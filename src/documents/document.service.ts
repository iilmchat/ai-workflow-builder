import { Injectable, Logger } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ILevelsOptions,
  type NumberingDefinition,
} from 'docx';
import { z } from 'zod';

/**
 * Генерация DOCX из Markdown и JSON (v0.10 S3).
 *
 * Сервис — чистый рендерер: он не знает ни о `node_runs`, ни о хранилище.
 * Конвейер S6 будет таким: Markdown/JSON → {@link DocumentModel} → DOCX
 * (`Packer.toBuffer`) → `IMediaStorage.saveGeneratedAsync` (S5).
 *
 * **Почему `docx`, а не `docxtemplater`/LibreOffice.** Пользовательских
 * шаблонов в v0.10 нет, а `docx` собирает документ кодом: не нужен ни
 * .docx-шаблон, ни внешний бинарник в runtime (DESIGN v0.10 § 2.3).
 *
 * **Почему свой Markdown-парсер, а не `markdown-it`.** В зависимостях проекта
 * `markdown-it` отсутствует, а задача S3 разрешает простой парсер. Поддержаны
 * ровно те конструкции, которые нужны документу: H1–H3, абзацы, маркированные
 * и нумерованные списки, fenced code, GFM-таблицы и инлайн-разметка
 * (`**bold**`, `*italic*`, `` `code` ``, ссылки). HTML в Markdown не
 * исполняется и не превращается в разметку DOCX — это важно, потому что
 * Markdown приходит из LLM/пользовательского узла (RULES 1.17).
 *
 * **Шрифты.** Основной текст — Times New Roman 12 pt, заголовки — Arial
 * (16/14/12 pt), код — Consolas 10 pt. Размеры `docx` задаются в полупунктах:
 * 12 pt = 24.
 */

/** MIME-тип DOCX (нужен исполнителю S6 для `outputs.mimeType`). */
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Основной шрифт документа. */
const BODY_FONT = 'Times New Roman';

/** Шрифт заголовков: отличается от основного, как принято в деловых документах. */
const HEADING_FONT = 'Arial';

/** Моноширинный шрифт для кода и inline-code. */
const CODE_FONT = 'Consolas';

/** Размер основного текста в полупунктах (12 pt). */
const BODY_FONT_SIZE = 24;

/** Размер кода в полупунктах (10 pt). */
const CODE_FONT_SIZE = 20;

/** Максимальный уровень заголовка, который умеет DOCX-рендерер. */
const MAX_HEADING_LEVEL = 3;

/** Максимальный уровень вложенности списка (Word поддерживает 0–8). */
const MAX_LIST_LEVEL = 8;

/** Размер поля страницы в twips (2 см). */
const PAGE_MARGIN_TWIPS = 1_134;

/** Формат A4 в twips (210 × 297 мм). */
const A4_WIDTH_TWIPS = 11_906;
const A4_HEIGHT_TWIPS = 16_838;

/**
 * Уровень заголовка в документе (H1–H3).
 *
 * H4–H6 из Markdown сводятся к H3: в документе v0.10 глубже трёх уровней
 * структуры нет, а `docx` без явной настройки всё равно рисует их мельче.
 */
export type DocumentHeadingLevel = 1 | 2 | 3;

/** Блок «заголовок». */
export interface DocumentHeadingBlock {
  /** Тип блока. */
  readonly type: 'heading';
  /** Уровень H1–H3. */
  readonly level: DocumentHeadingLevel;
  /** Текст заголовка (с инлайн-разметкой). */
  readonly text: string;
}

/** Блок «абзац». */
export interface DocumentParagraphBlock {
  /** Тип блока. */
  readonly type: 'paragraph';
  /** Текст абзаца (с инлайн-разметкой). */
  readonly text: string;
}

/** Один пункт списка. */
export interface DocumentListItem {
  /** Текст пункта (с инлайн-разметкой). */
  readonly text: string;
  /** Уровень вложенности: 0 — верхний, до {@link MAX_LIST_LEVEL}. */
  readonly level: number;
}

/** Блок «список»: пункты с общим стилем нумерации. */
export interface DocumentListBlock {
  /** Тип блока. */
  readonly type: 'list';
  /** `true` — нумерованный, `false` — маркированный. */
  readonly ordered: boolean;
  /** Пункты списка в порядке следования. */
  readonly items: readonly DocumentListItem[];
}

/** Блок «код» (fenced code из Markdown). */
export interface DocumentCodeBlock {
  /** Тип блока. */
  readonly type: 'code';
  /** Содержимое без открывающих/закрывающих fence'ов. */
  readonly text: string;
}

/** Блок «таблица» (GFM-таблица из Markdown). */
export interface DocumentTableBlock {
  /** Тип блока. */
  readonly type: 'table';
  /** Заголовки колонок. */
  readonly headers: readonly string[];
  /** Строки таблицы; длина каждой строки равна числу колонок. */
  readonly rows: readonly (readonly string[])[];
}

/** Блок документа — единица, которую умеет рендерить {@link DocumentService}. */
export type DocumentBlock =
  | DocumentHeadingBlock
  | DocumentParagraphBlock
  | DocumentListBlock
  | DocumentCodeBlock
  | DocumentTableBlock;

/** Промежуточная модель документа: заголовок (опционально) и блоки. */
export interface DocumentModel {
  /**
   * Заголовок документа из JSON-режима. В Markdown не заполняется: H1 остаётся
   * обычным блоком заголовка, чтобы не дублировать его в теле документа.
   */
  readonly title?: string;
  /** Блоки в порядке вывода. */
  readonly blocks: readonly DocumentBlock[];
}

/**
 * Ошибка рендера документа.
 *
 * Наследуется от `Error`, а не от Nest `HttpException`: рендер живёт в
 * worker'е и должен приводить к `run.status='failed'`, а не к HTTP-ответу.
 * Текст содержит причину (битый JSON, неизвестный блок), но не данные
 * пользователя целиком — они могут содержать PII (RULES 5.9).
 */
export class DocumentRenderException extends Error {
  /**
   * @param message - понятный пользователю текст ошибки
   * @param options.cause - исходная ошибка, если есть
   */
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = 'DocumentRenderException';

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Схема JSON-режима (v0.10 S3).
 *
 * Структура из задачи: `{ title, blocks: [{ type, text, level? }] }`.
 * Неизвестные поля Zod отбрасывает — это позволяет расширять контракт без
 * падения старых графов. `level` у заголовка — 1–6 (как в Markdown), у списка —
 * уровень вложенности; значения вне диапазона нормализуются при рендере.
 */
const JsonBlockSchema = z.object({
  type: z.enum(['paragraph', 'heading', 'list']),
  text: z.string(),
  level: z.number().int().min(1).max(6).optional(),
  /** Для `list`: `true` — нумерованный, по умолчанию маркированный. */
  ordered: z.boolean().optional(),
});

/** Схема JSON-документа: заголовок опционален, блоки обязательны. */
const JsonDocumentSchema = z.object({
  title: z.string().trim().max(200).optional(),
  blocks: z.array(JsonBlockSchema),
});

/**
 * Заголовок Markdown: `#`, `##`, … (не более шести, с пробелом после).
 *
 * Закрывающие `#` срезаются только после пробела: `# C#` — это заголовок
 * «C#», а не «C».
 */
const HEADING_PATTERN = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;

/** Открывающий/закрывающий fence кода (``` или ~~~). */
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})\s*(.*)$/;

/** Пункт списка: отступ, маркер (`-`, `*`, `+`, `1.`, `1)`) и текст. */
const LIST_ITEM_PATTERN = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** Строка-разделитель GFM-таблицы: `| --- | :---: |`. */
const TABLE_SEPARATOR_CELL_PATTERN = /^:?-{3,}:?$/;

/**
 * Инлайн-разметка.
 *
 * Inline-code и ссылки идут раньше выделений: иначе `**` внутри `` `код` ``
 * разбирался бы как жирный, а `[**метка**](url)` — как текст с выделением, а
 * не ссылка. Внутри выделений альтернативы упорядочены от длинных маркеров к
 * коротким, иначе `**` был бы разобран как два `*`.
 */
const INLINE_PATTERN =
  /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<!\w)\*([^*\n]+)\*(?!\w)|(?<!\w)_([^_\n]+)_(?!\w)/g;

/** Фрагмент инлайн-текста с применённым форматированием. */
interface InlineSegment {
  /** Текст фрагмента. */
  readonly text: string;
  /** Полужирный. */
  readonly bold?: boolean;
  /** Курсив. */
  readonly italics?: boolean;
  /** Inline-code (моноширинный шрифт). */
  readonly code?: boolean;
  /** URL ссылки (только http/https/mailto). */
  readonly link?: string;
}

/** Дополнительное форматирование, которое накладывается на весь фрагмент. */
interface InlineBaseStyle {
  /** Сделать весь текст полужирным (например, заголовок таблицы). */
  readonly bold?: boolean;
}

/** Контекст рендера: накопленные блоки и нумерация списков. */
interface RenderContext {
  /** Готовые элементы документа в порядке вывода. */
  readonly children: (Paragraph | Table)[];
  /** Определения нумерации для нумерованных списков. */
  readonly numbering: NumberingDefinition[];
  /** Счётчик нумерованных списков: у каждого свой старт с 1. */
  orderedListCount: number;
}

/** Соответствие уровня Markdown → константе заголовка `docx`. */
const HEADING_BY_LEVEL: Readonly<
  Record<DocumentHeadingLevel, (typeof HeadingLevel)[keyof typeof HeadingLevel]>
> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

/**
 * Ограничивает число заданным диапазоном.
 *
 * @param value - исходное значение
 * @param min - нижняя граница
 * @param max - верхняя граница
 * @returns значение внутри диапазона
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Приводит уровень заголовка из Markdown/JSON к H1–H3.
 *
 * @param level - сырой уровень (1–6)
 * @returns 1, 2 или 3
 */
function normalizeHeadingLevel(level: number): DocumentHeadingLevel {
  return clamp(Math.trunc(level), 1, MAX_HEADING_LEVEL) as DocumentHeadingLevel;
}

/**
 * Разбирает строку инлайн-разметки на фрагменты.
 *
 * Поддерживается только безопасное подмножество Markdown: HTML не
 * интерпретируется, ссылки ограничены `http(s)` и `mailto`. Непарные маркеры
 * остаются обычным текстом.
 *
 * @param text - строка с разметкой
 * @returns фрагменты в исходном порядке (минимум один, возможно пустой)
 */
function splitInlineMarkdown(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // `g`-regexp хранит `lastIndex`; создаём новый на каждый вызов, чтобы
  // параллельные рендеры не делили состояние.
  const pattern = new RegExp(INLINE_PATTERN.source, 'g');

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }

    const token = match[0];

    if (token.startsWith('**') || token.startsWith('__')) {
      segments.push({
        text: token.slice(2, -2),
        bold: true,
      });
    } else if (token.startsWith('`')) {
      segments.push({ text: token.slice(1, -1), code: true });
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const url = link?.[2]?.trim();

      if (url !== undefined && isSafeLinkTarget(url)) {
        segments.push({ text: label, link: url });
      } else {
        // Небезопасная/битая ссылка остаётся текстом — без кликабельного URL.
        segments.push({ text: label });
      }
    } else {
      segments.push({
        text: token.slice(1, -1),
        italics: true,
      });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text: '' }];
}

/**
 * Проверяет, что цель ссылки безопасна для DOCX-гиперссылки.
 *
 * @param url - URL из Markdown
 * @returns `true` для `http://`, `https://`, `mailto:`
 */
function isSafeLinkTarget(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^mailto:/i.test(url);
}

/**
 * Превращает инлайн-разметку в элементы `docx`.
 *
 * @param text - текст с разметкой
 * @param base - форматирование, применяемое ко всем фрагментам
 * @returns runs и гиперссылки для `Paragraph.children`
 */
function renderInline(
  text: string,
  base: InlineBaseStyle = {},
): (TextRun | ExternalHyperlink)[] {
  return splitInlineMarkdown(text).map((segment) => {
    const bold = base.bold === true || segment.bold === true;

    if (segment.link !== undefined) {
      return new ExternalHyperlink({
        link: segment.link,
        children: [
          new TextRun({
            text: segment.text,
            bold,
            italics: segment.italics === true,
            style: 'Hyperlink',
          }),
        ],
      });
    }

    return new TextRun({
      text: segment.text,
      bold,
      italics: segment.italics === true,
      ...(segment.code === true
        ? { font: CODE_FONT, size: CODE_FONT_SIZE }
        : {}),
    });
  });
}

/**
 * Делит строку таблицы по неэкранированным `|`.
 *
 * @param line - строка GFM-таблицы
 * @returns ячейки без крайних пустых сегментов
 */
function splitTableRow(line: string): string[] {
  let value = line.trim();

  if (value.startsWith('|')) {
    value = value.slice(1);
  }

  if (value.endsWith('|') && !value.endsWith('\\|')) {
    value = value.slice(0, -1);
  }

  const cells: string[] = [];
  let current = '';

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === '\\' && value[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }

    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());

  return cells;
}

/**
 * Проверяет, что строка — разделитель GFM-таблицы.
 *
 * @param line - проверяемая строка
 * @returns `true`, если все ячейки состоят из `-` с необязательными `:`
 */
function isTableSeparator(line: string): boolean {
  if (!line.includes('|')) {
    return false;
  }

  const cells = splitTableRow(line);

  return (
    cells.length > 0 &&
    cells.every((cell) => TABLE_SEPARATOR_CELL_PATTERN.test(cell))
  );
}

/**
 * Проверяет, начинается ли на текущей строке новый блочный элемент.
 *
 * Нужен абзацу, чтобы не «съесть» следующий заголовок, список, таблицу или
 * fence кода.
 *
 * @param line - текущая строка
 * @param nextLine - следующая строка (для распознавания таблицы)
 * @returns `true`, если строка открывает новый блок
 */
function startsBlock(line: string, nextLine: string | undefined): boolean {
  if (HEADING_PATTERN.test(line) || FENCE_PATTERN.test(line)) {
    return true;
  }

  if (LIST_ITEM_PATTERN.test(line)) {
    return true;
  }

  return isTableStart(line, nextLine);
}

/**
 * Проверяет, что с текущей строки начинается GFM-таблица.
 *
 * @param line - строка с заголовками
 * @param nextLine - следующая строка (должна быть разделителем)
 * @returns `true`, если это таблица
 */
function isTableStart(line: string, nextLine: string | undefined): boolean {
  return (
    line.includes('|') &&
    nextLine !== undefined &&
    isTableSeparator(nextLine) &&
    splitTableRow(line).length === splitTableRow(nextLine).length
  );
}

/**
 * Разбирает Markdown в блоки документа.
 *
 * Поддерживаются H1–H6 (сводятся к H1–H3), абзацы, списки, fenced code,
 * GFM-таблицы. Смысл — не полный CommonMark, а предсказуемый набор
 * конструкций, которые пользователь ожидает увидеть в DOCX.
 *
 * @param markdown - исходный Markdown
 * @returns модель документа без заголовка (он остаётся H1-блоком)
 */
export function parseMarkdown(markdown: string): DocumentModel {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: DocumentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE_PATTERN.exec(line);

    if (fence !== null) {
      const marker = fence[1] ?? '```';
      const fenceChar = marker.startsWith('~') ? '~' : '`';
      const closingPattern = new RegExp(
        `^\\s*${fenceChar}{${marker.length},}\\s*$`,
      );
      const codeLines: string[] = [];
      let nextIndex = index + 1;

      while (nextIndex < lines.length) {
        const candidate = lines[nextIndex] ?? '';

        if (closingPattern.test(candidate)) {
          break;
        }

        codeLines.push(candidate);
        nextIndex += 1;
      }

      blocks.push({ type: 'code', text: codeLines.join('\n') });
      // Незакрытый fence не должен терять остаток документа: он становится
      // кодом до конца файла, а не молча отбрасывается.
      index = nextIndex < lines.length ? nextIndex + 1 : nextIndex;
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);

    if (heading !== null) {
      blocks.push({
        type: 'heading',
        level: normalizeHeadingLevel((heading[1] ?? '#').length),
        text: (heading[2] ?? '').trim(),
      });
      index += 1;
      continue;
    }

    if (isTableStart(line, lines[index + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      let nextIndex = index + 2;

      while (nextIndex < lines.length) {
        const candidate = lines[nextIndex] ?? '';

        if (candidate.trim() === '' || !candidate.includes('|')) {
          break;
        }

        const cells = splitTableRow(candidate);

        rows.push(headers.map((_, column) => cells[column] ?? ''));
        nextIndex += 1;
      }

      blocks.push({ type: 'table', headers, rows });
      index = nextIndex;
      continue;
    }

    if (LIST_ITEM_PATTERN.test(line)) {
      const firstItem = LIST_ITEM_PATTERN.exec(line);
      const ordered = /^\d/.test(firstItem?.[2] ?? '');
      const items: DocumentListItem[] = [];
      let nextIndex = index;

      while (nextIndex < lines.length) {
        const item = LIST_ITEM_PATTERN.exec(lines[nextIndex] ?? '');

        if (item === null || /^\d/.test(item[2] ?? '') !== ordered) {
          break;
        }

        // Вложенность в Markdown — два пробела на уровень; табуляция
        // раскрывается в два пробела, чтобы смешанные отступы не сбивали счёт.
        const indent = (item[1] ?? '').replace(/\t/g, '  ').length;

        items.push({
          text: (item[3] ?? '').trim(),
          level: clamp(Math.floor(indent / 2), 0, MAX_LIST_LEVEL),
        });
        nextIndex += 1;
      }

      blocks.push({ type: 'list', ordered, items });
      index = nextIndex;
      continue;
    }

    // Абзац: склеиваем соседние строки до пустой строки или нового блока.
    // Markdown-перенос без пустой строки — мягкий, поэтому пробел, а не `\n`.
    const paragraphLines = [line.trim()];
    let nextIndex = index + 1;

    while (nextIndex < lines.length) {
      const candidate = lines[nextIndex] ?? '';

      if (
        candidate.trim() === '' ||
        startsBlock(candidate, lines[nextIndex + 1])
      ) {
        break;
      }

      paragraphLines.push(candidate.trim());
      nextIndex += 1;
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
    index = nextIndex;
  }

  return { blocks };
}

/**
 * Преобразует JSON-документ в модель блоков.
 *
 * Ожидаемая структура:
 * `{ title?: string, blocks: Array<{ type: 'paragraph' | 'heading' | 'list',
 * text: string, level?: number }> }`.
 *
 * @param json - недоверенное значение (результат `JSON.parse` или поле узла)
 * @returns модель документа для рендера
 * @throws DocumentRenderException если структура не соответствует схеме
 */
export function parseJsonDocument(json: unknown): DocumentModel {
  const parsed = JsonDocumentSchema.safeParse(json);

  if (!parsed.success) {
    throw new DocumentRenderException(
      `Некорректная структура JSON документа:\n${z.prettifyError(parsed.error)}`,
      { cause: parsed.error },
    );
  }

  const blocks: DocumentBlock[] = [];

  for (const block of parsed.data.blocks) {
    if (block.type === 'heading') {
      blocks.push({
        type: 'heading',
        level: normalizeHeadingLevel(block.level ?? 1),
        text: block.text,
      });
      continue;
    }

    if (block.type === 'paragraph') {
      blocks.push({ type: 'paragraph', text: block.text });
      continue;
    }

    const ordered = block.ordered === true;
    const level = clamp((block.level ?? 1) - 1, 0, MAX_LIST_LEVEL);
    const item: DocumentListItem = { text: block.text, level };
    const previous = blocks.at(-1);

    if (previous?.type === 'list' && previous.ordered === ordered) {
      // Одиночные list-блоки в JSON — это пункты одного списка; собираем их,
      // чтобы нумерация шла подряд, а не начиналась заново с каждого пункта.
      blocks[blocks.length - 1] = {
        ...previous,
        items: [...previous.items, item],
      };
      continue;
    }

    blocks.push({ type: 'list', ordered, items: [item] });
  }

  const title = parsed.data.title?.trim();

  return {
    ...(title !== undefined && title.length > 0 ? { title } : {}),
    blocks,
  };
}

/**
 * Строит уровни нумерации для одного нумерованного списка.
 *
 * @returns определения уровней 0–8 с отступом и форматом `1.`
 */
function buildOrderedListLevels(): ILevelsOptions[] {
  return Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => ({
    level,
    format: LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { left: 720 + level * 360, hanging: 360 },
      },
    },
  }));
}

/**
 * Добавляет блок списка в документ.
 *
 * @param block - блок списка
 * @param context - контекст рендера
 */
function appendList(block: DocumentListBlock, context: RenderContext): void {
  if (!block.ordered) {
    for (const item of block.items) {
      context.children.push(
        new Paragraph({
          bullet: { level: clamp(item.level, 0, MAX_LIST_LEVEL) },
          children: renderInline(item.text),
        }),
      );
    }

    return;
  }

  // У каждого нумерованного списка своя нумерация: Word начинает её с 1.
  // Общий reference заставил бы второй список продолжать нумерацию первого.
  const reference = `document-ordered-list-${context.orderedListCount}`;
  context.orderedListCount += 1;
  context.numbering.push({
    reference,
    levels: buildOrderedListLevels(),
  });

  for (const item of block.items) {
    context.children.push(
      new Paragraph({
        numbering: {
          reference,
          level: clamp(item.level, 0, MAX_LIST_LEVEL),
        },
        children: renderInline(item.text),
      }),
    );
  }
}

/**
 * Добавляет блок кода в документ.
 *
 * Код выводится одним абзацем: строки разделены `TextRun.break`, поэтому
 * визуально это единый блок, а не набор независимых абзацев с интервалами.
 *
 * @param block - блок кода
 * @param context - контекст рендера
 */
function appendCodeBlock(
  block: DocumentCodeBlock,
  context: RenderContext,
): void {
  const lines = block.text.replace(/\n$/, '').split('\n');
  const runs = lines.map(
    (line, index) =>
      new TextRun({
        text: line,
        font: CODE_FONT,
        size: CODE_FONT_SIZE,
        ...(index > 0 ? { break: 1 } : {}),
      }),
  );

  context.children.push(
    new Paragraph({
      spacing: { before: 120, after: 120 },
      children: runs,
    }),
  );
}

/**
 * Добавляет GFM-таблицу в документ.
 *
 * @param block - блок таблицы
 * @param context - контекст рендера
 */
function appendTable(block: DocumentTableBlock, context: RenderContext): void {
  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: 'BFBFBF',
  };
  const borders = {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: border,
    insideVertical: border,
  };
  const columnWidth =
    block.headers.length > 0 ? 100 / block.headers.length : 100;

  const cellWidth = {
    size: columnWidth,
    type: WidthType.PERCENTAGE,
  };

  /**
   * Собирает ячейку таблицы.
   *
   * @param text - содержимое ячейки
   * @param header - `true` для строки заголовков (полужирный + фон)
   * @returns ячейка с одним абзацем
   */
  const createCell = (text: string, header: boolean): TableCell =>
    new TableCell({
      width: cellWidth,
      ...(header
        ? {
            shading: {
              fill: 'E7E6E6',
            },
          }
        : {}),
      children: [
        new Paragraph({
          children: renderInline(text, { bold: header }),
        }),
      ],
    });

  const rows = [
    new TableRow({
      tableHeader: true,
      children: block.headers.map((header) => createCell(header, true)),
    }),
    ...block.rows.map(
      (row) =>
        new TableRow({
          children: block.headers.map((_, column) =>
            createCell(row[column] ?? '', false),
          ),
        }),
    ),
  ];

  context.children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders,
      rows,
    }),
  );
}

/**
 * Добавляет блоки в контекст рендера.
 *
 * @param blocks - блоки документа
 * @param context - контекст рендера
 */
function appendBlocks(
  blocks: readonly DocumentBlock[],
  context: RenderContext,
): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        context.children.push(
          new Paragraph({
            heading: HEADING_BY_LEVEL[block.level],
            children: renderInline(block.text),
          }),
        );
        break;
      case 'paragraph':
        context.children.push(
          new Paragraph({
            children: renderInline(block.text),
          }),
        );
        break;
      case 'list':
        appendList(block, context);
        break;
      case 'code':
        appendCodeBlock(block, context);
        break;
      case 'table':
        appendTable(block, context);
        break;
    }
  }
}

/**
 * Сервис генерации DOCX (v0.10 S3).
 *
 * Не зависит от хранилища и БД: на вход — Markdown/JSON, на выход — буфер
 * DOCX. Это позволяет тестировать рендер без Docker и S3, а исполнитель S6
 * добавляет к нему `saveGeneratedAsync` (S5).
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  /**
   * Генерирует DOCX из Markdown.
   *
   * @param markdown - исходный Markdown (может быть пустым — получится пустой
   *   валидный документ)
   * @returns содержимое .docx (ZIP, начинается с `PK`)
   * @throws DocumentRenderException если `docx` не смог собрать документ
   */
  async generateDocxFromMarkdownAsync(markdown: string): Promise<Buffer> {
    return this.renderAsync(parseMarkdown(markdown), 'markdown');
  }

  /**
   * Генерирует DOCX из JSON-структуры.
   *
   * @param json - недоверенное значение:
   *   `{ title?, blocks: [{ type, text, level? }] }`
   * @returns содержимое .docx (ZIP, начинается с `PK`)
   * @throws DocumentRenderException если структура не соответствует схеме или
   *   `docx` не смог собрать документ
   */
  async generateDocxFromJsonAsync(json: unknown): Promise<Buffer> {
    return this.renderAsync(parseJsonDocument(json), 'json');
  }

  /**
   * Собирает документ `docx` и упаковывает его в буфер.
   *
   * @param model - разобранная модель документа
   * @param source - источник (`markdown`/`json`) — только для лога
   * @returns содержимое .docx
   * @throws DocumentRenderException если упаковка не удалась
   */
  private async renderAsync(
    model: DocumentModel,
    source: 'markdown' | 'json',
  ): Promise<Buffer> {
    const context: RenderContext = {
      children: [],
      numbering: [],
      orderedListCount: 0,
    };

    if (model.title !== undefined) {
      context.children.push(
        new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          children: renderInline(model.title),
        }),
      );
    }

    appendBlocks(model.blocks, context);

    const document = new Document({
      creator: 'IIChatTools AI Workflow Builder',
      title: model.title ?? 'Документ',
      description: 'Сгенерировано IIChatTools AI Workflow Builder',
      styles: {
        default: {
          document: {
            run: {
              font: BODY_FONT,
              size: BODY_FONT_SIZE,
            },
            paragraph: {
              spacing: { after: 120, line: 276 },
            },
          },
          title: {
            run: {
              font: HEADING_FONT,
              size: 36,
              bold: true,
            },
            paragraph: {
              spacing: { after: 240 },
            },
          },
          heading1: {
            run: {
              font: HEADING_FONT,
              size: 32,
              bold: true,
            },
            paragraph: {
              spacing: { before: 240, after: 120 },
            },
          },
          heading2: {
            run: {
              font: HEADING_FONT,
              size: 28,
              bold: true,
            },
            paragraph: {
              spacing: { before: 200, after: 100 },
            },
          },
          heading3: {
            run: {
              font: HEADING_FONT,
              size: 24,
              bold: true,
            },
            paragraph: {
              spacing: { before: 160, after: 80 },
            },
          },
        },
      },
      ...(context.numbering.length > 0
        ? { numbering: { config: context.numbering } }
        : {}),
      sections: [
        {
          properties: {
            page: {
              size: {
                width: A4_WIDTH_TWIPS,
                height: A4_HEIGHT_TWIPS,
              },
              margin: {
                top: PAGE_MARGIN_TWIPS,
                right: PAGE_MARGIN_TWIPS,
                bottom: PAGE_MARGIN_TWIPS,
                left: PAGE_MARGIN_TWIPS,
              },
            },
          },
          children: context.children,
        },
      ],
    });

    try {
      const buffer = await Packer.toBuffer(document);

      this.logger.log(
        `DOCX из ${source}: ${model.blocks.length} блок(ов), ` +
          `${buffer.byteLength} байт`,
      );

      return buffer;
    } catch (error: unknown) {
      throw new DocumentRenderException(
        'Не удалось собрать DOCX: внутренняя ошибка рендерера',
        { cause: error },
      );
    }
  }
}
