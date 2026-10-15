import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { NODE_PORT_CONTRACT } from '../engine/node-ports.js';
import { TemplateFileSchema } from './dto/template.dto.js';
import { TemplateLoaderService } from './template-loader.service.js';

/**
 * Валидное содержимое файла шаблона — минимальный граф из одного `text`-узла.
 *
 * Используется как «хороший» файл во временных каталогах: так проверяется, что
 * загрузчик пропускает именно битые файлы, а не всё подряд.
 */
const VALID_TEMPLATE = {
  version: 1,
  name: 'Ok',
  description: 'валидный шаблон',
  exportedAt: '2026-10-16T00:00:00.000Z',
  nodes: [
    { id: 't1', type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text', value: '' } },
  ],
  edges: [],
} as const;

/** Схема минимального узла — для разбора `unknown[]` без `any` (RULES 4.15). */
const NodeRefSchema = z.object({ id: z.string(), type: z.string() });

/** Схема связи шаблона: нужны только id узлов и хендлы. */
const EdgeRefSchema = z.object({
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

/** Создаёт временный каталог под файлы шаблонов. */
function createTempDirAsync(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'templates-spec-'));
}

describe('TemplateLoaderService', () => {
  let service: TemplateLoaderService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TemplateLoaderService],
    }).compile();

    service = moduleRef.get(TemplateLoaderService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('читает src/templates/*.json и отдаёт три шаблона', async () => {
      await service.onModuleInit();

      const list = await service.listAsync();

      // Отсортировано по id — порядок детерминирован независимо от файловой системы.
      expect(list.map((template) => template.id)).toEqual([
        'http-llm',
        'text-llm',
        'text-llm-image',
      ]);
      expect(list.map((template) => template.nodeCount)).toEqual([2, 2, 3]);

      for (const template of list) {
        expect(template.name.length).toBeGreaterThan(0);
        expect(template.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('loadDirectoryAsync', () => {
    it('валидирует файлы схемой: версия ≠ 1 и без description пропускаются', async () => {
      const directory = await createTempDirAsync();
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      try {
        await writeFile(join(directory, 'ok.json'), JSON.stringify(VALID_TEMPLATE));
        await writeFile(
          join(directory, 'bad-version.json'),
          JSON.stringify({ ...VALID_TEMPLATE, version: 2 }),
        );
        await writeFile(
          join(directory, 'no-description.json'),
          JSON.stringify({ ...VALID_TEMPLATE, description: undefined }),
        );

        await service.loadDirectoryAsync(directory);

        expect((await service.listAsync()).map((template) => template.id)).toEqual(['ok']);
        // Оба отказа — от схемы (а не от парсера JSON): по одному warn на файл.
        expect(warn).toHaveBeenCalledTimes(2);
        expect(String(warn.mock.calls[0]?.[0])).toContain('не соответствует схеме');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }

      // Контрольная проверка самой схемы: `version` — именно литерал 1.
      expect(TemplateFileSchema.safeParse({ ...VALID_TEMPLATE, version: 2 }).success).toBe(false);
      expect(TemplateFileSchema.safeParse(VALID_TEMPLATE).success).toBe(true);
    });

    it('битый файл (не JSON) пропускается с warning, остальные загружаются', async () => {
      const directory = await createTempDirAsync();
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      try {
        await writeFile(join(directory, 'broken.json'), '{ "version": 1, ');
        await writeFile(join(directory, 'good.json'), JSON.stringify(VALID_TEMPLATE));

        // Fail-soft: исключение наружу не летит, поэтому и `resolves`.
        await expect(service.loadDirectoryAsync(directory)).resolves.toBeUndefined();

        expect((await service.listAsync()).map((template) => template.id)).toEqual(['good']);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('broken.json');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it('нечитаемый каталог не затирает уже загруженный реестр', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await service.onModuleInit();
      await service.loadDirectoryAsync(join(tmpdir(), 'templates-spec-missing-dir'));

      expect(warn).toHaveBeenCalledTimes(1);
      expect((await service.listAsync()).length).toBe(3);
    });
  });

  describe('getAsync', () => {
    it('возвращает граф шаблона, для неизвестного id — null', async () => {
      await service.onModuleInit();

      const data = await service.getAsync('text-llm');

      expect(data).not.toBeNull();
      expect(data?.version).toBe(1);
      expect(data?.name).toBe('Text → LLM');
      expect(data?.nodes).toHaveLength(2);
      expect(data?.edges).toHaveLength(1);
      expect(data?.exportedAt).toBe('2026-10-16T00:00:00.000Z');
      // `description` — поле файла шаблона; в sharable-артефакт оно не входит,
      // иначе Zod-схема импорта/экспорта разошлась бы с форматом ответа.
      expect(data).not.toHaveProperty('description');

      await expect(service.getAsync('nope')).resolves.toBeNull();
    });

    it('handle ID во всех шаблонах совпадают с NODE_PORT_CONTRACT', async () => {
      await service.onModuleInit();

      for (const id of ['http-llm', 'text-llm', 'text-llm-image']) {
        const data = await service.getAsync(id);

        expect(data, `шаблон ${id} должен существовать`).not.toBeNull();

        const nodes = z.array(NodeRefSchema).parse(data?.nodes);
        const edges = z.array(EdgeRefSchema).parse(data?.edges);
        const typeById = new Map(nodes.map((node) => [node.id, node.type]));

        expect(edges.length).toBeGreaterThan(0);

        for (const edge of edges) {
          const sourceType = typeById.get(edge.source);
          const targetType = typeById.get(edge.target);

          expect(sourceType, `узел ${edge.source} в ${id}`).toBeDefined();
          expect(targetType, `узел ${edge.target} в ${id}`).toBeDefined();
          // Хендлы не угаданы, а взяты из реестра портов: разъехавшееся имя
          // молча теряло бы данные при выполнении (KI-022/KI-030).
          expect(edge.sourceHandle).toBe(NODE_PORT_CONTRACT[sourceType ?? '']?.sourceHandleId);
          expect(edge.targetHandle).toBe(NODE_PORT_CONTRACT[targetType ?? '']?.targetHandleId);
        }
      }
    });
  });
});
