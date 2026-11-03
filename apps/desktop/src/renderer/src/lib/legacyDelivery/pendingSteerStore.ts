// LEGACY(input-ledger-v1): frozen delivery inference for older hosts.
// Delete only when EVERY host advertises input-ledger-v1 (including hachimi).
// Pending inserts (steers the native has not read yet, lib/pendingSteers) survive a desktop restart
// (owner 2026-10-21). cutex keeps no record of a steer once it handed it to the native — there is no
// steered-not-yet-read list in the bootstrap / queue and no way to cancel one — so the desktop is the
// only place that still knows about them: kept per (host, agent) in localStorage, restored on load.
// The store then settles them against the agent's re-read timeline (load → settlePendingSteers):
// recorded → gone; their turn ended without them → re-checked and shown as undelivered (resend);
// the turn still runs → waiting, so 打断并发送 re-sends them. Every read / write tolerates storage
// that is missing or throws (nothing is restored then, as before).
import type { PendingSteer } from "./pendingSteers";
import { reportStorageFull } from "../storageFull";

export const PENDING_STEERS_KEY = "cutex-desktop.pendingSteers.v1";
// No age limit (owner 2026-10-23: user data is never deleted on a timer): a list stays until it is settled or the
// agent / its storage is cleaned on the owner's confirmation (「存储」).
/** Agents kept at most (the least recently changed dropped): a size bound, not a timer. */
const MAX_AGENTS = 200;
/** Above this the inline (data URL) images are left out; their text and local paths stay. */
const MAX_BYTES = 1_000_000;

interface StoredList {
  /** When the list last changed (ms). */
  at: number;
  steers: PendingSteer[];
}
type Stored = Record<string, StoredList>;

/** Last written lists (unchanged lists keep their timestamp). */
let written: Record<string, { list: readonly PendingSteer[]; at: number }> = {};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function validSteer(raw: unknown): PendingSteer | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<PendingSteer>;
  if (typeof p.id !== "string" || !p.id || typeof p.text !== "string") return null;
  return {
    id: p.id,
    text: p.text,
    imageCount: typeof p.imageCount === "number" ? p.imageCount : 0,
    turnId: typeof p.turnId === "string" ? p.turnId : null,
    baseline: typeof p.baseline === "number" ? p.baseline : 0,
    ...(typeof p.usersBefore === "number" ? { usersBefore: p.usersBefore } : {}),
    ...(Array.isArray(p.extra) ? { extra: p.extra } : {}),
    ...(p.imageDelivery === "pathText" || p.imageDelivery === "nativeImage" ? { imageDelivery: p.imageDelivery } : {}),
    // A history re-check that was running when the app closed is redone after the load.
    state: p.state === "undelivered" ? "undelivered" : "waiting",
    restored: true,
  };
}

/** Every agent's kept pending inserts (viewKey → list); malformed entries dropped. */
export function loadPendingSteers(): Record<string, PendingSteer[]> {
  const out: Record<string, PendingSteer[]> = {};
  written = {};
  const store = storage();
  if (!store) return out;
  try {
    const raw = store.getItem(PENDING_STEERS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<StoredList> | null;
      if (!v || typeof v.at !== "number" || !Array.isArray(v.steers)) continue;
      const steers = v.steers.map(validSteer).filter((p): p is PendingSteer => p !== null);
      if (!steers.length) continue;
      out[key] = steers;
      written[key] = { list: steers, at: v.at };
    }
  } catch {
    // unreadable: start empty
  }
  return out;
}

const inlineImage = (x: unknown) => (x as { type?: string } | null)?.type === "image";

/** Keep `all` (the store's pendingSteers); empty lists are removed. */
export function savePendingSteers(all: Readonly<Record<string, readonly PendingSteer[]>>, now = Date.now()): void {
  const next: Record<string, { list: readonly PendingSteer[]; at: number }> = {};
  for (const [key, list] of Object.entries(all)) {
    if (!list?.length) continue;
    const before = written[key];
    next[key] = { list, at: before && before.list === list ? before.at : now };
  }
  const keys = Object.keys(next).sort((a, b) => next[b]!.at - next[a]!.at).slice(0, MAX_AGENTS);
  written = Object.fromEntries(keys.map((k) => [k, next[k]!]));
  const store = storage();
  if (!store) return;
  const encode = (strip: boolean) => {
    const out: Stored = {};
    for (const k of keys) {
      const { list, at } = next[k]!;
      out[k] = { at, steers: list.map((p) => (strip && p.extra?.some(inlineImage) ? { ...p, extra: p.extra.filter((x) => !inlineImage(x)) } : p)) };
    }
    return JSON.stringify(out);
  };
  try {
    if (!keys.length) {
      store.removeItem(PENDING_STEERS_KEY);
      return;
    }
    let text = encode(false);
    if (text.length > MAX_BYTES) text = encode(true);
    try {
      store.setItem(PENDING_STEERS_KEY, text);
    } catch {
      store.setItem(PENDING_STEERS_KEY, encode(true));
    }
  } catch {
    // storage full / unavailable: the in-memory list still works for this run — and the owner is told (once).
    reportStorageFull();
  }
}
