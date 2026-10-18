import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import ru from '@/i18n/ru.json';
import { ShareModal } from './ShareModal';

/** Сохранённый workflow для модалки. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Отдельный i18next-инстанс: серверный рендер не должен зависеть от
 * глобального `document`/localStorage (jsdom в тестах есть, KI-155).
 */
const i18n = createInstance();

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ru: { translation: ru } },
    lng: 'ru',
    fallbackLng: 'ru',
    interpolation: { escapeValue: false },
  });
});

/**
 * Рендерит модалку на сервере (без DOM).
 *
 * @param isOwner - показывать ли управление участниками
 * @returns HTML разметки
 */
function renderParticipantsTab(isOwner: boolean): string {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ShareModal, {
        workflowId: WORKFLOW_ID,
        isOwner,
        initialTab: 'participants',
        onClose: () => undefined,
      }),
    ),
  );
}

describe('ShareModal — вкладка «Участники» (R7.6)', () => {
  it('рендерит вкладки «Ссылка» и «Участники»', () => {
    const html = renderParticipantsTab(true);

    expect(html).toContain('data-share-tab="link"');
    expect(html).toContain('data-share-tab="participants"');
    expect(html).toContain('Ссылка');
    expect(html).toContain('Участники');
  });

  it('владельцу показывает форму инвайта и пустой список', () => {
    const html = renderParticipantsTab(true);

    expect(html).toContain('data-share-participants=""');
    expect(html).toContain('data-collaborator-user-id=""');
    expect(html).toContain('data-collaborator-role=""');
    expect(html).toContain('data-collaborator-invite=""');
    expect(html).toContain('Пригласить');
    expect(html).toContain('data-share-participants-empty=""');
  });

  it('не-владельцу не показывает форму и удаление', () => {
    const html = renderParticipantsTab(false);

    expect(html).toContain('data-share-participants-owner-only=""');
    expect(html).not.toContain('data-collaborator-invite=""');
    expect(html).not.toContain('data-collaborator-user-id=""');
    expect(html).not.toContain('data-collaborator-remove=""');
    expect(html).toContain('только владелец');
  });
});
