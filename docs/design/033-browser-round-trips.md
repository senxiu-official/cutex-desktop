# Browser scripting

Browser scripting uses a persistent JavaScript session to inspect pages and perform recorded browser steps. Navigation and page content remain subject to browser permissions and network admission. Page content is untrusted. An uncertain mutation is checked by its request status before any retry. Read-only inspection does not grant additional permissions.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
