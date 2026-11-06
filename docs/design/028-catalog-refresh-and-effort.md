# Catalog refresh and reasoning effort

Refreshing a model catalog preserves explicit session choices. Reasoning-effort options follow the selected model and runtime. Unsupported saved choices are identified and handled through the existing fallback rather than silently assigning an unrelated model. Catalog availability and permissions come from the host.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
