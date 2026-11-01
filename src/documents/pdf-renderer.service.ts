import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import {
  DocumentRenderException,
  parseJsonDocument,
  parseMarkdown,
  splitInlineMarkdown,
  type DocumentBlock,
  type DocumentListBlock,
  type DocumentModel,
  type InlineSegment,
} from './document.service.js';

/**
 * MIME-тип PDF (нужен исполнителю `document_gen` для `outputs.mimeType`).
 *
 * Экспортируется из рендерера, а не из `document.service`: DOCX и PDF — разные
 * форматы, и держать оба MIME-типа в одном файле значило бы смешать
 * ответственность (v0.12 S1, DESIGN § 3.1.3).
 */
export const PDF_MIME_TYPE = 'application/pdf';

/** Имя встроенного шрифта, под которым он регистрируется в PDFKit. */
const BODY_FONT = 'NotoSans';

/** Встроенный шрифт PDFKit для кода (есть в любом PDF-просмотрщике). */
const CODE_FONT = 'Courier';

/** Файл шрифта с кириллицей относительно этого модуля. */
const FONT_URL = new URL('./assets/NotoSans-Regular.ttf', import.meta.url);

/** Абсолютный путь к шрифту (работает и в `src` под Vitest, и в `dist`). */
const FONT_PATH = fileURLToPath(FONT_URL);

/** Поле страницы в пунктах (2 см), как у DOCX-рендерера. */
const PAGE_MARGIN = 56;

/** Размер основного текста, pt (DESIGN § 3.1.2). */
const BODY_FONT_SIZE = 12;

/**
 * Межстрочный интервал основного текста, pt.
 *
 * PDFKit считает `lineGap` добавкой к высоте строки: для 12 pt шрифта высота
 * ~13,8 pt, значит 4 pt дают ~1,5 интервала (DESIGN § 3.1.2).
 */
const BODY_LINE_GAP = 4;

/** Размер кода в блоке, pt. */
const CODE_FONT_SIZE = 9;

/** Внутренний отступ серого блока кода, pt. */
const CODE_PADDING = 8;

/** Размер заголовков H1–H3, pt (DESIGN § 3.1.2). */
const HEADING_FONT_SIZES: Readonly<Record<1 | 2 | 3, number>> = {
  1: 24,
  2: 18,
  3: 14,
};

/** Размер заголовка JSON-документа (`title`), pt. */
const TITLE_FONT_SIZE = 24;

/** Шаг отступа вложенного списка, pt. */
const LIST_INDENT = 18;

/** Основной цвет текста. */
const TEXT_COLOR = '#1A1A1A';

/** Цвет заголовков (чуть темнее основного текста). */
const HEADING_COLOR = '#111111';

/** Цвет ссылок (DESIGN § 3.1.2). */
const LINK_COLOR = '#1A56DB';

/** Цвет inline-кода. */
const INLINE_CODE_COLOR = '#7A3E00';

/** Цвет текста блока кода. */
const CODE_COLOR = '#333333';

/** Фон блока кода (DESIGN § 3.1.2). */
const CODE_BACKGROUND = '#F2F2F2';

/** Цвет разделителя под заголовком таблицы. */
const TABLE_BORDER_COLOR = '#BFBFBF';

/** Размер текста таблицы, pt. */
const TABLE_FONT_SIZE = 10;

/**
 * Состояние одного рендера.
 *
 * Объект локальный для вызова: два параллельных PDF (`Promise.all` в
 * движке) не должны делить `doc`/шрифт. Поэтому у сервиса нет изменяемых
 * полей рендера — только кэш загруженного шрифта.
 */
interface PdfRenderState {
  /** Созданный PDFKit-документ. */
  readonly doc: PDFKit.PDFDocument;
  /** Шрифт основного текста: Noto Sans либо fallback Helvetica. */
  readonly bodyFont: string;
  /** Ширина области текста между полями, pt. */
  readonly contentWidth: number;
}

/** Стиль инлайн-фрагмента. */
interface InlineStyle {
  /** Размер, pt. */
  readonly size: number;
  /** Цвет текста (по умолчанию основной). */
  readonly color?: string;
  /** Сделать весь текст полужирным (заголовки, шапка таблицы). */
  readonly bold?: boolean;
  /** Межстрочный интервал, pt. */
  readonly lineGap?: number;
}

/**
 * Применяет к документу шрифт и размер фрагмента.
 *
 * Полужирный имитируется обводкой (`stroke`): в комплекте только
 * `NotoSans-Regular.ttf`, а синтетический bold PDFKit не умеет. Обводка в
 * 0,3 pt визуально неотличима от настоящего bold при 14–24 pt и не требует
 * второго файла шрифта (DESIGN § 3.1.2).
 *
 * @param state - состояние рендера
 * @param segment - фрагмент инлайн-разметки
 * @param style - базовый стиль блока
 * @param isLast - последний ли фрагмент (закрывает `continued`)
 */
function appendInlineSegment(
  state: PdfRenderState,
  segment: InlineSegment,
  style: InlineStyle,
  isLast: boolean,
): void {
  const { doc } = state;
  const isLink = segment.link !== undefined;
  const isCode = segment.code === true;
  const color = isLink
    ? LINK_COLOR
    : isCode
      ? INLINE_CODE_COLOR
      : (style.color ?? TEXT_COLOR);
  const bold = style.bold === true || segment.bold === true;
  const fontSize = isCode ? Math.max(9, style.size - 2) : style.size;

  doc
    .font(isCode ? CODE_FONT : state.bodyFont)
    .fontSize(fontSize)
    .fillColor(color);

  if (bold) {
    // `strokeColor`/`lineWidth` — состояние документа, но сама обводка
    // включается только опцией `stroke` у конкретного `text`, поэтому на
    // соседние фрагменты она не влияет.
    doc.lineWidth(0.3).strokeColor(color);
  }

  doc.text(segment.text.length > 0 ? segment.text : ' ', {
    continued: !isLast,
    lineGap: style.lineGap ?? BODY_LINE_GAP,
    ...(bold ? { stroke: true } : {}),
    ...(segment.italics === true ? { oblique: true } : {}),
    ...(isLink ? { link: segment.link, underline: true } : {}),
  });
}

/**
 * Выводит строку с инлайн-разметкой.
 *
 * Ширина не передаётся: PDFKit берёт её от текущего `x` до правого поля
 * страницы. Это важно для `continued`-фрагментов — иначе каждый фрагмент
 * начинал бы новую ширину от своей позиции и текст уезжал за поле.
 *
 * @param state - состояние рендера
 * @param text - текст с Markdown-разметкой
 * @param style - базовый стиль
 */
function appendInlineText(
  state: PdfRenderState,
  text: string,
  style: InlineStyle,
): void {
  const segments = splitInlineMarkdown(text);

  segments.forEach((segment, index) => {
    appendInlineSegment(state, segment, style, index === segments.length - 1);
  });
}

/**
 * Добавляет заголовок H1–H3.
 *
 * @param state - состояние рендера
 * @param block - блок заголовка
 */
function appendHeading(
  state: PdfRenderState,
  block: Extract<DocumentBlock, { type: 'heading' }>,
): void {
  const { doc } = state;
  const size = HEADING_FONT_SIZES[block.level];

  // Заголовок не должен остаться в самом низу страницы: иначе он визуально
  // относится к следующему разделу, а не к своему.
  if (doc.y > doc.page.height - doc.page.margins.bottom - 2 * size) {
    doc.addPage();
  }

  doc.x = PAGE_MARGIN;
  doc.font(state.bodyFont).fontSize(size);
  doc.moveDown(block.level === 1 ? 0.9 : 0.6);
  appendInlineText(state, block.text, {
    size,
    color: HEADING_COLOR,
    bold: true,
    lineGap: 2,
  });
  doc.font(state.bodyFont).fontSize(size);
  doc.moveDown(block.level === 1 ? 0.5 : 0.3);
}

/**
 * Добавляет абзац.
 *
 * @param state - состояние рендера
 * @param block - блок абзаца
 */
function appendParagraph(
  state: PdfRenderState,
  block: Extract<DocumentBlock, { type: 'paragraph' }>,
): void {
  const { doc } = state;

  doc.x = PAGE_MARGIN;
  appendInlineText(state, block.text, {
    size: BODY_FONT_SIZE,
    color: TEXT_COLOR,
  });
  doc.moveDown(0.6);
}

/**
 * Добавляет маркированный или нумерованный список.
 *
 * @param state - состояние рендера
 * @param block - блок списка
 */
function appendList(state: PdfRenderState, block: DocumentListBlock): void {
  const { doc } = state;
  let orderedNumber = 1;

  for (const item of block.items) {
    doc.x = PAGE_MARGIN + item.level * LIST_INDENT;
    doc.font(state.bodyFont).fontSize(BODY_FONT_SIZE).fillColor(TEXT_COLOR);

    const marker = block.ordered ? `${orderedNumber}.` : '•';
    orderedNumber += block.ordered ? 1 : 0;

    // Маркер и текст — одна строка: `continued` сохраняет выравнивание
    // перенесённых строк под текстом, а не под маркером.
    doc.text(marker, doc.x, doc.y, {
      continued: true,
      lineGap: BODY_LINE_GAP,
    });
    appendInlineText(state, item.text, {
      size: BODY_FONT_SIZE,
      color: TEXT_COLOR,
    });
  }

  doc.moveDown(0.4);
}

/**
 * Добавляет блок кода с серым фоном.
 *
 * Длинный код (выше страницы) выводится без фона: закрасить несколько
 * страниц одним прямоугольником нельзя, а разрывать фон по страницам ради
 * декоративности — лишняя сложность.
 *
 * @param state - состояние рендера
 * @param block - блок кода
 */
function appendCodeBlock(
  state: PdfRenderState,
  block: Extract<DocumentBlock, { type: 'code' }>,
): void {
  const { doc } = state;
  const text = block.text.replace(/\n$/, '') || ' ';
  const topMargin = doc.page.margins.top;
  const bottomMargin = doc.page.margins.bottom;
  const pageBottom = doc.page.height - bottomMargin;
  const maxBoxHeight = doc.page.height - topMargin - bottomMargin;
  const textWidth = state.contentWidth - CODE_PADDING * 2;

  doc.font(CODE_FONT).fontSize(CODE_FONT_SIZE);

  const textHeight = doc.heightOfString(text, {
    width: textWidth,
    lineGap: 1,
  });
  const boxHeight = textHeight + CODE_PADDING * 2;

  doc.x = PAGE_MARGIN;

  if (boxHeight <= maxBoxHeight) {
    if (doc.y + boxHeight > pageBottom) {
      doc.addPage();
    }

    const top = doc.y;

    doc.save();
    doc
      .roundedRect(PAGE_MARGIN, top, state.contentWidth, boxHeight, 3)
      .fill(CODE_BACKGROUND);
    doc.restore();

    doc.fillColor(CODE_COLOR);
    doc.text(text, PAGE_MARGIN + CODE_PADDING, top + CODE_PADDING, {
      width: textWidth,
      height: boxHeight - CODE_PADDING * 2,
      lineGap: 1,
    });
    doc.x = PAGE_MARGIN;
    doc.y = top + boxHeight + 6;
  } else {
    doc.fillColor(CODE_COLOR);
    doc.text(text, PAGE_MARGIN, doc.y, {
      width: state.contentWidth,
      lineGap: 1,
    });
    doc.moveDown(0.4);
  }

  doc.fillColor(TEXT_COLOR);
}

/**
 * Добавляет GFM-таблицу плоским текстом.
 *
 * Полноценная сетка с переносами ячеек в PDF не входит в срез S1 (DESIGN
 * § 3.1.2 перечисляет H1–H3, абзацы, списки, код и ссылки). Данные таблицы
 * всё равно попадают в файл — как строки с разделителем `|`, — поэтому
 * контент не теряется молча.
 *
 * @param state - состояние рендера
 * @param block - блок таблицы
 */
function appendTable(
  state: PdfRenderState,
  block: Extract<DocumentBlock, { type: 'table' }>,
): void {
  const { doc } = state;

  doc.x = PAGE_MARGIN;
  doc.font(state.bodyFont).fontSize(TABLE_FONT_SIZE);
  appendInlineText(state, block.headers.join('   |   '), {
    size: TABLE_FONT_SIZE,
    color: HEADING_COLOR,
    bold: true,
    lineGap: 2,
  });

  doc.moveDown(0.1);
  doc
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + state.contentWidth, doc.y)
    .lineWidth(0.5)
    .strokeColor(TABLE_BORDER_COLOR)
    .stroke();
  doc.fillColor(TEXT_COLOR).strokeColor(TEXT_COLOR);

  for (const row of block.rows) {
    doc.x = PAGE_MARGIN;
    appendInlineText(state, row.join('   |   '), {
      size: TABLE_FONT_SIZE,
      color: TEXT_COLOR,
      lineGap: 2,
    });
  }

  doc.moveDown(0.5);
}

/**
 * Выводит заголовок JSON-документа по центру.
 *
 * @param state - состояние рендера
 * @param title - заголовок из `{ title }`
 */
function appendTitle(state: PdfRenderState, title: string): void {
  const { doc } = state;

  doc.x = PAGE_MARGIN;
  doc.font(state.bodyFont).fontSize(TITLE_FONT_SIZE).fillColor(HEADING_COLOR);
  doc.text(title, { align: 'center', lineGap: 2 });
  doc.moveDown(0.8);
}

/**
 * Обходит блоки модели в порядке вывода.
 *
 * @param state - состояние рендера
 * @param blocks - блоки документа
 */
function appendBlocks(
  state: PdfRenderState,
  blocks: readonly DocumentBlock[],
): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        appendHeading(state, block);
        break;
      case 'paragraph':
        appendParagraph(state, block);
        break;
      case 'list':
        appendList(state, block);
        break;
      case 'code':
        appendCodeBlock(state, block);
        break;
      case 'table':
        appendTable(state, block);
        break;
    }
  }
}

/**
 * Рендерер PDF из Markdown и JSON (v0.12 S1, DESIGN § 3.1.2).
 *
 * **Почему `pdfkit`, а не Headless Chrome/LibreOffice.** `pdfkit` — чистый JS
 * без внешнего бинарника в runtime (как `docx` в S3), потоково пишет PDF в
 * буфер и не требует Chromium/офисного пакета в Docker-образе.
 *
 * **Кириллица.** Встроенные шрифты PDFKit (Helvetica/Courier) не содержат
 * кириллицы, поэтому основной текст набирается `NotoSans-Regular.ttf` из
 * `src/documents/assets/`. Если файла нет (урезанный образ, забыли assets),
 * рендерер не падает: пишет warning и переходит на Helvetica — PDF
 * создаётся, но кириллица в нём будет потерей глифов (DESIGN § 3.1.2).
 *
 * **Разбор Markdown/JSON — общий с DOCX.** Сервис не дублирует парсер, а
 * переиспользует `parseMarkdown`/`parseJsonDocument` из
 * {@link DocumentService}: иначе DOCX и PDF начали бы расходиться в трактовке
 * одного и того же контента.
 */
@Injectable()
export class PdfRenderer {
  private readonly logger = new Logger(PdfRenderer.name);

  /**
   * Кэш шрифта: `null` — файла нет/не читается, рендер идёт на Helvetica.
   *
   * Promise, а не Buffer, чтобы параллельные первые рендеры не читали файл
   * дважды. Отказ тоже кэшируется: warning пишется один раз на процесс.
   */
  private fontPromise: Promise<Buffer | null> | undefined;

  /**
   * Рендерит Markdown в PDF.
   *
   * @param markdown - исходный Markdown (может быть пустым)
   * @returns содержимое .pdf (начинается с `%PDF-`)
   * @throws DocumentRenderException если PDFKit не смог собрать документ
   */
  async renderFromMarkdownAsync(markdown: string): Promise<Buffer> {
    return this.renderAsync(parseMarkdown(markdown), 'markdown');
  }

  /**
   * Рендерит JSON-документ в PDF.
   *
   * @param json - недоверенное значение:
   *   `{ title?, blocks: [{ type, text, level? }] }`
   * @returns содержимое .pdf (начинается с `%PDF-`)
   * @throws DocumentRenderException если структура JSON не соответствует схеме
   *   или PDFKit не смог собрать документ
   */
  async renderFromJsonAsync(json: unknown): Promise<Buffer> {
    return this.renderAsync(parseJsonDocument(json), 'json');
  }

  /**
   * Загружает шрифт с кириллицей один раз на процесс.
   *
   * @returns содержимое TTF либо `null`, если шрифт недоступен
   */
  private loadFontAsync(): Promise<Buffer | null> {
    this.fontPromise ??= readFile(FONT_PATH).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);

      // Только путь и причина, без содержимого документа (RULES 5.9).
      this.logger.warn(
        `Шрифт ${FONT_PATH} недоступен (${reason}); ` +
          'используется Helvetica — кириллица может не отобразиться',
      );

      return null;
    });

    return this.fontPromise;
  }

  /**
   * Собирает PDF и отдаёт его буфером.
   *
   * @param model - разобранная модель документа
   * @param source - источник (`markdown`/`json`) — только для лога
   * @returns содержимое .pdf
   * @throws DocumentRenderException если PDFKit не смог собрать документ
   */
  private async renderAsync(
    model: DocumentModel,
    source: 'markdown' | 'json',
  ): Promise<Buffer> {
    const fontBuffer = await this.loadFontAsync();
    const bodyFont = fontBuffer === null ? 'Helvetica' : BODY_FONT;

    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      info: {
        Title: model.title ?? 'Документ',
        Author: 'IIChatTools AI Workflow Builder',
        Subject: 'Сгенерировано IIChatTools AI Workflow Builder',
        Creator: 'IIChatTools AI Workflow Builder',
      },
    });

    if (fontBuffer !== null) {
      doc.registerFont(BODY_FONT, fontBuffer);
    }

    const chunks: Buffer[] = [];
    const completed = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      doc.on('error', (error: Error) => {
        reject(error);
      });
    });

    const state: PdfRenderState = {
      doc,
      bodyFont,
      contentWidth:
        doc.page.width - doc.page.margins.left - doc.page.margins.right,
    };

    try {
      if (model.title !== undefined) {
        appendTitle(state, model.title);
      }

      appendBlocks(state, model.blocks);
      doc.end();

      const buffer = await completed;

      // Дешёвая проверка контракта: PDFKit всегда пишет `%PDF-` в первых
      // байтах. Если сигнатуры нет — отдавать «PDF» в хранилище нельзя.
      if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new DocumentRenderException(
          'PDFKit вернул данные без сигнатуры %PDF-',
        );
      }

      this.logger.log(
        `PDF из ${source}: ${model.blocks.length} блок(ов), ` +
          `${buffer.byteLength} байт`,
      );

      return buffer;
    } catch (error: unknown) {
      if (error instanceof DocumentRenderException) {
        throw error;
      }

      throw new DocumentRenderException(
        'Не удалось собрать PDF: внутренняя ошибка рендерера',
        { cause: error },
      );
    }
  }
}
