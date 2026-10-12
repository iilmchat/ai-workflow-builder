import { EMPTY_UPDATE_MESSAGE, UpdateWorkflowSchema } from './update-workflow.dto.js';

describe('UpdateWorkflowSchema', () => {
  it('отклоняет пустой объект с сообщением о отсутствии полей', () => {
    const result = UpdateWorkflowSchema.safeParse({});

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('ожидалась ошибка валидации пустого объекта');
    }

    expect(result.error.issues[0]?.message).toBe(EMPTY_UPDATE_MESSAGE);
  });

  it('принимает частичное обновление одного поля', () => {
    const result = UpdateWorkflowSchema.safeParse({ name: 'Новое имя' });

    expect(result.success).toBe(true);

    if (!result.success) {
      throw new Error('ожидался успешный парсинг');
    }

    // default([]) не должен добавлять nodes/edges в частичное обновление.
    expect(result.data).toEqual({ name: 'Новое имя' });
    expect(Object.keys(result.data)).toEqual(['name']);
  });

  it('принимает обновление нескольких полей', () => {
    const result = UpdateWorkflowSchema.safeParse({
      name: 'Имя',
      description: 'Описание',
      nodes: [{ id: 'n1' }],
      edges: [],
    });

    expect(result.success).toBe(true);
  });

  it('не пропускает userId (владельца нельзя сменить через PATCH)', () => {
    const result = UpdateWorkflowSchema.safeParse({
      name: 'Имя',
      userId: 'another-user',
    });

    expect(result.success).toBe(true);

    if (!result.success) {
      throw new Error('ожидался успешный парсинг');
    }

    expect(result.data).not.toHaveProperty('userId');
  });

  it('отклоняет некорректные значения полей', () => {
    expect(UpdateWorkflowSchema.safeParse({ name: '' }).success).toBe(false);
    expect(UpdateWorkflowSchema.safeParse({ name: 'a'.repeat(201) }).success).toBe(
      false,
    );
    expect(UpdateWorkflowSchema.safeParse({ nodes: 'not-an-array' }).success).toBe(
      false,
    );
  });

  it('отбрасывает неизвестные ключи, поэтому только их недостаточно', () => {
    const result = UpdateWorkflowSchema.safeParse({ limit: 5 });

    // Zod strip: ключа `limit` нет в схеме, после парсинга объект пуст,
    // значит refine отклоняет запрос как «нет полей для обновления».
    expect(result.success).toBe(false);
    expect(UpdateWorkflowSchema.safeParse({ limit: 5, name: 'Имя' }).success).toBe(
      true,
    );
  });
});
