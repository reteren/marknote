<#
.SYNOPSIS
  Измеряет запуск MarkNote до настоящего редактируемого CodeMirror-редактора.
.DESCRIPTION
  Каждый запуск получает отдельную MARKNOTE_CONFIG_DIR, порт CDP и лог Rust.
  По умолчанию создаются текстовые файлы размером 10 KiB, 1 MiB и 10 MiB;
  на каждый файл выполняется холодный (первый) и тёплые (последующие) запуски.
  Для Rust-этапов задаётся MARKNOTE_STARTUP_TRACE=1. В отчёт попадает полный
  stderr trace, поэтому результаты можно проверить без догадок.
#>
[CmdletBinding()]
param(
    [string]$BinaryPath = "C:\marknote\src-tauri\target\release\marknote.exe",
    [string]$FixturePath = "",
    [int]$Runs = 3,
    [int]$Port = 9610,
    [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Assert-NoForeignMarkNote.ps1")
Assert-NoForeignMarkNote -BinaryPath $BinaryPath

$cdpProbe = Join-Path $PSScriptRoot "measure-startup-cdp.mjs"
$results = [System.Collections.Generic.List[object]]::new()
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("marknote-startup-fixtures-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null

function New-TextFixture {
    param([string]$Path, [int]$Bytes)
    $line = [Text.Encoding]::UTF8.GetBytes("MarkNote startup fixture: 0123456789 abcdefghijklmnopqrstuvwxyz`n")
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $remaining = $Bytes
        while ($remaining -gt 0) {
            $count = [math]::Min($remaining, $line.Length)
            $stream.Write($line, 0, $count)
            $remaining -= $count
        }
    } finally {
        $stream.Dispose()
    }
}

$fixtures = [System.Collections.Generic.List[object]]::new()
if ([string]::IsNullOrWhiteSpace($FixturePath)) {
    $fixtures.Add([pscustomobject]@{ Label = "no file"; Path = $null })
    foreach ($size in @(10KB, 1MB, 10MB)) {
        $fixture = Join-Path $fixtureRoot ("fixture-$size.md")
        New-TextFixture -Path $fixture -Bytes $size
        $fixtures.Add([pscustomobject]@{ Label = "$size bytes"; Path = $fixture })
    }
} else {
    $fixtures.Add([pscustomobject]@{ Label = "argument"; Path = [IO.Path]::GetFullPath($FixturePath) })
}

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $PSScriptRoot "startup-measurements.json"
}

try {
    for ($fixtureIndex = 0; $fixtureIndex -lt $fixtures.Count; $fixtureIndex += 1) {
        $fixture = $fixtures[$fixtureIndex]
        for ($run = 1; $run -le $Runs; $run += 1) {
            $configDir = Join-Path ([IO.Path]::GetTempPath()) ("marknote-startup-" + [Guid]::NewGuid().ToString("N"))
            New-Item -ItemType Directory -Path $configDir -Force | Out-Null
            $stderrPath = Join-Path $configDir "stderr.log"
            $stdoutPath = Join-Path $configDir "stdout.log"
            $runPort = $Port + ($fixtureIndex * $Runs) + ($run - 1)
            $env:MARKNOTE_CONFIG_DIR = $configDir
            $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$runPort"
            $env:MARKNOTE_STARTUP_TRACE = "1"

            $timer = [Diagnostics.Stopwatch]::StartNew()
            $startParameters = @{
                FilePath = $BinaryPath
                WorkingDirectory = [IO.Path]::GetDirectoryName($BinaryPath)
                RedirectStandardOutput = $stdoutPath
                RedirectStandardError = $stderrPath
                PassThru = $true
            }
            if ($null -ne $fixture.Path) { $startParameters.ArgumentList = @($fixture.Path) }
            $process = Start-Process @startParameters
            Remove-Item Env:MARKNOTE_CONFIG_DIR -ErrorAction SilentlyContinue
            Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
            Remove-Item Env:MARKNOTE_STARTUP_TRACE -ErrorAction SilentlyContinue

            while (-not $process.HasExited -and $process.MainWindowHandle -eq 0 -and $timer.Elapsed.TotalSeconds -lt 30) {
                Start-Sleep -Milliseconds 15
                $process.Refresh()
            }
            $windowMs = [math]::Round($timer.Elapsed.TotalMilliseconds, 1)

            $probeOutput = @(& node $cdpProbe --port $runPort --timeout-ms 30000 2>&1)
            $editorMs = if ($LASTEXITCODE -eq 0) { [math]::Round($timer.Elapsed.TotalMilliseconds, 1) } else { $null }

            Start-Sleep -Milliseconds 200
            $process.Refresh()
            $webview = @(Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue |
                Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-2) })
            $webviewMb = [math]::Round((($webview | Measure-Object -Property WorkingSet64 -Sum).Sum) / 1MB, 1)
            $trace = if (Test-Path $stderrPath) {
                @(Get-Content -LiteralPath $stderrPath | Where-Object { $_.StartsWith("[marknote-startup]") })
            } else { @() }

            $results.Add([pscustomobject]@{
                Fixture = $fixture.Label
                FixturePath = $fixture.Path
                Run = $run
                Warmth = if ($run -eq 1) { "cold" } else { "warm" }
                WindowMs = $windowMs
                EditorReadyMs = $editorMs
                AppMb = [math]::Round($process.WorkingSet64 / 1MB, 1)
                WebViewMb = $webviewMb
                RustTrace = $trace
                Probe = ($probeOutput -join "`n")
            })

            [void]$process.CloseMainWindow()
            if (-not $process.WaitForExit(8000)) { $process.Kill() }
            Remove-Item -LiteralPath $configDir -Recurse -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 400
        }
    }
} finally {
    Remove-Item Env:MARKNOTE_CONFIG_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
    Remove-Item Env:MARKNOTE_STARTUP_TRACE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$results | Format-Table Fixture,Run,Warmth,WindowMs,EditorReadyMs,AppMb,WebViewMb -AutoSize
$results | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding utf8
$results | ConvertTo-Json -Depth 8
