import { useEffect } from 'react';
import { useWorkflowStore } from '@/stores/workflow';

/** Сколько держать уведомление на экране. */
const NOTICE_TIMEOUT_MS = 3000;

/**
 * Простой inline-тост: красная плашка для ошибок, зелёная для успеха.
 *
 * Библиотеку не тянем — уведомления нужны ровно в одном месте.
 */
export function Toast() {
  const notice = useWorkflowStore((state) => state.notice);
  const setNotice = useWorkflowStore((state) => state.setNotice);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  if (!notice) {
    return null;
  }

  const palette =
    notice.kind === 'error'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  return (
    <div className="pointer-events-none fixed left-1/2 top-16 z-50 -translate-x-1/2">
      <div
        role="status"
        className={`pointer-events-auto max-w-2xl rounded-lg border px-4 py-2 text-xs shadow-sm ${palette}`}
      >
        {notice.text}
      </div>
    </div>
  );
}
