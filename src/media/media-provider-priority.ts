/**
 * Приоритет media-провайдеров (R7.3, DESIGN v0.9 § 3.3).
 *
 * Модели разных провайдеров могут называться одинаково (например `gpt-image-1`
 * есть и у CreativeLab, и у OpenAI Images). Чтобы id модели всегда уходил в
 * **один и тот же** upstream, победитель при коллизии определяется порядком
 * провайдеров, а не порядком регистрации в DI: первый в списке объявляет
 * модель, дубликаты остальных отбрасываются с предупреждением.
 *
 * Порядок задаётся env `MEDIA_PROVIDER_PRIORITY`
 * (`creativelab,replicate,fal,openai_images` по умолчанию) — тем же приёмом,
 * что и список моделей у LLM-провайдеров (RULES 4.6: env читает вызывающий
 * код, а не сервис).
 */

/** Имена провайдеров, известные на момент R7.3 (в дефолтном порядке). */
export const DEFAULT_MEDIA_PROVIDER_PRIORITY: readonly string[] = [
  'creativelab',
  'replicate',
  'fal',
  'openai_images',
];

/**
 * Разбирает env-строку приоритета в список имён.
 *
 * Поведение:
 * - пробелы и пустые элементы (`a,,b`) отбрасываются;
 * - дубликаты в строке схлопываются (первое вхождение сохраняет позицию);
 * - имена вне {@link DEFAULT_MEDIA_PROVIDER_PRIORITY} сохраняются как есть —
 *   кастомный провайдер тоже должен уметь попасть в порядок;
 * - пустая строка (или значение целиком из запятых) даёт дефолтный порядок:
 *   «пользователь стёр переменную» не должно означать «порядка нет».
 *
 * @param raw - сырое значение `MEDIA_PROVIDER_PRIORITY` (может быть `undefined`)
 * @returns имена провайдеров в порядке приоритета (непустой массив)
 */
export function parseMediaProviderPriority(
  raw: string | undefined,
): readonly string[] {
  if (raw === undefined) {
    return DEFAULT_MEDIA_PROVIDER_PRIORITY;
  }

  const names: string[] = [];

  for (const part of raw.split(',')) {
    const name = part.trim();

    if (name.length > 0 && !names.includes(name)) {
      names.push(name);
    }
  }

  return names.length > 0 ? names : DEFAULT_MEDIA_PROVIDER_PRIORITY;
}

/**
 * Упорядочивает провайдеров по приоритету.
 *
 * Провайдеры, которых нет в списке приоритета, сохраняют относительный порядок
 * и дописываются в конец: новый провайдер, добавленный в модуль без правки
 * env, обязан быть доступен (иначе его модели молча исчезли бы из UI).
 *
 * @param providers - провайдеры в порядке регистрации в DI
 * @param priority - имена провайдеров в порядке приоритета
 * @returns новый массив: сначала по приоритету, затем остальные как были
 * @throws Error если у двух провайдеров одинаковое имя (неоднозначная
 *   маршрутизация: `resolveByModelAsync` вернул бы случайного)
 */
export function orderMediaProviders<T extends { readonly name: string }>(
  providers: readonly T[],
  priority: readonly string[],
): readonly T[] {
  const byName = new Map<string, T>();

  for (const provider of providers) {
    if (byName.has(provider.name)) {
      throw new Error(
        `Два media-провайдера с именем «${provider.name}»: имена обязаны быть уникальны`,
      );
    }

    byName.set(provider.name, provider);
  }

  const ordered: T[] = [];

  for (const name of priority) {
    const provider = byName.get(name);

    if (provider) {
      ordered.push(provider);
      byName.delete(name);
    }
  }

  // Не упомянутые в приоритете — в порядке регистрации.
  for (const provider of providers) {
    if (byName.has(provider.name)) {
      ordered.push(provider);
      byName.delete(provider.name);
    }
  }

  return ordered;
}
