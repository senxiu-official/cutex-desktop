// 备忘 · 要处理: cache per host, memory only: `GET /v2/owner-pins?state=all` of every connected host with `owner-pins`.
// `cutex/ownerPin/changed` on a host's feed patches the pin it carries; a resync or a newly connected host
// reloads; a slow safety poll covers a missed event. cutex owns the pins; nothing here is stored.
import { create } from "zustand";
import { OWNER_PINS_FEATURE, ownerPinChangeOf, type OwnerPin, type OwnerPinChange } from "../../../../../shared/ownerPins";
import { LOCAL_HOST_ID } from "../../../../../shared/hosts";
import { bridge } from "../../../bridge";
import { translate } from "../../../i18n";
import { featuresOf, useApp } from "../../../store";
import { services } from "../../app";
import type { ModuleContext } from "../../slots";
import { withPin } from "./model";

interface Entry { pins: OwnerPin[]; loaded: boolean; error: string | null }
export const usePins = create<{ byHost: Record<string, Entry> }>(() => ({ byHost: {} }));

const LIMIT = 300;
const POLL_MS = 120_000;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function daemonOf(hostId: string) {
  const s = useApp.getState();
  return hostId === (s.hosts?.active ?? LOCAL_HOST_ID) ? s.daemon : s.byHost[hostId]?.daemon;
}

/** Connected hosts whose cutex has the pins routes. */
function pinHosts(): string[] {
  const s = useApp.getState();
  const ids = (s.hosts?.hosts ?? [{ id: LOCAL_HOST_ID }]).map((h) => h.id);
  return ids.filter((id) => daemonOf(id)?.kind === "connected" && featuresOf(s, id).has(OWNER_PINS_FEATURE));
}

const inflight = new Map<string, Promise<void>>();
export function loadPins(hostId: string): Promise<void> {
  const running = inflight.get(hostId);
  if (running) return running;
  const promise = (async () => {
    try {
      const list = await services.daemonFor(hostId).ownerPins({ state: "all", limit: LIMIT });
      usePins.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { pins: list?.pins ?? [], loaded: true, error: null } } }));
    } catch (e) {
      usePins.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { pins: s.byHost[hostId]?.pins ?? [], loaded: true, error: errorText(e) } } }));
    } finally {
      inflight.delete(hostId);
    }
  })();
  inflight.set(hostId, promise);
  return promise;
}

function patch(hostId: string, pinId: string, pin: OwnerPin | null) {
  usePins.setState((s) => {
    const entry = s.byHost[hostId];
    if (!entry) return s;
    return { byHost: { ...s.byHost, [hostId]: { ...entry, pins: withPin(entry.pins, pinId, pin) } } };
  });
}

/** The owner's 完成 / 不用了 / 重新钉上 / 删除. */
export async function changePin(hostId: string, pinId: string, change: OwnerPinChange): Promise<void> {
  try {
    const r = await services.daemonFor(hostId).ownerPinUpdate(pinId, change);
    if (r.ok) patch(hostId, pinId, r.pin);
    else services.ui.notice(translate("bookmarks.memo.failed", { error: r.error.message, board: translate("bookmarks.memo.title") }), "error");
  } catch (e) {
    services.ui.notice(translate("bookmarks.memo.failed", { error: errorText(e), board: translate("bookmarks.memo.title") }), "error");
  }
}

/** Module activation: load each pin host once it connects, follow its events, poll slowly. */
export function startPinSync(ctx: ModuleContext): void {
  let known = new Set<string>();
  const sync = () => {
    const now = pinHosts();
    for (const id of now) if (!known.has(id)) void loadPins(id);
    const gone = [...known].filter((id) => !now.includes(id));
    if (gone.length) usePins.setState((s) => { const byHost = { ...s.byHost }; for (const id of gone) delete byHost[id]; return { byHost }; });
    known = new Set(now);
  };
  sync();
  const offStore = useApp.subscribe(sync);
  const offEvent = bridge?.on?.("hostEvent", ({ hostId, envelope }) => {
    const change = ownerPinChangeOf(envelope);
    if (change) patch(hostId, change.pinId, change.pin);
  });
  const offResync = bridge?.on?.("hostResync", ({ hostId }) => { if (known.has(hostId)) void loadPins(hostId); });
  const timer = setInterval(() => { if (!document.hidden) for (const id of known) void loadPins(id); }, POLL_MS);
  ctx.signal.addEventListener("abort", () => {
    offStore();
    offEvent?.();
    offResync?.();
    clearInterval(timer);
    usePins.setState({ byHost: {} });
  }, { once: true });
}
