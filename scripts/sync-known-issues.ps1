<#
.SYNOPSIS
    Синхронизирует docs/KNOWN_ISSUES.md с GitHub Issues (подход B — витрина).

.DESCRIPTION
    Источник истины — docs/KNOWN_ISSUES.md. Скрипт создаёт/обновляет Issues
    как витрину для удобного просмотра. Двусторонней синхронизации нет:
    правки в Issues игнорируются и перезаписываются при следующем прогоне.

    Логика:
    1. Парсит секции "### KI-XXX — Title" из KNOWN_ISSUES.md.
    2. Извлекает Priority (эмодзи) и Status (regex).
    3. Создаёт/обновляет GitHub Issues:
       - Title: "KI-XXX: Название".
       - Body: полная секция MD.
       - Labels: ki + priority-* + status-*.
       - Состояние: closed для Fixed/Documented/Deferred/Won't Fix/Implemented,
         open для Planned/Open/In Progress/Partially Fixed.

.PARAMETER Repo
    Owner/repo. Default: iilmchat/ai-workflow-builder.

.PARAMETER Path
    Путь к KNOWN_ISSUES.md. Default: docs/KNOWN_ISSUES.md.

.PARAMETER DryRun
    Не вызывать gh. Только показать, что было бы сделано.

.PARAMETER SkipExisting
    Не обновлять существующие Issues (только создавать новые).

.PARAMETER Filter
    Wildcard-фильтр по KI-id (например, "KI-00*" или "KI-003,KI-005").

.EXAMPLE
    pwsh scripts/sync-known-issues.ps1 -DryRun
    pwsh scripts/sync-known-issues.ps1 -Filter "KI-00*"
    pwsh scripts/sync-known-issues.ps1

.NOTES
    v0.3.0. Требует `gh` CLI >= 2.40 + авторизацию с правами issues:write.
    Адаптировано из проекта IIChatTools (KI-214).
#>
[CmdletBinding()]
param(
    [string]$Repo = "iilmchat/ai-workflow-builder",
    [string]$Path = "docs/KNOWN_ISSUES.md",
    [switch]$DryRun,
    [switch]$SkipExisting,
    [string]$Filter
)

$ErrorActionPreference = "Stop"

# UTF-8 для консоли и вывода gh.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# ============================================================
# § 1. Читаем KNOWN_ISSUES.md
# ============================================================

if (-not (Test-Path $Path)) {
    Write-Error "Файл не найден: $Path"
    exit 1
}

Write-Host "[INFO] Читаю $Path..." -ForegroundColor Cyan
$raw = Get-Content -Raw -Path $Path -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-Error "Файл пуст."
    exit 1
}

# ============================================================
# § 2. Парсим секции KI-XXX
# ============================================================

# Разделяем на строки — нужны позиции, чтобы вырезать body.
$lines = $raw -split "`r?`n"

# Заголовки KI: "### KI-XXX — Title" (или с дефисом/en-dash).
$headingRegex = [regex]'^###\s+(KI-(\d+))\s*[—–-]\s*(.+?)\s*$'

# Карта KI-id → { Id, Number, Title, Priority, Status, BodyStart, BodyEnd }
$sections = @{}

for ($i = 0; $i -lt $lines.Length; $i++) {
    $m = $headingRegex.Match($lines[$i])
    if (-not $m.Success) { continue }

    $kiId     = $m.Groups[1].Value     # "KI-003"
    $kiNumber = [int]$m.Groups[2].Value
    $kiTitle  = $m.Groups[3].Value.Trim()

    if ($sections.ContainsKey($kiId)) {
        Write-Host "[WARN] Дубликат секции $kiId — первое вхождение побеждает." -ForegroundColor Yellow
        continue
    }

    # Найти конец секции: следующий "###" или "##" (или EOF).
    $end = $lines.Length
    for ($j = $i + 1; $j -lt $lines.Length; $j++) {
        if ($lines[$j] -match '^###\s+KI-\d+' -or $lines[$j] -match '^##\s+') {
            $end = $j
            break
        }
    }

    # Body: от строки heading до строки end-1.
    $bodyLines = $lines[$i..($end - 1)]
    $body = ($bodyLines -join "`n").TrimEnd()

    # Priority: первая эмодзи-метка.
    $priority = "unknown"
    foreach ($line in $bodyLines) {
        if ($line -match '🔴') { $priority = "critical"; break }
        if ($line -match '🟠') { $priority = "high";     break }
        if ($line -match '🟡') { $priority = "medium";   break }
        if ($line -match '🟢') { $priority = "low";      break }
    }

    # Status: "**Статус:** XXX |" или "**Статус:** XXX" (до конца строки).
    $status = "unknown"
    $statusLine = $bodyLines | Where-Object { $_ -match '\*\*Статус:\*\*' } | Select-Object -First 1
    if ($statusLine) {
        if ($statusLine -match '\*\*Статус:\*\*\s*[✅❌⚠️📝🔄\s]*\*{0,2}\s*([^|*\n]+)') {
            $rawStatus = $Matches[1].Trim().TrimEnd('*').Trim()
            $s = $rawStatus.ToLowerInvariant()

            if ($s -match "won'?t\s*fix" -or $s -match "wontfix") { $status = "wontfix" }
            elseif ($s -match "partially")                        { $status = "partially-fixed" }
            elseif ($s -match "in\s*progress")                    { $status = "in-progress" }
            elseif ($s -match "implemented")                      { $status = "implemented" }
            elseif ($s -match "documented")                       { $status = "documented" }
            elseif ($s -match "deferred")                         { $status = "deferred" }
            elseif ($s -match "planned")                          { $status = "planned" }
            elseif ($s -match "resolved")                         { $status = "resolved" }
            elseif ($s -match "fixed")                            { $status = "fixed" }
            elseif ($s -match "open")                             { $status = "open" }
        }
    }

    $sections[$kiId] = [pscustomobject]@{
        Id       = $kiId
        Number   = $kiNumber
        Title    = $kiTitle
        Priority = $priority
        Status   = $status
        Body     = $body
        Line     = $i + 1
    }
}

Write-Host "[INFO] Найдено $($sections.Count) секций KI." -ForegroundColor Cyan

# ============================================================
# § 3. Применяем -Filter
# ============================================================

$filterList = $sections.Values
if ($Filter) {
    $patterns = $Filter -split ',' | ForEach-Object { $_.Trim() }
    $filterList = $sections.Values | Where-Object {
        $id = $_.Id
        $patterns | Where-Object { $id -like $_ } | Select-Object -First 1
    }
    Write-Host "[INFO] После фильтра: $($filterList.Count) секций." -ForegroundColor Cyan
}

# Сортируем по номеру (для читаемого вывода).
$filterList = $filterList | Sort-Object Number

# ============================================================
# § 4. Собираем существующие Issues (одним запросом)
# ============================================================

if ($DryRun) {
    Write-Host "[DRYRUN] Пропускаю gh issue list / gh label create." -ForegroundColor Yellow
    $issueByKiId = @{}
    $existingLabels = @{}
} else {
    Write-Host "[INFO] Читаю существующие Issues ($Repo)..." -ForegroundColor Cyan
    $jsonIssues = gh issue list --repo $Repo --state all --limit 500 --json number,title,state,labels
    if ($LASTEXITCODE -ne 0) {
        Write-Error "gh issue list упал (exit $LASTEXITCODE). Проверьте авторизацию: gh auth status"
        exit 1
    }
    $allIssues = $jsonIssues | ConvertFrom-Json

    $issueByKiId = @{}
    foreach ($iss in $allIssues) {
        if ($iss.title -match '^(KI-\d+)[:\s]') {
            $issueByKiId[$Matches[1]] = $iss
        }
    }
    Write-Host "[INFO] Найдено $($allIssues.Count) Issues, из них KI-*: $($issueByKiId.Count)." -ForegroundColor Cyan

    # Читаем существующие labels.
    $jsonLabels = gh label list --repo $Repo --limit 200 --json name,color,description
    $existingLabels = @{}
    if ($LASTEXITCODE -eq 0) {
        foreach ($lbl in ($jsonLabels | ConvertFrom-Json)) {
            $existingLabels[$lbl.name] = $true
        }
    }
}

# ============================================================
# § 5. Определяем нужные labels
# ============================================================

# Формат: name → @{ Color; Description }
$neededLabels = @{
    "ki"                    = @{ Color = "ededed"; Description = "AI Workflow Builder KI-XXX из KNOWN_ISSUES.md" }
    "priority-critical"     = @{ Color = "b60205"; Description = "🔴 Critical" }
    "priority-high"         = @{ Color = "d93f0b"; Description = "🟠 High" }
    "priority-medium"       = @{ Color = "fbca04"; Description = "🟡 Medium" }
    "priority-low"          = @{ Color = "0e8a16"; Description = "🟢 Low" }
    "priority-unknown"      = @{ Color = "ededed"; Description = "Приоритет не указан" }
    "status-fixed"          = @{ Color = "0e8a16"; Description = "Fixed" }
    "status-resolved"       = @{ Color = "0e8a16"; Description = "Resolved" }
    "status-implemented"    = @{ Color = "006b75"; Description = "Implemented" }
    "status-documented"     = @{ Color = "c2e0c6"; Description = "Documented" }
    "status-deferred"       = @{ Color = "cccccc"; Description = "Deferred" }
    "status-wontfix"        = @{ Color = "6a737d"; Description = "Won't Fix" }
    "status-planned"        = @{ Color = "1d76db"; Description = "Planned" }
    "status-in-progress"    = @{ Color = "fbca04"; Description = "In Progress" }
    "status-partially-fixed"= @{ Color = "d93f0b"; Description = "Partially Fixed" }
    "status-open"           = @{ Color = "b60205"; Description = "Open" }
    "status-unknown"        = @{ Color = "ededed"; Description = "Статус не указан" }
}

if (-not $DryRun) {
    Write-Host "[INFO] Проверяю labels..." -ForegroundColor Cyan
    foreach ($name in $neededLabels.Keys) {
        if ($existingLabels.ContainsKey($name)) { continue }
        $meta = $neededLabels[$name]
        Write-Host "  + создаю label '$name'..." -ForegroundColor DarkGray
        gh label create $name --repo $Repo --color $meta.Color --description $meta.Description 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $existingLabels[$name] = $true
        } else {
            Write-Host "    [WARN] Не удалось создать label '$name' (возможно, уже существует)." -ForegroundColor Yellow
            $existingLabels[$name] = $true  # считаем что есть — не блокируем работу
        }
    }
}

# ============================================================
# § 6. Обрабатываем каждую секцию
# ============================================================

# Retry для gh CLI при transient 5xx (504/502/503).
# GitHub API иногда отдаёт Gateway Timeout на gh issue edit --body-file
# с большими body. Ретраим 3 раза с задержками 2s / 5s / 10s.
# Не ретраим на 4xx (постоянные ошибки: invalid body, no permission).
function Invoke-GhWithRetry {
    param(
        [Parameter(Mandatory=$true)] [scriptblock]$Action,
        [string]$Description = "gh",
        [int[]]$RetryDelaysSeconds = @(2, 5, 10)
    )

    $totalAttempts = $RetryDelaysSeconds.Count + 1
    $lastOutput = ""
    $lastExitCode = 0

    for ($attempt = 1; $attempt -le $totalAttempts; $attempt++) {
        $lastOutput = (& $Action 2>&1 | Out-String)
        $lastExitCode = $LASTEXITCODE

        if ($lastExitCode -eq 0) {
            return [pscustomobject]@{
                Success      = $true
                Output       = $lastOutput
                Attempts     = $attempt
                WasTransient = $false
            }
        }

        # Транзиентная ошибка? 504/502/503 + специфичное сообщение GitHub.
        $isTransient = ($lastOutput -match '504 Gateway Timeout') -or
                       ($lastOutput -match '502 Bad Gateway') -or
                       ($lastOutput -match '503 Service Unavailable') -or
                       ($lastOutput -match 'Something went wrong while executing your query') -or
                       ($lastOutput -match 'non-200 OK status code: 50[0-9]')

        if (-not $isTransient) {
            # Постоянная ошибка (4xx, invalid, permission) — не ретраим.
            return [pscustomobject]@{
                Success      = $false
                Output       = $lastOutput
                Attempts     = $attempt
                WasTransient = $false
            }
        }

        if ($attempt -lt $totalAttempts) {
            $delay = $RetryDelaysSeconds[$attempt - 1]
            Write-Host "   [RETRY] $Description — transient 5xx (попытка $attempt/$totalAttempts), ждём ${delay}s..." -ForegroundColor Yellow
            Start-Sleep -Seconds $delay
        }
    }

    # Все попытки исчерпаны, но это transient — пометить для ручного retry.
    return [pscustomobject]@{
        Success      = $false
        Output       = $lastOutput
        Attempts     = $totalAttempts
        WasTransient = $true
    }
}

function Get-ClosedStatus {
    param([string]$Status)
    # Closed: Fixed/Resolved/Implemented/Documented/Deferred/Won't Fix.
    # Open:   Planned/Open/In Progress/Partially Fixed/Unknown.
    switch ($Status) {
        "fixed"           { return $true }
        "resolved"        { return $true }
        "implemented"     { return $true }
        "documented"      { return $true }
        "deferred"        { return $true }
        "wontfix"         { return $true }
        default           { return $false }
    }
}

$created = 0
$updated = 0
$skipped = 0
$errors  = 0
# Счётчик transient 5xx после retry (не критично, но ручной retry не помешает).
$transientFailures = 0

foreach ($ki in $filterList) {
    $issueTitle = "$($ki.Id): $($ki.Title)"
    $desiredLabels = @(
        "ki",
        "priority-$($ki.Priority)",
        "status-$($ki.Status)"
    ) -join ","

    $closed = Get-ClosedStatus $ki.Status
    $existing = $issueByKiId[$ki.Id]

    Write-Host ""
    Write-Host "── $($ki.Id) — $($ki.Title)" -ForegroundColor White
    Write-Host "   priority=$($ki.Priority), status=$($ki.Status), closed=$closed"

    if ($DryRun) {
        if ($existing) {
            Write-Host "   [DRYRUN] обновить Issue #$($existing.number) (body + labels)." -ForegroundColor Yellow
        } else {
            Write-Host "   [DRYRUN] создать новый Issue." -ForegroundColor Yellow
        }
        continue
    }

    if (-not $existing) {
        # --- CREATE ---
        $tempBody = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($tempBody, $ki.Body, [System.Text.UTF8Encoding]::new($false))

        try {
            $createResult = Invoke-GhWithRetry `
                -Description "gh issue create $($ki.Id)" `
                -Action { gh issue create --repo $Repo --title $issueTitle --body-file $tempBody --label $desiredLabels }

            $out = $createResult.Output

            if (-not $createResult.Success) {
                if ($createResult.WasTransient) {
                    Write-Host "   [RETRY-FAIL] gh issue create $($ki.Id) — 5xx после $($createResult.Attempts) попыток." -ForegroundColor Yellow
                    $transientFailures++
                } else {
                    Write-Host "   [ERROR] gh issue create упал: $out" -ForegroundColor Red
                    $errors++
                }
            } else {
                $created++
                Write-Host "   [+] создан: $out" -ForegroundColor Green
                # Если статус — закрытый: надо закрыть свежесозданный Issue.
                if ($closed) {
                    if ($out -match '/issues/(\d+)') {
                        $num = $Matches[1]
                        gh issue close $num --repo $Repo 2>&1 | Out-Null
                    }
                }
            }
        } finally {
            Remove-Item $tempBody -ErrorAction SilentlyContinue
        }
    }
    elseif ($SkipExisting) {
        Write-Host "   [SKIP] $($ki.Id) уже существует (#$($existing.number)) — SkipExisting." -ForegroundColor DarkGray
        $skipped++
    }
    else {
        # --- UPDATE ---
        $tempBody = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($tempBody, $ki.Body, [System.Text.UTF8Encoding]::new($false))

        try {
            $editBodyResult = Invoke-GhWithRetry `
                -Description "gh issue edit #$($existing.number) (body)" `
                -Action { gh issue edit $existing.number --repo $Repo --body-file $tempBody }

            if (-not $editBodyResult.Success) {
                if ($editBodyResult.WasTransient) {
                    Write-Host "   [RETRY-FAIL] gh issue edit (body) #$($existing.number) — 5xx после $($editBodyResult.Attempts) попыток." -ForegroundColor Yellow
                    Write-Host "                Повторите вручную: pwsh scripts/sync-known-issues.ps1 -Filter `"KI-XXX`"" -ForegroundColor DarkYellow
                    $transientFailures++
                } else {
                    Write-Host "   [ERROR] gh issue edit (body) упал: $($editBodyResult.Output)" -ForegroundColor Red
                    $errors++
                }
                continue
            }

            # Обновляем labels: добавляем недостающие, удаляем лишние (наши).
            $currentLabels = @($existing.labels | ForEach-Object { $_.name })
            $desired = @("ki", "priority-$($ki.Priority)", "status-$($ki.Status)")

            $toAdd = @($desired | Where-Object { $currentLabels -notcontains $_ })
            $managedPrefixes = @("ki", "priority-", "status-")
            $toRemove = @($currentLabels | Where-Object {
                $lbl = $_
                foreach ($p in $managedPrefixes) {
                    if ($lbl -eq $p -or $lbl -like "$p*") { return $true }
                }
                return $false
            } | Where-Object { $desired -notcontains $_ })

            $editArgs = @("issue", "edit", $existing.number, "--repo", $Repo)
            foreach ($l in $toAdd)    { $editArgs += @("--add-label",    $l) }
            foreach ($l in $toRemove) { $editArgs += @("--remove-label", $l) }

            if ($toAdd.Count -gt 0 -or $toRemove.Count -gt 0) {
                $out2 = gh @editArgs 2>&1
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "   [WARN] gh issue edit (labels) упал: $out2" -ForegroundColor Yellow
                }
            }

            # Состояние: closed / open.
            if ($closed -and $existing.state -ne "CLOSED") {
                gh issue close $existing.number --repo $Repo 2>&1 | Out-Null
            }
            elseif (-not $closed -and $existing.state -ne "OPEN") {
                gh issue reopen $existing.number --repo $Repo 2>&1 | Out-Null
            }

            $updated++
            Write-Host "   [~] обновлён: #$($existing.number)" -ForegroundColor Cyan
        } finally {
            Remove-Item $tempBody -ErrorAction SilentlyContinue
        }
    }
}

# ============================================================
# § 7. Итог
# ============================================================

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor White
Write-Host "  Итог sync-known-issues" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor White
Write-Host "  Всего секций:  $($filterList.Count)"
Write-Host "  Создано:       $created" -ForegroundColor Green
Write-Host "  Обновлено:     $updated" -ForegroundColor Cyan
Write-Host "  Пропущено:     $skipped" -ForegroundColor DarkGray
Write-Host "  Ошибок:        $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "DarkGray" })
Write-Host "  Transient:     $transientFailures" -ForegroundColor $(if ($transientFailures -gt 0) { "Yellow" } else { "DarkGray" })
Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor White

if ($DryRun) {
    Write-Host ""
    Write-Host "  [DRYRUN] Ничего не создано. Уберите -DryRun для реального прогона." -ForegroundColor Yellow
}

if ($transientFailures -gt 0) {
    Write-Host ""
    Write-Host "  [INFO] Некоторые Issues не обновились (GitHub 5xx). Запустите ещё раз:" -ForegroundColor Yellow
    Write-Host "         pwsh scripts/sync-known-issues.ps1" -ForegroundColor DarkYellow
}

if ($errors -gt 0) { exit 1 } else { exit 0 }