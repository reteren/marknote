Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'Win32.MouseSim').Type) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
namespace Win32 {
    public class MouseSim {
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
        public const uint MOUSEEVENTF_MOVE = 0x0001;
        public static void MoveRel(int dx, int dy) {
            mouse_event(MOUSEEVENTF_MOVE, dx, dy, 0, UIntPtr.Zero);
        }
    }
}
"@
    Add-Type -TypeDefinition $csharp
}

$exePath = "C:\marknote\src-tauri\target\release\marknote.exe"
$fixturePath = "C:\marknote\fixtures\table_empty.md"
. (Join-Path $PSScriptRoot "Assert-NoForeignMarkNote.ps1")
Assert-NoForeignMarkNote -BinaryPath $exePath
$configDir = Join-Path ([IO.Path]::GetTempPath()) ("marknote-shots-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $configDir -Force | Out-Null

# Never let a screenshot run read or write the owner's real AppData settings.
# Start-Process inherits this environment variable.
$previousConfigDir = $env:MARKNOTE_CONFIG_DIR
$env:MARKNOTE_CONFIG_DIR = $configDir

Write-Host "Starting marknote..."
try {
    $proc = Start-Process -FilePath $exePath -ArgumentList $fixturePath -PassThru
    Start-Sleep -Seconds 4

# Move mouse to far away corner
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(50, 50)
Start-Sleep -Milliseconds 400

# Take rest screenshot
$resRest = & C:\marknote\qa\screenshot.ps1 -ProcessName "marknote" -TitleFilter "table_empty" -OutputPath "C:\marknote\qa\shots\w119_table_rest.png"
Write-Host "Rest captured: PID=$($resRest.ProcessId), Handle=$($resRest.WindowHandle)"

$winPid = $resRest.ProcessId
$allWins = [Win32.ScreenCapturer]::EnumerateWindows([uint32]$winPid, "table_empty")
$targetWin = $allWins | Where-Object { $_.Width -ge 400 } | Select-Object -First 1

if ($targetWin) {
    Write-Host "Target window: Left=$($targetWin.Left), Top=$($targetWin.Top), W=$($targetWin.Width), H=$($targetWin.Height)"
    [Win32.ScreenCapturer]::SetForegroundWindow($targetWin.Handle)
    Start-Sleep -Milliseconds 300

    # Table is X=145..345, Y=125..194 inside the window
    # Bottom edge is at X=245, Y=190..205
    $hoverX = $targetWin.Left + 245
    $hoverY = $targetWin.Top + 180
    Write-Host "Hovering mouse at ($hoverX, $hoverY)..."
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($hoverX, $hoverY)
    Start-Sleep -Milliseconds 100

    for ($i = 0; $i -lt 12; $i++) {
        [Win32.MouseSim]::MoveRel(0, 2)
        Start-Sleep -Milliseconds 40
    }
    Start-Sleep -Milliseconds 800

    Write-Host "Taking hover screenshot..."
    & C:\marknote\qa\screenshot.ps1 -ProcessId $winPid -TitleFilter "table_empty" -OutputPath "C:\marknote\qa\shots\w119_table_hover.png"
}

    Write-Host "Stopping process..."
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
} finally {
    if ($null -eq $previousConfigDir) {
        Remove-Item Env:MARKNOTE_CONFIG_DIR -ErrorAction SilentlyContinue
    } else {
        $env:MARKNOTE_CONFIG_DIR = $previousConfigDir
    }
    Remove-Item -LiteralPath $configDir -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "Complete."
