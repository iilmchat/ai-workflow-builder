import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/i18n/ru.json';
import {
  fetchAuditLogsAsync,
  type AuditLog,
} from '@/lib/audit-api';
import {
  fetchOrganizationMembersAsync,
  inviteMemberAsync,
  removeMemberAsync,
  updateMemberRoleAsync,
  type InviteMemberResponse,
  type OrgInvitation,
  type OrgMember,
} from '@/lib/org-api';
import { useAuthStore } from '@/stores/auth';
import type { OrgRole } from '@/types/organization';
import { TeamPage } from './TeamPage';

/**
 * Мок API команды и аудита (v1.0.0 S5).
 *
 * Модалка не должна ходить в сеть из тестов: состав контракта проверяет
 * `api-contract.spec.ts`, а здесь — поведение UI (вкладки, роли, приглашение,
 * keyset-пагинация журнала). `importOriginal` сохраняет Zod-схемы модуля,
 * которые может тянуть компонент.
 */
vi.mock('@/lib/org-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org-api')>();

  return {
    ...actual,
    fetchOrganizationMembersAsync: vi.fn(),
    inviteMemberAsync: vi.fn(),
    updateMemberRoleAsync: vi.fn(),
    removeMemberAsync: vi.fn(),
  };
});

vi.mock('@/lib/audit-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit-api')>();

  return { ...actual, fetchAuditLogsAsync: vi.fn() };
});

/** uuid организации в тестах. */
const ORG_ID = '00000000-0000-4000-8000-000000000001';

/** uuid текущего пользователя (владельца организации). */
const OWNER_ID = '11111111-1111-4111-8111-111111111111';

/** uuid второго участника организации. */
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Публичные данные тестового пользователя.
 *
 * @param role - роль в организации (по умолчанию `owner`)
 * @returns объект пользователя для стора аутентификации
 */
function authUserOf(role: OrgRole) {
  return {
    id: OWNER_ID,
    email: 'owner@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    organizationId: ORG_ID,
    role,
  };
}

/** Текущий пользователь — владелец организации. */
const OWNER_MEMBER: OrgMember = {
  userId: OWNER_ID,
  email: 'owner@example.com',
  role: 'owner',
  joinedAt: '2026-01-01T00:00:00.000Z',
};

/** Второй участник организации. */
const MEMBER: OrgMember = {
  userId: MEMBER_ID,
  email: 'member@example.com',
  role: 'member',
  joinedAt: '2026-02-02T00:00:00.000Z',
};

/** Ожидающее приглашение. */
const PENDING_INVITATION: OrgInvitation = {
  email: 'invited@example.com',
  role: 'viewer',
  invitedBy: OWNER_ID,
  invitedAt: '2026-03-03T00:00:00.000Z',
};

/**
 * Ответ инвайта, когда письмо поставлено в очередь (v1.2.0 S2).
 *
 * `emailSent` всегда `false` (письмо не отправляется синхронно), поэтому
 * успех письма в UI определяется только по `emailQueued`.
 */
const INVITE_RESPONSE: InviteMemberResponse = {
  ...PENDING_INVITATION,
  emailQueued: true,
  emailSent: false,
};

/** Запись журнала аудита с ресурсом. */
const LOG_WORKFLOW_CREATE: AuditLog = {
  id: '33333333-3333-4333-8333-333333333333',
  cursor: 'cursor-log-1',
  createdAt: '2026-11-02T10:00:00.000Z',
  userId: MEMBER_ID,
  organizationId: ORG_ID,
  action: 'workflow.create',
  resourceId: '44444444-4444-4444-8444-444444444444',
  metadata: {},
};

/** Запись журнала аудита без ресурса и с неизвестным пользователем. */
const LOG_RUN_START: AuditLog = {
  id: '55555555-5555-4555-8555-555555555555',
  cursor: 'cursor-log-2',
  createdAt: '2026-11-02T09:00:00.000Z',
  userId: 'deleted-user',
  organizationId: ORG_ID,
  action: 'run.start',
  resourceId: null,
  metadata: { attempt: 1 },
};

/**
 * Рендерит модалку команды с заглушкой `onClose`.
 *
 * @returns `onClose`-мок и результат `render`
 */
function renderTeam() {
  const onClose = vi.fn();
  const view = render(<TeamPage onClose={onClose} />);

  return { ...view, onClose };
}

describe('TeamPage — вкладки и роли (v1.0.0 S5)', () => {
  beforeEach(() => {
    vi.mocked(fetchOrganizationMembersAsync).mockReset();
    vi.mocked(fetchOrganizationMembersAsync).mockResolvedValue({
      members: [OWNER_MEMBER, MEMBER],
      invitations: [PENDING_INVITATION],
    });
    vi.mocked(inviteMemberAsync).mockReset();
    vi.mocked(inviteMemberAsync).mockResolvedValue(INVITE_RESPONSE);
    vi.mocked(fetchAuditLogsAsync).mockReset();
    vi.mocked(fetchAuditLogsAsync).mockResolvedValue({
      logs: [],
      nextCursor: null,
      total: 0,
    });

    useAuthStore.setState({
      user: authUserOf('owner'),
      accessToken: 'test-token',
      status: 'authenticated',
    });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, status: 'unknown' });
  });

  it('owner видит обе вкладки и кнопку приглашения', async () => {
    const { container } = renderTeam();

    await screen.findByText(ru['team.tab.members']);

    expect(container.querySelector('[data-team-tab-members]')).not.toBeNull();
    expect(container.querySelector('[data-team-tab-audit]')).not.toBeNull();
    expect(container.querySelector('[data-team-invite]')).not.toBeNull();

    // По умолчанию открыта вкладка «Участники»: список уже запрошен.
    await waitFor(() =>
      expect(vi.mocked(fetchOrganizationMembersAsync)).toHaveBeenCalledTimes(1),
    );
  });

  it('роль member: вкладки «Аудит» и приглашения нет (backend отдал бы 403)', async () => {
    useAuthStore.setState({ user: authUserOf('member') });

    const { container } = renderTeam();

    // Список участников доступен и участнику — ждём загрузку.
    await screen.findByText('member@example.com');

    expect(container.querySelector('[data-team-tab-members]')).not.toBeNull();
    expect(container.querySelector('[data-team-tab-audit]')).toBeNull();
    expect(container.querySelector('[data-team-invite]')).toBeNull();
  });

  it('рендерит участников (email, роль, дата вступления) и ожидающие приглашения', async () => {
    const { container } = renderTeam();

    await screen.findByText('member@example.com');

    // Свой email + маркер «вы» только у текущего пользователя.
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-team-member-you]')).toHaveLength(1);

    // Роль — бейдж с подписью из i18n (`team.role.*`). Ищем именно бейджи
    // (`[data-team-role]`): с v1.1.0 S2 те же подписи есть в `<option>`
    // селекта смены роли, и `getByText` нашёл бы несколько узлов.
    expect(
      Array.from(container.querySelectorAll('[data-team-role]')).map(
        (element) => element.textContent,
      ),
    ).toEqual([ru['team.role.owner'], ru['team.role.member']]);

    // Дата вступления локализуется и вставляется в шаблон.
    expect(screen.getAllByText(/присоединился/)).toHaveLength(2);

    // Заголовок с общим числом участников.
    expect(
      container.querySelector('[data-team-members-total]'),
    ).toHaveAttribute('data-team-members-total', '2');
    expect(
      screen.getByText(`Всего участников: 2`),
    ).toBeInTheDocument();

    // Секция ожидающих приглашений: адрес, роль и дата.
    expect(
      container.querySelector('[data-team-invitations]'),
    ).not.toBeNull();
    expect(screen.getByText('invited@example.com')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-team-invitation]')).toHaveLength(1);
  });

  it('показывает ошибку загрузки участников и повторяет запрос по «Повторить»', async () => {
    vi.mocked(fetchOrganizationMembersAsync)
      .mockReset()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ members: [OWNER_MEMBER], invitations: [] });

    const { container } = renderTeam();

    const error = await screen.findByText(/Не удалось загрузить участников: boom/);
    expect(error).toBeInTheDocument();
    expect(container.querySelector('[data-team-error]')).not.toBeNull();

    fireEvent.click(
      container.querySelector('[data-team-retry]') as HTMLButtonElement,
    );

    await screen.findByText('owner@example.com');
    expect(vi.mocked(fetchOrganizationMembersAsync)).toHaveBeenCalledTimes(2);
  });
});

describe('TeamPage — журнал аудита (v1.0.0 S5)', () => {
  beforeEach(() => {
    vi.mocked(fetchOrganizationMembersAsync).mockReset();
    vi.mocked(fetchOrganizationMembersAsync).mockResolvedValue({
      members: [OWNER_MEMBER, MEMBER],
      invitations: [],
    });
    vi.mocked(fetchAuditLogsAsync).mockReset();

    useAuthStore.setState({
      user: authUserOf('owner'),
      accessToken: 'test-token',
      status: 'authenticated',
    });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, status: 'unknown' });
  });

  it('грузит журнал лениво при первом открытии вкладки и рендерит строки', async () => {
    vi.mocked(fetchAuditLogsAsync).mockResolvedValue({
      logs: [LOG_WORKFLOW_CREATE],
      nextCursor: null,
      total: 1,
    });

    const { container } = renderTeam();

    // До открытия вкладки «Аудит» запрос не уходит (ленивая загрузка).
    expect(vi.mocked(fetchAuditLogsAsync)).not.toHaveBeenCalled();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenCalledWith(20, null, {}),
    );

    // Строка журнала: подпись действия из `audit.action.*`, email участника по
    // `userId` и `resourceId` в колонке «Ресурс». Ищем ячейки по data-атрибутам:
    // с v1.1.0 S3 те же email/подписи есть в `<option>` фильтров.
    await waitFor(() =>
      expect(
        container.querySelector('[data-team-audit-row]'),
      ).not.toBeNull(),
    );
    expect(
      container.querySelector('[data-team-audit-action="workflow.create"]')
        ?.textContent,
    ).toBe(ru['audit.action.workflow.create']);
    expect(
      container.querySelector('[data-team-audit-user]')?.textContent,
    ).toBe('member@example.com');
    expect(
      screen.getByText(LOG_WORKFLOW_CREATE.resourceId as string),
    ).toBeInTheDocument();
    // Счётчик «Показано 1 из 1» и отсутствие кнопки при `nextCursor === null`.
    expect(
      screen.getByText(`Показано 1 из 1`),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-team-audit-load-more]'),
    ).toBeNull();
    expect(container.querySelector('[data-team-audit-end]')).not.toBeNull();
  });

  it('показывает журнал с неизвестным пользователем и неизвестным действием', async () => {
    vi.mocked(fetchAuditLogsAsync).mockResolvedValue({
      logs: [{ ...LOG_RUN_START, action: 'custom.action' }],
      nextCursor: null,
      total: 1,
    });

    const { container } = renderTeam();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    await screen.findByText('custom.action');

    // Неизвестный пользователь — подпись `audit.unknown_user`; неизвестный код
    // действия показывается сырым (с подсказкой `audit.unknown_action`).
    expect(screen.getByText(ru['audit.unknown_user'])).toBeInTheDocument();
    const actionCell = container.querySelector(
      '[data-team-audit-action="custom.action"]',
    );
    expect(actionCell).toHaveAttribute('title', ru['audit.unknown_action']);
    // Ресурса нет — прочерк.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('«Загрузить ещё» дописывает вторую страницу и скрывается на nextCursor null', async () => {
    vi.mocked(fetchAuditLogsAsync)
      .mockResolvedValueOnce({
        logs: [LOG_WORKFLOW_CREATE],
        nextCursor: 'cursor-page-2',
        total: 2,
      })
      .mockResolvedValueOnce({
        logs: [LOG_RUN_START],
        nextCursor: null,
        total: 2,
      });

    const { container } = renderTeam();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-team-audit-row]'),
      ).toHaveLength(1),
    );

    const loadMore = container.querySelector(
      '[data-team-audit-load-more]',
    ) as HTMLButtonElement;

    expect(loadMore).not.toBeNull();
    fireEvent.click(loadMore);

    // Вторая страница дописана к первой: обе строки в списке.
    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-team-audit-row]'),
      ).toHaveLength(2),
    );
    expect(
      container.querySelector('[data-team-audit-action="run.start"]')
        ?.textContent,
    ).toBe(ru['audit.action.run.start']);
    expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenLastCalledWith(
      20,
      'cursor-page-2',
      {},
    );

    // `nextCursor === null` — страниц больше нет: кнопка исчезла, показан «конец».
    await waitFor(() =>
      expect(
        container.querySelector('[data-team-audit-load-more]'),
      ).toBeNull(),
    );
    expect(container.querySelector('[data-team-audit-end]')).not.toBeNull();
    expect(screen.getByText('Показано 2 из 2')).toBeInTheDocument();
  });

  it('при ошибке API журнала (в т.ч. 403) показывает ошибку, а не падает', async () => {
    vi.mocked(fetchAuditLogsAsync).mockRejectedValue(
      Object.assign(new Error('Доступ запрещён'), { status: 403 }),
    );

    const { container } = renderTeam();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    const error = await screen.findByText(/Не удалось загрузить журнал/);
    expect(error).toBeInTheDocument();
    expect(container.querySelector('[data-team-audit-error]')).not.toBeNull();
    // Модалка остаётся открытой: вкладки на месте.
    expect(container.querySelector('[data-team-modal]')).not.toBeNull();
  });
});

describe('TeamPage — приглашение (v1.0.0 S5)', () => {
  beforeEach(() => {
    vi.mocked(fetchOrganizationMembersAsync).mockReset();
    vi.mocked(fetchOrganizationMembersAsync).mockResolvedValue({
      members: [OWNER_MEMBER],
      invitations: [],
    });
    vi.mocked(inviteMemberAsync).mockReset();
    vi.mocked(inviteMemberAsync).mockResolvedValue(INVITE_RESPONSE);
    vi.mocked(fetchAuditLogsAsync).mockReset();
    vi.mocked(fetchAuditLogsAsync).mockResolvedValue({
      logs: [],
      nextCursor: null,
      total: 0,
    });

    useAuthStore.setState({
      user: authUserOf('admin'),
      accessToken: 'test-token',
      status: 'authenticated',
    });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, status: 'unknown' });
  });

  it('отправляет приглашение, перезапрашивает участников и показывает успех', async () => {
    const { container } = renderTeam();

    await screen.findByText(OWNER_MEMBER.email);

    fireEvent.click(
      container.querySelector('[data-team-invite]') as HTMLButtonElement,
    );

    const emailInput = container.querySelector(
      '[data-team-invite-email]',
    ) as HTMLInputElement;
    const roleSelect = container.querySelector(
      '[data-team-invite-role]',
    ) as HTMLSelectElement;

    expect(emailInput).not.toBeNull();
    expect(roleSelect).not.toBeNull();

    fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
    fireEvent.change(roleSelect, { target: { value: 'admin' } });
    fireEvent.click(
      container.querySelector('[data-team-invite-submit]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(inviteMemberAsync)).toHaveBeenCalledWith({
        email: 'new@example.com',
        role: 'admin',
      }),
    );

    // Сообщение об успехе — с приглашённым email; форма закрыта. Текст берём
    // из i18n: v1.2.0 S2 добавил маркер очереди (`(в очереди)`).
    expect(
      await screen.findByText(
        ru['team.invite.success'].replace('{{email}}', 'new@example.com'),
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-team-invite-form]'),
    ).toBeNull();

    // Список участников перезапрошен после успеха.
    await waitFor(() =>
      expect(vi.mocked(fetchOrganizationMembersAsync)).toHaveBeenCalledTimes(2),
    );
  });

  it('показывает «письмо не отправлено», если emailQueued=false (v1.2.0 S2)', async () => {
    // Очередь/Redis недоступны: приглашение в БД есть, письмо не поставлено.
    vi.mocked(inviteMemberAsync).mockResolvedValue({
      ...INVITE_RESPONSE,
      emailQueued: false,
    });

    const { container } = renderTeam();

    await screen.findByText(OWNER_MEMBER.email);

    fireEvent.click(
      container.querySelector('[data-team-invite]') as HTMLButtonElement,
    );
    fireEvent.change(
      container.querySelector('[data-team-invite-email]') as HTMLInputElement,
      { target: { value: 'no-smtp@example.com' } },
    );
    fireEvent.click(
      container.querySelector('[data-team-invite-submit]') as HTMLButtonElement,
    );

    // Сообщение честно различает «создано» и «письмо отправлено»: при
    // `emailQueued: false` нельзя утверждать, что письмо ушло.
    expect(
      await screen.findByText(
        ru['team.invite.success_no_email'].replace(
          '{{email}}',
          'no-smtp@example.com',
        ),
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-team-invite-success]'),
    ).not.toBeNull();
  });

  it('показывает «отправлено (в очереди)», если emailQueued=true (v1.2.0 S2)', async () => {
    const { container } = renderTeam();

    await screen.findByText(OWNER_MEMBER.email);

    fireEvent.click(
      container.querySelector('[data-team-invite]') as HTMLButtonElement,
    );
    fireEvent.change(
      container.querySelector('[data-team-invite-email]') as HTMLInputElement,
      { target: { value: 'queued@example.com' } },
    );
    fireEvent.click(
      container.querySelector('[data-team-invite-submit]') as HTMLButtonElement,
    );

    // При `emailQueued: true` UI не утверждает «письмо отправлено», а говорит
    // про очередь: доставку подтвердит только SMTP-воркер.
    expect(
      await screen.findByText(
        ru['team.invite.success'].replace('{{email}}', 'queued@example.com'),
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-team-invite-success]')?.textContent,
    ).toContain('в очереди');
  });

  it('не отправляет приглашение с некорректным email', async () => {
    const { container } = renderTeam();

    await screen.findByText(OWNER_MEMBER.email);

    fireEvent.click(
      container.querySelector('[data-team-invite]') as HTMLButtonElement,
    );
    fireEvent.change(
      container.querySelector('[data-team-invite-email]') as HTMLInputElement,
      { target: { value: 'not-an-email' } },
    );
    fireEvent.click(
      container.querySelector('[data-team-invite-submit]') as HTMLButtonElement,
    );

    expect(
      await screen.findByText(ru['team.invite.invalid_email']),
    ).toBeInTheDocument();
    expect(vi.mocked(inviteMemberAsync)).not.toHaveBeenCalled();
  });

  it('показывает ошибку приглашения (например, 409 — email уже занят)', async () => {
    vi.mocked(inviteMemberAsync).mockRejectedValue(
      new Error('Email уже зарегистрирован'),
    );

    const { container } = renderTeam();

    await screen.findByText(OWNER_MEMBER.email);

    fireEvent.click(
      container.querySelector('[data-team-invite]') as HTMLButtonElement,
    );
    fireEvent.change(
      container.querySelector('[data-team-invite-email]') as HTMLInputElement,
      { target: { value: 'busy@example.com' } },
    );
    fireEvent.click(
      container.querySelector('[data-team-invite-submit]') as HTMLButtonElement,
    );

    expect(
      await screen.findByText(
        'Не удалось пригласить: Email уже зарегистрирован',
      ),
    ).toBeInTheDocument();
    // Форма остаётся открытой, чтобы можно было исправить email.
    expect(
      container.querySelector('[data-team-invite-form]'),
    ).not.toBeNull();
  });
});

describe('TeamPage — управление составом (v1.1.0 S2)', () => {
  beforeEach(() => {
    vi.mocked(fetchOrganizationMembersAsync).mockReset();
    vi.mocked(fetchOrganizationMembersAsync).mockResolvedValue({
      members: [OWNER_MEMBER, MEMBER],
      invitations: [],
    });
    vi.mocked(updateMemberRoleAsync).mockReset();
    vi.mocked(updateMemberRoleAsync).mockResolvedValue({
      ...MEMBER,
      role: 'viewer',
    });
    vi.mocked(removeMemberAsync).mockReset();
    vi.mocked(removeMemberAsync).mockResolvedValue();
    vi.mocked(fetchAuditLogsAsync).mockReset();
    vi.mocked(fetchAuditLogsAsync).mockResolvedValue({
      logs: [],
      nextCursor: null,
      total: 0,
    });
    // jsdom не реализует window.confirm — подменяем, иначе обработчик упадёт.
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    useAuthStore.setState({
      user: authUserOf('owner'),
      accessToken: 'test-token',
      status: 'authenticated',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null, accessToken: null, status: 'unknown' });
  });

  it('owner видит селект роли и «Удалить» у участника, но не у владельца', async () => {
    const { container } = renderTeam();

    await screen.findByText(MEMBER.email);

    const select = container.querySelector(
      `[data-team-member-role-select="${MEMBER_ID}"]`,
    ) as HTMLSelectElement | null;

    expect(select).not.toBeNull();
    expect(select?.value).toBe('member');
    expect(
      container.querySelector(`[data-team-member-remove="${MEMBER_ID}"]`),
    ).not.toBeNull();
    // У строки владельца контролов нет: его роль и состав неизменяемы.
    expect(
      container.querySelector(`[data-team-member-role-select="${OWNER_ID}"]`),
    ).toBeNull();
    expect(
      container.querySelector(`[data-team-member-remove="${OWNER_ID}"]`),
    ).toBeNull();
  });

  it('admin не видит управление составом (backend отвечает 403)', async () => {
    useAuthStore.setState({ user: authUserOf('admin') });

    const { container } = renderTeam();

    await screen.findByText(MEMBER.email);

    expect(container.querySelector('[data-team-member-actions]')).toBeNull();
    // Приглашать admin может (S5), управлять составом — нет (S2).
    expect(container.querySelector('[data-team-invite]')).not.toBeNull();
  });

  it('смена роли вызывает PATCH и перезапрашивает список', async () => {
    const { container } = renderTeam();

    await screen.findByText(MEMBER.email);

    fireEvent.change(
      container.querySelector(
        `[data-team-member-role-select="${MEMBER_ID}"]`,
      ) as HTMLSelectElement,
      { target: { value: 'viewer' } },
    );

    await waitFor(() =>
      expect(vi.mocked(updateMemberRoleAsync)).toHaveBeenCalledWith(
        MEMBER_ID,
        'viewer',
      ),
    );
    // Сервер — источник истины: список перезапрашивается после действия.
    await waitFor(() =>
      expect(vi.mocked(fetchOrganizationMembersAsync)).toHaveBeenCalledTimes(2),
    );
  });

  it('удаление: confirm accepted → DELETE и перезапрос списка', async () => {
    const { container } = renderTeam();

    await screen.findByText(MEMBER.email);

    fireEvent.click(
      container.querySelector(
        `[data-team-member-remove="${MEMBER_ID}"]`,
      ) as HTMLButtonElement,
    );

    // Текст подтверждения содержит email участника.
    expect(window.confirm).toHaveBeenCalledWith(
      ru['team.confirm.remove'].replace('{{email}}', MEMBER.email),
    );
    await waitFor(() =>
      expect(vi.mocked(removeMemberAsync)).toHaveBeenCalledWith(MEMBER_ID),
    );
    await waitFor(() =>
      expect(vi.mocked(fetchOrganizationMembersAsync)).toHaveBeenCalledTimes(2),
    );
  });

  it('удаление: confirm cancelled → API не вызывается', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);

    const { container } = renderTeam();

    await screen.findByText(MEMBER.email);

    fireEvent.click(
      container.querySelector(
        `[data-team-member-remove="${MEMBER_ID}"]`,
      ) as HTMLButtonElement,
    );

    expect(vi.mocked(removeMemberAsync)).not.toHaveBeenCalled();
  });

  it('ошибка смены роли показывается над списком', async () => {
    vi.mocked(updateMemberRoleAsync).mockRejectedValue(
      new Error('403: только владелец'),
    );

    const { container } = renderTeam();

    await screen.findByText(MEMBER.email);

    fireEvent.change(
      container.querySelector(
        `[data-team-member-role-select="${MEMBER_ID}"]`,
      ) as HTMLSelectElement,
      { target: { value: 'admin' } },
    );

    expect(
      await screen.findByText(
        ru['team.member.action_failed'].replace(
          '{{reason}}',
          '403: только владелец',
        ),
      ),
    ).toBeInTheDocument();
  });
});

describe('TeamPage — фильтры аудита (v1.1.0 S3)', () => {
  beforeEach(() => {
    vi.mocked(fetchOrganizationMembersAsync).mockReset();
    vi.mocked(fetchOrganizationMembersAsync).mockResolvedValue({
      members: [OWNER_MEMBER, MEMBER],
      invitations: [],
    });
    vi.mocked(fetchAuditLogsAsync).mockReset();
    vi.mocked(fetchAuditLogsAsync).mockResolvedValue({
      logs: [],
      nextCursor: null,
      total: 0,
    });

    useAuthStore.setState({
      user: authUserOf('owner'),
      accessToken: 'test-token',
      status: 'authenticated',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null, accessToken: null, status: 'unknown' });
  });

  it('рендерит фильтры действия, автора и дат на вкладке «Аудит»', async () => {
    const { container } = renderTeam();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenCalledWith(20, null, {}),
    );

    expect(container.querySelector('[data-team-audit-filters]')).not.toBeNull();
    expect(
      container.querySelector('[data-team-audit-action-filter]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-team-audit-user-filter]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-team-audit-from]')).not.toBeNull();
    expect(container.querySelector('[data-team-audit-to]')).not.toBeNull();
    // Без активных фильтров кнопки «Сбросить» нет.
    expect(container.querySelector('[data-team-audit-reset]')).toBeNull();
    // В селекте действия — «Все действия» и известные коды (подписи из i18n).
    expect(
      screen.getByRole('option', { name: ru['audit.filter.all_actions'] }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: ru['audit.action.workflow.create'] }),
    ).toBeInTheDocument();
  });

  it('смена действия перезапрашивает журнал с action', async () => {
    const { container } = renderTeam();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(
      container.querySelector(
        '[data-team-audit-action-filter]',
      ) as HTMLSelectElement,
      { target: { value: 'workflow.create' } },
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenLastCalledWith(
        20,
        null,
        { action: 'workflow.create' },
      ),
    );
    // Активный фильтр даёт возможность сбросить его одним нажатием.
    expect(container.querySelector('[data-team-audit-reset]')).not.toBeNull();
  });

  it('автор и даты уходят ISO-моментами локальных суток', async () => {
    const { container } = renderTeam();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(
      container.querySelector(
        '[data-team-audit-user-filter]',
      ) as HTMLSelectElement,
      { target: { value: MEMBER_ID } },
    );
    fireEvent.change(
      container.querySelector('[data-team-audit-from]') as HTMLInputElement,
      { target: { value: '2026-11-01' } },
    );
    fireEvent.change(
      container.querySelector('[data-team-audit-to]') as HTMLInputElement,
      { target: { value: '2026-11-02' } },
    );

    // Границы считаются в локальном поясе: «с 1 ноября» включает весь день
    // по местному времени, а не UTC-сутки.
    const expectedFrom = new Date('2026-11-01T00:00:00').toISOString();
    const expectedTo = new Date('2026-11-02T23:59:59.999').toISOString();

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenLastCalledWith(
        20,
        null,
        {
          userId: MEMBER_ID,
          from: expectedFrom,
          to: expectedTo,
        },
      ),
    );
  });

  it('«Загрузить ещё» передаёт те же фильтры и курсор', async () => {
    vi.mocked(fetchAuditLogsAsync).mockReset();
    vi.mocked(fetchAuditLogsAsync).mockResolvedValue({
      logs: [LOG_WORKFLOW_CREATE],
      nextCursor: 'cursor-page-2',
      total: 2,
    });

    const { container } = renderTeam();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(
      container.querySelector(
        '[data-team-audit-action-filter]',
      ) as HTMLSelectElement,
      { target: { value: 'workflow.create' } },
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenLastCalledWith(
        20,
        null,
        { action: 'workflow.create' },
      ),
    );

    fireEvent.click(
      container.querySelector(
        '[data-team-audit-load-more]',
      ) as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenLastCalledWith(
        20,
        'cursor-page-2',
        { action: 'workflow.create' },
      ),
    );
  });

  it('«Сбросить» очищает фильтры и перезапрашивает журнал без них', async () => {
    const { container } = renderTeam();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(
      container.querySelector(
        '[data-team-audit-action-filter]',
      ) as HTMLSelectElement,
      { target: { value: 'run.start' } },
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenLastCalledWith(20, null, {
        action: 'run.start',
      }),
    );

    fireEvent.click(
      container.querySelector('[data-team-audit-reset]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenLastCalledWith(
        20,
        null,
        {},
      ),
    );
    // После сброса фильтров кнопка снова скрыта.
    await waitFor(() =>
      expect(
        container.querySelector('[data-team-audit-reset]'),
      ).toBeNull(),
    );
  });

  it('пустой отфильтрованный журнал показывает отдельное сообщение', async () => {
    const { container } = renderTeam();

    fireEvent.click(
      container.querySelector('[data-team-tab-audit]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(vi.mocked(fetchAuditLogsAsync)).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(
      container.querySelector(
        '[data-team-audit-action-filter]',
      ) as HTMLSelectElement,
      { target: { value: 'run.start' } },
    );

    expect(
      await screen.findByText(ru['audit.empty_filtered']),
    ).toBeInTheDocument();
    // Это не «журнал пуст» — общий текст без фильтров не показывается.
    expect(screen.queryByText(ru['audit.empty'])).toBeNull();
  });
});
