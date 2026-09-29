# Links this repo into the per-user CEP extensions folder so After Effects loads the
# working copy directly:
#     %APPDATA%\Adobe\CEP\extensions\RFX  ->  <repo root>   (directory junction)
# Safe to re-run. It never deletes or modifies anything else in that folder.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-link.ps1

$ErrorActionPreference = 'Stop'

$source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$extDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$link   = Join-Path $extDir 'RFX'

function Normalize([string]$p) {
    if (-not $p) { return '' }
    # strip the \\?\ or \??\ prefix some APIs report on junction targets
    return ($p -replace '^(\\\\\?\\|\\\?\?\\)', '').TrimEnd('\')
}

Write-Host "Repo:     $source"
Write-Host "Junction: $link"

try {
    if (-not (Test-Path -LiteralPath (Join-Path $source 'CSXS\manifest.xml'))) {
        throw "No CSXS\manifest.xml under $source - run this script from the repo's scripts folder."
    }

    if (-not (Test-Path -LiteralPath $extDir)) {
        New-Item -ItemType Directory -Path $extDir -Force | Out-Null
        Write-Host "Created   $extDir"
    }

    $existing = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
    if ($existing) {
        $target = Normalize ([string]($existing.Target | Select-Object -First 1))
        if ($existing.LinkType -eq 'Junction' -and $target -ieq $source) {
            Write-Host "OK: junction already exists and points to the repo. Nothing to do." -ForegroundColor Green
            exit 0
        }
        if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if (-not $target) { $target = '(unreadable or broken target)' }
            throw ("$link already exists as a link to $target, not to this repo. Not touching it.`n" +
                   "        To replace it, remove only the link (no /s, the target is left alone):`n" +
                   "            cmd /c rmdir `"$link`"`n" +
                   "        then re-run this script.")
        }
        throw "$link already exists as a real folder/file. Not touching it. Rename or remove it yourself, then re-run."
    }

    New-Item -ItemType Junction -Path $link -Target $source | Out-Null

    $check = Get-Item -LiteralPath $link -Force
    if ($check.LinkType -ne 'Junction' -or -not (Test-Path -LiteralPath (Join-Path $link 'CSXS\manifest.xml'))) {
        throw "Junction was created but does not resolve to the repo."
    }
    Write-Host "OK: created junction $link -> $source" -ForegroundColor Green
    Write-Host "Restart After Effects, then open Window > Extensions > RFX."
    exit 0
}
catch {
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
