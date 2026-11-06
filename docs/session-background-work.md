# Sidebar background work

Hosts advertising `session-background-work` expose `runtime.backgroundWork` on a
session. `running` is a boolean; optional kind counts and `complete` describe the
observed in-memory inventory. The sidebar shows presence without a numeric badge.
The daemon owns this state, including native child-thread attribution.

The bot appears beside the message in two-line rows, or before the passive tail in
compact rows. It is hidden when the busy ring is present, the runtime/host is
disconnected, the row is unconfirmed, or the capability is absent. A tooltip and
accessible label say that background work is running. Opacity breathes over 2.4 s;
`prefers-reduced-motion: reduce` disables the animation.

Background changes patch one session projection and retain unrelated row identity.
They do not invalidate the sidebar list. Runtime generation and host connection
fences reject old events; an event overlay prevents an older in-flight HTTP reply
from replacing a newer background status. Disconnect/reconnect and subscription
gaps discard the overlay and use the normal bounded sidebar resync.
The first live handshake also resyncs once: a sidebar snapshot may have been read
before the status subscription existed, so a change in that interval has no replay.

The host feed opts into `sessionStatus=true`, independently of text deltas. The
`session_status` SSE name carries a validated Management envelope whose method is
`cutex/session/backgroundWork/changed`. Its observation fields never advance the
durable cursor or Last-Event-ID. `backgroundWork:null` explicitly clears a signal.
The daemon's own `docs/session-background-work.md` defines task attribution and
reconnect inventories. This desktop change adds optional protocol fields and does
not break older clients or Waveline.

For mock review, start `preview:web` on a private loopback port and open
`?backgroundwork&perf=quiet`. The fixture includes busy work, three idle work kinds
and completed work. `scripts/qa-background-work.mjs` drives Playwright CLI and
captures compact/full rows, light/dark themes, reduced motion and an older host
without the capability. Set `PLAYWRIGHT_CLI` to its installed JS entry and
`BACKGROUND_PREVIEW_URL` to the private mock URL. It never contacts a daemon.
