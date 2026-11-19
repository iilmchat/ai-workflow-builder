/**
 * Одноразовая сверка зеркала GitHub Issues с KNOWN_ISSUES.md ( RULES 2.4 ).
 *
 * Источник истины — реестр. Все Issues с меткой `ki`, у которых итоговый
 * статус не Open/Planned, закрываются с причиной completed / not planned.
 * Duplicates не удаляются — история сохраняется в закрытом виде. Канонической
 * копии (самый свежий номер) добавляется комментарий с итоговым статусом.
 *
 * Запуск:
 *   node scripts/reconcile-github-issues.mjs            # dry-run
 *   node scripts/reconcile-github-issues.mjs --apply    # apply
 *   node scripts/reconcile-github-issues.mjs --apply --limit 5
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const REPO = 'iilmchat/ai-workflow-builder';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitArg = args.indexOf('--limit');
const limit = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;

/**
 * Выполняет `gh api` и возвращает распарсенный JSON.
 *
 * @param {string[]} ghArgs - аргументы gh
 * @returns {unknown} JSON-ответ
 */
function gh(ghArgs) {
  return JSON.parse(
    execFileSync('gh', ['api', ...ghArgs], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

/** Читает итоговые статусы из реестра. */
function readStatuses() {
  const lines = fs.readFileSync('docs/KNOWN_ISSUES.md', 'utf8').split(/\r?\n/);
  const map = new Map();
  let id = null;

  for (const line of lines) {
    const heading = line.match(/^### (KI-\d+)/);
    if (heading) {
      id = heading[1];
      continue;
    }
    if (!id) continue;
    const status = line.match(/\*\*Статус:\*\*\s*([^|\n]+?)\s*\|/);
    if (status) {
      map.set(id, status[1].trim());
    }
  }

  return map;
}

const statuses = readStatuses();

console.log('[INFO] Читаю открытые KI-issues...');
const issues = gh([
  '--paginate',
  `repos/${REPO}/issues?state=open&labels=ki&per_page=100`,
]);

const parsed = issues
  .map((issue) => ({
    number: issue.number,
    title: issue.title,
    id: issue.title?.match(/^(KI-\d+)/)?.[1] ?? null,
    labels: (issue.labels ?? []).map((label) => label.name),
  }))
  .filter((issue) => issue.id !== null);

const canonical = new Map();
for (const issue of parsed) {
  const current = canonical.get(issue.id);
  if (current === undefined || issue.number > current) {
    canonical.set(issue.id, issue.number);
  }
}

const planned = parsed.filter((issue) => statuses.get(issue.id) === 'Planned');
const closable = parsed.filter(
  (issue) => statuses.get(issue.id) !== undefined && statuses.get(issue.id) !== 'Planned',
);
const unknown = parsed.filter((issue) => !statuses.has(issue.id));

// Planned — единственныеKI, которые остаются открытыми, но по одному на KI:
// дубликаты закрываются, история сохраняется.
const plannedDuplicates = planned.filter(
  (issue) => canonical.get(issue.id) !== issue.number,
);

console.log(
  `[INFO] KI-issues: ${parsed.length}; к закрытию: ${
    closable.length + plannedDuplicates.length
  }; ` +
    `Planned canonical (остаются открытыми): ${
      planned.length - plannedDuplicates.length
    }; без статуса в реестре: ${unknown.length}`,
);
console.log(`[INFO] Канонических копий для комментария: ${canonical.size}`);

if (!apply) {
  console.log('[DRYRUN] Пример к закрытию:', closable.slice(0, 5));
  console.log('[DRYRUN] Planned:', planned.map((i) => `${i.id}#${i.number}`));
  process.exit(0);
}

const allTargets = [...closable, ...plannedDuplicates];
const targets = allTargets.slice(
  0,
  Number.isFinite(limit) ? limit : allTargets.length,
);
let closed = 0;
let commented = 0;

for (const issue of targets) {
  const status = statuses.get(issue.id);
  const reason = /Deferred|Won't Fix|Documented|Planned/i.test(status)
    ? 'not_planned'
    : 'completed';

  try {
    gh([
      `-X`,
      `PATCH`,
      `repos/${REPO}/issues/${issue.number}`,
      '-f',
      'state=closed',
      '-f',
      `state_reason=${reason}`,
    ]);
    closed += 1;

    if (canonical.get(issue.id) === issue.number) {
      gh([
        `-X`,
        `POST`,
        `repos/${REPO}/issues/${issue.number}/comments`,
        '-f',
        `body=Закрыто автоматической сверкой с реестром: **${status}**. Источник истины — docs/KNOWN_ISSUES.md (RULES 2.4).`,
      ]);
      commented += 1;
    }

    if (closed % 100 === 0) {
      console.log(`[INFO] Закрыто ${closed}/${targets.length}, комментариев ${commented}`);
    }
  } catch (error) {
    console.error(`[WARN] Не удалось закрыть #${issue.number} (${issue.id}): ${error.message}`);
  }
}

console.log(`[DONE] Закрыто ${closed}, комментариев ${commented}`);
