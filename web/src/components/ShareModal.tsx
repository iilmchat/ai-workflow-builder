import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchCollaboratorsAsync,
  inviteCollaboratorAsync,
  removeCollaboratorAsync,
  updateCollaboratorRoleAsync,
} from '@/lib/collaborators-api';
import { createShareTokenAsync, revokeShareTokenAsync } from '@/lib/share-api';
import { buildAbsoluteShareUrl } from '@/lib/share-url';
import { useShareStore } from '@/stores/share';
import {
  CollaboratorRoleSchema,
  InviteCollaboratorPayloadSchema,
  type Collaborator,
  type CollaboratorRole,
} from '@/types/collaborator';

/** Вкладки модалки: публичная ссылка и участники (R7.6). */
export type ShareTab = 'link' | 'participants';

interface ShareModalProps {
  /** uuid сохранённого workflow. */
  readonly workflowId: string;
  /** Является ли текущий пользователь владельцем (R7.6). */
  readonly isOwner?: boolean;
  /** Вкладка при открытии; по умолчанию — «Ссылка». */
  readonly initialTab?: ShareTab;
  /** Закрыть модалку. */
  readonly onClose: () => void;
}

/**
 * Модалка «Поделиться» (R6.2.2, R7.6; DESIGN v0.8 § 4.3, DESIGN v0.9 § 3.6).
 *
 * Две вкладки: «Ссылка» (создать / скопировать / отозвать) и «Участники»
 * (приглашение по uuid, список с ролями, удаление). Управление участниками
 * показывается только владельцу: backend отвечает 404 участнику с ролью
 * `editor`, поэтому форма для него была бы заведомо нерабочей.
 *
 * Токен ссылки не логируется (RULES 5.9) и живёт в `useShareStore`: backend не
 * отдаёт существующий токен, поэтому после F5 модалка снова предложит создать
 * ссылку.
 *
 * @param props.workflowId - id workflow
 * @param props.isOwner - владелец ли текущий пользователь
 * @param props.initialTab - стартовая вкладка
 * @param props.onClose - закрытие модалки
 * @returns разметка модалки
 */
export function ShareModal({
  workflowId,
  isOwner = false,
  initialTab = 'link',
  onClose,
}: ShareModalProps) {
  const { t } = useTranslation();
  const shareToken = useShareStore((state) => state.shareToken);
  const setShareToken = useShareStore((state) => state.setShareToken);

  const [activeTab, setActiveTab] = useState<ShareTab>(initialTab);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  // Задел (R6.6): флаг «разрешить копирование» пока только UI — backend его
  // не хранит и никак не влияет на read-only страницу.
  const [allowCopy, setAllowCopy] = useState(true);

  // R7.6: участники.
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isParticipantsLoading, setIsParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState<CollaboratorRole>('viewer');
  const [isInviteBusy, setIsInviteBusy] = useState(false);

  const shareUrl =
    shareToken === null
      ? null
      : buildAbsoluteShareUrl(window.location.origin, `/workflow/share/${shareToken}`);

  /**
   * Загружает список участников с backend.
   *
   * @returns промис без значения
   */
  const loadCollaboratorsAsync = async () => {
    setIsParticipantsLoading(true);
    setParticipantsError(null);

    try {
      setCollaborators(await fetchCollaboratorsAsync(workflowId));
    } catch {
      setParticipantsError(t('share.participants.error'));
    } finally {
      setIsParticipantsLoading(false);
    }
  };

  // Список грузим лениво — при первом открытии вкладки «Участники» (R7.6).
  useEffect(() => {
    if (activeTab === 'participants') {
      void loadCollaboratorsAsync();
    }
  }, [activeTab, workflowId]);

  /**
   * Создаёт share-ссылку (перевыпускает токен, если он уже был).
   *
   * @returns промис без значения
   */
  const handleCreate = async () => {
    setIsBusy(true);
    setError(null);

    try {
      const result = await createShareTokenAsync(workflowId);

      setShareToken(result.shareToken);
      setCopied(false);
    } catch {
      setError(t('share.error.network'));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Копирует абсолютную ссылку в буфер обмена.
   *
   * Clipboard API может быть недоступен (нет разрешения, не-secure контекст,
   * политика браузера) — тогда копируем через устаревший, но поддерживаемый
   * `execCommand` по выделенному полю.
   *
   * @returns промис без значения
   */
  const handleCopy = async () => {
    if (shareUrl === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);

      return;
    } catch {
      // переходим к fallback
    }

    const input = urlInputRef.current;

    if (input !== null) {
      input.select();
      setCopied(document.execCommand('copy'));
    }
  };

  /**
   * Отзывает ссылку после подтверждения.
   *
   * @returns промис без значения
   */
  const handleRevoke = async () => {
    if (!window.confirm(t('share.revokeConfirm'))) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await revokeShareTokenAsync(workflowId);
      setShareToken(null);
      setCopied(false);
    } catch {
      setError(t('share.error.network'));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Приглашает участника по uuid (R7.6).
   *
   * @param event - событие submit формы
   * @returns промис без значения
   */
  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setParticipantsError(null);

    const parsed = InviteCollaboratorPayloadSchema.safeParse({
      userId: inviteUserId.trim(),
      role: inviteRole,
    });

    if (!parsed.success) {
      setParticipantsError(t('share.participants.invalidUserId'));

      return;
    }

    setIsInviteBusy(true);

    try {
      await inviteCollaboratorAsync(workflowId, parsed.data);
      setInviteUserId('');
      await loadCollaboratorsAsync();
    } catch {
      setParticipantsError(t('share.participants.error'));
    } finally {
      setIsInviteBusy(false);
    }
  };

  /**
   * Меняет роль участника (R7.6).
   *
   * @param userId - uuid участника
   * @param role - новая роль
   * @returns промис без значения
   */
  const handleRoleChange = async (userId: string, role: CollaboratorRole) => {
    setParticipantsError(null);

    try {
      const updated = await updateCollaboratorRoleAsync(workflowId, userId, role);

      // PATCH не возвращает email (его нет в строке участия): сохраняем
      // подпись из текущего списка, иначе после смены роли в строке появился
      // бы uuid вместо email.
      setCollaborators((current) =>
        current.map((item) =>
          item.userId === updated.userId
            ? { ...updated, email: updated.email ?? item.email }
            : item,
        ),
      );
    } catch {
      setParticipantsError(t('share.participants.error'));
    }
  };

  /**
   * Удаляет участника после подтверждения (R7.6).
   *
   * @param participant - удаляемый участник
   * @returns промис без значения
   */
  const handleRemove = async (participant: Collaborator) => {
    const label = participant.email ?? participant.userId;

    if (!window.confirm(t('share.participants.removeConfirm', { email: label }))) {
      return;
    }

    setParticipantsError(null);

    try {
      await removeCollaboratorAsync(workflowId, participant.userId);
      setCollaborators((current) =>
        current.filter((item) => item.userId !== participant.userId),
      );
    } catch {
      setParticipantsError(t('share.participants.error'));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      data-share-modal=""
      role="dialog"
      aria-label={t('share.title')}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-node">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t('share.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('share.close')}
            className="cursor-pointer rounded px-2 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex gap-1 border-b border-border" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'link'}
            data-share-tab="link"
            onClick={() => setActiveTab('link')}
            className={`cursor-pointer rounded-t px-3 py-1.5 text-xs font-medium ${
              activeTab === 'link'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('share.tabs.link')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'participants'}
            data-share-tab="participants"
            onClick={() => setActiveTab('participants')}
            className={`cursor-pointer rounded-t px-3 py-1.5 text-xs font-medium ${
              activeTab === 'participants'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('share.tabs.participants')}
          </button>
        </div>

        {activeTab === 'link' && (
          <div data-share-link-panel="">
            {shareUrl === null ? (
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={isBusy}
                data-share-create=""
                className="mt-4 w-full cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('share.create')}
              </button>
            ) : (
              <div className="mt-4">
                <input
                  ref={urlInputRef}
                  readOnly
                  value={shareUrl}
                  data-share-url=""
                  aria-label={t('share.title')}
                  onFocus={(event) => event.currentTarget.select()}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />

                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    data-share-copy=""
                    className="flex-1 cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    {copied ? t('share.copied') : t('share.copy')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRevoke()}
                    disabled={isBusy}
                    data-share-revoke=""
                    className="cursor-pointer rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('share.revoke')}
                  </button>
                </div>

                <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allowCopy}
                    onChange={(event) => setAllowCopy(event.target.checked)}
                    data-share-allow-copy=""
                    className="size-3.5 accent-[var(--color-primary)]"
                  />
                  {t('share.allowCopy')}
                </label>
              </div>
            )}
          </div>
        )}

        {activeTab === 'participants' && (
          <div className="mt-4" data-share-participants="">
            {!isOwner && (
              <p
                data-share-participants-owner-only=""
                className="mb-3 text-[11px] leading-snug text-muted-foreground"
              >
                {t('share.participants.ownerOnly')}
              </p>
            )}

            {isOwner && (
              <form onSubmit={(event) => void handleInvite(event)} className="space-y-2">
                <input
                  type="text"
                  value={inviteUserId}
                  onChange={(event) => setInviteUserId(event.target.value)}
                  placeholder={t('share.participants.userIdPlaceholder')}
                  aria-label={t('share.participants.userIdPlaceholder')}
                  data-collaborator-user-id=""
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <div className="flex gap-2">
                  <select
                    value={inviteRole}
                    onChange={(event) => {
                      const parsed = CollaboratorRoleSchema.safeParse(event.target.value);

                      if (parsed.success) {
                        setInviteRole(parsed.data);
                      }
                    }}
                    aria-label={t('share.participants.role')}
                    data-collaborator-role=""
                    className="flex-1 cursor-pointer rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  >
                    <option value="viewer">{t('share.participants.role.viewer')}</option>
                    <option value="editor">{t('share.participants.role.editor')}</option>
                  </select>
                  <button
                    type="submit"
                    disabled={isInviteBusy}
                    data-collaborator-invite=""
                    className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('share.participants.invite')}
                  </button>
                </div>
              </form>
            )}

            {isParticipantsLoading && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('share.participants.loading')}
              </p>
            )}

            {!isParticipantsLoading && collaborators.length === 0 && (
              <p data-share-participants-empty="" className="mt-3 text-xs text-muted-foreground">
                {t('share.participants.empty')}
              </p>
            )}

            {collaborators.length > 0 && (
              <ul className="mt-3 space-y-2">
                {collaborators.map((participant) => (
                  <li
                    key={participant.userId}
                    data-collaborator-row={participant.userId}
                    className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {participant.email ?? participant.userId}
                    </span>
                    {isOwner ? (
                      <select
                        value={participant.role}
                        onChange={(event) => {
                          const parsed = CollaboratorRoleSchema.safeParse(event.target.value);

                          if (parsed.success) {
                            void handleRoleChange(participant.userId, parsed.data);
                          }
                        }}
                        aria-label={t('share.participants.role')}
                        className="cursor-pointer rounded border border-border bg-background px-1 py-0.5 text-[11px] text-foreground"
                      >
                        <option value="viewer">{t('share.participants.role.viewer')}</option>
                        <option value="editor">{t('share.participants.role.editor')}</option>
                      </select>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {t(`share.participants.role.${participant.role}`)}
                      </span>
                    )}
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => void handleRemove(participant)}
                        data-collaborator-remove=""
                        aria-label={t('share.participants.remove')}
                        className="cursor-pointer rounded px-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {participantsError !== null && (
              <p role="alert" data-collaborator-error="" className="mt-3 text-xs text-red-600">
                {participantsError}
              </p>
            )}
          </div>
        )}

        {/* KI-233: предупреждение показываем всегда — оно про сам факт доступа
            по ссылке, а не про конкретное состояние токена. */}
        <p
          data-share-warning=""
          className="mt-3 text-[11px] leading-snug text-amber-600"
        >
          {t('share.warning')}
        </p>

        {error !== null && (
          <p role="alert" className="mt-3 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
