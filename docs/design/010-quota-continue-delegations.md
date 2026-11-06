# Quota-blocked delegations

A quota-blocked delegation remains queued with its reason and available reset information. Automatic continuation uses the host scheduler and runtime admission state. A user pause or stop remains effective until explicitly released. A retry is not reported as delivered until the host confirms delivery; unknown quota reset times remain distinguishable from measured reset times.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
