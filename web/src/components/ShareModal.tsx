import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createShareTokenAsync, revokeShareTokenAsync } from '@/lib/share-api';
import { buildAbsoluteShareUrl } from '@/lib/share-url';
import { useShareStore } from '@/stores/share';

interface ShareModalProps {
  /** uuid сохранённого workflow. */
  readonly workflowId: string;
  /** Закрыть модалку. */
  readonly onClose: () => void;
}

/**
 * Модалка «Поделиться» (R6.2.2, DESIGN v0.8 § 4.3).
 *
 * Три состояния: ссылки нет (кнопка «Создать»), ссылка есть (URL + копирование
 * + отзыв), идёт запрос/ошибка. Токен не логируется (RULES 5.9) и живёт в
 * `useShareStore` — backend не отдаёт существующий токен, поэтому после F5
 * модалка снова предложит создать ссылку.
 *
 * @param props.workflowId - id workflow
 * @param props.onClose - закрытие модалки
 * @returns разметка модалки
 */
export function ShareModal({ workflowId, onClose }: ShareModalProps) {
  const { t } = useTranslation();
  const shareToken = useShareStore((state) => state.shareToken);
  const setShareToken = useShareStore((state) => state.setShareToken);

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  // Задел (R6.6): флаг «разрешить копирование» пока только UI — backend его
  // не хранит и никак не влияет на read-only страницу.
  const [allowCopy, setAllowCopy] = useState(true);

  const shareUrl =
    shareToken === null
      ? null
      : buildAbsoluteShareUrl(window.location.origin, `/workflow/share/${shareToken}`);

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
