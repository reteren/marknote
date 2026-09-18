# Dot-source before launching MarkNote from a QA script:
#   . (Join-Path $PSScriptRoot "Assert-NoForeignMarkNote.ps1")
#   Assert-NoForeignMarkNote -BinaryPath $BinaryPath
#
# MARKNOTE_CONFIG_DIR keeps settings apart, but single-instance still keys on
# the application identifier. If the owner's installed MarkNote is open, a
# test launch forwards its fixture into the owner's window instead of starting
# a new process. A test run must stop here rather than touch that window.

function Assert-NoForeignMarkNote {
    param([Parameter(Mandatory)][string]$BinaryPath)

    $target = [IO.Path]::GetFullPath($BinaryPath)
    $foreign = @(Get-Process -Name marknote -ErrorAction SilentlyContinue | Where-Object {
        $path = $null
        try { $path = $_.Path } catch { }
        -not [string]::Equals($path, $target, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($foreign.Count -gt 0) {
        $list = ($foreign | ForEach-Object { "pid=$($_.Id) $($_.Path)" }) -join "; "
        throw "Another MarkNote is running ($list). Close it before a QA run: a test launch would be forwarded into that window by single-instance."
    }
}
