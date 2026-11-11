// 备忘 · 要处理 (cutex `owner-pins`): things an agent pinned for the owner with the `owner_pin` tool — something
// the owner should do or decide, or a note worth keeping — kept by cutex until the agent or the owner resolves
// them. Wire shapes of `GET /v2/owner-pins`, `PATCH|DELETE /v2/owner-pins/{id}` and the host event
// `cutex/ownerPin/changed`. cutex validates again; the main process only passes well-formed ids.

import type { CutexRefusal } from "./ipc";

export const OWNER_PINS_FEATURE = "owner-pins";
export const OWNER_PIN_CHANGED_EVENT = "cutex/ownerPin/changed";
export const OWNER_PIN_TOOL = "owner_pin";
export const OWNER_PIN_ID = /^pin-[A-Za-z0-9-]{1,64}$/;

/** todo = the owner should do something; decide = the owner should decide or answer; note = keep for later. */
export type OwnerPinKind = "todo" | "decide" | "note";
/** done = finished; dropped = no longer needed (the agent withdrew it, or the owner set it aside). */
export type OwnerPinState = "open" | "done" | "dropped";

export interface OwnerPinLink {
  /** `cutex:artifact/…`, an absolute file path, or an http(s) URL. */
  target: string;
  label: string | null;
}

export interface OwnerPin {
  pinId: string;
  /** The agent's own handle for it (same key = the same open pin); null when it gave none. */
  key: string | null;
  author: "agent" | "owner";
  agentId: string;
  agentName: string | null;
  kind: OwnerPinKind;
  title: string;
  detail: string | null;
  links: OwnerPinLink[];
  /** Where it was pinned: the agent's turn at the call (jump target). */
  turnId: string | null;
  state: OwnerPinState;
  resolvedBy: "agent" | "owner" | null;
  /** The agent's closing word (owner_pin state done / dropped + note). */
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  revision: number;
}

export interface OwnerPinList {
  hostId: string;
  pins: OwnerPin[];
  /** Open pins on the host (all agents), whatever the filter. */
  openCount: number;
}

export type OwnerPinChange = { state: OwnerPinState } | { delete: true };
export type OwnerPinUpdateResult = { ok: true; pin: OwnerPin | null } | { ok: false; error: CutexRefusal };

const KINDS: readonly string[] = ["todo", "decide", "note"];
const STATES: readonly string[] = ["open", "done", "dropped"];
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const opt = (v: unknown, max: number): string | null => (str(v, max) ? v : null);

/** A pin from the wire, or null when it is malformed (dropped, never repaired). */
export function asOwnerPin(raw: unknown): OwnerPin | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.pinId, 80) || !OWNER_PIN_ID.test(r.pinId) || !str(r.agentId, 200) || !str(r.title, 200) || !str(r.createdAt, 40)) return null;
  if (typeof r.kind !== "string" || !KINDS.includes(r.kind) || typeof r.state !== "string" || !STATES.includes(r.state)) return null;
  const links = Array.isArray(r.links)
    ? r.links.flatMap((l) => (l && typeof l === "object" && str((l as Record<string, unknown>).target, 2000) ? [{ target: (l as { target: string }).target, label: opt((l as Record<string, unknown>).label, 120) }] : [])).slice(0, 5)
    : [];
  return {
    pinId: r.pinId,
    key: opt(r.key, 64),
    author: r.author === "owner" ? "owner" : "agent",
    agentId: r.agentId,
    agentName: opt(r.agentName, 200),
    kind: r.kind as OwnerPinKind,
    title: r.title,
    detail: opt(r.detail, 4000),
    links,
    turnId: opt(r.turnId, 200),
    state: r.state as OwnerPinState,
    resolvedBy: r.resolvedBy === "agent" || r.resolvedBy === "owner" ? r.resolvedBy : null,
    resolution: opt(r.resolution, 1000),
    createdAt: r.createdAt,
    updatedAt: opt(r.updatedAt, 40) ?? r.createdAt,
    resolvedAt: opt(r.resolvedAt, 40),
    revision: typeof r.revision === "number" ? r.revision : 1,
  };
}

/** `cutex/ownerPin/changed` → the pin it carries (a delete carries `{pinId, deleted: true}`). */
export function ownerPinChangeOf(envelope: { cutex?: { method?: string; params?: unknown } | null } | null | undefined): { pin: OwnerPin | null; pinId: string } | null {
  if (envelope?.cutex?.method !== OWNER_PIN_CHANGED_EVENT || !envelope.cutex.params || typeof envelope.cutex.params !== "object") return null;
  const p = envelope.cutex.params as Record<string, unknown>;
  const pin = asOwnerPin(p.pin);
  const pinId = pin?.pinId ?? (str(p.pinId, 80) ? p.pinId : null);
  return pinId ? { pin, pinId } : null;
}
