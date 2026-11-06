# Desktop widgets

Widgets register through the desktop module contract rather than a second extension engine. Settings, defaults and saved list entries use validated schemas. New optional fields can receive defaults without discarding otherwise valid saved entries. External executable code remains subject to the opaque-frame sandbox contract.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
