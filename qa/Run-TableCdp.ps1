<#
.SYNOPSIS
  Launches the debug MarkNote binary for table CDP checks.
.DESCRIPTION
  Uses an isolated MARKNOTE_CONFIG_DIR and refuses to launch when an installed
  or otherwise foreign MarkNote is open. Start 'npm run dev' separately first.
#>
[CmdletBinding()]
param(
    [string]$FixturePath = (Join-Path $PSScriptRoot "fixtures/table-controls.md"),
    [string]$ConfigDir = (Join-Path ([IO.Path]::GetTempPath()) "marknote-table-cdp"),
    [int]$Port = 9445
)

$ErrorActionPreference = "Stop"
$BinaryPath = Join-Path $PSScriptRoot "../src-tauri/target/debug/marknote.exe"
. (Join-Path $PSScriptRoot "Assert-NoForeignMarkNote.ps1")
Assert-NoForeignMarkNote -BinaryPath $BinaryPath

if (-not (Test-Path -LiteralPath $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}
$env:MARKNOTE_CONFIG_DIR = [IO.Path]::GetFullPath($ConfigDir)
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
Start-Process -FilePath $BinaryPath -ArgumentList ([IO.Path]::GetFullPath($FixturePath)) -WorkingDirectory (Split-Path $BinaryPath)
Write-Output "Started $BinaryPath with MARKNOTE_CONFIG_DIR=$($env:MARKNOTE_CONFIG_DIR) and CDP port $Port"
