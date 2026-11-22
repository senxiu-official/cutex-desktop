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

// A list read replaces the host's cache with cutex's answer, but an event or an update answer that arrived while it was
// on the way is newer than (or as new as) that answer: it is applied again on top (by revision; a delete stays
// deleted). Only the latest read of a host writes; `fresh` starts a new one even when one is on the way (after a 409,
// the one on the way may have been sent before the change).
let tick = 0;
// Deleted pins, per host, by id (cutex never reuses an id, and a delete event carries no revision): a PATCH answer or a
// list answer that left cutex before the delete (PATCH commits → delete event → PATCH answer) never brings one back.
// Bounded: kept TOMBSTONE_MS (a late answer arrives well within it) and at most TOMBSTONE_MAX per host, oldest dropped.
const TOMBSTONE_MS = 10 * 60_000;
const TOMBSTONE_MAX = 1000;
const deleted = new Map<string, Map<string, number>>();
function isDeleted(hostId: string, pinId: string): boolean {
  const at = deleted.get(hostId)?.get(pinId);
  return at !== undefined && Date.now() - at < TOMBSTONE_MS;
}
function bury(hostId: string, pinId: string): void {
  const ids = deleted.get(hostId) ?? new Map<string, number>();
  const now = Date.now();
  ids.delete(pinId);
  ids.set(pinId, now);
  // Insertion order is age order: drop expired entries, then the oldest beyond the cap.
  for (const [id, at] of ids) if (now - at >= TOMBSTONE_MS || ids.size > TOMBSTONE_MAX) ids.delete(id); else break;
  deleted.set(hostId, ids);
}
const alive = (hostId: string) => (p: OwnerPin) => !isDeleted(hostId, p.pinId);
const loads = new Map<string, { seq: number; promise: Promise<void> }>();
const during = new Map<string, { at: number; pinId: string; pin: OwnerPin | null }[]>();
export function loadPins(hostId: string, opts: { fresh?: boolean } = {}): Promise<void> {
  const running = loads.get(hostId);
  if (running && !opts.fresh) return running.promise;
  const seq = ++tick;
  if (!during.has(hostId)) during.set(hostId, []);
  const latest = () => loads.get(hostId)?.seq === seq;
  const promise = Promise.resolve().then(async () => {
    try {
      const list = await services.daemonFor(hostId).ownerPins({ state: "all" });
      if (!latest()) return;
      let pins = (list?.pins ?? []).filter(alive(hostId));
      for (const c of during.get(hostId) ?? []) if (c.at > seq) pins = withPin(pins, c.pinId, c.pin);
      usePins.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { pins, loaded: true, error: null } } }));
    } catch (e) {
      if (latest()) usePins.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { pins: s.byHost[hostId]?.pins ?? [], loaded: true, error: errorText(e) } } }));
    } finally {
      if (latest()) { loads.delete(hostId); during.delete(hostId); }
    }
  });
  loads.set(hostId, { seq, promise });
  return promise;
}

/** Test hook: the number of tombstones kept for a host. */
export const tombstoneCount = (hostId: string): number => deleted.get(hostId)?.size ?? 0;

function patch(hostId: string, pinId: string, pin: OwnerPin | null) {
  if (pin && isDeleted(hostId, pinId)) return;
  if (!pin) bury(hostId, pinId);
  during.get(hostId)?.push({ at: ++tick, pinId, pin });
  usePins.setState((s) => {
    const entry = s.byHost[hostId];
    if (!entry) return s;
    return { byHost: { ...s.byHost, [hostId]: { ...entry, pins: withPin(entry.pins, pinId, pin) } } };
  });
}

/** The pin as this host's cache holds it now (the detail view and the actions read it here). */
export function pinOf(hostId: string, pinId: string): OwnerPin | null {
  return usePins.getState().byHost[hostId]?.pins.find((p) => p.pinId === pinId) ?? null;
}

/** The owner's 完成 / 不用了 / 重新钉上 / 删除. A state change carries the revision the owner saw: a pin that changed
 *  since (cutex 409) is not overwritten; the list is read again and the owner sees the new state. */
export async function changePin(hostId: string, pinId: string, change: OwnerPinChange): Promise<void> {
  const seen = "state" in change && change.expectedRevision === undefined ? pinOf(hostId, pinId)?.revision : undefined;
  const sent: OwnerPinChange = "state" in change && seen !== undefined ? { ...change, expectedRevision: seen } : change;
  try {
    const r = await services.daemonFor(hostId).ownerPinUpdate(pinId, sent);
    if (r.ok) patch(hostId, pinId, r.pin);
    else {
      void loadPins(hostId, { fresh: true });
      const conflict = r.error.code === "pin_revision_conflict";
      services.ui.notice(conflict ? translate("bookmarks.memo.conflict", { board: translate("bookmarks.memo.title") }) : translate("bookmarks.memo.failed", { error: r.error.message, board: translate("bookmarks.memo.title") }), conflict ? "info" : "error");
    }
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
    deleted.clear();
  }, { once: true });
}
