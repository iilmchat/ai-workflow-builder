import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { NodeDataValidationException } from '../engine/errors.js';
import {
  DocumentTemplateInvalidException,
  type DocumentTemplateInvalidCode,
} from './document.errors.js';

/**
 * Рендерер DOCX-шаблонов `docxtemplater` + `pizzip` (v0.11 S2, DESIGN § 3.1.3).
 *
 * Сервис — чистый рендерер/инспектор: он не знает ни о БД, ни о `node_runs`,
 * ни о хранилище. Загрузку, права и хранение делает
 * `DocumentTemplatesService` (S3), исполнение узла — S4. Такое разделение
 * позволяет тестировать ZIP/OOXML-защиту без Nest-графа и без PostgreSQL.
 *
 * **Почему core `docxtemplater`, без модулей.** Нужны только простые
 * плейсхолдеры `{name}` и циклы `{#items}…{/items}`; HTML/Image/Table-модули
 * платные и добавляют XSS/XML-риски (DESIGN § 3.1.3).
 *
 * **Почему проверки идут до docxtemplater.** Библиотека сама распаковывает ZIP
 * и парсит XML, поэтому zip bomb, макросы и DTD обязаны быть отсечены по
 * заголовкам архива — иначе «проверка» уже выполнила бы опасную работу.
 */

/** Результат инспекции шаблона при загрузке. */
export interface DocumentTemplateInspection {
  /** Простые плейсхолдеры в порядке сортировки, без дублей. */
  readonly placeholders: readonly string[];
}

/** Результат рендера. */
export interface DocumentTemplateRenderResult {
  /** Готовый DOCX. */
  readonly buffer: Buffer;
  /** Плейсхолдеры, для которых не нашлось значения (рендерятся пустой строкой). */
  readonly missingVariables: readonly string[];
}

/** Сигнатура локального заголовка ZIP-файла (`PK\x03\x04`). */
const ZIP_SIGNATURE = 0x04034b50;

/** Части OOXML, без которых `.docx` заведомо не откроется. */
const REQUIRED_ZIP_ENTRIES = ['[Content_Types].xml', 'word/document.xml'] as const;

/** Признак VBA-проекта в архиве (`.docm`). */
const VBA_PROJECT_MARKER = 'vbaProject.bin';

/** Признак macro-enabled content-type в `[Content_Types].xml`. */
const MACRO_CONTENT_TYPE_MARKER = 'macroEnabled';

/** Максимально допустимый коэффициент сжатия (DESIGN § 3.1.3). */
const MAX_COMPRESSION_RATIO = 100;

/** Дефолты лимитов — те же, что в `DocumentTemplateEnvSchema` (DESIGN § 3.1.9). */
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 52_428_800;
const DEFAULT_MAX_ENTRIES = 2_000;
const DEFAULT_MAX_VARIABLES_BYTES = 262_144;

/**
 * Часть внутренних метаданных PizZip, нужная для проверки zip bomb.
 *
 * `_data.uncompressedSize` — внутреннее поле библиотеки (в публичных типах его
 * нет). Доступ изолирован здесь, чтобы обновление PizZip падало тестом, а не в
 * проде. Тип намеренно «слабый»: любое не-число означает fail-closed.
 */
interface PizZipEntryMetadata {
  readonly _data?: {
    readonly uncompressedSize?: unknown;
  };
}

/** Компилирует шаблон и извлекает плейсхолдеры/рендерит данные. */
@Injectable()
export class DocumentTemplateService {
  private readonly logger = new Logger(DocumentTemplateService.name);

  /** Лимит распакованного размера архива (env `DOCUMENT_TEMPLATE_MAX_UNCOMPRESSED_BYTES`). */
  private readonly maxUncompressedBytes: number;

  /** Лимит числа записей ZIP-архива (env `DOCUMENT_TEMPLATE_MAX_ENTRIES`). */
  private readonly maxEntries: number;

  /** Лимит размера JSON-переменных (env `DOCUMENT_TEMPLATE_MAX_VARIABLES_BYTES`). */
  private readonly maxVariablesBytes: number;

  /**
   * @param config - доступ к env через `ConfigService` (RULES 4.6), а не
   *   `process.env` напрямую: значения уже провалидированы `EnvSchema`
   */
  constructor(private readonly config: ConfigService) {
    this.maxUncompressedBytes =
      config.get<number>('DOCUMENT_TEMPLATE_MAX_UNCOMPRESSED_BYTES') ??
      DEFAULT_MAX_UNCOMPRESSED_BYTES;
    this.maxEntries =
      config.get<number>('DOCUMENT_TEMPLATE_MAX_ENTRIES') ?? DEFAULT_MAX_ENTRIES;
    this.maxVariablesBytes =
      config.get<number>('DOCUMENT_TEMPLATE_MAX_VARIABLES_BYTES') ??
      DEFAULT_MAX_VARIABLES_BYTES;
  }

  /**
   * Компилирует шаблон и возвращает список простых плейсхолдеров.
   *
   * @param content - содержимое `.docx`
   * @returns список имён (без `#`, `/`, `^`, `@`, `=`), без дублей
   * @throws DocumentTemplateInvalidException если архив или теги битые
   */
  inspect(content: Buffer): DocumentTemplateInspection {
    const doc = this.createDocument(content);
    const placeholders = extractPlaceholders(doc.getFullText());

    this.logger.debug(`Шаблон скомпилирован: плейсхолдеров ${placeholders.length}`);

    return { placeholders };
  }

  /**
   * Рендерит шаблон данными.
   *
   * Отсутствующая переменная не роняет документ: `nullGetter` возвращает
   * пустую строку, а имя попадает в `missingVariables` (DESIGN § 3.1.4).
   *
   * @param content - содержимое `.docx`
   * @param variables - значения плейсхолдеров (объект)
   * @returns DOCX и список незаполненных переменных
   * @throws DocumentTemplateInvalidException при синтаксисе, рендере или
   *   превышении лимита размера переменных
   */
  async renderAsync(
    content: Buffer,
    variables: Record<string, unknown>,
  ): Promise<DocumentTemplateRenderResult> {
    this.assertVariablesSize(content, variables);

    const missing = new Set<string>();
    const doc = this.createDocument(content, (part) => {
      missing.add(String(part.value));

      return '';
    });

    try {
      // renderAsync, а не render: единый async-контракт и поддержка
      // Promise-значений в переменных.
      await doc.renderAsync(variables);
    } catch (error: unknown) {
      throw toTemplateRenderException(error);
    }

    const buffer = doc.toBuffer({ compression: 'DEFLATE' });

    return {
      buffer,
      missingVariables: [...missing].sort(),
    };
  }

  /**
   * Проверяет, что JSON-переменные не превышают лимит (DESIGN § 3.1.3).
   *
   * Проверка живёт в рендерере, а не в исполнителе: лимит относится к тому же
   * шагу, где объект превращается в XML, и должен срабатывать и в S3-тестах
   * рендера, и в S4-исполнителе одинаково.
   *
   * @param content - содержимое шаблона (для подсказки в сообщении)
   * @param variables - значения плейсхолдеров
   * @throws DocumentTemplateInvalidException если сериализация невозможна или
   *   результат больше `DOCUMENT_TEMPLATE_MAX_VARIABLES_BYTES`
   */
  private assertVariablesSize(
    content: Buffer,
    variables: Record<string, unknown>,
  ): void {
    let serialized: string;

    try {
      serialized = JSON.stringify(variables) ?? '';
    } catch {
      throw new DocumentTemplateInvalidException(
        'render',
        'переменные шаблона не сериализуются в JSON',
      );
    }

    const bytes = Buffer.byteLength(serialized, 'utf8');

    if (bytes > this.maxVariablesBytes) {
      throw new DocumentTemplateInvalidException(
        'render',
        `переменные шаблона больше лимита: ${bytes} байт > ${this.maxVariablesBytes} байт`,
      );
    }

    // Длина шаблона участвует в логе, чтобы при разборе инцидента было видно,
    // к какому шаблону относятся переменные (RULES 5.9: без содержимого).
    this.logger.debug(
      `Рендер шаблона: ${content.byteLength} байт, переменных ${bytes} байт`,
    );
  }

  /**
   * Создаёт docxtemplater с безопасными опциями.
   *
   * - `paragraphLoop`/`linebreaks` — циклы и переносы без «мусорных» пустых
   *   абзацев;
   * - `nullGetter` — отсутствующая переменная даёт пустую строку, а не
   *   `undefined`;
   * - `errorLogging: false` — docxtemplater по умолчанию печатает ошибку в
   *   консоль вместе с фрагментом шаблона (`context`); это содержимое
   *   пользовательского документа, которое не должно попадать в логи
   *   (RULES 5.9). Наружу ошибка всё равно уходит через наше исключение;
   * - никаких `modules` (HTML/Image/Table — платные и не нужны) и `parser`
   *   (angular-expressions не подключаем: это исполняемый парсер).
   *
   * @param content - содержимое `.docx`
   * @param nullGetter - обработчик отсутствующей переменной
   * @returns скомпилированный документ
   * @throws DocumentTemplateInvalidException если архив небезопасен или теги
   *   не компилируются
   */
  private createDocument(
    content: Buffer,
    nullGetter?: (part: { value: unknown }) => string,
  ): Docxtemplater {
    const zip = this.assertDocxArchive(content);

    try {
      return new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        errorLogging: false,
        nullGetter: nullGetter ?? (() => ''),
      });
    } catch (error: unknown) {
      throw toTemplateSyntaxException(error);
    }
  }

  /**
   * Проверяет, что буфер — безопасный OOXML-архив.
   *
   * Проверки идут до docxtemplater: библиотека распаковывает ZIP и парсит XML,
   * поэтому zip bomb, макросы и DTD должны быть отсечены раньше.
   *
   * **Порядок отличается от DESIGN § 3.1.3 одной деталью.** Размеры
   * распакованных частей читаются **до** первого `asText()`: PizZip лениво
   * распаковывает запись и подменяет `_data` при чтении, после чего
   * `uncompressedSize` недоступен. Если сначала проверить макросы через
   * `asText()` (как в псевдокоде DESIGN), то fail-closed проверка ниже
   * отклонила бы **любой** шаблон. Поэтому: лимиты (нужны только метаданные) →
   * макросы/DTD (нужен текст).
   *
   * @param content - содержимое `.docx`
   * @returns открытый ZIP для рендера
   * @throws DocumentTemplateInvalidException если файл не ZIP, не OOXML,
   *   содержит макросы/DTD или превышает лимиты
   */
  private assertDocxArchive(content: Buffer): PizZip {
    if (content.length < 4 || content.readUInt32LE(0) !== ZIP_SIGNATURE) {
      throw new DocumentTemplateInvalidException(
        'invalid-zip',
        'файл не является ZIP',
      );
    }

    let zip: PizZip;

    try {
      zip = new PizZip(content);
    } catch (error: unknown) {
      throw new DocumentTemplateInvalidException(
        'invalid-zip',
        'не удалось открыть ZIP-архив',
        errorDetails(error),
      );
    }

    const names = Object.keys(zip.files);

    for (const name of REQUIRED_ZIP_ENTRIES) {
      if (!names.includes(name)) {
        throw new DocumentTemplateInvalidException(
          'invalid-docx',
          `в архиве нет обязательного файла ${name}`,
        );
      }
    }

    if (names.length > this.maxEntries) {
      throw new DocumentTemplateInvalidException(
        'invalid-docx',
        `слишком много файлов в архиве: ${names.length}`,
      );
    }

    // Размеры читаются до любых asText(): см. JSDoc метода.
    let totalUncompressed = 0;
    let unknownSize = false;

    for (const name of names) {
      const size = readUncompressedSize(zip, name);

      if (size === undefined) {
        unknownSize = true;
        continue;
      }

      totalUncompressed += size;
    }

    if (unknownSize) {
      // fail-closed: если метаданные PizZip изменились и размер не прочитать,
      // пропускать архив нельзя — иначе проверка zip bomb превращается в no-op.
      throw new DocumentTemplateInvalidException(
        'invalid-docx',
        'не удалось проверить распакованный размер (fail-closed)',
      );
    }

    if (totalUncompressed > this.maxUncompressedBytes) {
      throw new DocumentTemplateInvalidException(
        'invalid-docx',
        `распакованный размер больше лимита: ${totalUncompressed} байт > ${this.maxUncompressedBytes} байт`,
      );
    }

    if (content.length * MAX_COMPRESSION_RATIO < totalUncompressed) {
      throw new DocumentTemplateInvalidException(
        'invalid-docx',
        'подозрительный коэффициент сжатия (zip bomb)',
      );
    }

    if (
      names.some((name) => name.endsWith(VBA_PROJECT_MARKER)) ||
      zip.file('[Content_Types].xml')?.asText().includes(MACRO_CONTENT_TYPE_MARKER) ===
        true
    ) {
      throw new DocumentTemplateInvalidException(
        'invalid-docx',
        'макросы (.docm/VBA) не поддерживаются',
      );
    }

    for (const name of names) {
      // Бинарные части (изображения, embedded OLE) не декодируем в текст:
      // DTD/ENTITY ищется только в XML/rels, где он и может встретиться.
      if (!name.endsWith('.xml') && !name.endsWith('.rels')) {
        continue;
      }

      const text = zip.file(name)?.asText() ?? '';

      if (text.includes('<!DOCTYPE') || text.includes('<!ENTITY')) {
        throw new DocumentTemplateInvalidException(
          'invalid-docx',
          `в ${name} найден DTD/ENTITY (XXE)`,
        );
      }
    }

    return zip;
  }
}

/**
 * Извлекает простые имена плейсхолдеров из полного текста шаблона.
 *
 * `getFullText()` склеивает абзацы и оставляет теги как есть
 * (`{name}`, `{#items}`), поэтому имя — это тег без модификатора
 * (`#`/`/`/`^`/`@`/`=`) и без пробелов по краям. Цикл `{#items}…{/items}`
 * даёт одно имя `items`: значение нужно шаблону, поэтому оно попадает в
 * список. Дубли удаляются, результат сортируется — он показывается в UI и
 * сравнивается в тестах.
 *
 * @param text - текст документа из docxtemplater
 * @returns отсортированные имена без модификаторов
 */
export function extractPlaceholders(text: string): string[] {
  const names = new Set<string>();

  for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
    const raw = match[1]?.trim() ?? '';

    if (raw.length === 0) {
      continue;
    }

    // Модификатор — один символ в начале тега: `{#items}`, `{/items}`,
    // `{^items}`, `{@raw}`, `{=...}`. Для `/` бывает и двойной (`{//...}`),
    // но docxtemplater core такие теги не поддерживает — хватит одного.
    const name = raw.replace(/^[#/^@=]+/, '').trim();

    if (name.length > 0) {
      names.add(name);
    }
  }

  return [...names].sort();
}

/**
 * Читает распакованный размер записи ZIP по внутренним метаданным PizZip.
 *
 * @param zip - открытый архив
 * @param name - имя записи
 * @returns размер в байтах либо `undefined`, если метаданные не число
 */
function readUncompressedSize(zip: PizZip, name: string): number | undefined {
  const file = zip.files[name];

  if (file === undefined) {
    return undefined;
  }

  const data = (file as unknown as PizZipEntryMetadata)._data;
  const size = data?.uncompressedSize;

  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    return undefined;
  }

  return size;
}

/**
 * Разбирает `inputs.prompt` и `data.variables` узла `document_gen` в объект
 * переменных шаблона (v0.11 S4-контракт, DESIGN § 3.1.4).
 *
 * Приоритет: вход важнее fallback. Поддерживаются:
 * - отсутствие входа → только `fallback`;
 * - объект → слияние с `fallback`;
 * - массив → `{ items: [...] }` (шаблон использует `{#items}…{/items}`);
 * - JSON-строка → JSON-объект (частая форма ответа LLM).
 *
 * Строка обязана быть JSON-объектом: модель, «объяснившая» ответ прозой, не
 * должна целиком попадать в документ.
 *
 * @param inputs - входы узла (`inputs.prompt` — объект/массив/JSON-строка)
 * @param fallback - `data.variables` из определения узла
 * @returns объект переменных без прототипных ключей
 * @throws NodeDataValidationException если вход не объект/JSON-объект
 */
export function resolveTemplateVariables(
  inputs: Record<string, unknown>,
  fallback: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const input = inputs.prompt;
  const base = fallback ?? {};

  if (input === undefined || input === null || input === '') {
    return sanitizeVariables(base);
  }

  if (typeof input === 'object' && !Array.isArray(input)) {
    return sanitizeVariables({ ...base, ...(input as Record<string, unknown>) });
  }

  if (Array.isArray(input)) {
    // Массив — частая форма ответа LLM; заворачиваем в {items}, чтобы
    // шаблон мог использовать {#items}…{/items}.
    return sanitizeVariables({ ...base, items: input });
  }

  if (typeof input === 'string') {
    let parsed: unknown;

    try {
      parsed = JSON.parse(input);
    } catch {
      throw new NodeDataValidationException(
        'document_gen',
        'режим template ожидает JSON-объект переменных в inputs.prompt',
      );
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new NodeDataValidationException(
        'document_gen',
        'inputs.prompt должен быть JSON-объектом переменных',
      );
    }

    return sanitizeVariables({ ...base, ...(parsed as Record<string, unknown>) });
  }

  throw new NodeDataValidationException(
    'document_gen',
    'inputs.prompt должен быть объектом или JSON-строкой',
  );
}

/**
 * Удаляет ключи, которые могут загрязнить прототип (prototype pollution).
 *
 * Фильтруются `__proto__`, `constructor` и `prototype` на верхнем уровне:
 * переменные приходят из JSON-ответа LLM и из `data.variables` — это внешние
 * данные (RULES 1.17), а `{ ...base, ...input }` иначе скопировал бы опасный
 * ключ в объект, который уходит в рендерер.
 *
 * @param value - собранные переменные (fallback + вход)
 * @returns копия без ключей `__proto__`/`constructor`/`prototype`
 */
export function sanitizeVariables(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    result[key] = item;
  }

  return result;
}

/**
 * Переводит ошибку docxtemplater в {@link DocumentTemplateInvalidException}
 * с кодом `syntax` (ошибка компиляции тегов).
 *
 * @param error - значение из `catch`
 * @returns доменная ошибка для контроллера/исполнителя
 */
function toTemplateSyntaxException(error: unknown): DocumentTemplateInvalidException {
  return new DocumentTemplateInvalidException(
    'syntax',
    'шаблон содержит некорректные теги',
    errorDetails(error),
  );
}

/**
 * Переводит ошибку docxtemplater в {@link DocumentTemplateInvalidException}
 * с кодом `render` (ошибка подстановки данных).
 *
 * @param error - значение из `catch`
 * @returns доменная ошибка для контроллера/исполнителя
 */
function toTemplateRenderException(error: unknown): DocumentTemplateInvalidException {
  return new DocumentTemplateInvalidException(
    'render',
    'не удалось отрендерить шаблон',
    errorDetails(error),
  );
}

/**
 * Извлекает человекочитаемые подробности из ошибки docxtemplater.
 *
 * У `TemplateError` верхнего уровня `message` — «Multi error», а реальные
 * причины лежат в `properties.errors[]`: `properties.explanation` и
 * `properties.file`. Документ целиком не включается (RULES 5.9) — только часть
 * (`word/document.xml`) и текст объяснения.
 *
 * @param error - значение из `catch`
 * @returns список подробностей; пустой, если структура не распознана
 */
function errorDetails(error: unknown): string[] {
  if (typeof error !== 'object' || error === null) {
    return [];
  }

  const properties = (error as { properties?: unknown }).properties;
  const nested =
    typeof properties === 'object' && properties !== null
      ? (properties as { errors?: unknown }).errors
      : undefined;

  if (!Array.isArray(nested)) {
    return error instanceof Error && error.message.length > 0
      ? [error.message]
      : [];
  }

  const details: string[] = [];

  for (const item of nested) {
    const detail = describeNestedError(item);

    if (detail !== null) {
      details.push(detail);
    }
  }

  return details;
}

/**
 * Описывает одну вложенную ошибку docxtemplater (`properties.errors[]`).
 *
 * @param item - элемент массива ошибок
 * @returns строка «файл: объяснение» (без содержимого документа) или `null`
 */
function describeNestedError(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }

  const { message, properties } = item as {
    message?: unknown;
    properties?: unknown;
  };
  const nested =
    typeof properties === 'object' && properties !== null
      ? (properties as { explanation?: unknown; file?: unknown })
      : undefined;
  const explanation =
    typeof nested?.explanation === 'string'
      ? nested.explanation
      : typeof message === 'string'
        ? message
        : null;

  if (explanation === null || explanation.length === 0) {
    return null;
  }

  return typeof nested?.file === 'string'
    ? `${nested.file}: ${explanation}`
    : explanation;
}

/** Коды отказа шаблона — реэкспорт для вызывающего кода (S3/S4). */
export type { DocumentTemplateInvalidCode };
