# Generated image history

Supporting runtimes store generated images as attachment references instead of repeating large inline payloads in every history record. Image loading remains authenticated and scoped. Existing inline records stay readable. Storage representation does not by itself change the image content sent to a model or authorize pruning model context.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
