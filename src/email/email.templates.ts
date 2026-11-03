/**
 * Шаблоны письма-приглашения в организацию (v1.1.0 S1, DESIGN V110 § 3.1).
 *
 * Отдельный модуль от `EmailService`, потому что это чистые функции без I/O:
 * их легко тестировать на экранирование и санитизацию, а сервис отвечает
 * только за транспорт. Письмо всегда одноязычное (русский): локализация
 * шаблонов по locale в v1.1.0 не входит (DESIGN V110 § 6).
 */

/**
 * Санитизирует значение для заголовка письма (subject/from).
 *
 * Символы CR/LF и прочие управляющие коды в заголовке — это header injection:
 * значение может «разрезать» письмо и добавить чужие заголовки (например,
 * `Bcc`). Имя организации приходит из БД (`Personal Workspace - {email}`) и
 * теоретически может содержать перевод строки, поэтому заголовок собирается
 * только из очищенного значения.
 *
 * @param value - исходное значение (имя организации)
 * @returns значение без управляющих символов, с схлопнутыми пробелами
 */
export function sanitizeHeaderValue(value: string): string {
  // Управляющие символы (CR/LF в первую очередь) заменяются пробелом по кодам,
  // а не регуляркой `[\u0000-\u001f]`: литеральный control-regex запрещён
  // линтером. Пробел, а не удаление, — чтобы слова не слипались
  // («Acme\r\nBcc» → «Acme Bcc», а не «AcmeBcc»).
  const withoutControlChars = Array.from(value)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;

      return code < 0x20 || code === 0x7f ? ' ' : char;
    })
    .join('');

  return withoutControlChars.replace(/\s+/g, ' ').trim();
}

/**
 * Экранирует HTML-спецсимволы в тексте, подставляемом в разметку письма.
 *
 * Имя организации задаёт пользователь при регистрации (`Personal Workspace -
 * email`), поэтому в HTML оно не может попасть «как есть»: `<script>` или
 * сломанный `<` испортили бы письмо (и выглядели бы как XSS в почтовом
 * клиенте, который показывает HTML).
 *
 * @param value - произвольная строка (имя организации, ссылка)
 * @returns строка, безопасная для подстановки в HTML
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Собирает тему письма-приглашения.
 *
 * Формулировка зафиксирована постановкой v1.1.0 S1: «Приглашение в организацию
 * {orgName}». Имя организации проходит {@link sanitizeHeaderValue}.
 *
 * @param orgName - название организации, в которую приглашают
 * @returns тема письма без управляющих символов
 */
export function buildInvitationSubject(orgName: string): string {
  return `Приглашение в организацию ${sanitizeHeaderValue(orgName)}`;
}

/**
 * Собирает plain-text версию письма.
 *
 * Нужна как fallback для почтовых клиентов без HTML и как «честный» текст для
 * антиспам-фильтров: письмо с одной HTML-частью чаще помечается спамом.
 *
 * @param orgName - название организации
 * @param inviteLink - абсолютная ссылка на регистрацию с параметром `?invite=`
 * @returns текст письма
 */
export function buildInvitationText(orgName: string, inviteLink: string): string {
  return [
    'Здравствуйте!',
    '',
    `Вас пригласили в организацию «${sanitizeHeaderValue(orgName)}» в IIChatTools AI Workflow Builder.`,
    '',
    'Чтобы присоединиться, зарегистрируйтесь по ссылке:',
    inviteLink,
    '',
    'Если вы не ожидали это приглашение, просто проигнорируйте письмо.',
    '',
    '© 2026 RuChating (iilmchat) · IIChatTools AI Workflow Builder',
  ].join('\n');
}

/**
 * Собирает HTML-версию письма-приглашения.
 *
 * Вёрстка — простая таблица с inline-стилями (внешний CSS почтовые клиенты
 * вырезают), кнопка «Присоединиться» ведёт на `inviteLink`. Тексты и ссылка
 * экранируются через {@link escapeHtml}.
 *
 * @param orgName - название организации
 * @param inviteLink - абсолютная ссылка на регистрацию с параметром `?invite=`
 * @returns HTML письма
 */
export function buildInvitationHtml(orgName: string, inviteLink: string): string {
  const safeOrgName = escapeHtml(sanitizeHeaderValue(orgName));
  const safeLink = escapeHtml(inviteLink);

  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Приглашение в организацию</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
            <tr>
              <td>
                <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;">Приглашение в организацию</h1>
                <p style="margin:0 0 16px;font-size:14px;line-height:22px;">
                  Вас пригласили в организацию <strong>«${safeOrgName}»</strong> в
                  IIChatTools AI Workflow Builder.
                </p>
                <p style="margin:0 0 24px;font-size:14px;line-height:22px;">
                  Чтобы присоединиться, зарегистрируйтесь по кнопке ниже — приглашение
                  привяжет вашу учётную запись к этой организации с назначенной ролью.
                </p>
                <p style="margin:0 0 24px;">
                  <a href="${safeLink}"
                     style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:bold;">
                    Присоединиться
                  </a>
                </p>
                <p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#64748b;">
                  Если кнопка не работает, скопируйте ссылку в браузер:<br />
                  <a href="${safeLink}" style="color:#2563eb;">${safeLink}</a>
                </p>
                <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#64748b;">
                  Если вы не ожидали это приглашение, просто проигнорируйте письмо.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;font-family:Arial,Helvetica,sans-serif;">
            © 2026 RuChating (iilmchat) · IIChatTools AI Workflow Builder
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
