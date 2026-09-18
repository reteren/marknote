[CmdletBinding()]
param(
    [string]$BinaryPath = "C:\marknote\src-tauri\target\debug\marknote.exe",
    [string]$FixturePath = "C:\marknote\fixtures\lf.md"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Assert-NoForeignMarkNote.ps1")
Assert-NoForeignMarkNote -BinaryPath $BinaryPath
$configDir = Join-Path ([IO.Path]::GetTempPath()) ("marknote-config-check-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$settingsJson = '{"editor":{"zoomPercent":123}}'
[IO.File]::WriteAllText(
    (Join-Path $configDir "settings.json"),
    $settingsJson + "`n",
    (New-Object Text.UTF8Encoding($false)))

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MarkNoteConfigProbe {
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
}
'@

$oldConfigDir = $env:MARKNOTE_CONFIG_DIR
$env:MARKNOTE_CONFIG_DIR = $configDir
try {
    $process = Start-Process -FilePath $BinaryPath -ArgumentList ("`"{0}`"" -f $FixturePath) `
        -WorkingDirectory (Split-Path -Parent $BinaryPath) -PassThru
} finally {
    if ($null -eq $oldConfigDir) {
        Remove-Item Env:MARKNOTE_CONFIG_DIR -ErrorAction SilentlyContinue
    } else {
        $env:MARKNOTE_CONFIG_DIR = $oldConfigDir
    }
}

try {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    $app = $null
    while (-not $app -and $deadline.Elapsed.TotalSeconds -lt 20) {
        $app = @(Get-Process -Name marknote -ErrorAction SilentlyContinue |
            Where-Object {
                try {
                    $_.Refresh()
                    $_.MainWindowHandle -ne [IntPtr]::Zero -and
                        $_.MainWindowTitle -notlike "*siw*"
                } catch { $false }
            } | Select-Object -First 1)
        Start-Sleep -Milliseconds 100
    }
    if (-not $app) { throw "MarkNote application window did not appear" }
    $app = $app[0]
    Start-Sleep -Seconds 3

    $timer = [Diagnostics.Stopwatch]::StartNew()
    if (-not [MarkNoteConfigProbe]::PostMessage(
        [IntPtr]$app.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
        throw "WM_CLOSE failed"
    }
    while (-not $app.HasExited -and $timer.Elapsed.TotalSeconds -lt 15) {
        $app.Refresh()
        Start-Sleep -Milliseconds 20
    }
    $timer.Stop()

    $settingsPath = Join-Path $configDir "settings.json"
    $recentPath = Join-Path $configDir "recent-files.json"
    $windowStatePath = Join-Path $configDir ".window-state.json"
    [pscustomobject]@{
        ConfigDir = $configDir
        ProcessId = $app.Id
        CloseElapsedMs = [math]::Round($timer.Elapsed.TotalMilliseconds, 1)
        ProcessExited = $app.HasExited
        SettingsStillPresent = Test-Path -LiteralPath $settingsPath
        SettingsUnchanged = ((Get-Content -Raw -LiteralPath $settingsPath) -eq ($settingsJson + "`n"))
        RecentFilesInOverride = Test-Path -LiteralPath $recentPath
        WindowStateInOverride = Test-Path -LiteralPath $windowStatePath
        OverrideFiles = ((Get-ChildItem -LiteralPath $configDir -File | Select-Object -ExpandProperty Name) -join ",")
    } | ConvertTo-Json -Compress
} finally {
    if (-not $process.HasExited) { $process.Kill() }
    Remove-Item -LiteralPath $configDir -Recurse -Force -ErrorAction SilentlyContinue
}
