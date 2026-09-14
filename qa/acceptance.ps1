<#
.SYNOPSIS
    Скрипт приёмочного тестирования собранного приложения MarkNote.

.DESCRIPTION
    Запускает бинарник release\marknote.exe и проверяет приёмочные критерии вех:
    1. Запуск без аргументов (окно, заголовок, замер времени).
    2. Запуск с аргументом fixtures\showcase.md (заголовок, снимок).
    3. Запуск с аргументом fixtures\cp1251.txt (заголовок, снимок).
    4. Запуск с несуществующим путём (отсутствие краша, стартовое состояние).
    5. Повторный запуск с тем же файлом (single-instance дедупликация).
    6. Повторный запуск с другим файлом (второе окно в процессе).
    7. Запуск с fixtures\big-10k.md (10 000 строк, замер времени, отзывчивость).

    Скрипт закрывает за собой все процессы и возвращает exit code 1 при наличии FAIL.

.EXAMPLE
    .\qa\acceptance.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$BinaryPath = "C:\marknote\src-tauri\target\release\marknote.exe",

    [Parameter(Mandatory = $false)]
    [string]$FixturesDir = "C:\marknote\fixtures",

    [Parameter(Mandatory = $false)]
    [string]$ShotsDir = "C:\marknote\qa\shots"
)

Set-StrictMode -Off

$ErrorActionPreference = "Continue"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "         MarkNote Acceptance Test Suite (QA W17)            " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Целевой бинарник: $BinaryPath"
Write-Host "Папка fixtures:   $FixturesDir"
Write-Host "Папка снимков:    $ShotsDir"
Write-Host ""

if (-not (Test-Path $BinaryPath)) {
    Write-Error "Бинарник не найден по пути: $BinaryPath"
    exit 2
}

if (-not (Test-Path $ShotsDir)) {
    New-Item -ItemType Directory -Path $ShotsDir -Force | Out-Null
}

$screenshotScript = Join-Path $PSScriptRoot "screenshot.ps1"
if (-not (Test-Path $screenshotScript)) {
    $screenshotScript = "C:\marknote\qa\screenshot.ps1"
}

# Функция полной очистки процессов marknote
function Stop-MarkNoteProcesses {
    $procs = Get-Process -Name marknote -ErrorAction SilentlyContinue
    if ($procs) {
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
}

# Функция ожидания видимого окна процесса
function Wait-ProcessWindow {
    param(
        [int]$ProcessId,
        [int]$TimeoutSec = 10,
        [string]$TitleFilter = $null
    )

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        $shotInfo = & $screenshotScript -ProcessId $ProcessId -TitleFilter $TitleFilter -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
        if ($shotInfo -and $shotInfo.Success -and $shotInfo.Width -ge 200 -and $shotInfo.Height -ge 200) {
            $sw.Stop()
            return [PSCustomObject]@{
                Found     = $true
                Window    = $shotInfo
                ElapsedMs = [int]$sw.Elapsed.TotalMilliseconds
            }
        }
        Start-Sleep -Milliseconds 200
    }

    $sw.Stop()
    return [PSCustomObject]@{
        Found     = $false
        Window    = $null
        ElapsedMs = [int]$sw.Elapsed.TotalMilliseconds
    }
}

$results = [System.Collections.Generic.List[PSCustomObject]]::new()

function Record-Result {
    param(
        [string]$Id,
        [string]$Name,
        [bool]$Passed,
        [string]$Details,
        [int]$ElapsedMs = 0,
        [string]$Screenshot = ""
    )

    $statusStr = if ($Passed) { "PASS" } else { "FAIL" }
    $color = if ($Passed) { "Green" } else { "Red" }

    Write-Host "[$statusStr] " -NoNewline -ForegroundColor $color
    Write-Host "${Id}: $Name" -ForegroundColor White
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        Write-Host "       Детали: $Details" -ForegroundColor Gray
    }
    if ($ElapsedMs -gt 0) {
        Write-Host "       Время:  ${ElapsedMs} мс" -ForegroundColor Gray
    }
    if (-not [string]::IsNullOrWhiteSpace($Screenshot)) {
        Write-Host "       Снимок: $Screenshot" -ForegroundColor DarkGray
    }
    Write-Host ""

    $results.Add([PSCustomObject]@{
        Id         = $Id
        Name       = $Name
        Status     = $statusStr
        Passed     = $Passed
        Details    = $Details
        ElapsedMs  = $ElapsedMs
        Screenshot = $Screenshot
    })
}

# -----------------------------------------------------------------------------
# Тест 1: Запуск без аргументов
# -----------------------------------------------------------------------------
Stop-MarkNoteProcesses
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $BinaryPath -PassThru
$winResult = Wait-ProcessWindow -ProcessId $proc.Id -TimeoutSec 10
$sw.Stop()
$shotPath = Join-Path $ShotsDir "01_no_args.png"

if ($winResult.Found) {
    & $screenshotScript -ProcessId $proc.Id -OutputPath $shotPath | Out-Null
    $title = $winResult.Window.WindowTitle
    $hasTitle = $title -like "*MarkNote*"
    Record-Result -Id "TC-01" `
                  -Name "Запуск без аргументов: окно появляется, заголовок MarkNote" `
                  -Passed $hasTitle `
                  -Details "Заголовок: '$title', размер: $($winResult.Window.Width)x$($winResult.Window.Height)" `
                  -ElapsedMs $winResult.ElapsedMs `
                  -Screenshot $shotPath
} else {
    Record-Result -Id "TC-01" `
                  -Name "Запуск без аргументов: окно появляется, заголовок MarkNote" `
                  -Passed $false `
                  -Details "Окно не появилось за 10 секунд" `
                  -ElapsedMs $sw.ElapsedMilliseconds
}
Stop-MarkNoteProcesses

# -----------------------------------------------------------------------------
# Тест 2: Запуск с аргументом fixtures\showcase.md
# -----------------------------------------------------------------------------
Stop-MarkNoteProcesses
$showcaseFile = Join-Path $FixturesDir "showcase.md"
$shotPath = Join-Path $ShotsDir "02_showcase.png"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $BinaryPath -ArgumentList "`"$showcaseFile`"" -PassThru
$winResult = Wait-ProcessWindow -ProcessId $proc.Id -TimeoutSec 10
$sw.Stop()

if ($winResult.Found) {
    & $screenshotScript -ProcessId $proc.Id -OutputPath $shotPath | Out-Null
    $title = $winResult.Window.WindowTitle
    $hasFile = $title -like "*showcase.md*"
    $details = if ($hasFile) {
        "Заголовок корректен: '$title'"
    } else {
        "ДЕФЕКТ: заголовок '$title' не содержит 'showcase.md' (аргумент командной строки потерян при старте)"
    }
    Record-Result -Id "TC-02" `
                  -Name "Запуск с аргументом showcase.md: заголовок 'showcase.md — MarkNote'" `
                  -Passed $hasFile `
                  -Details $details `
                  -ElapsedMs $winResult.ElapsedMs `
                  -Screenshot $shotPath
} else {
    Record-Result -Id "TC-02" `
                  -Name "Запуск с аргументом showcase.md: заголовок 'showcase.md — MarkNote'" `
                  -Passed $false `
                  -Details "Окно не появилось за 10 секунд" `
                  -ElapsedMs $sw.ElapsedMilliseconds
}
Stop-MarkNoteProcesses

# -----------------------------------------------------------------------------
# Тест 3: Запуск с аргументом fixtures\cp1251.txt
# -----------------------------------------------------------------------------
Stop-MarkNoteProcesses
$cp1251File = Join-Path $FixturesDir "cp1251.txt"
$shotPath = Join-Path $ShotsDir "03_cp1251.png"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $BinaryPath -ArgumentList "`"$cp1251File`"" -PassThru
$winResult = Wait-ProcessWindow -ProcessId $proc.Id -TimeoutSec 10
$sw.Stop()

if ($winResult.Found) {
    & $screenshotScript -ProcessId $proc.Id -OutputPath $shotPath | Out-Null
    $title = $winResult.Window.WindowTitle
    $hasFile = $title -like "*cp1251.txt*"
    $details = if ($hasFile) {
        "Заголовок корректен: '$title'"
    } else {
        "ДЕФЕКТ: заголовок '$title' не содержит 'cp1251.txt' (аргумент командной строки потерян при старте)"
    }
    Record-Result -Id "TC-03" `
                  -Name "Запуск с аргументом cp1251.txt: заголовок 'cp1251.txt — MarkNote'" `
                  -Passed $hasFile `
                  -Details $details `
                  -ElapsedMs $winResult.ElapsedMs `
                  -Screenshot $shotPath
} else {
    Record-Result -Id "TC-03" `
                  -Name "Запуск с аргументом cp1251.txt: заголовок 'cp1251.txt — MarkNote'" `
                  -Passed $false `
                  -Details "Окно не появилось за 10 секунд" `
                  -ElapsedMs $sw.ElapsedMilliseconds
}
Stop-MarkNoteProcesses

# -----------------------------------------------------------------------------
# Тест 4: Запуск с несуществующим путём
# -----------------------------------------------------------------------------
Stop-MarkNoteProcesses
$nonexistentFile = Join-Path $FixturesDir "nonexistent_file_definitely_absent_12345.md"
$shotPath = Join-Path $ShotsDir "04_nonexistent.png"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $BinaryPath -ArgumentList "`"$nonexistentFile`"" -PassThru
Start-Sleep -Seconds 2
$isAlive = $false
try {
    $checkProc = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if ($checkProc -and -not $checkProc.HasExited) {
        $isAlive = $true
    }
} catch {
    $isAlive = $false
}
$winResult = Wait-ProcessWindow -ProcessId $proc.Id -TimeoutSec 5
$sw.Stop()

if ($winResult.Found) {
    & $screenshotScript -ProcessId $proc.Id -OutputPath $shotPath | Out-Null
}

$passed = $isAlive -and $winResult.Found
$details = if ($passed) {
    "Процесс работает (PID $($proc.Id)), не упал, показал окно: '$($winResult.Window.WindowTitle)'"
} else {
    "Процесс упал или не показал окно (isAlive=$isAlive, windowFound=$($winResult.Found))"
}

Record-Result -Id "TC-04" `
              -Name "Запуск с несуществующим путём: программа не падает, окно живо" `
              -Passed $passed `
              -Details $details `
              -ElapsedMs $sw.ElapsedMilliseconds `
              -Screenshot $shotPath
Stop-MarkNoteProcesses

# -----------------------------------------------------------------------------
# Тест 5: Повторный запуск с тем же файлом (дедупликация)
# -----------------------------------------------------------------------------
Stop-MarkNoteProcesses
$showcaseFile = Join-Path $FixturesDir "showcase.md"
$shotPath = Join-Path $ShotsDir "05_same_file.png"

# Запуск 1
$p1 = Start-Process -FilePath $BinaryPath -ArgumentList "`"$showcaseFile`"" -PassThru
$win1 = Wait-ProcessWindow -ProcessId $p1.Id -TimeoutSec 8

# Запуск 2 (тот же файл)
$p2 = Start-Process -FilePath $BinaryPath -ArgumentList "`"$showcaseFile`"" -PassThru
Start-Sleep -Seconds 3

$runningMarknote = Get-Process -Name marknote -ErrorAction SilentlyContinue
$procCount = ($runningMarknote | Measure-Object).Count
& $screenshotScript -ProcessId $p1.Id -OutputPath $shotPath | Out-Null

$singleInstanceWorking = ($procCount -le 1)
$details = if ($singleInstanceWorking) {
    "Второй процесс завершился, остался ровно 1 основной процесс marknote (PID $($p1.Id))"
} else {
    "ДЕФЕКТ: обнаружено $procCount одновременных процессов marknote (второй процесс не передал управление первому и не закрылся)"
}

Record-Result -Id "TC-05" `
              -Name "Повторный запуск с тем же файлом: дедупликация (1 процесс)" `
              -Passed $singleInstanceWorking `
              -Details $details `
              -Screenshot $shotPath

# -----------------------------------------------------------------------------
# Тест 6: Повторный запуск с другим файлом (второе окно в том же процессе)
# -----------------------------------------------------------------------------
# p1 всё ещё запущен с предыдущего теста
$crlfFile = Join-Path $FixturesDir "crlf.md"
$shotPath = Join-Path $ShotsDir "06_second_window.png"

$p3 = Start-Process -FilePath $BinaryPath -ArgumentList "`"$crlfFile`"" -PassThru
Start-Sleep -Seconds 3

# Проверяем видимые окна процесса p1
$allWindows = [Win32.ScreenCapturer]::EnumerateWindows(0, $null)
$marknoteWindows = $allWindows | Where-Object {
    $wPid = $_.ProcessId
    $p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
    $p -and $p.ProcessName -eq "marknote" -and $_.Width -ge 200 -and $_.Height -ge 200
}

$winCount = ($marknoteWindows | Measure-Object).Count
& $screenshotScript -OutputPath $shotPath | Out-Null

$hasMultipleWindows = ($winCount -ge 2)
$details = if ($hasMultipleWindows) {
    "Открыто $winCount окон в приложении marknote: " + (($marknoteWindows | ForEach-Object { "'$($_.Title)'" }) -join ", ")
} else {
    "ДЕФЕКТ: обнаружено только $winCount окно (ожидалось >= 2 для двух разных файлов)"
}

Record-Result -Id "TC-06" `
              -Name "Повторный запуск с другим файлом: открытие второго окна" `
              -Passed $hasMultipleWindows `
              -Details $details `
              -Screenshot $shotPath
Stop-MarkNoteProcesses

# -----------------------------------------------------------------------------
# Тест 7: Запуск с fixtures\big-10k.md (10 000 строк / 1 МБ)
# -----------------------------------------------------------------------------
Stop-MarkNoteProcesses
$bigFile = Join-Path $FixturesDir "big-10k.md"
$shotPath = Join-Path $ShotsDir "07_big_10k.png"

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $BinaryPath -ArgumentList "`"$bigFile`"" -PassThru
$winResult = Wait-ProcessWindow -ProcessId $proc.Id -TimeoutSec 12
$sw.Stop()

$isResponsive = $false
try {
    $checkProc = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if ($checkProc) {
        $isResponsive = $checkProc.Responding
    }
} catch {
    $isResponsive = $false
}

if ($winResult.Found) {
    & $screenshotScript -ProcessId $proc.Id -OutputPath $shotPath | Out-Null
    $passed = $isResponsive -and ($winResult.ElapsedMs -lt 10000)
    Record-Result -Id "TC-07" `
                  -Name "Запуск с big-10k.md: окно появляется вовремя, процесс не завис" `
                  -Passed $passed `
                  -Details "Время появления: $($winResult.ElapsedMs) мс, Отзывчив: $isResponsive, Заголовок: '$($winResult.Window.WindowTitle)'" `
                  -ElapsedMs $winResult.ElapsedMs `
                  -Screenshot $shotPath
} else {
    Record-Result -Id "TC-07" `
                  -Name "Запуск с big-10k.md: окно появляется вовремя, процесс не завис" `
                  -Passed $false `
                  -Details "Окно не появилось за 12 секунд (Responding=$isResponsive)" `
                  -ElapsedMs $sw.ElapsedMilliseconds
}
Stop-MarkNoteProcesses

# -----------------------------------------------------------------------------
# Сводка результатов
# -----------------------------------------------------------------------------
$total = $results.Count
$passedCount = ($results | Where-Object { $_.Passed }).Count
$failedCount = ($results | Where-Object { -not $_.Passed }).Count

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "                     ИТОГИ ПРИЁМКИ                          " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Всего тестов:     $total"
Write-Host "Пройдено (PASS):  $passedCount" -ForegroundColor Green
Write-Host "Провалено (FAIL): $failedCount" -ForegroundColor $(if ($failedCount -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($failedCount -gt 0) {
    Write-Host "Список упавших критериев:" -ForegroundColor Yellow
    foreach ($r in ($results | Where-Object { -not $_.Passed })) {
        Write-Host "  - [$($r.Id)] $($r.Name)" -ForegroundColor Red
        Write-Host "    Причина: $($r.Details)" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Приёмка завершена со статусом FAILED." -ForegroundColor Red
    exit 1
} else {
    Write-Host "Все критерии приёмки успешно выполнены (PASSED)!" -ForegroundColor Green
    exit 0
}
