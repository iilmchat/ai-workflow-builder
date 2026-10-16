import {
  DEFAULT_MEDIA_PROVIDER_PRIORITY,
  orderMediaProviders,
  parseMediaProviderPriority,
} from './media-provider-priority.js';

/**
 * Юнит-тесты приоритета media-провайдеров (R7.3, DESIGN v0.9 § 3.3).
 *
 * Приоритет определяет, в какой upstream уйдёт id модели при коллизии имён
 * (`gpt-image-1` есть и у CreativeLab, и у OpenAI Images), поэтому проверяется
 * и разбор env, и порядок массива провайдеров.
 */
describe('parseMediaProviderPriority', () => {
  it('без значения отдаёт дефолтный порядок DESIGN § 3.3', () => {
    expect(parseMediaProviderPriority(undefined)).toEqual(
      DEFAULT_MEDIA_PROVIDER_PRIORITY,
    );
  });

  it('разбирает строку через запятую, обрезая пробелы', () => {
    expect(parseMediaProviderPriority(' fal , replicate ')).toEqual([
      'fal',
      'replicate',
    ]);
  });

  it('схлопывает дубликаты и пустые элементы', () => {
    expect(parseMediaProviderPriority('fal,,fal,replicate,')).toEqual([
      'fal',
      'replicate',
    ]);
  });

  it('строка из одних запятых даёт дефолтный порядок', () => {
    expect(parseMediaProviderPriority(',,,')).toEqual(
      DEFAULT_MEDIA_PROVIDER_PRIORITY,
    );
  });

  it('неизвестное имя сохраняется: кастомный провайдер тоже участвует', () => {
    expect(parseMediaProviderPriority('my_media,fal')).toEqual([
      'my_media',
      'fal',
    ]);
  });
});

describe('orderMediaProviders', () => {
  /** Провайдер-заглушка с именем. */
  const provider = (name: string): { name: string } => ({ name });

  it('расставляет провайдеров по порядку приоритета', () => {
    const ordered = orderMediaProviders(
      [provider('openai_images'), provider('fal'), provider('replicate')],
      ['replicate', 'fal', 'openai_images'],
    );

    expect(ordered.map((item) => item.name)).toEqual([
      'replicate',
      'fal',
      'openai_images',
    ]);
  });

  it('провайдер вне списка приоритета дописывается в конец', () => {
    const ordered = orderMediaProviders(
      [provider('creativelab'), provider('custom'), provider('fal')],
      ['creativelab', 'fal'],
    );

    // `custom` зарегистрирован, но не упомянут в приоритете: его модели не
    // должны молча исчезнуть из UI.
    expect(ordered.map((item) => item.name)).toEqual([
      'creativelab',
      'fal',
      'custom',
    ]);
  });

  it('имя из приоритета, которого нет среди провайдеров, игнорируется', () => {
    const ordered = orderMediaProviders([provider('fal')], [
      'replicate',
      'fal',
    ]);

    expect(ordered.map((item) => item.name)).toEqual(['fal']);
  });

  it('падает на дубликате имени: маршрутизация была бы неоднозначной', () => {
    expect(() =>
      orderMediaProviders([provider('fal'), provider('fal')], ['fal']),
    ).toThrow('Два media-провайдера с именем «fal»');
  });
});
