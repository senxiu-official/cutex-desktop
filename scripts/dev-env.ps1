# Dot-source this in PowerShell before working on cutex-desktop:
#   . .\scripts\dev-env.ps1
# Puts the project's Node 24 + pnpm (via corepack) and the Rust toolchain on PATH for this shell
# only. The global Node install is left untouched.
#
# Where the toolchains live is machine-specific. Set them, in order of precedence:
#   1. environment variables CUTEX_DEV_NODE_DIR (a Node 24 directory containing node.exe) and
#      CUTEX_DEV_RUST_DIR (a toolchain root containing cargo\ and rustup\);
#   2. an untracked scripts\dev-env.local.ps1 (git-ignored; start from dev-env.local.example.ps1),
#      which this script dot-sources first and which may set either variable.
# Unset: Node is whatever `node` is on PATH (with a warning if it is not v24), and the Rust
# toolchain (PATH / CARGO_HOME / RUSTUP_HOME) is left as it is.

$localConfig = Join-Path $PSScriptRoot 'dev-env.local.ps1'
if (Test-Path -LiteralPath $localConfig) { . $localConfig }

$NodeDir = $env:CUTEX_DEV_NODE_DIR
$RustDir = $env:CUTEX_DEV_RUST_DIR

$prefix = @()
if ($NodeDir) { $prefix += $NodeDir }
if ($RustDir) { $prefix += "$RustDir\cargo\bin" }
if ($prefix) { $env:PATH = (($prefix + $env:PATH) -join ';') }
if ($RustDir) {
    $env:CARGO_HOME = "$RustDir\cargo"
    $env:RUSTUP_HOME = "$RustDir\rustup"
}
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'

function pnpm { corepack pnpm @args }

$nodeVersion = node --version
if ($nodeVersion -notlike 'v24.*') { Write-Warning "node $nodeVersion is not Node 24: set CUTEX_DEV_NODE_DIR (see scripts\dev-env.ps1)" }
$cargoVersion = if (Get-Command cargo -ErrorAction SilentlyContinue) { cargo --version } else { 'cargo not on PATH' }
Write-Host "node $nodeVersion | pnpm $(corepack pnpm --version) | $cargoVersion"
