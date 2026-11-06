# Quota reset credits

Supporting providers can expose available quota-reset credits, their expiry and consumption results. Viewing credits does not consume them. Consumption requires explicit confirmation and an idempotent request; unknown outcomes retain the original request identity. Provider support and account eligibility come from the host. API-key access does not imply subscription reset-credit access.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
