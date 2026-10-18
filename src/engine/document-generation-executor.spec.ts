/**
 * Исполнитель узла `document_gen` (v0.10 S6, DESIGN v0.10 § 3.2).
 *
 * Рендерер и хранилище подменены моками: тест не запускает `docx` и не пишет
 * на диск. Проверяется контракт исполнителя — приоритет `inputs.prompt`,
 * JSON-режим, лимиты (1 МБ контента / 10 МБ файла), отказ без хранилища и
 * возврат `storageKey` для `node_runs.storage_key`.
 */
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_CONTENT_BYTES,
  NodeDataValidationException,
  executeDocumentGenerationNodeAsync,
  type DocumentGenerationStorage,
  type DocumentGenerator,
} from './node-executors.js';
import {
  DocumentStorageUnavailableException,
  DocumentTooLargeException,
} from '../documents/document.errors.js';
import type { NodeDto } from './dto/index.js';

/** id узла в тестовом графе. */
const NODE_ID = 'doc-node-1';

/** uuid запуска. */
const RUN_ID = '33333333-3333-4333-8333-333333333333';

/** Ключ, который «вернуло» хранилище. */
const STORAGE_KEY = `${RUN_ID}/generated-${NODE_ID}.docx`;

/** Ссылка, которую «вернуло» хранилище. */
const STORED_URL = `/media/file/${STORAGE_KEY}`;

/** Минимальный буфер, который изображает DOCX (содержимое в тесте не важно). */
const DOCX_BUFFER = Buffer.from('PK\u0003\u0004fake-docx');

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
      _extension: string,
      _runId: string,
      _nodeId: string,
    ): Promise<{ url: string | null; key: string | null }> =>
      Promise.resolve({
        url: options.url === undefined ? STORED_URL : options.url,
        key: options.key === undefined ? STORAGE_KEY : options.key,
      }),
  );

  return {
    storage: {
      backend: options.backend ?? 'local',
      saveGeneratedAsync: save,
    },
    save,
  };
}

describe('executeDocumentGenerationNodeAsync (v0.10 S6)', () => {
  it('Markdown из inputs.prompt важнее data.content и сохраняется как docx', async () => {
    const { generator, fromMarkdown, fromJson } = createDocumentService();
    const { storage, save } = createStorage();

    const result = await executeDocumentGenerationNodeAsync(
      documentNode({ source: 'markdown', content: '# из узла' }),
      { prompt: '# из связи' },
      RUN_ID,
      generator,
      storage,
    );

    expect(fromMarkdown).toHaveBeenCalledWith('# из связи');
    expect(fromJson).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(DOCX_BUFFER, 'docx', RUN_ID, NODE_ID);

    expect(result.storageKey).toBe(STORAGE_KEY);
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
      generator,
      storage,
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
      generator,
      storage,
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
        generator,
        storage,
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
        generator,
        storage,
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
        generator,
        storage,
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
        generator,
        storage,
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
        generator,
        storage,
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
        generator,
        storage,
      ),
    ).rejects.toThrow(/некорректный JSON/);

    expect(fromJson).not.toHaveBeenCalled();
  });

  it('PDF пока не поддержан — явная ошибка, а не подмена формата', async () => {
    const { generator, fromMarkdown } = createDocumentService();
    const { storage } = createStorage();

    await expect(
      executeDocumentGenerationNodeAsync(
        documentNode({ format: 'pdf', source: 'markdown' }),
        { prompt: '# Документ' },
        RUN_ID,
        generator,
        storage,
      ),
    ).rejects.toThrow(/pdf/);

    expect(fromMarkdown).not.toHaveBeenCalled();
  });
});
