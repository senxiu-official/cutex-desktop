# Approval result delivery

An approval result belongs to the request and agent that created it. Supporting runtimes can receive the result at an eligible next step while a turn is busy; otherwise delivery follows the host queue. The desktop displays the host receipt and does not infer execution from an approval alone. Repeated reads do not consume the same approval twice.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
