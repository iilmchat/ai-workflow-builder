import { listWorkflowsAsync, type ApiWorkflow } from './api';

/**
 * Кэш списка workflow владельца (R6.7, KI-302).
 *
 * Список нужен каждому узлу `sub_workflow`, а workflow у пользователя может
 * быть сколько угодно — без кэша каждый новый узел слал бы свой `GET /workflow`
 * (RULES 4.17). Раньше кэш жил прямо в `SubWorkflowNode.tsx` и **никогда** не
 * сбрасывался: созданный в этой же вкладке workflow появлялся в селекте только
 * после F5.
 *
 * Теперь у кэша три механизма свежести:
 * 1. **Явная инвалидация** (`invalidateWorkflowListCache`) — вызывается в
 *    точках, где список точно изменился: успешный Save (создание или правка
 *    графа/имени/версии — `stores/workflow.ts`), импорт файла и создание из
 *    шаблона (`lib/export-import-api.ts`), удаление workflow
 *    (`components/LoadModal.tsx`).
 * 2. **Подписка** (`subscribeWorkflowList`) — уже смонтированные узлы
 *    `sub_workflow` перезапрашивают список сразу после инвалидации, а не ждут
 *    размонтирования. Реализована на `useSyncExternalStore`, поэтому узел
 *    подписывается одной строкой и не тянет в проект отдельный event-emitter.
 * 3. **TTL** ({@link WORKFLOW_LIST_TTL_MS}) — страховка от изменений, которых
 *    UI не видит вообще (workflow создал другой клиент/сессия): даже без
 *    инвалидации список перечитывается не реже, чем раз в TTL.
 *
 * Кэш живёт на уровне модуля сознательно: `listWorkflowsAsync` — не store-экшен,
 * а держать чужое состояние в Zustand значило бы расширять стор ради одной
 * компоненты.
 */

/**
 * Время жизни кэша, мс.
 *
 * Достаточно мало, чтобы «чужие» изменения (другая вкладка/клиент) появлялись
 * в селекте без F5, и достаточно велико, чтобы десяток узлов `sub_workflow`,
 * добавленных подряд, уложился в один `GET /workflow`.
 */
export const WORKFLOW_LIST_TTL_MS = 5000;

/** Закэшированный список и время его получения (`Date.now()`). */
let cache: ApiWorkflow[] | null = null;
let cachedAt = 0;

/** Незавершённый запрос списка: параллельные узлы ждут его, а не шлют новый. */
let inflight: Promise<ApiWorkflow[]> | null = null;

/**
 * Номер последнего запущенного запроса.
 *
 * Нужен, чтобы «старый» запрос не обнулял `inflight` уже **нового** запроса:
 * инвалидация сбрасывает `inflight` (его ответ устарел), после чего подписчики
 * запускают свежий запрос, и оба живут одновременно.
 */
let inflightSeq = 0;

/**
 * Номер ревизии кэша.
 *
 * Растёт на каждой инвалидации. Нужен для двух вещей:
 * - подписчики (`useSyncExternalStore`) видят изменение снапшота;
 * - запрос, начатый до инвалидации, не имеет права заполнить кэш своим
 *   устаревшим ответом (сверка ревизии на старте и в `then`).
 */
let revision = 0;

/** Подписчики на изменение списка (узлы `sub_workflow`). */
const listeners = new Set<() => void>();

/**
 * Возвращает список workflow владельца, используя кэш.
 *
 * Порядок разрешения: свежий кэш (< {@link WORKFLOW_LIST_TTL_MS}) → летящий
 * запрос → новый `GET /workflow`. Ошибка не кэшируется: следующий вызов сходит
 * в сеть снова, поэтому «мигание» backend'а не залипает в UI.
 *
 * @returns список workflow владельца (без учёта `currentWorkflowId`)
 * @throws ApiError если запрос к backend упал (компонент покажет подсказку)
 */
export async function loadWorkflowListAsync(): Promise<ApiWorkflow[]> {
  if (cache !== null && Date.now() - cachedAt < WORKFLOW_LIST_TTL_MS) {
    return cache;
  }

  if (inflight !== null) {
    return inflight;
  }

  const startedRevision = revision;
  const seq = ++inflightSeq;

  inflight = listWorkflowsAsync()
    .then((list) => {
      // Инвалидация во время запроса: ответ старше создания workflow, в кэш не
      // идёт. Подписчики уже получили новую ревизию и сделают свой запрос.
      if (revision === startedRevision) {
        cache = list;
        cachedAt = Date.now();
      }

      return list;
    })
    .finally(() => {
      // Обнуляем только свой запрос: у нового он уже другой.
      if (inflightSeq === seq) {
        inflight = null;
      }
    });

  return inflight;
}

/**
 * Возвращает закэшированный список без обращения к сети.
 *
 * Нужен для начального состояния компонента: если кэш уже прогрет (второй узел
 * `sub_workflow` на холсте), селект заполняется сразу, без кадра с
 * «Нет доступных workflow». Данные могут быть несвежими — их обновит эффект
 * загрузки.
 *
 * @returns список workflow или `null`, если кэш пуст
 */
export function getCachedWorkflowList(): ApiWorkflow[] | null {
  return cache;
}

/**
 * Сбрасывает кэш и уведомляет подписчиков.
 *
 * Вызывать после любого действия, которое меняет список workflow: Save
 * (создание/переименование/изменение версии), импорт, создание из шаблона,
 * удаление.
 *
 * Летящий запрос тоже отбрасывается: его ответ начат **до** изменения списка и
 * потому устарел. Иначе подписчик, перезапустивший загрузку по ревизии, получил
 * бы старый список и больше не перезапросил бы его.
 */
export function invalidateWorkflowListCache(): void {
  cache = null;
  cachedAt = 0;
  revision += 1;
  inflight = null;

  // Обход без копии: `Set` переживает удаление текущего элемента во время
  // итерации, а копия массива здесь не нужна (unicorn/no-useless-spread).
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Подписывает слушателя на изменение списка workflow.
 *
 * Совместимо с `useSyncExternalStore`: возвращается функция отписки, а снапшот
 * (см. {@link getWorkflowListRevision}) — примитив, поэтому сравнение по ссылке
 * не даёт лишних перерисовок.
 *
 * @param listener - колбэк, который вызывается после каждой инвалидации
 * @returns функция отписки
 */
export function subscribeWorkflowList(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Текущая ревизия кэша — снапшот для `useSyncExternalStore`.
 *
 * @returns номер ревизии (растёт на каждой инвалидации)
 */
export function getWorkflowListRevision(): number {
  return revision;
}
