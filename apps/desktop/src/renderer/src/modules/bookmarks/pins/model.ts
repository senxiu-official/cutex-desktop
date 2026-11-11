// 备忘 · 要处理: lists, pure: one row per pin across the hosts in view; open ones by kind (要你定 → 要你做 → 记一下, newest first
// within a kind), resolved ones newest first. Unit-tested.
import type { OwnerPin, OwnerPinKind } from "../../../../../shared/ownerPins";

export const KINDS: readonly OwnerPinKind[] = ["decide", "todo", "note"];
export interface PinRow { hostId: string; pin: OwnerPin }
export interface HostPins { pins: readonly OwnerPin[] }

export const rowKey = (r: PinRow): string => `${r.hostId}\n${r.pin.pinId}`;
const newest = (a: string, b: string) => Date.parse(b) - Date.parse(a);

export function pinRows(byHost: Readonly<Record<string, HostPins>>, agentId?: string | null): PinRow[] {
  const out: PinRow[] = [];
  for (const [hostId, entry] of Object.entries(byHost)) for (const pin of entry.pins) if (!agentId || pin.agentId === agentId) out.push({ hostId, pin });
  return out;
}

export function openByKind(rows: readonly PinRow[]): { kind: OwnerPinKind; rows: PinRow[] }[] {
  return KINDS.map((kind) => ({ kind, rows: rows.filter((r) => r.pin.state === "open" && r.pin.kind === kind).sort((a, b) => newest(a.pin.createdAt, b.pin.createdAt)) })).filter((g) => g.rows.length > 0);
}

export function resolvedRows(rows: readonly PinRow[]): PinRow[] {
  return rows.filter((r) => r.pin.state !== "open").sort((a, b) => newest(a.pin.resolvedAt ?? a.pin.updatedAt, b.pin.resolvedAt ?? b.pin.updatedAt));
}

/** Open pins that ask something of the owner (todo + decide) and open notes. */
export function openCounts(rows: readonly PinRow[]): { action: number; notes: number } {
  let action = 0, notes = 0;
  for (const r of rows) if (r.pin.state === "open") r.pin.kind === "note" ? notes++ : action++;
  return { action, notes };
}

/** A pin replaces the one with its id (an event or an update answer); `null` removes it. */
export function withPin(pins: readonly OwnerPin[], pinId: string, pin: OwnerPin | null): OwnerPin[] {
  const rest = pins.filter((p) => p.pinId !== pinId);
  if (!pin) return rest;
  const old = pins.find((p) => p.pinId === pinId);
  return old && old.revision > pin.revision ? [...pins] : [pin, ...rest];
}
