# First install (or manual reinstall) of a self-updating portable desktop on Windows.
#
#   .\scripts\install-portable.ps1 [-Base <dir>] [-Source <base>\src] [-Channel main|release] [-NoShortcut]
#
# -Base defaults to $env:CUTEX_DESKTOP_PORTABLE_BASE (may be set in the untracked
# scripts\dev-env.local.ps1, see scripts\dev-env.ps1), else the install the existing Start-menu
# shortcut "Cutex" launches (<base>\current\cutex.exe), else %LOCALAPPDATA%\Programs\cutex-desktop-app.
# -Channel writes <base>\channel (main = development, release = stable; Settings > Updates & diagnostics
# can switch later);
# without it an existing <base>\channel is kept and a new install follows main. Same as
# install-portable.sh --channel.
#
# Mirrors what the in-app updater does for later updates (apps/desktop/src/main/updater.ts +
# src/shared/update.ts): in the source checkout (a clean clone of origin/main) run
# `pnpm install --frozen-lockfile`, `pnpm build` (apps/desktop) and
# `node scripts/package-portable.mjs <base>\releases\<short-hash[-N]>`, then point the
# <base>\current junction at the new release. The release records the checkout and this Node in
# resources\app\package.json, so the updater later pulls and rebuilds there by itself.
# Unless -NoShortcut, the Start-menu shortcut "Cutex" is (re)pointed at <base>\current\cutex.exe.
# Then, like the app after an update, every release but the new one and the previous one is moved to
# <base>\old-releases (scripts\archive-releases.mjs; never deleted here; a locked one stays for now).
# WScript.Shell cannot set its AppUserModelID; the app adds it on its next start (and keeps the
# shortcut and taskbar pins of this install in sync, see apps/desktop/src/main/winShortcuts.ts).
# Does not pull: update the checkout first (git -C <Source> pull --ff-only origin <branch>).
param(
    [string]$Base = '',
    [string]$Source = '',
    [ValidateSet('main', 'release')]
    [string]$Channel = '',
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dev-env.ps1')   # Node 24 + corepack pnpm on PATH (+ dev-env.local.ps1)
if ((node --version) -notlike 'v24.*') { throw 'Node 24 required: set CUTEX_DEV_NODE_DIR or scripts\dev-env.local.ps1 (see scripts\dev-env.ps1)' }
$startMenuLnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Cutex.lnk'
if (-not $Base) { $Base = $env:CUTEX_DESKTOP_PORTABLE_BASE }
if (-not $Base -and (Test-Path -LiteralPath $startMenuLnk)) {
    # Reinstall where the current shortcut points: <base>\current\cutex.exe.
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($startMenuLnk).TargetPath
    if ($target -and (Split-Path -Leaf $target) -eq 'cutex.exe' -and (Split-Path -Leaf (Split-Path -Parent $target)) -eq 'current') {
        $Base = Split-Path -Parent (Split-Path -Parent $target)
    }
}
if (-not $Base) { $Base = Join-Path $env:LOCALAPPDATA 'Programs\cutex-desktop-app' }
if (-not $Source) { $Source = Join-Path $Base 'src' }
Write-Host "base $Base | source $Source"

# Paths are passed as single arguments (PowerShell quotes ones with spaces for native programs) and
# read with -LiteralPath (a base under a profile like "John Smith" or a dir with [ ] still works). The
# corepack .cmd shim only ever gets fixed arguments, never a path.
function Invoke-Step([string]$Dir, [string]$Exe, [string[]]$Arguments) {
    Push-Location -LiteralPath $Dir
    try { & $Exe @Arguments; if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') exited $LASTEXITCODE" } }
    finally { Pop-Location }
}

$env:npm_config_update_notifier = 'false'   # no "Update available" banner: packageManager pins pnpm
$dirty = @(git -C $Source status --porcelain --untracked-files=no)
# The lockfile is restored only in the install's own clone <base>\src; in a -Source developer tree an
# edited pnpm-lock.yaml may be the developer's own work (as the in-app updater: isOwnClone).
$fullPath = { param($p) $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($p).TrimEnd('\', '/') }
$ownClone = (& $fullPath $Source) -ieq (& $fullPath (Join-Path $Base 'src'))
if ($ownClone -and $dirty.Count -eq 1 -and $dirty[0] -eq ' M pnpm-lock.yaml') {
    # Only the lockfile an earlier pnpm install rewrote (as the in-app updater: sourceDirtyCheck).
    Write-Host 'restoring pnpm-lock.yaml rewritten by an earlier pnpm install'
    git -C $Source checkout -- pnpm-lock.yaml
    if ($LASTEXITCODE -ne 0) { throw "git checkout -- pnpm-lock.yaml exited $LASTEXITCODE" }
} elseif ($dirty.Count -gt 0) { throw "source checkout has uncommitted changes: $Source`n$($dirty -join "`n")" }
$commit = (git -C $Source rev-parse HEAD).Trim()

# releaseName(): short hash, suffixed -2, -3, ... when taken.
$releases = Join-Path $Base 'releases'
$name = $commit.Substring(0, 7)
for ($i = 2; Test-Path -LiteralPath (Join-Path $releases $name); $i++) { $name = "$($commit.Substring(0, 7))-$i" }
$dest = Join-Path $releases $name

# The package keeps the channel (main stays implicit, as buildSteps does).
$channelFile = Join-Path $Base 'channel'
$effective = $Channel
if (-not $effective -and (Test-Path -LiteralPath $channelFile)) {
    $effective = ((Get-Content -LiteralPath $channelFile -TotalCount 1) -replace '\s', '')
}
$packageArgs = @('scripts/package-portable.mjs', $dest)
if ($effective -and $effective -ne 'main') { $packageArgs += @('--channel', $effective) }

# buildSteps()
Invoke-Step $Source 'corepack' @('pnpm', 'install', '--frozen-lockfile')
Invoke-Step (Join-Path $Source 'apps\desktop') 'corepack' @('pnpm', 'build')
Invoke-Step $Source 'node' $packageArgs
# Never point current at a release without its executable (a half-written package).
if (-not (Test-Path -LiteralPath (Join-Path $dest 'cutex.exe') -PathType Leaf)) { throw "the new release has no cutex.exe: $dest (current unchanged)" }

if ($Channel) { New-Item -ItemType Directory -Force $Base | Out-Null; [IO.File]::WriteAllText($channelFile, "$Channel`n") }   # channelFileContent(): one line, LF

# switchCurrent(): remove the old junction itself (never its target), then create anew.
$current = Join-Path $Base 'current'
$previous = ''
if (Test-Path -LiteralPath $current) {
    $item = Get-Item -LiteralPath $current -Force
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "$current exists and is not a junction" }
    $previous = [string]($item.Target | Select-Object -First 1)
    [IO.Directory]::Delete($current, $false)
}
New-Item -ItemType Junction -Path $current -Target $dest | Out-Null
Write-Host "current -> $dest"

# Old releases out of the way (moved to <base>\old-releases, never deleted here).
$archiveArgs = @((Join-Path $PSScriptRoot 'archive-releases.mjs'), '--base', $Base)
if ($previous) { $archiveArgs += @('--previous', $previous) }
& node @archiveArgs
if ($LASTEXITCODE -ne 0) { Write-Warning 'old releases were not tidied up (the app retries at its next start)' }

if (-not $NoShortcut) {
    $lnk = $startMenuLnk
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $sc.TargetPath = Join-Path $current 'cutex.exe'
    $sc.Arguments = ''
    $sc.WorkingDirectory = $current
    $sc.IconLocation = "$(Join-Path $current 'resources\app\resources\icons\icon.ico'),0"
    $sc.Description = 'Cutex'
    $sc.Save()
    Write-Host "shortcut $lnk -> $($sc.TargetPath)"
}
