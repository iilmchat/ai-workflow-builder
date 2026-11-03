import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import i18n from '@/i18n';
import {
  fetchAuditLogsAsync,
  type AuditLog,
} from '@/lib/audit-api';
import {
  fetchOrganizationMembersAsync,
  inviteMemberAsync,
  removeMemberAsync,
  updateMemberRoleAsync,
  type OrgInvitation,
  type OrgMember,
} from '@/lib/org-api';
import { useAuthStore } from '@/stores/auth';
import {
  InvitableOrgRoleSchema,
  type InvitableOrgRole,
  type OrgRole,
} from '@/types/organization';

/** Сколько записей журнала аудита запрашивается на одну страницу. */
const AUDIT_PAGE_SIZE = 20;

/** Вкладки модалки «Команда и аудит» (v1.0.0 S5). */
type TeamTab = 'members' | 'audit';

/**
 * Роли, которым доступны приглашения и журнал аудита.
 *
 * Backend отвечает 403 остальным ролям, поэтому вкладка «Аудит» и кнопка
 * «Пригласить» для `member`/`viewer` не рисуются: UI не предлагает действие,
 * которое гарантированно не сработает (тот же принцип, что у viewer в TopBar).
 */
const MANAGEMENT_ROLES: ReadonlySet<OrgRole> = new Set(['owner', 'admin']);

/** Цвет бейджа роли: владелец и админ визуально отличаются от остальных. */
const ROLE_BADGE_CLASS: Record<OrgRole, string> = {
  owner: 'bg-amber-100 text-amber-700',
  admin: 'bg-blue-100 text-blue-700',
  member: 'bg-muted text-muted-foreground',
  viewer: 'bg-muted text-muted-foreground',
};

/** Пропсы модального окна команды. */
interface TeamPageProps {
  /** Закрывает окно (Escape, клик по фону, крестик). */
  onClose: () => void;
}

/**
 * Форматирует ISO-дату под текущий язык интерфейса (без времени).
 *
 * @param value - ISO-строка из `joinedAt`/`invitedAt`
 * @returns дата в локали UI; «дата неизвестна» для битой строки
 */
function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return i18n.t('history.date_unknown');
  }

  return date.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'ru-RU');
}

/**
 * Форматирует ISO-дату и время записи журнала аудита.
 *
 * @param value - ISO-строка из `AuditLog.createdAt`
 * @returns дата/время в локали UI; «дата неизвестна» для битой строки
 */
function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return i18n.t('history.date_unknown');
  }

  return date.toLocaleString(i18n.language === 'en' ? 'en-US' : 'ru-RU');
}

/**
 * Достаёт текст ошибки из неизвестного значения (strict: `catch` → `unknown`).
 *
 * @param caught - значение из `catch`
 * @returns сообщение `Error` либо общая подпись «Неизвестная ошибка»
 */
function reasonOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : i18n.t('team.error.unknown');
}

/**
 * Собирает подпись и подсказку для кода действия журнала аудита.
 *
 * Коды действий — стабильные строки (`workflow.create`, `run.start`,
 * `http.post`; см. backend `src/audit/audit.constants.ts`). Известным кодам
 * соответствует ключ `audit.action.<код>`; для неизвестного (новое действие
 * backend'а, которого ещё нет в i18n) показываем **сам код** — журнал остаётся
 * читаемым, а не превращается в «Неизвестное действие». Подсказка
 * `audit.unknown_action` объясняет, что это сырой код.
 *
 * @param action - код действия из `AuditLog.action`
 * @returns подпись для ячейки и `title` (для неизвестного кода)
 */
function actionMetaOf(action: string): { label: string; title: string | undefined } {
  const key = `audit.action.${action}`;

  if (i18n.exists(key)) {
    return { label: i18n.t(key), title: undefined };
  }

  return { label: action, title: i18n.t('audit.unknown_action') };
}

/**
 * Модальное окно «Команда и аудит» (v1.0.0 S5, DESIGN V100 § 3.2).
 *
 * Две вкладки:
 * 1. «Участники» (по умолчанию) — список организации (`GET /admin/members`),
 *    ожидающие приглашения и (для `owner`/`admin`) форма приглашения
 *    (`POST /admin/members/invite`). Приглашённый адрес попадает в список
 *    ожидающих; после его регистрации он появится среди участников с указанной
 *    ролью.
 * 2. «Аудит» — журнал действий организации (`GET /admin/audit`, только
 *    `owner`/`admin`). Грузится **лениво** при первом открытии вкладки;
 *    пагинация — keyset по `nextCursor` (как история запусков, v0.16 S1):
 *    «Загрузить ещё» дописывает следующую страницу, дубли по `id`
 *    отбрасываются.
 *
 * Устройство модалки повторяет `RunHistoryModal`/`ShareModal`: оверлей на
 * `fixed inset-0 z-40`, закрытие по Escape, клику на фон и крестику; сам
 * редактор остаётся смонтированным под окном.
 *
 * @param props.onClose - закрытие модалки (передаётся в кнопку и обработчики)
 * @returns разметка модального окна
 */
export function TeamPage({ onClose }: TeamPageProps) {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  // Роль `null` (сессии ещё нет) трактуем как «нет прав»: модалку открывает
  // только аутентифицированный пользователь, но guard дешёвый.
  const canManageTeam = user !== null && MANAGEMENT_ROLES.has(user.role);
  // v1.1.0 S2 (KI-586): управление составом (смена роли/удаление) доступно
  // только владельцу — backend отвечает 403 администратору (OrgOwnerOnlyGuard).
  const isOwner = user !== null && user.role === 'owner';

  const [activeTab, setActiveTab] = useState<TeamTab>('members');

  // Участники и приглашения (GET /admin/members).
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [isMembersLoading, setIsMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  // Счётчик перезагрузок: retry и refetch после приглашения меняют его, не
  // дублируя логику загрузки отдельной функцией.
  const [membersReloadKey, setMembersReloadKey] = useState(0);

  // Форма приглашения.
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitableOrgRole>('member');
  const [isInviteBusy, setIsInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Управление составом (v1.1.0 S2): ошибка действия и id участника, для
  // которого запрос в полёте (блокирует его контролы, остальные остаются
  // активными).
  const [memberActionError, setMemberActionError] = useState<string | null>(
    null,
  );
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  // Журнал аудита (GET /admin/audit). `0` — первая страница ещё не запрошена:
  // вкладка грузится лениво, при первом открытии.
  const [auditFetchId, setAuditFetchId] = useState(0);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [isAuditLoadingMore, setIsAuditLoadingMore] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoadMoreError, setAuditLoadMoreError] = useState<string | null>(
    null,
  );

  // Догрузка «Загрузить ещё» запускается из обработчика, а не из effect:
  // после размонтирования её промис всё ещё может завершиться — гасим поздний
  // setState по ref (модалка живёт недолго, но лишних обновлений не нужно).
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Участники грузятся сразу при открытии модалки (вкладка по умолчанию).
  // `cancelled` гасит поздний ответ: пока запрос в полёте, окно могли закрыть.
  useEffect(() => {
    let cancelled = false;

    setIsMembersLoading(true);
    setMembersError(null);

    fetchOrganizationMembersAsync()
      .then((page) => {
        if (!cancelled) {
          setMembers(page.members);
          setInvitations(page.invitations);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setMembersError(
            i18n.t('team.members.load_failed', { reason: reasonOf(caught) }),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsMembersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [membersReloadKey]);

  // Первая страница журнала: запрос уходит при первом открытии вкладки
  // (auditFetchId становится 1 в `handleSelectTab`) и повторяется на retry.
  useEffect(() => {
    if (auditFetchId === 0) {
      return;
    }

    let cancelled = false;

    setIsAuditLoading(true);
    setAuditError(null);
    setAuditLoadMoreError(null);

    fetchAuditLogsAsync(AUDIT_PAGE_SIZE)
      .then((page) => {
        if (!cancelled) {
          setLogs(page.logs);
          setNextCursor(page.nextCursor);
          setTotal(page.total);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          // 403 (нет прав) приходит сюда же: вкладка не открывается без роли
          // owner/admin, но backend мог отклонить и по другой причине.
          setAuditError(
            i18n.t('audit.load_failed', { reason: reasonOf(caught) }),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsAuditLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auditFetchId]);

  // Escape закрывает окно — то же поведение, что у RunHistoryModal/ShareModal.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /**
   * Переключает вкладку; «Аудит» при первом открытии запрашивает первую
   * страницу журнала (ленивая загрузка).
   *
   * @param tab - целевая вкладка
   */
  const handleSelectTab = (tab: TeamTab) => {
    setActiveTab(tab);

    if (tab === 'audit' && auditFetchId === 0) {
      setAuditFetchId(1);
    }
  };

  /**
   * Показывает/прячет форму приглашения и сбрасывает её сообщения.
   *
   * @returns ничего
   */
  const handleToggleInvite = () => {
    setIsInviteOpen((value) => !value);
    setInviteError(null);
    // Успех прошлого приглашения не должен висеть над новой формой.
    setInviteSuccess(null);
  };

  /**
   * Отправляет приглашение (только owner/admin; кнопка скрыта у остальных).
   *
   * Email проверяется локально Zod'ом до запроса — та же схема, что принимает
   * backend (`InviteMemberPayloadSchema`), поэтому ошибка видна мгновенно.
   * После успеха форма закрывается, список участников перезапрашивается, а в
   * панели остаётся сообщение: «приглашение отправлено» при `emailSent: true`
   * либо «создано, но письмо не отправлено» при `false` (v1.1.0 S1 — SMTP
   * опционален, приглашение живёт в БД независимо от письма).
   *
   * @param event - событие submit формы
   * @returns промис без значения
   */
  const handleInviteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);

    const email = inviteEmail.trim();
    const parsedEmail = z.email().safeParse(email);

    if (!parsedEmail.success) {
      setInviteError(i18n.t('team.invite.invalid_email'));

      return;
    }

    setIsInviteBusy(true);

    try {
      const created = await inviteMemberAsync({
        email: parsedEmail.data,
        role: inviteRole,
      });

      // v1.1.0 S1: приглашение создаётся и без SMTP. Сообщение различается,
      // чтобы «письмо отправлено» не звучало при `emailSent: false`.
      setInviteSuccess(
        created.emailSent
          ? i18n.t('team.invite.success', { email: parsedEmail.data })
          : i18n.t('team.invite.success_no_email', { email: parsedEmail.data }),
      );
      setInviteEmail('');
      setInviteRole('member');
      setIsInviteOpen(false);
      // Перезапрос списка: приглашение должно появиться в секции ожидающих.
      setMembersReloadKey((value) => value + 1);
    } catch (caught: unknown) {
      setInviteError(
        i18n.t('team.invite.error', { reason: reasonOf(caught) }),
      );
    } finally {
      setIsInviteBusy(false);
    }
  };

  /**
   * Меняет роль участника (v1.1.0 S2, только владелец).
   *
   * Роль приходит из `<select>`: значение парсится `InvitableOrgRoleSchema`
   * (домен `admin`/`member`/`viewer`, `owner` назначить нельзя). После успеха
   * список перезапрашивается — сервер остаётся источником истины. Ошибка
   * (400 своя роль, 403, 404) показывается над списком, роль в контроле при
   * ошибке не «залипает»: форму перерисует следующий `GET /admin/members`.
   *
   * @param member - участник, чью роль меняем
   * @param role - новая роль из селекта
   * @returns промис без значения
   */
  const handleRoleChange = async (
    member: OrgMember,
    role: InvitableOrgRole,
  ): Promise<void> => {
    setMemberActionError(null);
    setBusyMemberId(member.userId);

    try {
      await updateMemberRoleAsync(member.userId, role);
      setMembersReloadKey((value) => value + 1);
    } catch (caught: unknown) {
      setMemberActionError(
        i18n.t('team.member.action_failed', { reason: reasonOf(caught) }),
      );
    } finally {
      setBusyMemberId(null);
    }
  };

  /**
   * Исключает участника из организации (v1.1.0 S2, только владелец).
   *
   * Подтверждение — нативное `window.confirm` с email участника: операция
   * заметная (участник теряет доступ к графам этой организации, графы
   * переходят владельцу), а отдельная модалка подтверждения в S2 не вводилась.
   * Себя удалить нельзя — defensive-проверка перед `confirm` (backend всё равно
   * ответит 400), ключ `team.error.cannot_remove_self`.
   *
   * @param member - участник, которого исключаем
   * @returns промис без значения
   */
  const handleRemoveMember = async (member: OrgMember): Promise<void> => {
    setMemberActionError(null);

    if (user !== null && member.userId === user.id) {
      setMemberActionError(i18n.t('team.error.cannot_remove_self'));

      return;
    }

    if (!window.confirm(i18n.t('team.confirm.remove', { email: member.email }))) {
      return;
    }

    setBusyMemberId(member.userId);

    try {
      await removeMemberAsync(member.userId);
      setMembersReloadKey((value) => value + 1);
    } catch (caught: unknown) {
      setMemberActionError(
        i18n.t('team.member.action_failed', { reason: reasonOf(caught) }),
      );
    } finally {
      setBusyMemberId(null);
    }
  };

  /**
   * Догружает следующую страницу журнала аудита и дописывает её к списку.
   *
   * Источник истины о наличии страниц — `nextCursor` сервера (выборка
   * `limit + 1`), а не `logs.length < total`: `total` может опережать список,
   * если между запросами появились новые записи. Дубли по `id` отбрасываются —
   * дешёвая защита от повторной страницы.
   *
   * @returns промис без значения
   */
  const handleAuditLoadMore = () => {
    if (nextCursor === null || isAuditLoadingMore) {
      return;
    }

    setIsAuditLoadingMore(true);
    setAuditLoadMoreError(null);

    fetchAuditLogsAsync(AUDIT_PAGE_SIZE, nextCursor)
      .then((page) => {
        if (!isMountedRef.current) {
          return;
        }

        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setLogs((previous) => {
          const seen = new Set(previous.map((log) => log.id));
          const merged = [...previous];

          for (const log of page.logs) {
            if (!seen.has(log.id)) {
              seen.add(log.id);
              merged.push(log);
            }
          }

          return merged;
        });
      })
      .catch((caught: unknown) => {
        if (isMountedRef.current) {
          setAuditLoadMoreError(
            i18n.t('audit.load_more_failed', { reason: reasonOf(caught) }),
          );
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsAuditLoadingMore(false);
        }
      });
  };

  /** email участника по uuid: приглашающий и записи журнала показываются так. */
  const emailByUserId = new Map(
    members.map((member) => [member.userId, member.email]),
  );

  /**
   * Подпись пользователя в строке журнала: email из участников либо
   * «неизвестный пользователь» (журнал может ссылаться на удалённого).
   *
   * @param userId - uuid пользователя из `AuditLog.userId`
   * @returns email участника или подпись `audit.unknown_user`
   */
  const userLabelOf = (userId: string): string =>
    emailByUserId.get(userId) ?? t('audit.unknown_user');

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="presentation"
      data-team-modal-backdrop=""
    >
      <div
        className="flex max-h-[75vh] w-full max-w-3xl flex-col rounded-xl bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('team.title')}
        data-team-modal=""
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t('team.title')}
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-2 text-muted-foreground hover:text-foreground"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div
          className="flex gap-1 border-b border-border px-4"
          role="tablist"
          aria-label={t('team.title')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'members'}
            data-team-tab-members=""
            onClick={() => handleSelectTab('members')}
            className={`cursor-pointer rounded-t px-3 py-2 text-xs font-medium ${
              activeTab === 'members'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('team.tab.members')}
          </button>

          {/* Вкладка «Аудит» — только owner/admin: backend отвечает 403
              остальным, и вкладка не должна предлагать заведомый отказ. */}
          {canManageTeam && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'audit'}
              data-team-tab-audit=""
              onClick={() => handleSelectTab('audit')}
              className={`cursor-pointer rounded-t px-3 py-2 text-xs font-medium ${
                activeTab === 'audit'
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('team.tab.audit')}
            </button>
          )}
        </div>

        <div className="min-h-24 flex-1 overflow-y-auto px-4 py-3">
          {activeTab === 'members' && (
            <div data-team-panel-members="">
              <div className="flex items-center justify-between gap-2 pb-2">
                <span
                  className="text-[11px] text-muted-foreground"
                  data-team-members-total={members.length}
                >
                  {t('team.members.total', { total: members.length })}
                </span>

                {/* Приглашать может только owner/admin (backend: 403 остальным). */}
                {canManageTeam && (
                  <button
                    type="button"
                    data-team-invite=""
                    onClick={handleToggleInvite}
                    className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-blue-700"
                  >
                    {t('team.invite')}
                  </button>
                )}
              </div>

              {isInviteOpen && canManageTeam && (
                <form
                  onSubmit={(event) => void handleInviteSubmit(event)}
                  // Своя проверка (Zod) вместо нативной: браузерная валидация
                  // `type="email"` отменила бы submit и не показала наше
                  // локализованное сообщение `team.invite.invalid_email`.
                  noValidate
                  data-team-invite-form=""
                  className="mb-3 space-y-2 rounded-lg border border-border p-3"
                >
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder={t('team.invite.email.placeholder')}
                    aria-label={t('team.invite.email')}
                    data-team-invite-email=""
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />

                  <div className="flex gap-2">
                    <select
                      value={inviteRole}
                      onChange={(event) => {
                        const parsed = InvitableOrgRoleSchema.safeParse(
                          event.target.value,
                        );

                        if (parsed.success) {
                          setInviteRole(parsed.data);
                        }
                      }}
                      aria-label={t('team.invite.role')}
                      data-team-invite-role=""
                      className="flex-1 cursor-pointer rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                    >
                      {InvitableOrgRoleSchema.options.map((role) => (
                        <option key={role} value={role}>
                          {t(`team.role.${role}`)}
                        </option>
                      ))}
                    </select>

                    <button
                      type="submit"
                      disabled={isInviteBusy}
                      data-team-invite-submit=""
                      className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('team.invite.submit')}
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleInvite}
                      data-team-invite-cancel=""
                      className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      {t('team.invite.cancel')}
                    </button>
                  </div>
                </form>
              )}

              {inviteSuccess !== null && (
                <p
                  role="status"
                  data-team-invite-success=""
                  className="mb-3 text-xs text-green-700"
                >
                  {inviteSuccess}
                </p>
              )}

              {inviteError !== null && (
                <p
                  role="alert"
                  data-team-invite-error=""
                  className="mb-3 text-xs text-red-600"
                >
                  {inviteError}
                </p>
              )}

              {/* v1.1.0 S2: ошибка смены роли/удаления участника. */}
              {memberActionError !== null && (
                <p
                  role="alert"
                  data-team-member-error=""
                  className="mb-3 text-xs text-red-600"
                >
                  {memberActionError}
                </p>
              )}

              {isMembersLoading && (
                <p
                  className="text-xs text-muted-foreground"
                  data-team-loading=""
                >
                  {t('common.loading')}
                </p>
              )}

              {!isMembersLoading && membersError !== null && (
                <div className="flex flex-col gap-2" data-team-error="">
                  <p role="alert" className="text-xs text-red-600">
                    {membersError}
                  </p>
                  <button
                    type="button"
                    data-team-retry=""
                    onClick={() => setMembersReloadKey((value) => value + 1)}
                    className="w-fit cursor-pointer rounded-md bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-border"
                  >
                    {t('team.members.retry')}
                  </button>
                </div>
              )}

              {!isMembersLoading &&
                membersError === null &&
                members.length === 0 && (
                  <p
                    className="text-xs text-muted-foreground"
                    data-team-empty=""
                  >
                    {t('team.members.empty')}
                  </p>
                )}

              {!isMembersLoading &&
                membersError === null &&
                members.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {members.map((member) => (
                      <li
                        key={member.userId}
                        data-team-member={member.userId}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                          {member.email}
                        </span>

                        {/* «вы» — чтобы в списке было видно себя, а не только роль. */}
                        {user !== null && member.userId === user.id && (
                          <span
                            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            data-team-member-you=""
                          >
                            {t('team.members.you')}
                          </span>
                        )}

                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_BADGE_CLASS[member.role]}`}
                          data-team-role={member.role}
                        >
                          {t(`team.role.${member.role}`)}
                        </span>

                        <span className="text-[10px] text-muted-foreground">
                          {t('team.members.joined', {
                            date: formatDate(member.joinedAt),
                          })}
                        </span>

                        {/* v1.1.0 S2 (KI-586): управление составом — только
                            владелец и только для не-владельцев. Владельца
                            нельзя ни разжаловать, ни удалить (backend: 400),
                            поэтому у его строки контролов нет. */}
                        {isOwner && member.role !== 'owner' && (
                          <span
                            className="flex items-center gap-1.5"
                            data-team-member-actions=""
                          >
                            <select
                              value={member.role}
                              aria-label={t('team.role.update')}
                              title={t('team.role.update')}
                              data-team-member-role-select={member.userId}
                              disabled={busyMemberId === member.userId}
                              onChange={(event) => {
                                const parsed = InvitableOrgRoleSchema.safeParse(
                                  event.target.value,
                                );

                                if (parsed.success) {
                                  void handleRoleChange(member, parsed.data);
                                }
                              }}
                              className="cursor-pointer rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {InvitableOrgRoleSchema.options.map((role) => (
                                <option key={role} value={role}>
                                  {t(`team.role.${role}`)}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              data-team-member-remove={member.userId}
                              disabled={busyMemberId === member.userId}
                              onClick={() => void handleRemoveMember(member)}
                              aria-label={t('team.member.remove')}
                              title={t('team.member.remove')}
                              className="cursor-pointer rounded-lg border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t('team.member.remove')}
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

              <div className="mt-4" data-team-invitations="">
                <h3 className="pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('team.members.pending')}
                </h3>

                {invitations.length === 0 ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-team-invitations-empty=""
                  >
                    {t('team.members.pending_empty')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {invitations.map((invitation) => (
                      <li
                        key={invitation.email}
                        data-team-invitation=""
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                          {invitation.email}
                        </span>

                        <span className="text-[11px] text-muted-foreground">
                          {t(`team.role.${invitation.role}`)}
                        </span>

                        <span className="text-[10px] text-muted-foreground">
                          {formatDate(invitation.invitedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {activeTab === 'audit' && canManageTeam && (
            <div data-team-panel-audit="">
              <div className="flex items-center justify-between pb-2">
                <span
                  className="text-[11px] text-muted-foreground"
                  data-team-audit-total={total}
                >
                  {t('audit.total', { total })}
                </span>
              </div>

              {/* Заголовок «таблицы»: те же колонки, что у строк ниже. */}
              <div className="grid grid-cols-[150px_1fr_1fr_1fr] gap-2 border-b border-border px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{t('audit.date')}</span>
                <span>{t('audit.user')}</span>
                <span>{t('audit.action')}</span>
                <span>{t('audit.resource')}</span>
              </div>

              {isAuditLoading && (
                <p
                  className="px-2 py-1 text-xs text-muted-foreground"
                  data-team-audit-loading=""
                >
                  {t('common.loading')}
                </p>
              )}

              {!isAuditLoading && auditError !== null && (
                <div
                  className="flex flex-col gap-2 px-2 py-1"
                  data-team-audit-error=""
                >
                  <p role="alert" className="text-xs text-red-600">
                    {auditError}
                  </p>
                  <button
                    type="button"
                    data-team-audit-retry=""
                    onClick={() => setAuditFetchId((value) => value + 1)}
                    className="w-fit cursor-pointer rounded-md bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-border"
                  >
                    {t('audit.retry')}
                  </button>
                </div>
              )}

              {!isAuditLoading &&
                auditError === null &&
                logs.length === 0 && (
                  <p
                    className="px-2 py-1 text-xs text-muted-foreground"
                    data-team-audit-empty=""
                  >
                    {t('audit.empty')}
                  </p>
                )}

              {!isAuditLoading &&
                auditError === null &&
                logs.length > 0 && (
                  <ul className="flex flex-col">
                    {logs.map((log) => {
                      const action = actionMetaOf(log.action);

                      return (
                        <li
                          key={log.id}
                          data-team-audit-row={log.id}
                          className="grid grid-cols-[150px_1fr_1fr_1fr] items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted"
                        >
                          <span className="truncate text-muted-foreground">
                            {formatDateTime(log.createdAt)}
                          </span>

                          <span
                            className="truncate text-foreground"
                            data-team-audit-user={log.userId}
                          >
                            {userLabelOf(log.userId)}
                          </span>

                          <span
                            className="truncate text-foreground"
                            title={action.title}
                            data-team-audit-action={log.action}
                          >
                            {action.label}
                          </span>

                          <span
                            className="truncate text-muted-foreground"
                            title={log.resourceId ?? undefined}
                            data-team-audit-resource=""
                          >
                            {log.resourceId ?? '—'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

              {!isAuditLoading &&
                auditError === null &&
                auditLoadMoreError !== null && (
                  <div
                    className="mt-2 flex flex-col gap-2 px-2 py-1"
                    data-team-audit-load-more-error=""
                  >
                    <p role="alert" className="text-xs text-red-600">
                      {auditLoadMoreError}
                    </p>
                    <button
                      type="button"
                      onClick={handleAuditLoadMore}
                      data-team-audit-load-more-retry=""
                      className="w-fit cursor-pointer rounded-md bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-border"
                    >
                      {t('audit.retry')}
                    </button>
                  </div>
                )}

              {/* Футер — только когда первая страница загружена без ошибки:
                  иначе при isLoading `nextCursor === null` и рядом с «Загрузка…»
                  появилось бы «Показано 0 из 0». */}
              {!isAuditLoading && auditError === null && (
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-2">
                  <span
                    className="text-[10px] text-muted-foreground"
                    data-team-audit-loaded={logs.length}
                    data-team-audit-total-counter={total}
                  >
                    {t('audit.loaded', { loaded: logs.length, total })}
                  </span>

                  {nextCursor !== null ? (
                    <button
                      type="button"
                      data-team-audit-load-more=""
                      onClick={handleAuditLoadMore}
                      disabled={isAuditLoadingMore}
                      className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isAuditLoadingMore
                        ? t('common.loading')
                        : t('audit.load_more')}
                    </button>
                  ) : (
                    <span
                      className="text-[10px] text-muted-foreground"
                      data-team-audit-end=""
                    >
                      {t('audit.end')}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
