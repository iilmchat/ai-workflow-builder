import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Workflow } from '../db/schema.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

const workflow: Workflow = {
  id: WORKFLOW_ID,
  userId: 'user-1',
  name: 'My workflow',
  description: null,
  nodes: [],
  edges: [],
  version: 1,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

describe('WorkflowController', () => {
  let controller: WorkflowController;
  let service: {
    createAsync: ReturnType<typeof vi.fn>;
    findAllAsync: ReturnType<typeof vi.fn>;
    findOneAsync: ReturnType<typeof vi.fn>;
    updateAsync: ReturnType<typeof vi.fn>;
    removeAsync: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      createAsync: vi.fn(() => Promise.resolve(workflow)),
      findAllAsync: vi.fn(() => Promise.resolve([workflow])),
      findOneAsync: vi.fn(() => Promise.resolve(workflow)),
      updateAsync: vi.fn(() => Promise.resolve(workflow)),
      removeAsync: vi.fn(() => Promise.resolve(true)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [{ provide: WorkflowService, useValue: service }],
    }).compile();

    controller = moduleRef.get(WorkflowController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('делегирует создание сервису и возвращает результат', async () => {
      const dto = { userId: 'user-1', name: 'My workflow', nodes: [], edges: [] };

      await expect(controller.create(dto)).resolves.toEqual(workflow);
      expect(service.createAsync).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('передаёт userId, limit и offset в сервис', async () => {
      const query = { userId: 'user-1', limit: 10, offset: 20 };

      await expect(controller.findAll(query)).resolves.toEqual([workflow]);
      expect(service.findAllAsync).toHaveBeenCalledWith('user-1', 10, 20);
    });
  });

  describe('findOne', () => {
    it('возвращает workflow, если он найден', async () => {
      await expect(controller.findOne({ id: WORKFLOW_ID })).resolves.toEqual(
        workflow,
      );
      expect(service.findOneAsync).toHaveBeenCalledWith(WORKFLOW_ID);
    });

    it('бросает NotFoundException, если сервис вернул null', async () => {
      service.findOneAsync.mockResolvedValue(null);

      await expect(controller.findOne({ id: WORKFLOW_ID })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('возвращает обновлённый workflow', async () => {
      const dto = { name: 'Updated' };

      await expect(controller.update({ id: WORKFLOW_ID }, dto)).resolves.toEqual(
        workflow,
      );
      expect(service.updateAsync).toHaveBeenCalledWith(WORKFLOW_ID, dto);
    });

    it('бросает NotFoundException, если сервис вернул null', async () => {
      service.updateAsync.mockResolvedValue(null);

      await expect(
        controller.update({ id: WORKFLOW_ID }, { name: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('завершается успешно, когда сервис удалил запись', async () => {
      await expect(controller.remove({ id: WORKFLOW_ID })).resolves.toBeUndefined();
      expect(service.removeAsync).toHaveBeenCalledWith(WORKFLOW_ID);
    });

    it('бросает NotFoundException, если сервис вернул false', async () => {
      service.removeAsync.mockResolvedValue(false);

      await expect(controller.remove({ id: WORKFLOW_ID })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
