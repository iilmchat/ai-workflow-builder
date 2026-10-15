import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExportWorkflowDto } from '../workflow/dto/export-workflow.dto.js';
import { TemplateFileSchema, type TemplateSummary } from './dto/template.dto.js';

/** Расширение файлов шаблонов. */
const TEMPLATE_FILE_EXTENSION = '.json';

/**
 * Каталог этого модуля (RULES 1.9: путь строится от `import.meta.url`, а не от
 * `process.cwd()` — иначе поведение зависело бы от того, откуда запущен процесс).
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Кандидаты на каталог шаблонов, в порядке приоритета.
 *
 * 1. Рядом с самим модулем — так работает в dev/тестах, где файл исполняется
 *    прямо из `src/templates` (vitest) или из `dist/templates` (`nest start`).
 * 2. `<корень репозитория>/src/templates` — фолбэк для собранного приложения:
 *    `nest build` не копирует `.json` в `dist`, потому что ассеты не объявлены
 *    в `nest-cli.json` (см. KI-289). Без этого фолбэка `GET /templates` на
 *    `node dist/main` вернул бы пустой список.
 *
 * Проверяется не «каталог существует», а «каталог существует и содержит хотя бы
 * один `.json`»: первый кандидат существует всегда, поэтому одной проверки
 * `existsSync` не хватило бы.
 */
const TEMPLATE_DIR_CANDIDATES: readonly string[] = [
  MODULE_DIR,
  join(MODULE_DIR, '..', '..', 'src', 'templates'),
];

/** Запись реестра шаблонов. */
interface TemplateEntry {
  /** Человекочитаемое имя шаблона (из файла). */
  name: string;
  /** Описание для карточки в UI (из файла). */
  description: string;
  /** Сам граф — тот же sharable-артефакт, что отдаёт экспорт. */
  data: ExportWorkflowDto;
}

/**
 * Загрузчик шаблонов из `src/templates/*.json` (R6.6.1, DESIGN v0.8 § 9).
 *
 * Реестр читается один раз при старте приложения (`OnModuleInit`) и держится в
 * памяти: шаблоны — часть поставки, а не пользовательские данные, поэтому
 * дисковый I/O на каждый `GET /templates` был бы лишним.
 *
 * Политика отказа — **fail-soft**: битый файл (не JSON, не проходит
 * `TemplateFileSchema`) не роняет старт приложения, а пропускается с
 * `logger.warn`. Причина: один испорченный шаблон не должен делать весь
 * продукт неработающим — остальные шаблоны и весь API остаются доступны.
 * Отсутствие каталога шаблонов обрабатывается так же (пустой список).
 */
@Injectable()
export class TemplateLoaderService implements OnModuleInit {
  private readonly logger = new Logger(TemplateLoaderService.name);
  /** Реестр: id шаблона (= имя файла без расширения) → запись. */
  private templates = new Map<string, TemplateEntry>();

  /**
   * Читает реестр шаблонов при инициализации модуля.
   *
   * @returns промис без значения; завершается, когда реестр загружен
   */
  async onModuleInit(): Promise<void> {
    const directory = await this.resolveTemplateDirAsync();

    if (directory === null) {
      this.logger.warn(
        `Каталог шаблонов не найден (искали: ${TEMPLATE_DIR_CANDIDATES.join(', ')}) — список шаблонов будет пустым`,
      );

      return;
    }

    await this.loadDirectoryAsync(directory);
  }

  /**
   * Возвращает краткий список шаблонов для UI.
   *
   * Промис, а не синхронный возврат, сознательно: реестр наполняется
   * асинхронным загрузчиком, и если источник когда-нибудь переедет на S3/БД,
   * сигнатура не изменится (RULES 1.4).
   *
   * @returns карточки шаблонов, отсортированные по id (детерминированно)
   */
  listAsync(): Promise<TemplateSummary[]> {
    const summaries = [...this.templates.entries()]
      .map(([id, entry]) => ({
        id,
        name: entry.name,
        description: entry.description,
        nodeCount: entry.data.nodes.length,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    return Promise.resolve(summaries);
  }

  /**
   * Возвращает граф шаблона по его id.
   *
   * @param id - id шаблона (имя файла без расширения, например `text-llm`)
   * @returns sharable-граф либо `null`, если такого шаблона нет
   */
  getAsync(id: string): Promise<ExportWorkflowDto | null> {
    return Promise.resolve(this.templates.get(id)?.data ?? null);
  }

  /**
   * Читает и валидирует все `.json` указанного каталога.
   *
   * Публичный, чтобы тесты могли прогнать загрузчик на временном каталоге (с
   * битым файлом) — путь при старте приложения фиксирован `import.meta.url`.
   *
   * Реестр заменяется целиком, а не дополняется: иначе после перезагрузки в нём
   * остались бы записи удалённых файлов. Если каталог не читается вовсе,
   * предыдущий реестр сохраняется — «нет данных» не равно «данных нет».
   *
   * @param directory - абсолютный путь к каталогу с шаблонами
   * @returns промис без значения
   */
  async loadDirectoryAsync(directory: string): Promise<void> {
    let entries: string[];

    try {
      const dirents = await readdir(directory, { withFileTypes: true });

      entries = dirents
        .filter((dirent) => dirent.isFile() && extname(dirent.name) === TEMPLATE_FILE_EXTENSION)
        .map((dirent) => dirent.name)
        .sort((left, right) => left.localeCompare(right));
    } catch (error: unknown) {
      this.logger.warn(`Каталог шаблонов ${directory} не читается: ${describeError(error)}`);

      return;
    }

    const loaded = new Map<string, TemplateEntry>();

    // Файлы читаются последовательно: каталог маленький (единицы файлов), а
    // параллельное чтение здесь ничего не ускоряет (RULES 4.17 — про циклы с
    // независимым I/O на больших коллекциях).
    for (const fileName of entries) {
      const entry = await this.readTemplateAsync(directory, fileName);

      if (entry !== null) {
        loaded.set(basename(fileName, TEMPLATE_FILE_EXTENSION), entry);
      }
    }

    this.templates = loaded;
    this.logger.log(
      `Шаблоны загружены: ${loaded.size} из ${entries.length} (${directory})`,
    );
  }

  /**
   * Читает один файл шаблона и валидирует его схемой.
   *
   * @param directory - каталог с шаблонами
   * @param fileName - имя файла (например `text-llm.json`)
   * @returns запись реестра либо `null`, если файл битый (с записью в warn)
   */
  private async readTemplateAsync(
    directory: string,
    fileName: string,
  ): Promise<TemplateEntry | null> {
    const filePath = join(directory, fileName);

    try {
      const raw: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      const parsed = TemplateFileSchema.safeParse(raw);

      if (!parsed.success) {
        this.logger.warn(
          `Шаблон ${fileName} пропущен: не соответствует схеме — ${describeError(parsed.error)}`,
        );

        return null;
      }

      return {
        name: parsed.data.name,
        description: parsed.data.description,
        // `description` — поле файла шаблона, в sharable-артефакт оно не входит.
        data: {
          version: parsed.data.version,
          name: parsed.data.name,
          nodes: parsed.data.nodes,
          edges: parsed.data.edges,
          exportedAt: parsed.data.exportedAt,
        },
      };
    } catch (error: unknown) {
      this.logger.warn(`Шаблон ${fileName} пропущен: ${describeError(error)}`);

      return null;
    }
  }

  /**
   * Ищет каталог шаблонов среди кандидатов {@link TEMPLATE_DIR_CANDIDATES}.
   *
   * @returns абсолютный путь к каталогу с хотя бы одним `.json` либо `null`
   */
  private async resolveTemplateDirAsync(): Promise<string | null> {
    for (const candidate of TEMPLATE_DIR_CANDIDATES) {
      if (!existsSync(candidate)) {
        continue;
      }

      try {
        const dirents = await readdir(candidate, { withFileTypes: true });
        const hasTemplate = dirents.some(
          (dirent) => dirent.isFile() && extname(dirent.name) === TEMPLATE_FILE_EXTENSION,
        );

        if (hasTemplate) {
          return candidate;
        }
      } catch (error: unknown) {
        this.logger.warn(`Кандидат ${candidate} не читается: ${describeError(error)}`);
      }
    }

    return null;
  }
}

/**
 * Приводит неизвестную ошибку к тексту для лога.
 *
 * @param error - значение из `catch` (может быть чем угодно, RULES 4.15)
 * @returns текст ошибки без стека
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : JSON.stringify(error);
}
