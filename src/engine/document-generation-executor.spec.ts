/**
 * Исполнитель узла `document_gen` (v0.10 S6; режим `template` — v0.11 S4).
 *
 * Рендереры и хранилище подменены моками: тест не запускает `docx`/
 * `docxtemplater` и не пишет на диск. Проверяется контракт исполнителя:
 * - inline: приоритет `inputs.prompt`, JSON-режим, лимиты (1 МБ контента /
 *   10 МБ файла), отказ без хранилища, `storageKey` для `node_runs.storage_key`;
 * - template: загрузка шаблона из workflow запуска, разрешение переменных,
 *   рендер, метаданные в outputs и warning в logs (DESIGN v0.11 § 3.1.7).
 */
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_CONTENT_BYTES,
  NodeDataValidationException,
  executeDocumentGenerationNodeAsync,
  type DocumentGenerationDeps,
  type DocumentGenerationStorage,
  type DocumentGenerator,
  type DocumentTemplateLoader,
  type DocumentTemplateRenderer,
  type PdfGenerator,
} from './node-executors.js';
import {
  DocumentStorageUnavailableException,
  DocumentTemplateNotFoundException,
  DocumentTooLargeException,
} from '../documents/document.errors.js';
import type { NodeDto } from './dto/index.js';

/** id узла в тестовом графе. */
const NODE_ID = 'doc-node-1';

/** uuid запуска. */
const RUN_ID = '33333333-3333-4333-8333-333333333333';

/** uuid workflow запуска (v0.11 S4, проверка принадлежности шаблона). */
const WORKFLOW_ID = '77777777-7777-4777-8777-777777777777';

/** uuid шаблона из data.templateId. */
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555';

/** Имя шаблона, которое вернул загрузчик. */
const TEMPLATE_NAME = 'Договор поставки';

/** Ключ, который «вернуло» хранилище. */
const STORAGE_KEY = `${RUN_ID}/generated-${NODE_ID}.docx`;

/** Ссылка, которую «вернуло» хранилище. */
const STORED_URL = `/media/file/${STORAGE_KEY}`;

/** Минимальный буфер, который изображает DOCX (содержимое в тесте не важно). */
const DOCX_BUFFER = Buffer.from('PK\u0003\u0004fake-docx');

/** Минимальный буфер с настоящей сигнатурой PDF (v0.12 S1). */
const PDF_BUFFER = Buffer.from('%PDF-1.7 fake-pdf');

/** Содержимое загруженного шаблона. */
const TEMPLATE_CONTENT = Buffer.from('PK\u0003\u0004template-docx');

/** Результат рендера шаблона. */
const RENDERED_BUFFER = Buffer.from('PK\u0003\u0004rendered-docx');

/**
 * Создаёт узел `document_gen`.
 *
 * @param data - сырые `data` узла
 * @returns узел графа
 */
function documentNode(data: Record<string, unknown>): NodeDto {
  return { id: NODE_ID, type: 'document_gen', data };
}

/**
 * Создаёт мок `DocumentService`.
 *
 * @param buffer - что вернёт рендерер
 * @returns рендерер и моки его методов
 */
function createDocumentService(buffer: Buffer = DOCX_BUFFER): {
  generator: DocumentGenerator;
  fromMarkdown: ReturnType<typeof vi.fn>;
  fromJson: ReturnType<typeof vi.fn>;
} {
  const fromMarkdown = vi.fn((_markdown: string) => Promise.resolve(buffer));
  const fromJson = vi.fn((_json: unknown) => Promise.resolve(buffer));

  return {
    generator: {
      generateDocxFromMarkdownAsync: fromMarkdown,
      generateDocxFromJsonAsync: fromJson,
    },
    fromMarkdown,
    fromJson,
  };
}

/**
 * Создаёт мок `PdfRenderer` (v0.12 S1).
 *
 * @param buffer - что вернёт рендерер
 * @returns рендерер и моки его методов
 */
function createPdfRenderer(buffer: Buffer = PDF_BUFFER): {
  renderer: PdfGenerator;
  fromMarkdown: ReturnType<typeof vi.fn>;
  fromJson: ReturnType<typeof vi.fn>;
} {
  const fromMarkdown = vi.fn((_markdown: string) => Promise.resolve(buffer));
  const fromJson = vi.fn((_json: unknown) => Promise.resolve(buffer));

  return {
    renderer: {
      renderFromMarkdownAsync: fromMarkdown,
      renderFromJsonAsync: fromJson,
    },
    fromMarkdown,
    fromJson,
  };
}

/**
 * Создаёт мок хранилища.
 *
 * @param options - переопределения результата/бэкенда
 * @returns хранилище и мок `saveGeneratedAsync`
 */
function createStorage(
  options: {
    backend?: DocumentGenerationStorage['backend'];
    url?: string | null;
    key?: string | null;
  } = {},
): {
  storage: DocumentGenerationStorage;
  save: ReturnType<typeof vi.fn>;
} {
  const save = vi.fn(
    (
      _buffer: Buffer,
      extension: string,
      runId: string,
      nodeId: string,
    ): Promise<{ url: string | null; key: string | null }> => {
      // Хранилище строит ключ из расширения (DESIGN § 3.1.3): тест PDF обязан
      // видеть `.pdf` в key/fileName, а не захардкоженный `.docx`.
      const key = `${runId}/generated-${nodeId}.${extension}`;

      return Promise.resolve({
        url: options.url === undefined ? `/media/file/${key}` : options.url,
        key: options.key === undefined ? key : options.key,
      });
    },
  );

  return {
    storage: {
      backend: options.backend ?? 'local',
      saveGeneratedAsync: save,
    },
    save,
  };
}

/**
 * Создаёт мок загрузчика шаблонов.
 *
 * @param content - содержимое, которое «прочитали» из БД
 * @returns загрузчик и мок `loadAsync`
 */
function createLoader(content: Buffer = TEMPLATE_CONTENT): {
  loader: DocumentTemplateLoader;
  load: ReturnType<typeof vi.fn>;
} {
  const load = vi.fn((_templateId: string, _workflowId: string) =>
    Promise.resolve({ name: TEMPLATE_NAME, content }),
  );

  return { loader: { loadAsync: load }, load };
}

/**
 * Создаёт мок рендерера шаблонов.
 *
 * @param options - результат рендера
 * @returns рендерер и мок `renderAsync`
 */
function createRenderer(
  options: {
    buffer?: Buffer;
    missingVariables?: readonly string[];
  } = {},
): {
  renderer: DocumentTemplateRenderer;
  render: ReturnType<typeof vi.fn>;
} {
  const buffer = options.buffer ?? RENDERED_BUFFER;
  const missingVariables = options.missingVariables ?? [];
  const render = vi.fn(
    (_content: Buffer, _variables: Record<string, unknown>) =>
      Promise.resolve({ buffer, missingVariables }),
  );

  return { renderer: { renderAsync: render }, render };
}

/**
 * Собирает зависимости исполнителя.
 *
 * @param options - переопределения моков/контекста
 * @returns объект зависимостей `document_gen`
 */
function createDeps(
  options: {
    generator?: DocumentGenerator;
    pdfRenderer?: PdfGenerator;
    storage?: DocumentGenerationStorage;
    loader?: DocumentTemplateLoader;
    renderer?: DocumentTemplateRenderer;
    workflowId?: string;
  } = {},
): DocumentGenerationDeps {
  return {
    documentService: options.generator ?? createDocumentService().generator,
    pdfRenderer: options.pdfRenderer ?? createPdfRenderer().renderer,
    mediaStorage: options.storage ?? createStorage().storage,
    templateLoader: options.loader ?? createLoader().loader,
    templateRenderer: options.renderer ?? createRenderer().renderer,
    workflowId: options.workflowId ?? WORKFLOW_ID,
  };
}

describe('executeDocumentGenerationNodeAsync — inline (v0.10 S6)', () => {
  it('Markdown из inputs.prompt важнее data.content и сохраняется как docx', async () => {
    const { generator, fromMarkdown, fromJson } = createDocumentService();
    const { storage, save } = createStorage();

    const result = await executeDocumentGenerationNodeAsync(
      documentNode({ source: 'markdown', content: '# из узла' }),
      { prompt: '# из связи' },
      RUN_ID,
      createDeps({ generator, storage }),
    );

    expect(fromMarkdown).toHaveBeenCalledWith('# из связи');
    expect(fromJson).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(DOCX_BUFFER, 'docx', RUN_ID, NODE_ID);

    expect(result.storageKey).toBe(STORAGE_KEY);
    // Контракт inline-режима не изменился: метаданных `template` здесь нет.
    expect(result.logs).toBeUndefined();
    expect(result.outputs).toEqual({
      fileUrl: STORED_URL,
      storedUrl: STORED_URL,
      storedExpiresAt: null,
      fileName: `generated-${NODE_ID}.docx`,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: DOCX_BUFFER.byteLength,
      format: 'docx',
    });
  });

  it('JSON из data.content парсится и получает title из data.title', async () => {
    const { generator, fromMarkdown, fromJson } = createDocumentService();
    const { storage } = createStorage();

    await executeDocumentGenerationNodeAsync(
      documentNode({
        source: 'json',
        title: 'Отчёт',
        content: '{"blocks":[{"type":"paragraph","text":"Текст"}]}',
      }),
      {},
      RUN_ID,
      createDeps({ generator, storage }),
    );

    expect(fromMarkdown).not.toHaveBeenCalled();
    expect(fromJson).toHaveBeenCalledWith({
      title: 'Отчёт',
      blocks: [{ type: 'paragraph', text: 'Текст' }],
    });
  });

  it('JSON-объект из inputs.prompt не требует JSON.parse', async () => {
    const { generator, fromJson } = createDocumentService();
    const { storage } = createStorage();
    const document = { blocks: [{ type: 'paragraph', text: 'Из связи' }] };

    await executeDocumentGenerationNodeAsync(
      documentNode({ source: 'json' }),
      { prompt: document },
      RUN_ID,
      createDeps({ generator, storage }),
    );

    expect(fromJson).toHaveBeenCalledWith(document);
  });

  it('пустой контент — NodeDataValidationException, рендер не вызывается', async () => {
    const { generator, fromMarkdown, fromJson } = createDocumentService();
    const { storage, save } = createStorage();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ source: 'markdown', content: '   ' }),
        { prompt: '' },
        RUN_ID,
        createDeps({ generator, storage }),
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    expect(fromMarkdown).not.toHaveBeenCalled();
    expect(fromJson).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('контент больше 1 МБ UTF-8 отклоняется до рендера (DESIGN § 3.2.3)', async () => {
    const { generator, fromMarkdown } = createDocumentService();
    const { storage, save } = createStorage();
    // Кириллица — 2 байта на символ: 600 000 символов > 1 МБ, но < 1 000 000.
    const tooBig = 'я'.repeat(DOCUMENT_MAX_CONTENT_BYTES / 2 + 1);

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ source: 'markdown' }),
        { prompt: tooBig },
        RUN_ID,
        createDeps({ generator, storage }),
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    expect(fromMarkdown).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('DOCX больше 10 МБ — DocumentTooLargeException, в хранилище не пишется', async () => {
    const huge = Buffer.alloc(DOCUMENT_MAX_BYTES + 1);
    const { generator } = createDocumentService(huge);
    const { storage, save } = createStorage();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ source: 'markdown' }),
        { prompt: '# Большой' },
        RUN_ID,
        createDeps({ generator, storage }),
      ),
    ).rejects.toBeInstanceOf(DocumentTooLargeException);

    expect(save).not.toHaveBeenCalled();
  });

  it('MEDIA_STORAGE_BACKEND=none — DocumentStorageUnavailableException до рендера', async () => {
    const { generator, fromMarkdown } = createDocumentService();
    const { storage, save } = createStorage({ backend: 'none' });

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ source: 'markdown' }),
        { prompt: '# Документ' },
        RUN_ID,
        createDeps({ generator, storage }),
      ),
    ).rejects.toBeInstanceOf(DocumentStorageUnavailableException);

    expect(fromMarkdown).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('сохранение вернуло null — DocumentStorageUnavailableException', async () => {
    const { generator } = createDocumentService();
    const { storage } = createStorage({ url: null, key: null });

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ source: 'markdown' }),
        { prompt: '# Документ' },
        RUN_ID,
        createDeps({ generator, storage }),
      ),
    ).rejects.toBeInstanceOf(DocumentStorageUnavailableException);
  });

  it('битый JSON — NodeDataValidationException с понятной причиной', async () => {
    const { generator, fromJson } = createDocumentService();
    const { storage } = createStorage();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ source: 'json', content: '{не json}' }),
        {},
        RUN_ID,
        createDeps({ generator, storage }),
      ),
    ).rejects.toThrow(/некорректный JSON/);

    expect(fromJson).not.toHaveBeenCalled();
  });

  it('PDF-формат без поддержки рендерера больше не отвергается (v0.12 S1)', async () => {
    const { generator, fromMarkdown, fromJson } = createDocumentService();
    const { renderer, fromMarkdown: pdfFromMarkdown } = createPdfRenderer();
    const { storage } = createStorage();

    await executeDocumentGenerationNodeAsync(
      documentNode({ format: 'pdf', source: 'markdown' }),
      { prompt: '# Документ' },
      RUN_ID,
      createDeps({
        generator,
        pdfRenderer: renderer,
        storage,
      }),
    );

    // DOCX-рендерер не должен вызываться: формат выбирает рендерер.
    expect(fromMarkdown).not.toHaveBeenCalled();
    expect(fromJson).not.toHaveBeenCalled();
    expect(pdfFromMarkdown).toHaveBeenCalledWith('# Документ');
  });
});

describe('executeDocumentGenerationNodeAsync — PDF (v0.12 S1)', () => {
  it('Markdown → PdfRenderer, ключ .pdf и mimeType application/pdf', async () => {
    const { generator, fromMarkdown } = createDocumentService();
    const { renderer, fromMarkdown: pdfFromMarkdown, fromJson } =
      createPdfRenderer();
    const { storage, save } = createStorage();

    const result = await executeDocumentGenerationNodeAsync(
      documentNode({ format: 'pdf', source: 'markdown' }),
      { prompt: '# Отчёт\n\nКириллица' },
      RUN_ID,
      createDeps({ generator, pdfRenderer: renderer, storage }),
    );

    expect(pdfFromMarkdown).toHaveBeenCalledWith('# Отчёт\n\nКириллица');
    expect(fromMarkdown).not.toHaveBeenCalled();
    expect(fromJson).not.toHaveBeenCalled();
    // Расширение в ключе хранилища — `.pdf`, иначе скачается .docx с PDF внутри.
    expect(save).toHaveBeenCalledWith(PDF_BUFFER, 'pdf', RUN_ID, NODE_ID);
    expect(result.storageKey).toBe(`${RUN_ID}/generated-${NODE_ID}.pdf`);
    expect(result.outputs).toEqual({
      fileUrl: `/media/file/${RUN_ID}/generated-${NODE_ID}.pdf`,
      storedUrl: `/media/file/${RUN_ID}/generated-${NODE_ID}.pdf`,
      storedExpiresAt: null,
      fileName: `generated-${NODE_ID}.pdf`,
      mimeType: 'application/pdf',
      bytes: PDF_BUFFER.byteLength,
      format: 'pdf',
    });
  });

  it('JSON → PdfRenderer, title из data.title сохраняется в PDF-документе', async () => {
    const { generator, fromJson } = createDocumentService();
    const { renderer, fromJson: pdfFromJson } = createPdfRenderer();
    const { storage, save } = createStorage();

    const result = await executeDocumentGenerationNodeAsync(
      documentNode({
        format: 'pdf',
        source: 'json',
        title: 'Отчёт за квартал',
        content: '{"blocks":[{"type":"paragraph","text":"Текст"}]}',
      }),
      {},
      RUN_ID,
      createDeps({ generator, pdfRenderer: renderer, storage }),
    );

    expect(pdfFromJson).toHaveBeenCalledWith({
      title: 'Отчёт за квартал',
      blocks: [{ type: 'paragraph', text: 'Текст' }],
    });
    expect(fromJson).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(PDF_BUFFER, 'pdf', RUN_ID, NODE_ID);
    expect(result.outputs.mimeType).toBe('application/pdf');
    expect(result.outputs.format).toBe('pdf');
  });

  it('data.fileName с .docx нормализуется в .pdf', async () => {
    const { generator } = createDocumentService();
    const { renderer } = createPdfRenderer();
    const { storage } = createStorage();

    const result = await executeDocumentGenerationNodeAsync(
      documentNode({ format: 'pdf', fileName: 'отчёт.docx' }),
      { prompt: '# Отчёт' },
      RUN_ID,
      createDeps({ generator, pdfRenderer: renderer, storage }),
    );

    expect(result.outputs.fileName).toBe('отчёт.pdf');
  });

  it('DOCX-формат по умолчанию не трогает PdfRenderer', async () => {
    const { generator, fromMarkdown } = createDocumentService();
    const { renderer, fromMarkdown: pdfFromMarkdown } = createPdfRenderer();
    const { storage, save } = createStorage();

    await executeDocumentGenerationNodeAsync(
      documentNode({ source: 'markdown' }),
      { prompt: '# Документ' },
      RUN_ID,
      createDeps({ generator, pdfRenderer: renderer, storage }),
    );

    expect(fromMarkdown).toHaveBeenCalledWith('# Документ');
    expect(pdfFromMarkdown).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(DOCX_BUFFER, 'docx', RUN_ID, NODE_ID);
  });
});

describe('executeDocumentGenerationNodeAsync — template (v0.11 S4)', () => {
  it('загружает шаблон workflow, рендерит переменные и сохраняет DOCX', async () => {
    const { generator, fromMarkdown } = createDocumentService();
    const { storage, save } = createStorage();
    const { loader, load } = createLoader();
    const { renderer, render } = createRenderer();

    const result = await executeDocumentGenerationNodeAsync(
      documentNode({
        mode: 'template',
        templateId: TEMPLATE_ID,
        variables: { client: 'ACME' },
      }),
      // Строка от LLM — валидный JSON-объект; вход важнее fallback-поля.
      { prompt: '{"amount":42}' },
      RUN_ID,
      createDeps({ generator, storage, loader, renderer }),
    );

    // Проверка принадлежности шаблона workflow запуска (DESIGN § 3.1.1).
    expect(load).toHaveBeenCalledWith(TEMPLATE_ID, WORKFLOW_ID);
    expect(render).toHaveBeenCalledWith(TEMPLATE_CONTENT, {
      client: 'ACME',
      amount: 42,
    });
    expect(save).toHaveBeenCalledWith(
      RENDERED_BUFFER,
      'docx',
      RUN_ID,
      NODE_ID,
    );
    // Inline-рендерер в template-режиме не вызывается.
    expect(fromMarkdown).not.toHaveBeenCalled();

    expect(result.storageKey).toBe(STORAGE_KEY);
    expect(result.logs).toBeUndefined();
    expect(result.outputs).toEqual({
      fileUrl: STORED_URL,
      storedUrl: STORED_URL,
      storedExpiresAt: null,
      fileName: `generated-${NODE_ID}.docx`,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: RENDERED_BUFFER.byteLength,
      format: 'docx',
      mode: 'template',
      templateId: TEMPLATE_ID,
      templateName: TEMPLATE_NAME,
      missingVariables: [],
    });
  });

  it('missingVariables попадают в outputs и warning в logs (без значений)', async () => {
    const { storage } = createStorage();
    const { loader } = createLoader();
    const { renderer } = createRenderer({
      missingVariables: ['amount', 'date'],
    });

    const result = await executeDocumentGenerationNodeAsync(
      documentNode({ mode: 'template', templateId: TEMPLATE_ID }),
      { prompt: '{"client":"ACME"}' },
      RUN_ID,
      createDeps({ storage, loader, renderer }),
    );

    expect(result.outputs.missingVariables).toEqual(['amount', 'date']);
    // RULES 5.9: в лог — только имена, не значения переменных.
    expect(result.logs).toHaveLength(1);
    expect(result.logs?.[0]).toContain('warning');
    expect(result.logs?.[0]).toContain('amount');
    expect(result.logs?.[0]).toContain('date');
    expect(result.logs?.[0]).not.toContain('ACME');
  });

  it('шаблон чужого workflow — DocumentTemplateNotFoundException, рендера нет', async () => {
    const { storage } = createStorage();
    const notFound = new DocumentTemplateNotFoundException(TEMPLATE_ID);
    const load = vi.fn(() => Promise.reject(notFound));
    const { renderer, render } = createRenderer();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ mode: 'template', templateId: TEMPLATE_ID }),
        {},
        RUN_ID,
        createDeps({
          storage,
          loader: { loadAsync: load },
          renderer,
        }),
      ),
    ).rejects.toBe(notFound);

    expect(render).not.toHaveBeenCalled();
  });

  it('template без templateId — ошибка схемы до загрузки шаблона', async () => {
    const { storage } = createStorage();
    const { loader, load } = createLoader();
    const { renderer, render } = createRenderer();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ mode: 'template' }),
        {},
        RUN_ID,
        createDeps({ storage, loader, renderer }),
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    expect(load).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('template + format=pdf отклоняется схемой (шаблоны — только DOCX)', async () => {
    const { storage } = createStorage();
    const { loader, load } = createLoader();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ mode: 'template', templateId: TEMPLATE_ID, format: 'pdf' }),
        {},
        RUN_ID,
        createDeps({ storage, loader }),
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    expect(load).not.toHaveBeenCalled();
  });

  it('отрендеренный DOCX больше 10 МБ — DocumentTooLargeException до сохранения', async () => {
    const { storage, save } = createStorage();
    const { loader } = createLoader();
    const { renderer } = createRenderer({
      buffer: Buffer.alloc(DOCUMENT_MAX_BYTES + 1),
    });

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ mode: 'template', templateId: TEMPLATE_ID }),
        {},
        RUN_ID,
        createDeps({ storage, loader, renderer }),
      ),
    ).rejects.toBeInstanceOf(DocumentTooLargeException);

    expect(save).not.toHaveBeenCalled();
  });

  it('MEDIA_STORAGE_BACKEND=none — отказ до загрузки шаблона', async () => {
    const { storage } = createStorage({ backend: 'none' });
    const { loader, load } = createLoader();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ mode: 'template', templateId: TEMPLATE_ID }),
        {},
        RUN_ID,
        createDeps({ storage, loader }),
      ),
    ).rejects.toBeInstanceOf(DocumentStorageUnavailableException);

    expect(load).not.toHaveBeenCalled();
  });

  it('пустой workflowId — понятная ошибка проводки движка, SQL не выполняется', async () => {
    const { storage } = createStorage();
    const { loader, load } = createLoader();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ mode: 'template', templateId: TEMPLATE_ID }),
        {},
        RUN_ID,
        createDeps({ storage, loader, workflowId: '' }),
      ),
    ).rejects.toThrow(/workflow запуска/);

    expect(load).not.toHaveBeenCalled();
  });

  it('проза вместо JSON во входе — NodeDataValidationException, рендера нет', async () => {
    const { storage } = createStorage();
    const { loader } = createLoader();
    const { renderer, render } = createRenderer();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ mode: 'template', templateId: TEMPLATE_ID }),
        { prompt: 'Вот документ: клиент ACME' },
        RUN_ID,
        createDeps({ storage, loader, renderer }),
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    expect(render).not.toHaveBeenCalled();
  });
});
