import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import i18n, { setLanguage, type Language } from '@/i18n';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { scanQr } from '@/hooks/useQrScanner';
import { useTheme } from '@/hooks/use-theme';
import { fetchLlmHealthAsync, cancelRunAsync } from '@/lib/api';
import { APP_VERSION } from '@/lib/app-version';
import { logoutAsync } from '@/lib/auth-api';
import { assetUrl } from '@/lib/asset-url';
import { exportFileNameOf, triggerDownload } from '@/lib/download-blob';
import {
  exportWorkflowAsync,
  importWorkflowAsync,
  parseExportedWorkflowFile,
} from '@/lib/export-import-api';
import { nodeLabelOf } from '@/lib/node-registry';
import { isAudioUrlInvalid, readToolAudioUrl } from '@/lib/image-tool-node';
import { isNative } from '@/lib/platform';
import { parseQrPayload } from '@/lib/qr-payload';
import { useAuthStore } from '@/stores/auth';
import { useWorkflowStore } from '@/stores/workflow';
import type { RunStatus } from '@/types/run-stream';
import type { ImageToolFlowNode } from '@/types/graph';
import { LoadModal } from './LoadModal';
import { RunHistoryModal } from './RunHistoryModal';
import { ShareModal } from './ShareModal';
import { TeamPage } from './TeamPage';
import { computeGraphHash } from '@/lib/graph-hash';
import {
  clearWorkflowUrlParam,
  syncWorkflowUrlParam,
} from '@/lib/url-sync';

/** Простой индикатор занятости для кнопок. */
function Spinner() {
  return (
    <span
      className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  );
}

/**
 * Подпись второстепенной кнопки шапки (KI-628).
 *
 * До 1760 px подпись скрыта, остаётся только иконка — иначе суммарная ширина
 * действий (Save/Run/Share/профиль плюс файловые операции) превышала бы
 * контейнер, и сжималась бы колонка имени workflow. Порог выше 1440 px, потому
 * что копирайт и индикатор GPU уже занимают место на 1440 px: с подписями
 * группа действий не влезает, а без них — помещается. `data-*`-атрибуты и
 * доступные имена (`aria-label`/`title`) остаются у самих кнопок, поэтому
 * иконка без текста не теряет смысла для скринридера и CDP-смоука.
 *
 * @param props - текст подписи
 * @returns `span`, видимый только на широких экранах
 */
function ActionLabel({ children }: { children: ReactNode }) {
  return <span className="hidden min-[1760px]:inline">{children}</span>;
}

/** Статусы, при которых запуск уже идёт и повторный запуск запрещён. */
const ACTIVE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set(['pending', 'running']);

/**
 * Период опроса доступности GPU (v1.2.0 S3, DESIGN V120 § 3.4).
 *
 * Те же 30 секунд, что у healthcheck'а backend (`LLM_HEALTH_INTERVAL_MS`):
 * более частый опрос не дал бы новых данных, более редкий — показывал бы
 * устаревший статус после восстановления LM Studio.
 */
const GPU_HEALTH_POLL_MS = 30_000;

/** Подпись и цвет бейджа статуса запуска. */
const RUN_STATUS_STYLE: Record<RunStatus, { labelKey: string; className: string }> = {
  pending: { labelKey: 'status.pending', className: 'bg-muted text-muted-foreground' },
  running: { labelKey: 'status.running', className: 'bg-blue-100 text-blue-700' },
  completed: { labelKey: 'status.completed', className: 'bg-green-100 text-green-700' },
  failed: { labelKey: 'status.failed', className: 'bg-red-100 text-red-700' },
  cancelled: { labelKey: 'status.cancelled', className: 'bg-muted text-muted-foreground' },
};

/**
 * Собирает подпись статуса запуска.
 *
 * @param status - статус запуска (null — запуск не выполнялся)
 * @param attemptNumber - номер текущей попытки job'а (1-based)
 * @param attempts - лимит попыток job'а (null — неизвестен)
 * @returns текст для кнопки Run
 */
function runStatusText(
  status: RunStatus | null,
  attemptNumber: number,
  attempts: number | null,
): string {
  if (status === null) {
    return i18n.t('topbar.run');
  }

  const base = i18n.t(RUN_STATUS_STYLE[status].labelKey);

  // Промежуточный провал (KI-070) статус не меняет: он остаётся 'running',
  // поэтому подпись продолжает показывать номер попытки.
  if (status === 'running' && attempts !== null && attemptNumber > 0) {
    return i18n.t('status.attempt', {
      base,
      current: attemptNumber,
      total: attempts,
    });
  }

  return base;
}

/**
 * Достаёт текст ошибки из неизвестного значения.
 *
 * `catch` в strict-режиме даёт `unknown` (RULES 4.15), а в UI нужна строка:
 * сообщение `Error` либо общая подпись «Неизвестная ошибка».
 *
 * @param caught - значение из `catch`
 * @returns текст для уведомления
 */
function reasonOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : i18n.t('error.unknown');
}

/**
 * Форматирует сумму в USD для тултипа прогресс-бара (R7.1).
 *
 * Четыре знака после запятой: стоимость одного LLM-вызова — доли цента, при
 * двух знаках она выглядела бы нулём.
 *
 * @param value - сумма в USD
 * @returns строка вида `$0.0123`
 */
function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/**
 * Верхняя панель редактора: имя workflow и действия Save / Load / Run.
 *
 * Run запускает реальный прогон (`POST /runs` + SSE, R4.2) и показывает статус:
 * «Создаётся…», «Выполняется… (попытка N/M)», «Готово», «Ошибка».
 * Панель — обычный flex-элемент колонки приложения (не fixed), её высота 56px.
 */
export function TopBar() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // v0.14 S2: история запусков — локальное UI-состояние TopBar, как у
  // LoadModal/ShareModal. В стор не вынесено: открытие модалки не влияет на
  // граф и не нужно другим компонентам (панель результата открывает стор по
  // `restoreRunAsync`).
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  // v1.0.0 S5 (DESIGN V100 § 3.2): «Команда и аудит» — локальное состояние
  // TopBar, как у истории запусков и шаринга: открытие модалки не влияет на
  // граф и не нужно другим компонентам.
  const [isTeamOpen, setIsTeamOpen] = useState(false);
  // R6.6.2: идёт файловая операция (экспорт/импорт) — кнопки блокируются,
  // чтобы повторный клик не запустил вторую выгрузку или второй импорт.
  const [isFileBusy, setIsFileBusy] = useState(false);
  // R6.6.2: скрытый `<input type="file">`. Клик по кнопке «Импорт» открывает
  // системный выбор файла, сам input в интерфейсе не виден.
  const importInputRef = useRef<HTMLInputElement>(null);
  // v1.4.0 S1 (DESIGN V140 § 3.1): отмена запуска. Локальное состояние, как у
  // остальных действий шапки: после ответа API запуск ещё некоторое время
  // остаётся `running` (движок замечает флаг перед следующим уровнем/узлом),
  // поэтому кнопка показывает «Отмена...» до прихода `run_completed`.
  const [isCancelling, setIsCancelling] = useState(false);
  // v1.5.0 S1: открыт нативный QR-сканер — кнопка блокируется, чтобы повторный
  // клик не открыл второй экран сканера поверх первого.
  const [isScanning, setIsScanning] = useState(false);
  // v1.2.0 S3 (DESIGN V120 § 3.4): доступен ли локальный LLM-бэкенд (GPU).
  // Исходное значение — `false`: до первого ответа healthcheck'а о GPU ничего
  // не известно, и индикатор не должен обещать online.
  const [isGpuOnline, setIsGpuOnline] = useState(false);
  const { resolved, setTheme } = useTheme();
  const { t, i18n: i18nInstance } = useTranslation();
  const currentLang = i18nInstance.language as Language;
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  // R6.2.2: поделиться можно только сохранённым workflow.
  const currentWorkflowId = useWorkflowStore((state) => state.currentWorkflowId);
  // R7.6: управление участниками видит только владелец. Backend всё равно
  // отклонит инвайт от участника (404), но UI не должен предлагать действие,
  // которое гарантированно не сработает.
  const currentWorkflowOwnerId = useWorkflowStore(
    (state) => state.currentWorkflowOwnerId,
  );
  const isWorkflowOwner =
    user !== null && currentWorkflowOwnerId !== null && user.id === currentWorkflowOwnerId;
  // KI-397: viewer видит граф, но действия записи ему недоступны — backend
  // отвечает 404 на PATCH/POST run. Пока роль приходит из API не всегда,
  // `null` трактуем как «неизвестна» и ничего не скрываем.
  const accessRole = useWorkflowStore((state) => state.accessRole);
  const isViewer = accessRole === 'viewer';
  // KI-195: «грязный» граф — если хэш текущего состояния не совпадает с хэшем
  // последнего сохранения/загрузки.
  const isDirty = useWorkflowStore(
    (state) =>
      currentWorkflowId !== null &&
      state.lastSavedHash !== computeGraphHash(state.nodes, state.edges),
  );

  // v1.2.0 S3 (DESIGN V120 § 3.4): статус GPU опрашивается при монтировании и
  // далее раз в GPU_HEALTH_POLL_MS. `cancelled` гасит setState, если запрос
  // завершится уже после размонтирования (закрыли редактор/сменили страницу),
  // а `clearInterval` снимает таймер: без него опрос жил бы до конца вкладки.
  useEffect(() => {
    let cancelled = false;

    /**
     * Запрашивает состояние GPU и обновляет индикатор.
     *
     * Ошибка запроса — это offline, а не повод для уведомления: healthcheck
     * фоновый и не должен мешать работе с графом.
     *
     * @returns промис без значения
     */
    const checkGpuHealthAsync = async () => {
      try {
        const health = await fetchLlmHealthAsync();

        if (!cancelled) {
          setIsGpuOnline(health.local.available);
        }
      } catch {
        if (!cancelled) {
          setIsGpuOnline(false);
        }
      }
    };

    void checkGpuHealthAsync();

    const timer = setInterval(() => {
      void checkGpuHealthAsync();
    }, GPU_HEALTH_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  /**
   * Выходит из аккаунта: отзывает refresh-токен и чистит сессию.
   *
   * Сбой запроса не должен запирать пользователя в интерфейсе, поэтому
   * локальную сессию сбрасываем в любом случае (R6.1b.2).
   */
  const handleLogout = async () => {
    try {
      await logoutAsync();
    } catch {
      // backend недоступен — выходим локально
    }

    useAuthStore.getState().clearSession();
    void navigate('/login', { replace: true });
  };

  const name = useWorkflowStore((state) => state.currentWorkflowName);
  const setCurrentWorkflowName = useWorkflowStore(
    (state) => state.setCurrentWorkflowName,
  );
  const isSaving = useWorkflowStore((state) => state.isSaving);
  const isLoading = useWorkflowStore((state) => state.isLoading);
  const saveWorkflowAsync = useWorkflowStore((state) => state.saveWorkflowAsync);
  const loadWorkflowAsync = useWorkflowStore((state) => state.loadWorkflowAsync);
  // v1.5.0 S1: QR-сканер открывает workflow по id — пишем id в стор до
  // загрузки, чтобы шапка (ссылки, история, шаринг) сразу увидела новый граф.
  const setCurrentWorkflowId = useWorkflowStore(
    (state) => state.setCurrentWorkflowId,
  );
  const startRunAsync = useWorkflowStore((state) => state.startRunAsync);
  const setNotice = useWorkflowStore((state) => state.setNotice);
  const runStatus = useWorkflowStore((state) => state.runStatus);
  const runError = useWorkflowStore((state) => state.runError);
  const newWorkflow = useWorkflowStore((state) => state.newWorkflow);
  // R6.4b.2b: история правок графа — кнопки и их доступность.
  const undo = useWorkflowStore((state) => state.undo);
  const redo = useWorkflowStore((state) => state.redo);
  const canUndo = useWorkflowStore((state) => state.past.length > 0);
  const canRedo = useWorkflowStore((state) => state.future.length > 0);

  // KI-157: имя пишется в хранилище на каждый символ, без сохранения выделения
  // курсор прыгал бы в конец при правке середины названия.
  const handleNameChange = usePreserveCursor<HTMLInputElement>(
    useCallback(
      (value: string) => setCurrentWorkflowName(value),
      [setCurrentWorkflowName],
    ),
  );
  const attemptNumber = useWorkflowStore((state) => state.attemptNumber);
  const attempts = useWorkflowStore((state) => state.attempts);
  const runHasMoreAttempts = useWorkflowStore((state) => state.runHasMoreAttempts);
  // R7.1 (KI-048): бюджет текущего запуска (прогресс-бар ниже).
  const runBudget = useWorkflowStore((state) => state.runBudget);
  const runId = useWorkflowStore((state) => state.runId);

  // v1.4.0 S1: «Отмена...» живёт только пока запуск активен. Как только SSE
  // принёс финал (в т.ч. `cancelled`), кнопка исчезает, и состояние сброса
  // больше не нужно — иначе следующий запуск показал бы «Отмена...» сразу.
  useEffect(() => {
    if (runStatus !== 'running') {
      setIsCancelling(false);
    }
  }, [runStatus]);

  const isBusy = isSaving || isLoading;
  const isRunActive = runStatus !== null && ACTIVE_RUN_STATUSES.has(runStatus);
  const runLabel = runStatusText(runStatus, attemptNumber, attempts);

  // Прогресс-бар показывается только при активном запуске (DESIGN v0.9 § 3.1):
  // без запуска тратить нечего, а завершённый запуск виден по бейджу статуса.
  const showBudget = isRunActive && runBudget !== null && runId !== null;
  const budgetRatio =
    runBudget !== null && runBudget.max > 0
      ? Math.min(runBudget.accumulated / runBudget.max, 1)
      : 0;
  const budgetExceeded = runBudget !== null && !runBudget.ok;
  const budgetTooltip =
    runBudget === null
      ? ''
      : [
          `${t('budget.label')}: ${formatUsd(runBudget.accumulated)} / ${formatUsd(runBudget.max)}`,
          t('budget.remaining', {
            remaining: formatUsd(runBudget.remaining),
            max: formatUsd(runBudget.max),
          }),
          // Рублёвый лимит показываем отдельной строкой: media-узлы
          // тарифицируются в рублях, и он расходуется независимо (R7.1).
          `${runBudget.maxRub} ₽`,
          budgetExceeded
            ? runBudget.mode === 'hard'
              ? t('budget.exceeded')
              : t('budget.warning')
            : '',
        ]
          .filter((line) => line.length > 0)
          .join('\n');

  /**
   * Ищет LLM-узлы, модель которых недоступна (KI-074).
   *
   * Граф с такой моделью гарантированно упадёт в узле с «Модель не
   * поддерживается», поэтому запуск блокируется до выбора модели из списка.
   *
   * @returns подписи узлов с недоступной моделью (пусто — запускать можно)
   */
  const findNodesWithUnavailableModel = (): string[] => {
    const { nodes, llmModels } = useWorkflowStore.getState();

    return nodes
      .filter((node) => node.data.kind === 'llm')
      .filter((node) => !llmModels.some((model) => model.id === node.data.model))
      .map((node) => nodeLabelOf(node, node.id));
  };

  /**
   * Ищет image-узлы без выбранной media-модели (v0.6.0b.2.3).
   *
   * Backend выполнит узел только с известной моделью каталога, поэтому запуск
   * блокируется: иначе узел упадёт с «Модель не поддерживается».
   *
   * @returns подписи узлов без доступной модели (пусто — запускать можно)
   */
  const findImageNodesWithoutModel = (): string[] => {
    const { nodes, mediaModels } = useWorkflowStore.getState();

    return nodes
      .filter((node) => node.data.kind === 'image')
      .filter((node) => !mediaModels.some((model) => model.id === node.data.model))
      .map((node) => nodeLabelOf(node, node.id));
  };

  /**
   * Ищет `image_tool`-узлы с невалидным `audioUrl` (KI-424).
   *
   * У операции `lipsync` второй вход — аудио; ссылка не по схеме `http(s)`
   * гарантированно упадёт на backend, поэтому Run блокируется до запроса.
   * Пустое поле нейтрально: «аудио обязательно» — правило backend (KI-369),
   * UI ругается только на введённую, но некорректную ссылку.
   *
   * @returns подписи узлов с невалидным `audioUrl` (пусто — запускать можно)
   */
  const findNodesWithInvalidAudioUrl = (): string[] => {
    const { nodes } = useWorkflowStore.getState();

    return nodes
      .filter((node): node is ImageToolFlowNode => node.data.kind === 'image_tool')
      .filter((node) => node.data.operation === 'lipsync')
      .filter((node) => isAudioUrlInvalid(readToolAudioUrl(node.data.params)))
      .map((node) => nodeLabelOf(node, node.id));
  };

  /**
   * Сохраняет граф. После первого сохранения id попадает в URL, чтобы
   * страницу можно было перезагрузить и вернуться к тому же workflow.
   */
  const handleSave = async () => {
    const idBefore = useWorkflowStore.getState().currentWorkflowId;

    await saveWorkflowAsync();

    const idAfter = useWorkflowStore.getState().currentWorkflowId;

    if (!idBefore && idAfter) {
      syncWorkflowUrlParam(idAfter);
    }
  };

  /**
   * Скачивает текущий workflow в файл `<имя>.workflow.json` (R6.6.2).
   *
   * Backend отдаёт артефакт как JSON-ответ, а не как файл, поэтому имя и
   * тип содержимого задаёт UI: `triggerDownload` создаёт blob и синтетический
   * клик по ссылке `<a download>`. В артефакте нет `id`/`userId`/`shareToken`
   * (R6.6.1), поэтому файл можно передавать другому пользователю.
   */
  const handleExport = async () => {
    if (currentWorkflowId === null || isFileBusy) {
      return;
    }

    setIsFileBusy(true);

    try {
      const artifact = await exportWorkflowAsync(currentWorkflowId);
      const fileName = exportFileNameOf(artifact.name);

      triggerDownload(
        new Blob([JSON.stringify(artifact, null, 2)], {
          type: 'application/json',
        }),
        fileName,
      );

      setNotice({
        kind: 'success',
        text: t('toast.export.success', { name: fileName }),
      });
    } catch (caught) {
      setNotice({
        kind: 'error',
        text: t('toast.export.error', { reason: reasonOf(caught) }),
      });
    } finally {
      setIsFileBusy(false);
    }
  };

  /**
   * Импортирует workflow из выбранного файла и открывает его (R6.6.2).
   *
   * Граф из файла backend сохраняет как **новый** workflow текущего
   * пользователя, поэтому после успеха переходим на него. `navigate` здесь не
   * нужен: `App` уже грузит workflow по `?workflowId=`, и навигация вместе с
   * явной загрузкой дали бы два `GET /workflow/:id` и два уведомления. Вместо
   * неё — `syncWorkflowUrlParam` (та же механика, что в `handleSave`).
   *
   * @param file - файл, выбранный в скрытом `<input type="file">`
   */
  const handleImportFile = async (file: File) => {
    setIsFileBusy(true);

    try {
      // FileReader не нужен: `File` — это `Blob`, у него есть `text()`.
      const artifact = parseExportedWorkflowFile(
        await file.text(),
        t('toast.import.invalid_file'),
      );
      const created = await importWorkflowAsync(artifact);

      syncWorkflowUrlParam(created.id);
      await loadWorkflowAsync(created.id);

      // Уведомление об импорте ставим только по факту открытия: при сбое
      // загрузки стор уже показал свою ошибку, и «импортирован» было бы ложью.
      if (useWorkflowStore.getState().currentWorkflowId === created.id) {
        setNotice({
          kind: 'success',
          text: t('toast.import.success', { name: created.name }),
        });
      }
    } catch (caught) {
      setNotice({
        kind: 'error',
        text: t('toast.import.error', { reason: reasonOf(caught) }),
      });
    } finally {
      setIsFileBusy(false);
    }
  };

  /**
   * Обрабатывает выбор файла в скрытом input.
   *
   * @param event - событие `change` поля выбора файла
   */
  const handleImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    // Значение сбрасываем сразу: иначе повторный выбор того же файла не
    // вызовет `change` (браузер считает значение неизменным).
    event.target.value = '';

    if (file !== null) {
      void handleImportFile(file);
    }
  };

  /**
   * Запускает workflow.
   *
   * KI-147: перед Run граф **всегда** сохраняется (не только для нового
   * workflow) — `POST /runs` читает snapshot из БД, иначе запускается
   * устаревшая версия графа.
   */
  const handleRun = async () => {
    // KI-397: у viewer Run скрыт; guard оставлен для программных вызовов.
    if (isViewer) {
      return;
    }

    // KI-074: сначала проверяем модели — граф с недоступной моделью упадёт.
    const unavailableNodes = findNodesWithUnavailableModel();

    if (unavailableNodes.length > 0) {
      setNotice({
        kind: 'error',
        text: t('topbar.models_unavailable', {
          nodes: unavailableNodes.join(', '),
        }),
      });

      return;
    }

    // v0.6.0b.2.3: у image-узлов должна быть выбрана media-модель.
    const nodesWithoutMediaModel = findImageNodesWithoutModel();

    if (nodesWithoutMediaModel.length > 0) {
      setNotice({
        kind: 'error',
        text: t('topbar.image_models_missing', {
          nodes: nodesWithoutMediaModel.join(', '),
        }),
      });

      return;
    }

    // KI-424: lipsync с невалидным audioUrl упадёт на backend — не запускаем.
    const nodesWithInvalidAudioUrl = findNodesWithInvalidAudioUrl();

    if (nodesWithInvalidAudioUrl.length > 0) {
      setNotice({
        kind: 'error',
        text: t('topbar.audio_url_invalid', {
          nodes: nodesWithInvalidAudioUrl.join(', '),
        }),
      });

      return;
    }

    // KI-147: сохраняем ВСЕГДА перед Run, а не только для нового workflow.
    // POST /runs читает snapshot из БД — без Save пользователь запускает
    // устаревший граф (связи, добавленные после последнего Save, теряются).
    const idBefore = useWorkflowStore.getState().currentWorkflowId;
    const isFirstSave = !idBefore;

    await saveWorkflowAsync();

    const workflowId = useWorkflowStore.getState().currentWorkflowId;

    if (!workflowId) {
      // Сохранение не удалось: причина уже показана уведомлением из стора.
      return;
    }

    if (isFirstSave) {
      syncWorkflowUrlParam(workflowId);
    }

    await startRunAsync(workflowId);
  };

  /**
   * Отменяет текущий запуск (v1.4.0 S1, DESIGN V140 § 3.1).
   *
   * Запрос только **просит** отмену: для `running`-запуска backend ставит
   * флаг `cancelled_at`, движок останавливается перед следующим уровнем или
   * узлом, а финальный статус приходит SSE-событием `run_completed`
   * (`status: 'cancelled'`). Поэтому после успешного ответа состояние
   * `isCancelling` не сбрасывается — кнопка продолжает показывать
   * «Отмена...», пока поток не сообщит финал.
   *
   * Ошибка (409 — запуск уже завершился, 404 — чужой/удалён) снимает
   * «Отмена...» и показывается уведомлением: иначе кнопка врала бы о
   * процессе.
   */
  const handleCancelRun = async () => {
    if (runId === null || isCancelling) {
      return;
    }

    setIsCancelling(true);

    try {
      await cancelRunAsync(runId);
    } catch (caught) {
      setIsCancelling(false);
      setNotice({
        kind: 'error',
        text: t('topbar.cancel_run.error', { reason: reasonOf(caught) }),
      });
    }
  };

  /**
   * Открывает QR-сканер и обрабатывает распознанное значение (v1.5.0 S1).
   *
   * Поддерживаются два «своих» формата (разбор — `parseQrPayload`):
   * - uuid сохранённого workflow → открыть его (`setCurrentWorkflowId` +
   *   `loadWorkflowAsync`, как после `LoadModal`);
   * - share-ссылка `/workflow/share/<token>` → перейти на публичную страницу.
   *
   * Отмена сканирования (`scanQr()` вернул `null`) не показывает ошибку: это
   * нормальный сценарий, пользователь сам закрыл камеру. Тост об ошибке
   * показывается только для распознанного, но неподдерживаемого формата —
   * произвольные ссылки из QR не открываем (фишинг).
   *
   * @returns промис без значения (ошибки внутри гасятся в уведомление)
   */
  const handleScanQr = async () => {
    if (isScanning) {
      return;
    }

    setIsScanning(true);

    try {
      const value = await scanQr();

      if (value === null) {
        // Отмена, отсутствие Play Services или запрет камеры.
        return;
      }

      const payload = parseQrPayload(value);

      if (payload === null) {
        setNotice({ kind: 'error', text: t('topbar.scan_qr_error') });

        return;
      }

      if (payload.kind === 'share') {
        void navigate(payload.path);

        return;
      }

      // Сначала id в стор, затем загрузка: даже если сеть упадёт, шапка уже
      // знает, какой workflow пытается открыть (история/шаринг/экспорт).
      setCurrentWorkflowId(payload.id);
      syncWorkflowUrlParam(payload.id);

      await loadWorkflowAsync(payload.id);

      // Успех — только если граф действительно открылся: `loadWorkflowAsync`
      // при ошибке оставляет прежний id и показывает своё уведомление.
      if (useWorkflowStore.getState().currentWorkflowId === payload.id) {
        setNotice({ kind: 'success', text: t('topbar.scan_qr_ok') });
      }
    } finally {
      setIsScanning(false);
    }
  };

  /**
   * Начинает новый workflow (A3): чистит граф и историю запуска.
   *
   * Если в графе что-то есть, спрашиваем подтверждение — несохранённая работа
   * пропадёт. Пустой граф чистится молча, чтобы кнопка не мешала зря.
   */
  const handleNewWorkflow = () => {
    const { nodes, edges } = useWorkflowStore.getState();

    if ((nodes.length > 0 || edges.length > 0) && !window.confirm(t('topbar.new.confirm'))) {
      return;
    }

    newWorkflow();
    clearWorkflowUrlParam();
  };

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-2 sm:px-4">
        {/* v0.10 S2: фирменный логотип слева от названия проекта. Высота
            фиксирована (24 px), ширина — по пропорциям исходника; тема
            переключает светлый/тёмный SVG. */}
        <img
          src={resolved === 'dark' ? assetUrl('logo-dark.svg') : assetUrl('logo.svg')}
          alt="IIRuChating"
          data-app-logo=""
          className="h-6 w-auto shrink-0"
        />

        {/* v1.2.0 S3 (DESIGN V120 § 3.4): индикатор локального GPU. Точка
            зелёная при `available: true`, серая — offline (ошибка запроса,
            `available: false` или ответ ещё не пришёл). Текст дублирует цвет
            словами — состояние читается без цветового зрения, `data-gpu-status`
            — контракт для CDP-смоука. KI-628: подпись скрыта до 1440 px, точка
            остаётся (полное состояние — в `title`). */}
        <span
          data-gpu-status={isGpuOnline ? 'online' : 'offline'}
          title={t(isGpuOnline ? 'topbar.gpu.online' : 'topbar.gpu.offline')}
          className="flex shrink-0 items-center gap-1.5 text-[10px] leading-none text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={`inline-block size-2 rounded-full ${
              isGpuOnline ? 'bg-green-500' : 'bg-slate-400'
            }`}
          />
          <span className="hidden min-[1440px]:inline">
            {t(isGpuOnline ? 'topbar.gpu.online' : 'topbar.gpu.offline')}
          </span>
        </span>

        {/* KI-446: имя workflow и копирайт с версией — одна колонка.
            Строка версии стоит под именем, а не у правого края: там действия
            (Save/Run/Share/профиль), и на 1280 px она вытеснила бы кнопки.
            `data-app-version` — контракт для CDP-смоука (RULES 1.12).
            KI-628: поле имени не даёт колонке схлопнуться (`shrink-0`), а
            копирайт скрыт до 1440 px и обрезается `truncate` — иначе он
            переносился по одной букве. */}
        <div className="flex min-w-0 shrink-0 flex-col">
          <input
            value={name}
            onChange={handleNameChange}
            placeholder={t('topbar.name.placeholder')}
            aria-label={t('topbar.name.placeholder')}
            // nodrag: единое правило для всех input внутри редактора.
            className="nodrag w-32 rounded-lg border border-transparent px-2 py-1 text-sm font-medium text-foreground outline-none hover:border-border focus:border-primary focus:ring-1 focus:ring-primary sm:w-48 lg:w-56 xl:w-64"
          />

          <span
            data-app-version={APP_VERSION}
            // Полная форма копирайта (с названием продукта) — в тултипе:
            // в шапке она не влезает, а RULES 1.12 требует её целиком.
            title={t('topbar.copyright.full', { version: APP_VERSION })}
            className="hidden max-w-full truncate whitespace-nowrap px-2 text-[10px] leading-none text-muted-foreground min-[1440px]:block"
          >
            {t('topbar.copyright', { version: APP_VERSION })}
          </span>
        </div>

        {runStatus !== null && (
          <span
            data-run-badge={runStatus}
            // Тултип: причина ошибки либо подсказка, что будет ещё попытка (KI-070).
            title={
              runError ??
              (runHasMoreAttempts ? t('topbar.retry_hint') : undefined)
            }
            className={`max-w-40 truncate rounded-full px-2.5 py-1 text-[11px] font-medium ${RUN_STATUS_STYLE[runStatus].className}`}
          >
            {runLabel}
          </span>
        )}

        {/* KI-628: действия — отдельная прокручиваемая группа. `min-w-0`
            разрешает ей сжиматься, `[&>*]:shrink-0` не даёт кнопкам
            сплющиваться вместе с подписями, а `overflow-x-auto` со скрытым
            скроллбаром — аварийный запас для очень узких окон: страница и
            поле имени не переполняются, даже если все действия не влезли. */}
        <div className="ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
          {/* R7.1 (KI-048): бюджет запуска. Показывается только при активном
              запуске, цифры — те же, что проверяет предохранитель на backend
              (`GET /runs/:id/budget`). `data-run-budget` — точка для смоука. */}
          {showBudget && runBudget !== null && (
            <div
              data-run-budget={runBudget.accumulated.toFixed(4)}
              data-run-budget-max={runBudget.max.toFixed(4)}
              data-run-budget-mode={runBudget.mode}
              data-run-budget-ok={runBudget.ok ? 'true' : 'false'}
              title={budgetTooltip}
              aria-label={budgetTooltip}
              className="flex w-32 flex-col gap-1"
            >
              <span className="flex justify-between text-[10px] leading-none text-muted-foreground">
                <span>{formatUsd(runBudget.accumulated)}</span>
                <span>{formatUsd(runBudget.max)}</span>
              </span>
              <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full rounded-full ${
                    budgetExceeded ? 'bg-red-500' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.round(budgetRatio * 100)}%` }}
                />
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
            aria-label={t(
              resolved === 'dark' ? 'topbar.theme.to_light' : 'topbar.theme.to_dark',
            )}
            title={t(
              resolved === 'dark' ? 'topbar.theme.to_light' : 'topbar.theme.to_dark',
            )}
            className="cursor-pointer rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            {resolved === 'dark' ? '☀' : '🌙'}
          </button>

          <button
            type="button"
            onClick={() => setLanguage(currentLang === 'ru' ? 'en' : 'ru')}
            aria-label={t('topbar.lang.toggle')}
            title={t('topbar.lang.toggle')}
            className="cursor-pointer rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            {currentLang === 'ru' ? 'EN' : 'RU'}
          </button>

          {/* R6.4b.2b: откат/повтор правок графа (DESIGN v0.8 § 7.2). Стоят
              перед файловыми операциями: это действия над текущим графом.
              `disabled` считается из глубины стопок истории селектором —
              отдельного поля «есть что откатить» не нужно. */}
          <button
            type="button"
            data-topbar-undo=""
            onClick={undo}
            disabled={!canUndo}
            title={t('topbar.undo')}
            aria-label={t('topbar.undo')}
            className="cursor-pointer rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↶
          </button>

          <button
            type="button"
            data-topbar-redo=""
            onClick={redo}
            disabled={!canRedo}
            title={t('topbar.redo')}
            aria-label={t('topbar.redo')}
            className="cursor-pointer rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↷
          </button>

          {/* A3: «Новый» — рядом с Load, до него: это первое действие в ряду
              файловых операций (новый → загрузить → сохранить → запустить). */}
          <button
            type="button"
            onClick={handleNewWorkflow}
            aria-label={t('topbar.new')}
            title={t('topbar.new')}
            data-topbar-new=""
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <span aria-hidden="true">📄</span>
            <ActionLabel>{t('topbar.new')}</ActionLabel>
          </button>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            disabled={isBusy}
            data-topbar-load=""
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Spinner /> : <span aria-hidden="true">📂</span>}
            <ActionLabel>{t('topbar.load')}</ActionLabel>
          </button>

          {/* KI-397: viewer не может сохранять — кнопка не показывается
              (не просто disabled: действие гарантированно вернёт 404). */}
          {!isViewer && (
            <button
              type="button"
              data-topbar-save=""
              onClick={() => void handleSave()}
              disabled={isBusy}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <Spinner /> : <span aria-hidden="true">💾</span>}
              {t('topbar.save')}
            </button>
          )}

          {/* KI-195: индикатор несохранённых изменений. Значение вычисляется
              селектором (хэш графа против хэша последнего сохранения), а не
              хранится полем: так его нельзя «забыть» обновить. */}
          {currentWorkflowId !== null && (
            <span
              data-dirty-indicator={isDirty ? 'dirty' : 'saved'}
              title={isDirty ? t('topbar.dirty') : t('topbar.saved')}
              className="hidden rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground min-[1440px]:inline-block"
            >
              {isDirty ? t('topbar.dirty') : t('topbar.saved')}
            </span>
          )}

          {/* R6.6.2: Export / Import (DESIGN v0.8 § 9). Стоят после Save и
              индикатора «грязного» графа: это операции над файлом, а не над
              холстом. Клик по «Импорт» открывает системный диалог — сам input
              скрыт и служит только точкой для выбора файла. */}
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.workflow.json,application/json"
            data-topbar-import-input=""
            className="hidden"
            onChange={handleImportChange}
          />

          <button
            type="button"
            data-topbar-export=""
            onClick={() => void handleExport()}
            disabled={currentWorkflowId === null || isFileBusy}
            aria-label={t('topbar.export')}
            title={t('topbar.export')}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isFileBusy ? <Spinner /> : <span aria-hidden="true">📥</span>}
            <ActionLabel>{t('topbar.export')}</ActionLabel>
          </button>

          <button
            type="button"
            data-topbar-import=""
            onClick={() => importInputRef.current?.click()}
            disabled={isFileBusy}
            aria-label={t('topbar.import')}
            title={t('topbar.import')}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isFileBusy ? <Spinner /> : <span aria-hidden="true">📤</span>}
            <ActionLabel>{t('topbar.import')}</ActionLabel>
          </button>

          {/* v0.14 S2 (DESIGN V014 § 3.2): история запусков. Доступна только для
              сохранённого workflow (у нового графа нет истории). Для viewer
              скрыта: `GET /workflow/:id/runs` требует роль `editor` (S1), и
              кнопка не должна предлагать гарантированный 404 (KI-397/KI-537). */}
          {!isViewer && (
            <button
              type="button"
              data-topbar-history=""
              onClick={() => setIsHistoryOpen(true)}
              disabled={currentWorkflowId === null}
              aria-label={t('topbar.history')}
              title={t('topbar.history')}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">🕒</span>
              <ActionLabel>{t('topbar.history')}</ActionLabel>
            </button>
          )}

          {/* v1.0.0 S5 (DESIGN V100 § 3.2): «Команда и аудит» — участники
              организации, приглашения и журнал действий. Кнопка доступна
              только аутентифицированному пользователю (у гостя нет организации)
              и не зависит от сохранённости workflow: команда — свойство
              аккаунта, а не графа. */}
          {user !== null && (
            <button
              type="button"
              data-topbar-team=""
              onClick={() => setIsTeamOpen(true)}
              aria-label={t('topbar.team')}
              title={t('topbar.team')}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <span aria-hidden="true">👥</span>
              <ActionLabel>{t('topbar.team')}</ActionLabel>
            </button>
          )}

          {/* v1.5.0 S1 (DESIGN V150 § 3.2): QR-сканер — только в нативном
              приложении. В браузере нативного сканера нет, а кнопка,
              гарантированно ничего не делающая, — обман пользователя.
              `data-topbar-scan-qr` — контракт для смоука/тестов; подпись
              скрывается по общей адаптивной механике (`ActionLabel`), значок
              остаётся. */}
          {isNative() && (
            <button
              type="button"
              data-topbar-scan-qr=""
              onClick={() => void handleScanQr()}
              disabled={isScanning}
              aria-label={t('topbar.scan_qr')}
              title={t('topbar.scan_qr')}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isScanning ? <Spinner /> : <span aria-hidden="true">📷</span>}
              <ActionLabel>{t('topbar.scan_qr')}</ActionLabel>
            </button>
          )}

          {/* v1.4.0 S1 (DESIGN V140 § 3.1): отмена запуска. Кнопка видна
              только при `runStatus === 'running'`: отменять `pending` из UI
              нечего (запуск ещё не начался и так завершится сам), а
              терминальные статусы отменять нельзя (API вернёт 409).
              `data-topbar-cancel-run` — контракт для смоука/тестов. */}
          {runStatus === 'running' && !isViewer && runId !== null && (
            <button
              type="button"
              data-topbar-cancel-run=""
              onClick={() => void handleCancelRun()}
              disabled={isCancelling}
              aria-label={t(
                isCancelling ? 'topbar.cancel_run.cancelling' : 'topbar.cancel_run',
              )}
              title={t(
                isCancelling ? 'topbar.cancel_run.cancelling' : 'topbar.cancel_run',
              )}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCancelling ? <Spinner /> : <span aria-hidden="true">⏹</span>}
              {t(
                isCancelling ? 'topbar.cancel_run.cancelling' : 'topbar.cancel_run',
              )}
            </button>
          )}

          {/* KI-397: viewer не запускает workflow — кнопка скрыта. */}
          {!isViewer && (
            <button
              type="button"
              data-topbar-run=""
              onClick={() => void handleRun()}
              disabled={isBusy || isRunActive}
              // Атрибут для e2e/smoke: статус запуска виден без разбора текста.
              data-run-status={runStatus ?? 'idle'}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunActive ? <Spinner /> : <span aria-hidden="true">▶️</span>}
              {runLabel}
            </button>
          )}

          {/* R6.2.2: share-ссылка доступна только для сохранённого workflow. */}
          <button
            type="button"
            onClick={() => setIsShareOpen(true)}
            disabled={currentWorkflowId === null}
            aria-label={t('share.title')}
            title={t('share.title')}
            data-share-button=""
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">🔗</span>
            <ActionLabel>{t('share.title')}</ActionLabel>
          </button>

          {user !== null && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsUserMenuOpen((value) => !value)}
                aria-label={t('auth.user.email')}
                aria-expanded={isUserMenuOpen}
                data-user-menu=""
                className="flex max-w-40 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                <span aria-hidden="true">👤</span>
                <span className="truncate">{user.email}</span>
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-border bg-background p-2 shadow-node">
                  <p className="truncate px-2 py-1 text-xs text-muted-foreground" title={user.email}>
                    {user.email}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    data-user-logout=""
                    className="mt-1 w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                  >
                    {t('auth.user.logout')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {isModalOpen && <LoadModal onClose={() => setIsModalOpen(false)} />}

      {isHistoryOpen && currentWorkflowId !== null && (
        <RunHistoryModal
          workflowId={currentWorkflowId}
          onClose={() => setIsHistoryOpen(false)}
        />
      )}

      {isShareOpen && currentWorkflowId !== null && (
        <ShareModal
          workflowId={currentWorkflowId}
          isOwner={isWorkflowOwner}
          onClose={() => setIsShareOpen(false)}
        />
      )}

      {/* v1.0.0 S5: модалка команды монтируется только при наличии сессии —
          у гостя нет организации, и запрос `GET /admin/members` был бы 401. */}
      {isTeamOpen && user !== null && (
        <TeamPage onClose={() => setIsTeamOpen(false)} />
      )}
    </>
  );
}
