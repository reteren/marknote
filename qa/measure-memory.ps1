<#
.SYNOPSIS
  MarkNote memory: only its own process subtree.
.DESCRIPTION
  Other msedgewebview2 processes are usually running on the machine, from
  the browser and other programs. Counting them by name gives an arbitrary
  number, so the script starts MarkNote, walks the process tree for its own
  descendants and sums their working sets, split by WebView2 process role.
#>
[CmdletBinding()]
param(
    [string]$BinaryPath = "C:\marknote\src-tauri\target\release\marknote.exe",
    [string]$FixturePath = "",
    [int]$SettleSeconds = 6,
    [string]$AdditionalBrowserArgs = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Assert-NoForeignMarkNote.ps1")
Assert-NoForeignMarkNote -BinaryPath $BinaryPath

function Get-ProcessTree {
    param([int]$RootId)
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
    $byParent = @{}
    foreach ($item in $all) {
        if (-not $byParent.ContainsKey([int]$item.ParentProcessId)) { $byParent[[int]$item.ParentProcessId] = @() }
        $byParent[[int]$item.ParentProcessId] += $item
    }
    $result = @()
    $queue = [System.Collections.Queue]::new()
    $queue.Enqueue($RootId)
    while ($queue.Count -gt 0) {
        $id = [int]$queue.Dequeue()
        $self = $all | Where-Object { [int]$_.ProcessId -eq $id } | Select-Object -First 1
        if ($self) { $result += $self }
        foreach ($child in ($byParent[$id] ?? @())) { $queue.Enqueue([int]$child.ProcessId) }
    }
    return $result
}

function Get-WebViewRole {
    param([string]$CommandLine)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return "main" }
    if ($CommandLine -match "--type=([a-zA-Z-]+)") {
        $type = $Matches[1]
        if ($type -eq "utility" -and $CommandLine -match "--utility-sub-type=([^\s]+)") {
            return "${type}:$($Matches[1])"
        }
        return $type
    }
    return "main"
}

$configDir = Join-Path ([IO.Path]::GetTempPath()) ("marknote-memory-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$env:MARKNOTE_CONFIG_DIR = $configDir
if ([string]::IsNullOrWhiteSpace($AdditionalBrowserArgs)) {
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
} else {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $AdditionalBrowserArgs
}
$process = if ([string]::IsNullOrWhiteSpace($FixturePath)) {
    Start-Process -FilePath $BinaryPath -PassThru
} else {
    Start-Process -FilePath $BinaryPath -ArgumentList ([IO.Path]::GetFullPath($FixturePath)) -PassThru
}
Remove-Item Env:MARKNOTE_CONFIG_DIR -ErrorAction SilentlyContinue
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue

Start-Sleep -Seconds $SettleSeconds

$tree = Get-ProcessTree -RootId $process.Id
$rows = foreach ($item in $tree) {
    $handle = Get-Process -Id ([int]$item.ProcessId) -ErrorAction SilentlyContinue
    if (-not $handle) { continue }
    [pscustomobject]@{
        Pid = [int]$item.ProcessId
        Name = $item.Name
        Role = if ($item.Name -like "msedgewebview2*") { Get-WebViewRole -CommandLine $item.CommandLine } else { "-" }
        Mb = [math]::Round($handle.WorkingSet64 / 1MB, 1)
        CommandLine = $item.CommandLine
    }
}

$rows | Sort-Object Mb -Descending | Format-Table -AutoSize
"Subtree total: {0} processes, {1} MB" -f @($rows).Count, [math]::Round((@($rows) | Measure-Object -Property Mb -Sum).Sum, 1)

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $report = [pscustomobject]@{
        generatedAt = [DateTime]::UtcNow.ToString("o")
        binaryPath = [IO.Path]::GetFullPath($BinaryPath)
        fixturePath = if ([string]::IsNullOrWhiteSpace($FixturePath)) { $null } else { [IO.Path]::GetFullPath($FixturePath) }
        additionalBrowserArgs = $AdditionalBrowserArgs
        settleSeconds = $SettleSeconds
        processCount = @($rows).Count
        workingSetMb = [math]::Round((@($rows) | Measure-Object -Property Mb -Sum).Sum, 1)
        processes = @($rows)
    }
    $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

[void]$process.CloseMainWindow()
if (-not $process.WaitForExit(8000)) { $process.Kill() }
Remove-Item -LiteralPath $configDir -Recurse -Force -ErrorAction SilentlyContinue
