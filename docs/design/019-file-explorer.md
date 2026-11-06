# File explorer

The file explorer uses daemon APIs for local and remote hosts. Tree navigation, file reads, diffs and mutations retain their host and workspace scope. Preview tabs and pinned tabs have distinct persistence. Paths outside the permitted workspace and unavailable symlink targets are reported rather than accessed through the renderer filesystem. See [File APIs](020-file-explorer-cutex-api.md).

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
