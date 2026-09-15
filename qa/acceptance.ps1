<#
.SYNOPSIS
    Скрипт приёмочного тестирования собранного приложения MarkNote.

.DESCRIPTION
    Запускает release\marknote.exe и проверяет десять критериев: запуск без
    аргументов, открытие файлов, single-instance, большие документы, отказ
    бинарного файла, диалог несохранённого документа и Ctrl+F. Все переходы
    ждут наблюдаемое условие с верхним пределом, а не фиксированную паузу.
    Каждый опрос записывается в JSONL-журнал с числом процессов, окнами,
    заголовками, размерами, видимостью и временем.

    Запускать из Windows PowerShell 5.1 или PowerShell 7:
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qa\acceptance.ps1 -Runs 20
      pwsh.exe -NoProfile -ExecutionPolicy Bypass -File .\qa\acceptance.ps1 -Runs 20

.PARAMETER Runs
    Число последовательных прогонов полного набора; по умолчанию 1.

.PARAMETER BinaryPath
    Путь к уже собранному release-бинарнику.

.PARAMETER FixturesDir
    Каталог приёмочных fixtures.

.PARAMETER ShotsDir
    Каталог PNG-снимков окон.

.PARAMETER JournalPath
    JSONL-журнал всех опросов состояния.

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qa\acceptance.ps1 -Runs 20
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 1000)]
    [int]$Runs = 1,

    [Parameter(Mandatory = $false)]
    [string]$BinaryPath = "C:\marknote\src-tauri\target\release\marknote.exe",

    [Parameter(Mandatory = $false)]
    [string]$FixturesDir = "C:\marknote\fixtures",

    [Parameter(Mandatory = $false)]
    [string]$ShotsDir = "C:\marknote\qa\shots",

    [Parameter(Mandatory = $false)]
    [string]$JournalPath = "C:\marknote\qa\acceptance-journal.jsonl"
)

Set-StrictMode -Off
$ErrorActionPreference = "Continue"

if (-not (Test-Path -LiteralPath $BinaryPath -PathType Leaf)) {
    Write-Error "Бинарник не найден по пути: $BinaryPath"
    exit 2
}

if (-not (Test-Path -LiteralPath $FixturesDir -PathType Container)) {
    Write-Error "Каталог fixtures не найден: $FixturesDir"
    exit 2
}

if (-not (Test-Path -LiteralPath $ShotsDir -PathType Container)) {
    New-Item -ItemType Directory -Path $ShotsDir -Force | Out-Null
}

$screenshotScript = Join-Path $PSScriptRoot "screenshot.ps1"
if (-not (Test-Path -LiteralPath $screenshotScript -PathType Leaf)) {
    Write-Error "Скрипт снимка не найден: $screenshotScript"
    exit 2
}

if (-not ([System.Management.Automation.PSTypeName]'MarkNote.Acceptance.Native').Type) {
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace MarkNote.Acceptance {
    public static class Native {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
            public int Width { get { return Right - Left; } }
            public int Height { get { return Bottom - Top; } }
        }

        public sealed class WindowInfo {
            public IntPtr Handle;
            public uint ProcessId;
            public string Title;
            public int Left;
            public int Top;
            public int Width;
            public int Height;
            public bool Visible;
        }

        public static List<WindowInfo> EnumerateWindows() {
            var windows = new List<WindowInfo>();
            EnumWindows((hWnd, lParam) => {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (pid == 0) return true;

                RECT rect;
                if (!GetWindowRect(hWnd, out rect)) return true;
                if (rect.Width < 50 || rect.Height < 50) return true;

                var titleBuilder = new StringBuilder(512);
                GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
                var title = titleBuilder.ToString();
                if (title.IndexOf("siw", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    title.IndexOf("single-instance", StringComparison.OrdinalIgnoreCase) >= 0) {
                    return true;
                }

                windows.Add(new WindowInfo {
                    Handle = hWnd,
                    ProcessId = pid,
                    Title = title,
                    Left = rect.Left,
                    Top = rect.Top,
                    Width = rect.Width,
                    Height = rect.Height,
                    Visible = IsWindowVisible(hWnd)
                });
                return true;
            }, IntPtr.Zero);
            return windows;
        }
    }
}
"@
}

$script:SessionId = [Guid]::NewGuid().ToString("N")
$script:CurrentRun = 0
$script:JournalPath = [IO.Path]::GetFullPath($JournalPath)
$script:Results = @()
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$journalParent = Split-Path -Parent $script:JournalPath
if (-not [string]::IsNullOrWhiteSpace($journalParent) -and -not (Test-Path -LiteralPath $journalParent)) {
    New-Item -ItemType Directory -Path $journalParent -Force | Out-Null
}

$uiAutomationAvailable = $true
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Windows.Forms
} catch {
    $uiAutomationAvailable = $false
    Write-Warning "UI Automation/System.Windows.Forms недоступны: проверки close/search будут FAIL"
}

function Get-MarkNoteState {
    $processes = @(Get-Process -Name marknote -ErrorAction SilentlyContinue)
    $processInfo = @($processes | ForEach-Object {
        [PSCustomObject]@{
            Id = $_.Id
            Responding = [bool]$_.Responding
            MainWindowTitle = [string]$_.MainWindowTitle
        }
    })

    $windows = @()
    $rawWindows = @([MarkNote.Acceptance.Native]::EnumerateWindows())
    foreach ($window in $rawWindows) {
        $process = Get-Process -Id ([int]$window.ProcessId) -ErrorAction SilentlyContinue
        if (-not $process -or $process.ProcessName -ne "marknote") { continue }
        $windows += [PSCustomObject]@{
            Handle = $window.Handle
            ProcessId = [int]$window.ProcessId
            Title = [string]$window.Title
            Left = [int]$window.Left
            Top = [int]$window.Top
            Width = [int]$window.Width
            Height = [int]$window.Height
            Visible = [bool]$window.Visible
            IsApplication = [bool]($window.Visible -and $window.Width -ge 200 -and $window.Height -ge 200)
        }
    }

    [PSCustomObject]@{
        Timestamp = (Get-Date).ToUniversalTime().ToString("o")
        ProcessCount = $processInfo.Count
        ProcessIds = @($processInfo | ForEach-Object { $_.Id })
        Processes = $processInfo
        WindowCount = @($windows | Where-Object { $_.IsApplication }).Count
        Windows = $windows
    }
}

function Write-StateJournal {
    param(
        [string]$Phase,
        [string]$TestId,
        [int]$ElapsedMs,
        [object]$State,
        [hashtable]$Extra = @{}
    )

    $windowLog = @($State.Windows | ForEach-Object {
        [ordered]@{
            pid = $_.ProcessId
            title = $_.Title
            width = $_.Width
            height = $_.Height
            visible = $_.Visible
            application = $_.IsApplication
        }
    })
    $record = [ordered]@{
        session = $script:SessionId
        run = $script:CurrentRun
        test = $TestId
        phase = $Phase
        timestamp = $State.Timestamp
        elapsedMs = $ElapsedMs
        processCount = $State.ProcessCount
        processIds = @($State.ProcessIds)
        processes = @($State.Processes)
        windowCount = $State.WindowCount
        windows = $windowLog
    }
    foreach ($key in $Extra.Keys) { $record[$key] = $Extra[$key] }
    $line = $record | ConvertTo-Json -Compress -Depth 8
    [IO.File]::AppendAllText($script:JournalPath, "$line`r`n", $script:Utf8NoBom)

    $windowText = @($State.Windows | ForEach-Object {
        "pid=$($_.ProcessId) '$($_.Title)' $($_.Width)x$($_.Height) visible=$($_.Visible)"
    }) -join "; "
    Write-Host ("[{0}] run={1} {2} {3}: processes={4} windows={5}; {6}" -f `
        $State.Timestamp, $script:CurrentRun, $TestId, $Phase, $State.ProcessCount, $State.WindowCount, $windowText) -ForegroundColor DarkGray
}

function Stop-MarkNoteProcesses {
    param([int]$TimeoutSec = 8)

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    do {
        $running = @(Get-Process -Name marknote -ErrorAction SilentlyContinue)
        if ($running.Count -eq 0) { break }
        foreach ($process in $running) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
        if ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSec) {
            Start-Sleep -Milliseconds 50
        }
    } while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSec)
    $stopwatch.Stop()
    Start-Sleep -Milliseconds 150
    return (@(Get-Process -Name marknote -ErrorAction SilentlyContinue).Count -eq 0)
}

function Wait-Until {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Condition,
        [Parameter(Mandatory = $true)]
        [string]$TestId,
        [Parameter(Mandatory = $true)]
        [string]$Phase,
        [int]$TimeoutSec = 10,
        [int]$IntervalMs = 100
    )

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $lastState = Get-MarkNoteState
    do {
        $lastState = Get-MarkNoteState
        $elapsed = [int]$stopwatch.Elapsed.TotalMilliseconds
        Write-StateJournal -Phase $Phase -TestId $TestId -ElapsedMs $elapsed -State $lastState
        $conditionResult = & $Condition $lastState
        if ([bool]$conditionResult) {
            $stopwatch.Stop()
            return [PSCustomObject]@{
                Found = $true
                State = $lastState
                ElapsedMs = [int]$stopwatch.Elapsed.TotalMilliseconds
            }
        }
        if ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSec) {
            Start-Sleep -Milliseconds $IntervalMs
        }
    } while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSec)
    $stopwatch.Stop()
    return [PSCustomObject]@{
        Found = $false
        State = $lastState
        ElapsedMs = [int]$stopwatch.Elapsed.TotalMilliseconds
    }
}

function Start-MarkNote {
    param([string]$Path = "")
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return (Start-Process -FilePath $BinaryPath -PassThru)
    }
    return (Start-Process -FilePath $BinaryPath -ArgumentList ("`"{0}`"" -f $Path) -PassThru)
}

function Wait-MarkNoteWindow {
    param(
        [int]$ProcessId = 0,
        [string]$TitleFilter = "",
        [string]$TestId = "window",
        [int]$TimeoutSec = 15
    )

    return Wait-Until -TestId $TestId -Phase "window" -TimeoutSec $TimeoutSec -Condition {
        param($state)
        $matching = @($state.Windows | Where-Object {
            $_.IsApplication -and
            ($ProcessId -eq 0 -or $_.ProcessId -eq $ProcessId) -and
            ([string]::IsNullOrWhiteSpace($TitleFilter) -or $_.Title -like "*$TitleFilter*")
        })
        return ($matching.Count -gt 0)
    }
}

function Wait-ProcessExit {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$TestId,
        [int]$TimeoutSec = 15
    )
    if (-not $Process) {
        return [PSCustomObject]@{ Found = $true; State = Get-MarkNoteState; ElapsedMs = 0 }
    }
    $targetPid = $Process.Id
    return Wait-Until -TestId $TestId -Phase "process-exit-pid-$targetPid" -TimeoutSec $TimeoutSec -Condition {
        param($state)
        return (@($state.ProcessIds | Where-Object { $_ -eq $targetPid }).Count -eq 0)
    }
}

function Wait-WindowCount {
    param(
        [int]$ExpectedCount,
        [string]$TestId,
        [int]$TimeoutSec = 15
    )
    return Wait-Until -TestId $TestId -Phase "window-count-$ExpectedCount" -TimeoutSec $TimeoutSec -Condition {
        param($state)
        return ($state.WindowCount -ge $ExpectedCount)
    }
}

function Get-ApplicationWindows {
    param([object]$State)
    return @($State.Windows | Where-Object { $_.IsApplication })
}

function Get-WindowForProcess {
    param([object]$State, [int]$ProcessId, [string]$TitleFilter = "")
    return @($State.Windows | Where-Object {
        $_.IsApplication -and
        ($ProcessId -eq 0 -or $_.ProcessId -eq $ProcessId) -and
        ([string]::IsNullOrWhiteSpace($TitleFilter) -or $_.Title -like "*$TitleFilter*")
    }) | Select-Object -First 1
}

function Capture-Window {
    param([int]$ProcessId, [string]$OutputPath, [string]$TitleFilter = "")
    if ([string]::IsNullOrWhiteSpace($TitleFilter)) {
        $capture = @(& $screenshotScript -ProcessId $ProcessId -OutputPath $OutputPath -WarningAction SilentlyContinue -ErrorAction SilentlyContinue)
    } else {
        $capture = @(& $screenshotScript -ProcessId $ProcessId -OutputPath $OutputPath -TitleFilter $TitleFilter -WarningAction SilentlyContinue -ErrorAction SilentlyContinue)
    }
    return ($capture | Where-Object { $_ -and $_.Success } | Select-Object -Last 1)
}

function Get-ShotPath {
    param([string]$Name)
    return (Join-Path $ShotsDir ("run_{0:D3}_{1}" -f $script:CurrentRun, $Name))
}

function Get-UiAutomationNames {
    param([IntPtr]$Handle)
    if (-not $uiAutomationAvailable -or $Handle -eq [IntPtr]::Zero) { return @() }
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
        if (-not $root) { return @() }
        $all = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)
        $names = @()
        foreach ($element in $all) {
            if (-not [string]::IsNullOrWhiteSpace($element.Current.Name)) {
                $names += [string]$element.Current.Name
            }
        }
        return $names
    } catch {
        return @()
    }
}

function Find-UiElement {
    param(
        [int]$ProcessId,
        [string]$Name
    )
    if (-not $uiAutomationAvailable) { return $null }
    try {
        $state = Get-MarkNoteState
        $window = Get-WindowForProcess -State $state -ProcessId $ProcessId
        if (-not $window) { return $null }
        $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
        if (-not $root) { return $null }
        $all = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)
        $exact = $all | Where-Object { $_.Current.Name -eq $Name } | Select-Object -First 1
        if ($exact) { return $exact }
        return ($all | Where-Object { $_.Current.Name -like "*$Name*" } | Select-Object -First 1)
    } catch {
        return $null
    }
}

function Click-UiElement {
    param(
        [int]$ProcessId,
        [string]$Name
    )
    $element = Find-UiElement -ProcessId $ProcessId -Name $Name
    if (-not $element) { return $false }
    try {
        $pattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
            return $true
        }
    } catch {}
    try {
        $rect = $element.Current.BoundingRectangle
        if ($rect.Width -le 0 -or $rect.Height -le 0) { return $false }
        $x = [int]($rect.X + ($rect.Width / 2))
        $y = [int]($rect.Y + ($rect.Height / 2))
        [MarkNote.Acceptance.Native]::SetCursorPos($x, $y) | Out-Null
        [MarkNote.Acceptance.Native]::mouse_event([uint32]2, 0, 0, 0, [UIntPtr]::Zero)
        [MarkNote.Acceptance.Native]::mouse_event([uint32]4, 0, 0, 0, [UIntPtr]::Zero)
        return $true
    } catch {
        return $false
    }
}

function Bring-WindowToFront {
    param([object]$Window)
    if (-not $Window) { return $false }
    [MarkNote.Acceptance.Native]::SetForegroundWindow([IntPtr]$Window.Handle) | Out-Null
    $x = [int]($Window.Left + ($Window.Width / 2))
    $y = [int]($Window.Top + ($Window.Height / 2))
    if ($x -gt 0 -and $y -gt 0) {
        [MarkNote.Acceptance.Native]::SetCursorPos($x, $y) | Out-Null
        [MarkNote.Acceptance.Native]::mouse_event([uint32]2, 0, 0, 0, [UIntPtr]::Zero)
        [MarkNote.Acceptance.Native]::mouse_event([uint32]4, 0, 0, 0, [UIntPtr]::Zero)
    }
    return $true
}

function Send-WindowKeys {
    param([string]$Keys)
    if ($Keys -eq "^f" -or $Keys -eq "^{f}") {
        [MarkNote.Acceptance.Native]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
        [MarkNote.Acceptance.Native]::keybd_event(0x46, 0, 0, [UIntPtr]::Zero)
        [MarkNote.Acceptance.Native]::keybd_event(0x46, 0, 2, [UIntPtr]::Zero)
        [MarkNote.Acceptance.Native]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
        return $true
    }
    if ($Keys -eq "%{F4}" -or $Keys -eq "%{f4}") {
        [MarkNote.Acceptance.Native]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
        [MarkNote.Acceptance.Native]::keybd_event(0x73, 0, 0, [UIntPtr]::Zero)
        [MarkNote.Acceptance.Native]::keybd_event(0x73, 0, 2, [UIntPtr]::Zero)
        [MarkNote.Acceptance.Native]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
        return $true
    }
    try {
        [System.Windows.Forms.SendKeys]::SendWait($Keys)
        return $true
    } catch {
        return $false
    }
}

function Wait-UiText {
    param(
        [int]$ProcessId,
        [string]$Expected,
        [string]$TestId,
        [bool]$Absent = $false,
        [int]$TimeoutSec = 10
    )
    return Wait-Until -TestId $TestId -Phase ("ui-text-" + $(if ($Absent) { "absent" } else { "present" })) -TimeoutSec $TimeoutSec -Condition {
        param($state)
        $window = Get-WindowForProcess -State $state -ProcessId $ProcessId
        if (-not $window) { return $false }
        $names = @(Get-UiAutomationNames -Handle ([IntPtr]$window.Handle))
        $present = @($names | Where-Object { $_ -like "*$Expected*" }).Count -gt 0
        return ($(if ($Absent) { -not $present } else { $present }))
    }
}

function New-Outcome {
    param([bool]$Passed, [string]$Details, [int]$ElapsedMs = 0, [string]$Screenshot = "")
    return [PSCustomObject]@{
        Passed = $Passed
        Details = $Details
        ElapsedMs = $ElapsedMs
        Screenshot = $Screenshot
    }
}

function Record-Result {
    param(
        [string]$Id,
        [string]$Name,
        [object]$Outcome
    )
    $status = if ($Outcome.Passed) { "PASS" } else { "FAIL" }
    $color = if ($Outcome.Passed) { "Green" } else { "Red" }
    Write-Host "[$status] run=$script:CurrentRun $Id`: $Name" -ForegroundColor $color
    Write-Host "       Детали: $($Outcome.Details)" -ForegroundColor Gray
    if ($Outcome.ElapsedMs -gt 0) { Write-Host "       Время: $($Outcome.ElapsedMs) мс" -ForegroundColor Gray }
    if (-not [string]::IsNullOrWhiteSpace($Outcome.Screenshot)) { Write-Host "       Снимок: $($Outcome.Screenshot)" -ForegroundColor DarkGray }
    Write-Host ""
    $script:Results += [PSCustomObject]@{
        Run = $script:CurrentRun
        Id = $Id
        Name = $Name
        Passed = [bool]$Outcome.Passed
        Details = $Outcome.Details
        ElapsedMs = $Outcome.ElapsedMs
        Screenshot = $Outcome.Screenshot
    }
}

function Invoke-Scenario {
    param(
        [string]$Id,
        [string]$Name,
        [scriptblock]$Body
    )
    [void](Stop-MarkNoteProcesses)
    $outcome = $null
    try {
        $outcome = & $Body
        if (-not $outcome) {
            $outcome = New-Outcome -Passed $false -Details "Сценарий не вернул результат"
        }
    } catch {
        $outcome = New-Outcome -Passed $false -Details ("Исключение QA: " + $_.Exception.Message)
    } finally {
        [void](Stop-MarkNoteProcesses)
    }
    Record-Result -Id $Id -Name $Name -Outcome $outcome
}

function Test-NoArguments {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $process = Start-MarkNote
    $windowWait = Wait-MarkNoteWindow -ProcessId $process.Id -TitleFilter "MarkNote" -TestId "TC-01" -TimeoutSec 15
    $watch.Stop()
    $window = Get-WindowForProcess -State $windowWait.State -ProcessId $process.Id -TitleFilter "MarkNote"
    $screenshot = ""
    if ($windowWait.Found) {
        $shot = Capture-Window -ProcessId $process.Id -OutputPath (Get-ShotPath "01_no_args.png") -TitleFilter "MarkNote"
        if ($shot) { $screenshot = $shot.OutputPath }
    }
    $passed = $windowWait.Found -and $window -and ($window.Title -like "*MarkNote*")
    $details = if ($passed) { "Окно '$($window.Title)', размер $($window.Width)x$($window.Height), visible=$($window.Visible)" } else { "Окно MarkNote не найдено за $($windowWait.ElapsedMs) мс" }
    return New-Outcome -Passed $passed -Details $details -ElapsedMs $watch.ElapsedMilliseconds -Screenshot $screenshot
}

function Test-Showcase {
    $path = Join-Path $FixturesDir "showcase.md"
    $process = Start-MarkNote -Path $path
    $windowWait = Wait-MarkNoteWindow -ProcessId $process.Id -TitleFilter "showcase.md" -TestId "TC-02" -TimeoutSec 15
    $window = Get-WindowForProcess -State $windowWait.State -ProcessId $process.Id -TitleFilter "showcase.md"
    $screenshot = ""
    if ($windowWait.Found) {
        $shot = Capture-Window -ProcessId $process.Id -OutputPath (Get-ShotPath "02_showcase.png") -TitleFilter "showcase.md"
        if ($shot) { $screenshot = $shot.OutputPath }
    }
    $passed = $windowWait.Found -and $window -and ($window.Title -like "*showcase.md*")
    $details = if ($passed) { "Заголовок '$($window.Title)', размер $($window.Width)x$($window.Height), visible=$($window.Visible)" } else { "Заголовок showcase.md не появился за $($windowWait.ElapsedMs) мс" }
    return New-Outcome -Passed $passed -Details $details -ElapsedMs $windowWait.ElapsedMs -Screenshot $screenshot
}

function Test-Cp1251 {
    $path = Join-Path $FixturesDir "cp1251.txt"
    $process = Start-MarkNote -Path $path
    $windowWait = Wait-MarkNoteWindow -ProcessId $process.Id -TitleFilter "cp1251.txt" -TestId "TC-03" -TimeoutSec 15
    $window = Get-WindowForProcess -State $windowWait.State -ProcessId $process.Id -TitleFilter "cp1251.txt"
    $screenshot = ""
    if ($windowWait.Found) {
        $shot = Capture-Window -ProcessId $process.Id -OutputPath (Get-ShotPath "03_cp1251.png") -TitleFilter "cp1251.txt"
        if ($shot) { $screenshot = $shot.OutputPath }
    }
    $passed = $windowWait.Found -and $window -and ($window.Title -like "*cp1251.txt*")
    $details = if ($passed) { "Заголовок '$($window.Title)', размер $($window.Width)x$($window.Height), visible=$($window.Visible)" } else { "Заголовок cp1251.txt не появился за $($windowWait.ElapsedMs) мс" }
    return New-Outcome -Passed $passed -Details $details -ElapsedMs $windowWait.ElapsedMs -Screenshot $screenshot
}

function Test-Nonexistent {
    $path = Join-Path $FixturesDir "nonexistent_file_definitely_absent_12345.md"
    $process = Start-MarkNote -Path $path
    $windowWait = Wait-MarkNoteWindow -ProcessId $process.Id -TestId "TC-04" -TimeoutSec 15
    $state = $windowWait.State
    $alive = @($state.ProcessIds | Where-Object { $_ -eq $process.Id }).Count -gt 0
    $screenshot = ""
    if ($windowWait.Found) {
        $shot = Capture-Window -ProcessId $process.Id -OutputPath (Get-ShotPath "04_nonexistent.png")
        if ($shot) { $screenshot = $shot.OutputPath }
    }
    $passed = $windowWait.Found -and $alive
    $windows = @(Get-ApplicationWindows -State $state)
    $details = "processAlive=$alive, окна=$($windows.Count): " + (($windows | ForEach-Object { "'$($_.Title)' $($_.Width)x$($_.Height) visible=$($_.Visible)" }) -join "; ")
    return New-Outcome -Passed $passed -Details $details -ElapsedMs $windowWait.ElapsedMs -Screenshot $screenshot
}

function Test-SameFile {
    $path = Join-Path $FixturesDir "showcase.md"
    $p1 = Start-MarkNote -Path $path
    $first = Wait-MarkNoteWindow -ProcessId $p1.Id -TitleFilter "showcase.md" -TestId "TC-05-main" -TimeoutSec 15
    $p2 = Start-MarkNote -Path $path
    $secondExit = Wait-ProcessExit -Process $p2 -TestId "TC-05-second" -TimeoutSec 15
    $countWait = Wait-Until -TestId "TC-05" -Phase "single-instance-process-count" -TimeoutSec 10 -Condition {
        param($state)
        return ($state.ProcessCount -le 1)
    }
    $state = $countWait.State
    $shot = Capture-Window -ProcessId $p1.Id -OutputPath (Get-ShotPath "05_same_file.png") -TitleFilter "showcase.md"
    $screenshot = if ($shot) { $shot.OutputPath } else { "" }
    $passed = $first.Found -and $secondExit.Found -and ($state.ProcessCount -le 1)
    $details = "firstWindow=$($first.Found), secondExited=$($secondExit.Found), processes=$($state.ProcessCount), pids=" + ((@($state.ProcessIds) -join ","))
    return New-Outcome -Passed $passed -Details $details -ElapsedMs ($first.ElapsedMs + $secondExit.ElapsedMs + $countWait.ElapsedMs) -Screenshot $screenshot
}

function Test-SecondWindow {
    $firstPath = Join-Path $FixturesDir "showcase.md"
    $secondPath = Join-Path $FixturesDir "crlf.md"
    $p1 = Start-MarkNote -Path $firstPath
    $first = Wait-MarkNoteWindow -ProcessId $p1.Id -TitleFilter "showcase.md" -TestId "TC-06-main" -TimeoutSec 15
    $p2 = Start-MarkNote -Path $secondPath
    $secondExit = Wait-ProcessExit -Process $p2 -TestId "TC-06-second" -TimeoutSec 15
    $windowWait = Wait-WindowCount -ExpectedCount 2 -TestId "TC-06" -TimeoutSec 15
    $state = $windowWait.State
    $windows = @(Get-ApplicationWindows -State $state)
    $shot = Capture-Window -ProcessId $p1.Id -OutputPath (Get-ShotPath "06_second_window.png") -TitleFilter "showcase.md"
    $screenshot = if ($shot) { $shot.OutputPath } else { "" }
    $titles = ($windows | ForEach-Object { "'$($_.Title)' $($_.Width)x$($_.Height) visible=$($_.Visible)" }) -join "; "
    $firstTitlePreserved = @($windows | Where-Object { $_.Title -like "*showcase.md*" }).Count -gt 0
    $secondTitleRouted = @($windows | Where-Object { $_.Title -like "*crlf.md*" }).Count -gt 0
    $passed = $first.Found -and $secondExit.Found -and $windowWait.Found -and $firstTitlePreserved -and $secondTitleRouted
    $details = "firstWindow=$($first.Found), secondExited=$($secondExit.Found), firstTitle=$firstTitlePreserved, secondTitle=$secondTitleRouted, windows=$($windows.Count), processes=$($state.ProcessCount): $titles"
    return New-Outcome -Passed $passed -Details $details -ElapsedMs ($first.ElapsedMs + $secondExit.ElapsedMs + $windowWait.ElapsedMs) -Screenshot $screenshot
}

function Test-BigDocument {
    $path = Join-Path $FixturesDir "big-10k.md"
    $process = Start-MarkNote -Path $path
    $windowWait = Wait-MarkNoteWindow -ProcessId $process.Id -TestId "TC-07" -TimeoutSec 20
    $state = $windowWait.State
    $processInfo = @($state.Processes | Where-Object { $_.Id -eq $process.Id } | Select-Object -First 1)
    $responsive = $processInfo -and $processInfo.Responding
    $screenshot = ""
    if ($windowWait.Found) {
        $shot = Capture-Window -ProcessId $process.Id -OutputPath (Get-ShotPath "07_big_10k.png")
        if ($shot) { $screenshot = $shot.OutputPath }
    }
    $passed = $windowWait.Found -and $responsive
    $details = "window=$($windowWait.Found), responding=$responsive, elapsed=$($windowWait.ElapsedMs) мс, processes=$($state.ProcessCount)"
    return New-Outcome -Passed $passed -Details $details -ElapsedMs $windowWait.ElapsedMs -Screenshot $screenshot
}

function Test-BinaryRejected {
    $path = Join-Path $FixturesDir "logo.png"
    $process = Start-MarkNote -Path $path
    $windowWait = Wait-MarkNoteWindow -ProcessId $process.Id -TestId "TC-08-window" -TimeoutSec 15
    # Match the actual backend message, not a translated phrase the app does not show.
    $noticeWait = Wait-UiText -ProcessId $process.Id -Expected "This file appears to be binary and cannot be opened as text." -TestId "TC-08" -TimeoutSec 15
    $state = $noticeWait.State
    $alive = @($state.ProcessIds | Where-Object { $_ -eq $process.Id }).Count -gt 0
    $shot = Capture-Window -ProcessId $process.Id -OutputPath (Get-ShotPath "08_binary_rejected.png")
    $screenshot = if ($shot) { $shot.OutputPath } else { "" }
    $passed = $windowWait.Found -and $noticeWait.Found -and $alive
    $details = "binaryNotice=$($noticeWait.Found), processAlive=$alive, title=" + (($state.Windows | Where-Object { $_.IsApplication } | Select-Object -First 1).Title)
    return New-Outcome -Passed $passed -Details $details -ElapsedMs ($windowWait.ElapsedMs + $noticeWait.ElapsedMs) -Screenshot $screenshot
}

function Test-UnsavedClose {
    $process = Start-MarkNote
    $windowWait = Wait-MarkNoteWindow -ProcessId $process.Id -TestId "TC-09-window" -TimeoutSec 15
    if (-not $windowWait.Found) {
        return New-Outcome -Passed $false -Details "Окно без аргументов не появилось" -ElapsedMs $windowWait.ElapsedMs
    }
    $window = Get-WindowForProcess -State $windowWait.State -ProcessId $process.Id
    [void](Bring-WindowToFront -Window $window)
    # Имя плитки на стартовом экране — «Markdown .md», с расширением.
    # Короткое «Markdown» попадает в кнопку типа документа в строке
    # состояния, и сценарий кликал не туда.
    $markdownTile = Wait-UiText -ProcessId $process.Id -Expected "Markdown .md" -TestId "TC-09-format-tile" -TimeoutSec 15
    if (-not $markdownTile.Found) {
        return New-Outcome -Passed $false -Details "Плитка Markdown не появилась на стартовом экране" -ElapsedMs $markdownTile.ElapsedMs
    }
    if (-not (Click-UiElement -ProcessId $process.Id -Name "Markdown .md")) {
        return New-Outcome -Passed $false -Details "Плитка Markdown не нажимается через UI Automation" -ElapsedMs $markdownTile.ElapsedMs
    }
    # "Choose document format" labels the persistent status-bar format picker,
    # not just the start screen. The Markdown tile is unique to the start screen.
    $screenGone = Wait-UiText -ProcessId $process.Id -Expected "Markdown .md" -Absent $true -TestId "TC-09-start-screen-closed" -TimeoutSec 10
    if (-not $screenGone.Found) {
        return New-Outcome -Passed $false -Details "Стартовый экран остался виден после выбора Markdown" -ElapsedMs ($markdownTile.ElapsedMs + $screenGone.ElapsedMs)
    }
    [void](Bring-WindowToFront -Window (Get-WindowForProcess -State $screenGone.State -ProcessId $process.Id))
    [void](Send-WindowKeys -Keys "qa-unsaved")
    $typed = Wait-UiText -ProcessId $process.Id -Expected "10 chars" -TestId "TC-09" -TimeoutSec 5
    if (-not $typed.Found) {
        $state = Get-MarkNoteState
        $w = Get-WindowForProcess -State $state -ProcessId $process.Id
        $names = if ($w) { @(Get-UiAutomationNames -Handle ([IntPtr]$w.Handle)) } else { @() }
        $status = ($names | Where-Object { $_ -match "\b\d+ chars\b" } | Select-Object -First 1)
        return New-Outcome -Passed $false -Details "В редактор не попал текст qa-unsaved; startScreenClosed=$($screenGone.Found), status='$status'" -ElapsedMs ($markdownTile.ElapsedMs + $screenGone.ElapsedMs + $typed.ElapsedMs)
    }
    [void](Send-WindowKeys -Keys "%{F4}")
    $prompt = Wait-Until -TestId "TC-09" -Phase "ui-close-prompt" -TimeoutSec 5 -Condition {
        param($state)
        $w = Get-WindowForProcess -State $state -ProcessId $process.Id
        if (-not $w) { return $false }
        $names = @(Get-UiAutomationNames -Handle ([IntPtr]$w.Handle))
        return (@($names | Where-Object { $_ -like "*unsaved changes*" -or $_ -like "*Save changes*" -or $_ -like "*Discard*" }).Count -gt 0)
    }
    $shot = Capture-Window -ProcessId $process.Id -OutputPath (Get-ShotPath "09_unsaved_close_prompt.png")
    $screenshot = if ($shot) { $shot.OutputPath } else { "" }
    if (-not $prompt.Found) {
        return New-Outcome -Passed $false -Details "Диалог несохранённых изменений не появился после Alt+F4" -ElapsedMs $prompt.ElapsedMs -Screenshot $screenshot
    }
    $watchdog = Wait-ProcessExit -Process $process -TestId "TC-09-watchdog" -TimeoutSec 8
    $passed = $watchdog.Found
    $details = "prompt=$($prompt.Found), watchdogClosed=$($watchdog.Found), watchdogWait=$($watchdog.ElapsedMs) мс без ответа"
    return New-Outcome -Passed $passed -Details $details -ElapsedMs ($markdownTile.ElapsedMs + $screenGone.ElapsedMs + $typed.ElapsedMs + $prompt.ElapsedMs + $watchdog.ElapsedMs) -Screenshot $screenshot
}

function Test-SearchShortcut {
    $path = Join-Path $FixturesDir "showcase.md"
    $process = Start-MarkNote -Path $path
    $windowWait = Wait-MarkNoteWindow -ProcessId $process.Id -TitleFilter "showcase.md" -TestId "TC-10-window" -TimeoutSec 15
    if (-not $windowWait.Found) {
        return New-Outcome -Passed $false -Details "showcase окно не появилось" -ElapsedMs $windowWait.ElapsedMs
    }
    $window = Get-WindowForProcess -State $windowWait.State -ProcessId $process.Id -TitleFilter "showcase.md"
    [void](Bring-WindowToFront -Window $window)
    if (-not (Click-UiElement -ProcessId $process.Id -Name "Edit")) {
        [void](Send-WindowKeys -Keys "^f")
    } else {
        Start-Sleep -Milliseconds 100
        if (-not (Click-UiElement -ProcessId $process.Id -Name "Find")) {
            [void](Send-WindowKeys -Keys "^f")
        }
    }
    $panel = Wait-Until -TestId "TC-10" -Phase "ui-search-panel" -TimeoutSec 8 -Condition {
        param($state)
        $w = Get-WindowForProcess -State $state -ProcessId $process.Id -TitleFilter "showcase.md"
        if (-not $w) { return $false }
        $names = @(Get-UiAutomationNames -Handle ([IntPtr]$w.Handle))
        return (@($names | Where-Object { $_ -like "*Search query*" -or $_ -like "*Find and replace*" -or $_ -like "*Строка поиска*" -or $_ -like "*Find…*" }).Count -gt 0)
    }
    $state = $panel.State
    $alive = @($state.ProcessIds | Where-Object { $_ -eq $process.Id }).Count -gt 0
    $shot = Capture-Window -ProcessId $process.Id -OutputPath (Get-ShotPath "10_search.png")
    $screenshot = if ($shot) { $shot.OutputPath } else { "" }
    $passed = $panel.Found -and $alive
    $details = "searchPanel=$($panel.Found), processAlive=$alive, windows=$($state.WindowCount)"
    return New-Outcome -Passed $passed -Details $details -ElapsedMs ($windowWait.ElapsedMs + $panel.ElapsedMs) -Screenshot $screenshot
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "       MarkNote Acceptance Test Suite (W42)                 " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Запускать PowerShell 5.1 или PowerShell 7; Runs=$Runs"
Write-Host "Целевой бинарник: $BinaryPath"
Write-Host "Папка fixtures:   $FixturesDir"
Write-Host "Папка снимков:    $ShotsDir"
Write-Host "JSONL-журнал:     $script:JournalPath"
Write-Host "Сессия:           $script:SessionId"
Write-Host ""

for ($run = 1; $run -le $Runs; $run += 1) {
    $script:CurrentRun = $run
    Write-Host "====================== ПРОГОН $run/$Runs ======================" -ForegroundColor Cyan
    Invoke-Scenario -Id "TC-01" -Name "Запуск без аргументов: окно и заголовок MarkNote" -Body { Test-NoArguments }
    Invoke-Scenario -Id "TC-02" -Name "Запуск showcase.md: корректный заголовок" -Body { Test-Showcase }
    Invoke-Scenario -Id "TC-03" -Name "Запуск cp1251.txt: корректный заголовок" -Body { Test-Cp1251 }
    Invoke-Scenario -Id "TC-04" -Name "Несуществующий путь: процесс жив и окно показано" -Body { Test-Nonexistent }
    Invoke-Scenario -Id "TC-05" -Name "Повторный запуск с тем же файлом: один процесс" -Body { Test-SameFile }
    Invoke-Scenario -Id "TC-06" -Name "Повторный запуск с другим файлом: второе окно" -Body { Test-SecondWindow }
    Invoke-Scenario -Id "TC-07" -Name "big-10k.md: окно появляется и процесс отзывчив" -Body { Test-BigDocument }
    Invoke-Scenario -Id "TC-08" -Name "logo.png: бинарный файл отклонён с сообщением" -Body { Test-BinaryRejected }
    Invoke-Scenario -Id "TC-09" -Name "Несохранённый документ: close prompt и watchdog" -Body { Test-UnsavedClose }
    Invoke-Scenario -Id "TC-10" -Name "Ctrl+F: панель поиска открывается" -Body { Test-SearchShortcut }
    $runResults = @($script:Results | Where-Object { $_.Run -eq $run })
    $runPassed = @($runResults | Where-Object { $_.Passed }).Count
    Write-Host "Прогон ${run}: $runPassed/$($runResults.Count) PASS" -ForegroundColor $(if ($runPassed -eq $runResults.Count) { "Green" } else { "Red" })
    Write-Host ""
}

[void](Stop-MarkNoteProcesses)
$allResults = @($script:Results)
$totalRuns = $Runs
$testsPerRun = 10
$fullyGreen = 0
for ($run = 1; $run -le $totalRuns; $run += 1) {
    if (@($allResults | Where-Object { $_.Run -eq $run -and $_.Passed }).Count -eq $testsPerRun) { $fullyGreen += 1 }
}
$passedTests = @($allResults | Where-Object { $_.Passed }).Count
$failedTests = @($allResults | Where-Object { -not $_.Passed }).Count

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "                     ИТОГИ ПРИЁМКИ                          " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Прогонов:          $totalRuns"
Write-Host "Тестов в прогоне:  $testsPerRun"
Write-Host "Полностью зелёных:  $fullyGreen/$totalRuns" -ForegroundColor $(if ($fullyGreen -eq $totalRuns) { "Green" } else { "Red" })
Write-Host "Тестов PASS:       $passedTests/$($allResults.Count)" -ForegroundColor Green
Write-Host "Тестов FAIL:       $failedTests/$($allResults.Count)" -ForegroundColor $(if ($failedTests -gt 0) { "Red" } else { "Green" })

$failuresByTest = @($allResults | Where-Object { -not $_.Passed } | Group-Object Id | Sort-Object Name)
if ($failuresByTest.Count -gt 0) {
    Write-Host "Плавающие/упавшие тесты:" -ForegroundColor Yellow
    foreach ($group in $failuresByTest) { Write-Host "  $($group.Name): $($group.Count)" -ForegroundColor Red }
}

$summaryPath = Join-Path (Split-Path -Parent $script:JournalPath) "acceptance-summary.json"
$summary = [ordered]@{
    session = $script:SessionId
    runs = $totalRuns
    testsPerRun = $testsPerRun
    fullyGreen = $fullyGreen
    passedTests = $passedTests
    failedTests = $failedTests
    failuresByTest = @($failuresByTest | ForEach-Object { [ordered]@{ id = $_.Name; count = $_.Count } })
    results = $allResults
}
[IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 10), $script:Utf8NoBom)
Write-Host "Подробный журнал:  $script:JournalPath"
Write-Host "Сводка JSON:       $summaryPath"
Write-Host "Остаток процессов marknote: $(@(Get-Process -Name marknote -ErrorAction SilentlyContinue).Count)"

if ($failedTests -gt 0 -or $fullyGreen -ne $totalRuns) {
    Write-Host "Приёмка завершена со статусом FAILED." -ForegroundColor Red
    exit 1
}
Write-Host "Все $totalRuns прогонов полностью PASSED." -ForegroundColor Green
exit 0
