# Stop idle agents

Stopping an idle agent shuts down its runtime without deleting its session or history. Work and queued-delivery state remain host-authoritative. Busy, paused, offline and idle states are distinct; a stop action must target the current runtime generation and supported host operation.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
