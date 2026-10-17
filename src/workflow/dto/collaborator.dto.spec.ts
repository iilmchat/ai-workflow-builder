import { describe, expect, it } from 'vitest';
import {
  CollaboratorRoleSchema,
  InviteCollaboratorSchema,
  UpdateCollaboratorRoleSchema,
} from './collaborator.dto.js';

/** Валидный uuid пользователя для тестов. */
const USER_ID = '33333333-3333-4333-8333-333333333333';

describe('CollaboratorRoleSchema (R7.6)', () => {
  it('принимает viewer и editor', () => {
    expect(CollaboratorRoleSchema.parse('viewer')).toBe('viewer');
    expect(CollaboratorRoleSchema.parse('editor')).toBe('editor');
  });

  it('отклоняет owner и неизвестные роли', () => {
    expect(CollaboratorRoleSchema.safeParse('owner').success).toBe(false);
    expect(CollaboratorRoleSchema.safeParse('admin').success).toBe(false);
  });
});

describe('InviteCollaboratorSchema (R7.6)', () => {
  it('принимает uuid и роль', () => {
    expect(InviteCollaboratorSchema.parse({ userId: USER_ID, role: 'editor' })).toEqual({
      userId: USER_ID,
      role: 'editor',
    });
  });

  it('отклоняет не-uuid, роль owner и лишние поля', () => {
    expect(
      InviteCollaboratorSchema.safeParse({ userId: 'not-a-uuid', role: 'viewer' }).success,
    ).toBe(false);
    expect(
      InviteCollaboratorSchema.safeParse({ userId: USER_ID, role: 'owner' }).success,
    ).toBe(false);
    // z.object по умолчанию отбрасывает лишние ключи, но валидный payload
    // обязан содержать ровно userId и role после parse.
    expect(
      InviteCollaboratorSchema.parse({ userId: USER_ID, role: 'viewer', invitedBy: 'x' }),
    ).toEqual({ userId: USER_ID, role: 'viewer' });
  });
});

describe('UpdateCollaboratorRoleSchema (R7.6)', () => {
  it('принимает только роль', () => {
    expect(UpdateCollaboratorRoleSchema.parse({ role: 'viewer' })).toEqual({
      role: 'viewer',
    });
  });

  it('отклоняет пустое тело и неизвестную роль', () => {
    expect(UpdateCollaboratorRoleSchema.safeParse({}).success).toBe(false);
    expect(UpdateCollaboratorRoleSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });
});
