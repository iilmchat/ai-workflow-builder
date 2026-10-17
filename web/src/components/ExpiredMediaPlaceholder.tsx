import { useTranslation } from 'react-i18next';

/**
 * Плейсхолдер истёкшей media-ссылки (R7.8, KI-362).
 *
 * Появляется, когда своя ссылка (`storedUrl`) сохранена, но её TTL прошёл
 * (`storedExpiresAt < now`). Ссылка провайдера к этому моменту тоже мертва
 * (CreativeLab отдаёт результат на 48 часов), поэтому вместо битой картинки
 * показывается честное «ссылка истекла».
 *
 * Атрибут `data-media-expired` — контракт для CDP-смоука и будущих e2e:
 * состояние видно без разбора текста.
 */
export function ExpiredMediaPlaceholder() {
  const { t } = useTranslation();

  return (
    <div
      data-media-expired=""
      className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border bg-muted px-2 text-center text-[10px] text-muted-foreground"
    >
      {t('node.media.expired')}
    </div>
  );
}
