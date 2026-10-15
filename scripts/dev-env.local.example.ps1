# Example machine-specific settings for scripts\dev-env.ps1 (and scripts\install-portable.ps1).
# Copy to scripts\dev-env.local.ps1 (git-ignored) and adjust; dev-env.ps1 dot-sources it.
# Environment variables already set in the shell take precedence over the defaults below.

# A Node 24 install (the directory that contains node.exe).
if (-not $env:CUTEX_DEV_NODE_DIR) { $env:CUTEX_DEV_NODE_DIR = 'C:\Tools\nodejs-24' }

# A Rust toolchain root containing cargo\ and rustup\ (sets CARGO_HOME / RUSTUP_HOME).
if (-not $env:CUTEX_DEV_RUST_DIR) { $env:CUTEX_DEV_RUST_DIR = 'C:\Tools\rust\1.95.0-x86_64-pc-windows-msvc' }

# Base directory of the self-updating portable install (scripts\install-portable.ps1 -Base).
# if (-not $env:CUTEX_DESKTOP_PORTABLE_BASE) { $env:CUTEX_DESKTOP_PORTABLE_BASE = 'C:\Tools\cutex-desktop-app' }
