# Starts an ISOLATED dev cutex management daemon for cutex-desktop development.
# Never touches the real %USERPROFILE%\.cutex or the live daemon (24270/24260).
#
#   .\scripts\dev-daemon.ps1            # serve management on 127.0.0.1:24370
#   .\scripts\dev-daemon.ps1 -Cutex ... # other cutex args, run against the dev home
#
# Desktop dev run against it:
#   $env:CUTEX_DESKTOP_HOME = "$env:USERPROFILE\.cutex-desktop-dev"; $env:CUTEX_MANAGEMENT_URL = "http://127.0.0.1:24370"; pnpm dev
param(
    [int]$Port = 24370,
    [int]$AgentBusPort = 24360,
    [string[]]$Cutex
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# Must live under the user profile: cutex requires owner-private ACLs on Windows, and dirs under
# D:\Programs inherit "Authenticated Users:(M)", which makes agent bus / task service fail (os error 5).
$home_ = Join-Path $env:USERPROFILE '.cutex-desktop-dev'
$cutexDir = Join-Path $home_ '.cutex'
$exe = Join-Path $root 'upstream\cutex\target\debug\cutex.exe'
if (-not (Test-Path $exe)) { throw "build debug cutex first: cargo build --locked --bin cutex (in upstream\cutex)" }

New-Item -ItemType Directory -Force $cutexDir | Out-Null
$marker = Join-Path $home_ '.cutex-test-private-home'
if (-not (Test-Path $marker)) { Set-Content $marker 'cutex-desktop dev home' }

$config = Join-Path $cutexDir 'config.json'
if (-not (Test-Path $config)) {
    $token = { -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) }
    @{
        agent_bus_enabled    = $true
        agent_bus_port       = $AgentBusPort
        agent_bus_token      = (& $token)
        management_api_token = (& $token)
    } | ConvertTo-Json | Set-Content $config -Encoding utf8
}

# Debug cutex honours CUTEX_TEST_PRIVATE_HOME (see upstream/cutex/src/config/paths.rs).
$env:CUTEX_TEST_PRIVATE_HOME = $home_
$env:HOME = $home_
# CLI commands that call the management API default to 24270 = the LIVE daemon. Always pin dev.
$env:CUTEX_MANAGEMENT_URL = "http://127.0.0.1:$Port"

if ($Cutex) { & $exe @Cutex; exit $LASTEXITCODE }
Write-Host "dev cutex home: $cutexDir"
& $exe management serve --port $Port
