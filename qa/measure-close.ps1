<#$
.SYNOPSIS
    Measures MarkNote process lifetime after a native WM_CLOSE.

.EXAMPLE
    .\qa\measure-close.ps1 -Scenario empty -Runs 3
    .\qa\measure-close.ps1 -Scenario file -Runs 3
    .\qa\measure-close.ps1 -Scenario dirty -Runs 3
#>
[CmdletBinding()]
param(
    [ValidateSet("empty", "file", "dirty")]
    [string]$Scenario = "empty",
    [ValidateRange(1, 20)]
    [int]$Runs = 3,
    [string]$BinaryPath = "",
    [string]$FixturePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BinaryPath)) {
    $BinaryPath = Join-Path $PSScriptRoot "..\src-tauri\target\release\marknote.exe"
}
if ([string]::IsNullOrWhiteSpace($FixturePath)) {
    $FixturePath = Join-Path $PSScriptRoot "..\fixtures\lf.md"
}
. (Join-Path $PSScriptRoot "Assert-NoForeignMarkNote.ps1")
Assert-NoForeignMarkNote -BinaryPath $BinaryPath
$script:ConfigDir = Join-Path ([IO.Path]::GetTempPath()) ("marknote-close-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $script:ConfigDir -Force | Out-Null

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MarkNoteCloseProbe {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Get-EditorElement([IntPtr]$Handle) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
    $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
    return @($all | Where-Object {
        try {
            $current = $_.Current
            $current.ControlType.ProgrammaticName -eq "ControlType.Edit" -and
                $current.ClassName -like "cm-content*" -and
                $current.IsKeyboardFocusable
        } catch { $false }
    } | Select-Object -First 1)
}

function Find-Button([IntPtr]$Handle) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
    $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
    $names = @("Discard", "Не сохранять", "Не сохранять изменения", "Отбросить")
    return @($all | Where-Object {
        try {
            $current = $_.Current
            $current.ControlType.ProgrammaticName -eq "ControlType.Button" -and
                $names -contains [string]$current.Name
        } catch { $false }
    } | Select-Object -First 1)
}

function Invoke-Element($Element) {
    if (-not $Element) { return $false }
    $pattern = $null
    if ($Element.TryGetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        return $true
    }
    return $false
}

function Start-MarkNote {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = [IO.Path]::GetFullPath($BinaryPath)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WorkingDirectory = Split-Path -Parent $info.FileName
    $info.Environment["MARKNOTE_CONFIG_DIR"] = $script:ConfigDir
    if ($Scenario -ne "empty") {
        $info.Arguments = '"' + [IO.Path]::GetFullPath($FixturePath).Replace('"', '\"') + '"'
    }
    [Diagnostics.Process]::Start($info).Dispose()
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        $process = @(Get-Process -Name marknote -ErrorAction SilentlyContinue |
            Where-Object {
                try {
                    $_.Refresh()
                    $_.MainWindowHandle -ne [IntPtr]::Zero -and
                        $_.MainWindowTitle -notlike "*siw*" -and
                        $_.MainWindowTitle -notlike "*single-instance*"
                } catch { $false }
            } | Select-Object -First 1)
        if ($process) { break }
        Start-Sleep -Milliseconds 50
    } while ($deadline.Elapsed.TotalSeconds -lt 20)
    $deadline.Stop()
    if (-not $process) {
        throw "MarkNote application window did not appear"
    }
    return $process[0]
}

function Make-Dirty([Diagnostics.Process]$Process) {
    $handle = $Process.MainWindowHandle
    [MarkNoteCloseProbe]::SetForegroundWindow($handle) | Out-Null
    $editor = Get-EditorElement $handle
    if ($editor) {
        $editor.SetFocus()
    } else {
        $Process.Refresh()
        $rect = $Process.MainWindowHandle
        [MarkNoteCloseProbe]::SetCursorPos(450, 350) | Out-Null
        [MarkNoteCloseProbe]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        [MarkNoteCloseProbe]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    }
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    [System.Windows.Forms.SendKeys]::SendWait("x")
    Start-Sleep -Milliseconds 200
}

$results = @()
for ($run = 1; $run -le $Runs; $run++) {
    $process = Start-MarkNote
    try {
        if ($Scenario -eq "dirty") { Make-Dirty $process }
        $process.Refresh()
        $handle = $process.MainWindowHandle
        $stopwatch = [Diagnostics.Stopwatch]::StartNew()
        if (-not [MarkNoteCloseProbe]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
            throw "WM_CLOSE failed for PID $($process.Id)"
        }
        $promptFound = $false
        $discarded = $false
        $deadline = [Diagnostics.Stopwatch]::StartNew()
        while (-not $process.HasExited -and $deadline.Elapsed.TotalSeconds -lt 15) {
            $process.Refresh()
            if ($Scenario -eq "dirty" -and -not $promptFound -and $deadline.Elapsed.TotalSeconds -gt 0.1) {
                try {
                    $button = Find-Button $handle
                    if ($button) {
                        $promptFound = $true
                        $discarded = Invoke-Element $button
                    }
                } catch { }
            }
            Start-Sleep -Milliseconds 10
        }
        $deadline.Stop()
        $stopwatch.Stop()
        $results += [pscustomobject]@{
            Scenario = $Scenario
            Run = $run
            Pid = $process.Id
            ElapsedMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 1)
            Exited = $process.HasExited
            PromptFound = $promptFound
            Discarded = $discarded
        }
    } finally {
        if (-not $process.HasExited) { $process.Kill() }
        $process.Dispose()
    }
}

$results | Format-Table -AutoSize
$results | ConvertTo-Json -Compress
Remove-Item -LiteralPath $script:ConfigDir -Recurse -Force -ErrorAction SilentlyContinue
