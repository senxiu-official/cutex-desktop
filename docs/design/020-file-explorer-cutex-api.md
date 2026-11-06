# File explorer API boundaries

File listing, reads, diffs, search and supported mutations use the host Management API. Requests carry a workspace scope and normalized path. The host enforces containment, permissions and symlink rules. The renderer does not read local files directly as a fallback. API availability is discovered through host capabilities; unsupported operations remain unavailable.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
