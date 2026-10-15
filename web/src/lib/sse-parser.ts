/**
 * Разбор SSE-потока на события (KI-268).
 *
 * Поток читается `fetch` + `ReadableStream` (см. `@/lib/run-stream`), поэтому
 * разбор кадров нужен свой: у `EventSource` он был встроен. Функция чистая —
 * ей передаётся весь накопленный буфер, она возвращает готовые payload'ы и
 * «хвост», который ещё не завершился пустой строкой.
 *
 * Формат кадра (WHATWG SSE):
 * - строки разделяются `\n`, `\r\n` или `\r` (нормализуем к `\n`);
 * - кадр завершается пустой строкой;
 * - строка, начинающаяся с `:`, — комментарий (у backend это `: keep-alive`,
 *   `runs-stream.service.ts`);
 * - `data: <значение>` — payload; несколько `data:` подряд склеиваются через
 *   `\n` (в нашем потоке так не бывает, но формат это разрешает);
 * - `event:`, `id:`, `retry:` — игнорируются: тип сообщения лежит внутри JSON
 *   (`RunStreamMessageSchema` — discriminated union по `type`), а
 *   `Last-Event-ID` не используется.
 */

/** Результат разбора буфера: готовые payload'ы и незавершённый остаток. */
export interface ParsedSseChunk {
  /** Payload'ы завершённых кадров (по одному на кадр, в порядке поступления). */
  events: string[];
  /** Незавершённый остаток — его нужно приклеить к следующему чанку. */
  rest: string;
}

/**
 * Разбирает накопленный буфер SSE на завершённые события.
 *
 * @param buffer - накопленный текст потока (может обрываться на середине кадра)
 * @returns payload'ы завершённых кадров и неразобранный остаток
 */
export function parseSseEvents(buffer: string): ParsedSseChunk {
  // Единый разделитель строк: протокол допускает CRLF и одиночный CR.
  const normalized = buffer.replace(/\r\n?/g, '\n');

  // Кадр завершается пустой строкой, то есть разделитель кадров — '\n\n'.
  const frames = normalized.split('\n\n');
  // Последний фрагмент всегда может быть неполным — возвращаем его вызывающему.
  const rest = frames.pop() ?? '';

  const events: string[] = [];

  for (const frame of frames) {
    const payload = payloadOf(frame);

    if (payload !== null) {
      events.push(payload);
    }
  }

  return { events, rest };
}

/**
 * Достаёт payload кадра: склеивает все его `data:`-строки.
 *
 * @param frame - текст одного кадра (без завершающей пустой строки)
 * @returns payload либо `null`, если `data:` в кадре не было (комментарий,
 *   `event:`/`id:` без данных, пустой кадр)
 */
function payloadOf(frame: string): string | null {
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    // Пустая строка внутри кадра данных не несёт; ': …' — комментарий.
    if (line.length === 0 || line.startsWith(':')) {
      continue;
    }

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // По спецификации после ':' снимается ровно один пробел.
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');

    if (field === 'data') {
      dataLines.push(value);
    }
  }

  return dataLines.length > 0 ? dataLines.join('\n') : null;
}
