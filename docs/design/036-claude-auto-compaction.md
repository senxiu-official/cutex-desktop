# Claude automatic compaction

Supporting Claude runtimes expose context and automatic-compaction settings. Configuration is scoped to the selected Profile/model and is validated by the host. A setting change does not discard conversation history or replace the agent identity. The runtime reports the effective configuration and any unsupported option.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
