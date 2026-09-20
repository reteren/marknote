<#
  Launches one isolated MarkNote process and measures native New window plus
  frontend New tab through real CDP input. This is deliberately separate from
  measure-startup.ps1 because the extra window remains alive until shutdown.
#>
[CmdletBinding()]
param(
    [string]$BinaryPath = "C:\marknote\src-tauri\target\release\marknote.exe",
    [int]$Port = 9670,
    [string]$FilePath = "",
    [int]$FixtureBytes = 0
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Assert-NoForeignMarkNote.ps1")
Assert-NoForeignMarkNote -BinaryPath $BinaryPath

$configDir = Join-Path ([IO.Path]::GetTempPath()) ("marknote-actions-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$stderrPath = Join-Path $configDir "stderr.log"
$stdoutPath = Join-Path $configDir "stdout.log"

if ($FixtureBytes -gt 0) {
    $FilePath = Join-Path $configDir "action-fixture.md"
    $line = [Text.Encoding]::UTF8.GetBytes("MarkNote action fixture: 0123456789 abcdefghijklmnopqrstuvwxyz`n")
    $stream = [IO.File]::Open($FilePath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $remaining = $FixtureBytes
        while ($remaining -gt 0) {
            $count = [math]::Min($remaining, $line.Length)
            $stream.Write($line, 0, $count)
            $remaining -= $count
        }
    } finally {
        $stream.Dispose()
    }
}
try {
    $env:MARKNOTE_CONFIG_DIR = $configDir
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
    $env:MARKNOTE_STARTUP_TRACE = "1"
    $process = Start-Process -FilePath $BinaryPath `
        -WorkingDirectory ([IO.Path]::GetDirectoryName($BinaryPath)) `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
    Remove-Item Env:MARKNOTE_CONFIG_DIR,Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,Env:MARKNOTE_STARTUP_TRACE -ErrorAction SilentlyContinue

    $startup = & node (Join-Path $PSScriptRoot "measure-startup-cdp.mjs") --port $Port --timeout-ms 30000 2>&1
    $actionArguments = @("--port", $Port, "--timeout-ms", 30000)
    if (-not [string]::IsNullOrWhiteSpace($FilePath)) {
        $actionArguments += @("--file", [IO.Path]::GetFullPath($FilePath))
    }
    $actions = & node (Join-Path $PSScriptRoot "measure-actions-cdp.mjs") @actionArguments 2>&1
    $startup
    $actions
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(8000)) { $process.Kill() }
    Write-Output "--- Rust trace"
    if (Test-Path $stderrPath) { Get-Content -LiteralPath $stderrPath | Where-Object { $_.StartsWith("[marknote-startup]") } }
} finally {
    Remove-Item Env:MARKNOTE_CONFIG_DIR,Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,Env:MARKNOTE_STARTUP_TRACE -ErrorAction SilentlyContinue
    if ($null -ne $process -and -not $process.HasExited) { $process.Kill() }
    Remove-Item -LiteralPath $configDir -Recurse -Force -ErrorAction SilentlyContinue
}
