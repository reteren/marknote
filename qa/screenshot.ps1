<#
.SYNOPSIS
    Снятие снимка окна процесса MarkNote в PNG через System.Drawing и Win32 API.

.DESCRIPTION
    Ищет главное видимое окно процесса marknote по PID (или имени процесса),
    игнорируя служебные и невидимые окна (включая служебное окно плагина single-instance
    размером 16x16 вида 'dev.marknote.app-siw'). Сохраняет снимок окна в PNG.
    Совместим с Windows PowerShell 5.1 и PowerShell 7 (кодировка UTF-8 с BOM).

.PARAMETER ProcessId
    Идентификатор целевого процесса. Если не задан, ищется окно среди запущенных процессов 'marknote'.

.PARAMETER ProcessName
    Имя процесса для поиска, по умолчанию 'marknote'.

.PARAMETER OutputPath
    Путь для сохранения PNG-снимка. По умолчанию 'qa/shots/shot_<PID>_<timestamp>.png'.

.PARAMETER TitleFilter
    Необязательная подстрока в заголовке окна для фильтрации.

.EXAMPLE
    .\qa\screenshot.ps1 -ProcessId 12345 -OutputPath "qa/shots/window.png"

SAFETY NOTE
    This script currently captures an already-running process and does not
    launch MarkNote. If a future capture flow starts the program here, it must
    create a unique temporary directory and set MARKNOTE_CONFIG_DIR before
    Start-Process so the owner's AppData is never used by a test run.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [int]$ProcessId = 0,

    [Parameter(Mandatory = $false)]
    [string]$ProcessName = "marknote",

    [Parameter(Mandatory = $false)]
    [string]$OutputPath,

    [Parameter(Mandatory = $false)]
    [string]$TitleFilter
)

Set-StrictMode -Off

# Загружаем необходимые сборки
Add-Type -AssemblyName System.Drawing

# Компилируем P/Invoke методы user32/gdi32, если еще не добавлены в сессию
if (-not ([System.Management.Automation.PSTypeName]'Win32.ScreenCapturer').Type) {
    $csharpCode = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Win32 {
    public class ScreenCapturer {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlink, uint nFlags);

        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll")]
        public static extern bool BitBlt(IntPtr hObject, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hObjectSource, int nXSrc, int nYSrc, uint dwRop);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
            public int Width { get { return Right - Left; } }
            public int Height { get { return Bottom - Top; } }
        }

        public class WindowItem {
            public IntPtr Handle;
            public uint ProcessId;
            public string Title;
            public int Left;
            public int Top;
            public int Width;
            public int Height;
        }

        public static List<WindowItem> EnumerateWindows(uint targetPid, string titleFilter) {
            var list = new List<WindowItem>();
            EnumWindows((hWnd, lParam) => {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (targetPid != 0 && pid != targetPid) return true;

                if (!IsWindowVisible(hWnd)) return true;

                RECT r;
                if (!GetWindowRect(hWnd, out r)) return true;
                if (r.Width < 100 || r.Height < 100) return true;

                var sb = new StringBuilder(512);
                GetWindowText(hWnd, sb, sb.Capacity);
                string title = sb.ToString();

                // Фильтрация служебных окон single-instance (16x16, dev.marknote.app-siw и т.д.)
                if (title.IndexOf("siw", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    title.IndexOf("single-instance", StringComparison.OrdinalIgnoreCase) >= 0) {
                    return true;
                }

                if (!string.IsNullOrEmpty(titleFilter) &&
                    title.IndexOf(titleFilter, StringComparison.OrdinalIgnoreCase) < 0) {
                    return true;
                }

                list.Add(new WindowItem {
                    Handle = hWnd,
                    ProcessId = pid,
                    Title = title,
                    Left = r.Left,
                    Top = r.Top,
                    Width = r.Width,
                    Height = r.Height
                });

                return true;
            }, IntPtr.Zero);

            return list;
        }
    }
}
"@
    Add-Type -TypeDefinition $csharpCode -Language CSharp
}

# Определяем целевой PID и ищем подходящие окна
$candidates = $null
if ($ProcessId -eq 0) {
    # Сначала проверяем все существующие окна для процессов с именем ProcessName
    $allWins = [Win32.ScreenCapturer]::EnumerateWindows(0, $TitleFilter)
    $filtered = $allWins | Where-Object {
        $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
        $p -and $p.ProcessName -eq $ProcessName -and $_.Width -ge 200 -and $_.Height -ge 200
    }

    if ($filtered) {
        $candidates = @($filtered)
        # Назначаем ProcessId процессу найденного окна
        $targetWin = $candidates | Sort-Object -Property @{ Expression = { -not [string]::IsNullOrWhiteSpace($_.Title) }; Descending = $true }, @{ Expression = { $_.Width * $_.Height }; Descending = $true } | Select-Object -First 1
        $ProcessId = $targetWin.ProcessId
    } else {
        $procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
        if (-not $procs) {
            Write-Error "Процесс '$ProcessName' не найден."
            return $null
        }
        $proc = $procs | Sort-Object -Property @{ Expression = { $_.MainWindowHandle -ne 0 }; Descending = $true }, WorkingSet -Descending | Select-Object -First 1
        $ProcessId = $proc.Id
        $candidates = [Win32.ScreenCapturer]::EnumerateWindows([uint32]$ProcessId, $TitleFilter)
    }
} else {
    $candidates = [Win32.ScreenCapturer]::EnumerateWindows([uint32]$ProcessId, $TitleFilter)
}

if (-not $candidates -or $candidates.Count -eq 0) {
    # Если конкретный PID не дал окон, пробуем поискать среди всех процессов с таким именем
    $allPids = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
    foreach ($p in $allPids) {
        if ($p -ne $ProcessId) {
            $extra = [Win32.ScreenCapturer]::EnumerateWindows([uint32]$p, $TitleFilter)
            if ($extra.Count -gt 0) {
                $candidates = $extra
                $ProcessId = $p
                break
            }
        }
    }
}

if (-not $candidates -or $candidates.Count -eq 0) {
    Write-Warning "Не найдено подходящих окон для PID $ProcessId."
    return $null
}

# Сортируем: сначала с непустым заголовком, затем по площади
$targetWindow = $candidates | Sort-Object -Property @{ Expression = { -not [string]::IsNullOrWhiteSpace($_.Title) }; Descending = $true }, @{ Expression = { $_.Width * $_.Height }; Descending = $true } | Select-Object -First 1

$hwnd = $targetWindow.Handle
$w = $targetWindow.Width
$h = $targetWindow.Height
$title = $targetWindow.Title

if ($w -le 0 -or $h -le 0) {
    Write-Warning "Размеры окна некорректны: ${w}x${h}."
    return $null
}

# Формируем путь для сохранения
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $shotsDir = Join-Path $PSScriptRoot "shots"
    if (-not (Test-Path $shotsDir)) {
        New-Item -ItemType Directory -Path $shotsDir -Force | Out-Null
    }
    $timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss_fff")
    $safeTitle = ($title -replace '[^\w\.-]', '_').Trim('_')
    if ([string]::IsNullOrWhiteSpace($safeTitle)) { $safeTitle = "window" }
    $OutputPath = Join-Path $shotsDir "shot_${ProcessId}_${safeTitle}_${timestamp}.png"
} else {
    $parent = Split-Path -Parent $OutputPath
    if (-not [string]::IsNullOrWhiteSpace($parent) -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

# Делаем окно активным перед захватом
[Win32.ScreenCapturer]::SetForegroundWindow($hwnd) | Out-Null

# Создаем Bitmap и Graphics
$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()

# Пробуем PrintWindow (флаг 2 = PW_RENDERFULLCONTENT)
$captured = [Win32.ScreenCapturer]::PrintWindow($hwnd, $hdc, 2)

if (-not $captured) {
    # Fallback: BitBlt из DC окна
    $srcDc = [Win32.ScreenCapturer]::GetDC($hwnd)
    if ($srcDc -ne [IntPtr]::Zero) {
        $captured = [Win32.ScreenCapturer]::BitBlt($hdc, 0, 0, $w, $h, $srcDc, 0, 0, 0x00CC0020) # SRCCOPY
        [Win32.ScreenCapturer]::ReleaseDC($hwnd, $srcDc) | Out-Null
    }
}

$g.ReleaseHdc($hdc)
$g.Dispose()

# Сохраняем в PNG
$bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$result = [PSCustomObject]@{
    Success      = $captured
    ProcessId    = $ProcessId
    WindowHandle = $hwnd
    WindowTitle  = $title
    Width        = $w
    Height       = $h
    OutputPath   = (Resolve-Path $OutputPath).Path
}

Write-Verbose "Снимок сохранён: $($result.OutputPath) ($($w)x$($h), заголовок: '$title')"
return $result
