import { useTranslation } from 'react-i18next';

/**
 * Плейсхолдер недоступной media-ссылки (R7.8/KI-362, KI-444).
 *
 * Появляется в двух случаях:
 * 1. своя ссылка (`storedUrl`) сохранена, но её TTL прошёл
 *    (`storedExpiresAt < now`);
 * 2. своей копии нет вовсе, хотя результат у узла есть (старый прогон или
 *    сбой загрузки в S3) — гарантировать доступность ссылки провайдера нельзя,
 *    её TTL (48 часов) нам не известен.
 *
 * Ссылка провайдера к этому моменту почти наверняка мертва (CreativeLab отдаёт
 * результат на 48 часов), поэтому вместо битой картинки показывается честное
 * «ссылка истекла».
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
