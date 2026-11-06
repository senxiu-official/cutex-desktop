# Claude live settings

Supported Claude agents can request model or reasoning-setting changes through host APIs. The runtime determines when a change takes effect and reports failures. Per-model context and compaction settings remain distinct. Existing runtime pins and provider identity are preserved; an active agent is not silently moved to another runtime variant.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
