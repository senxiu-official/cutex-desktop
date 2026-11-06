// 057: explicit daemon-owned owner/notice joins. A partial snapshot must keep
// the existing standalone row until both ends of the relation are available.
import type { InputRecord } from "@cutex-desktop/protocol";

export interface CarriedInputs {
  byOwner: ReadonlyMap<string, readonly InputRecord[]>;
  inputIds: ReadonlySet<string>;
}

export function carriedInputs(records: ReadonlyMap<string, InputRecord> | undefined, enabled: boolean): CarriedInputs {
  const byOwner = new Map<string, InputRecord[]>();
  const inputIds = new Set<string>();
  if (!enabled || !records) return { byOwner, inputIds };
  for (const owner of records.values()) {
    if (owner.kind !== "owner" || owner.surface !== "timeline" || !owner.turnId || !owner.carries?.length) continue;
    const children: InputRecord[] = [];
    for (const id of owner.carries) {
      const child = records.get(id);
      if (!child || child.kind === "owner" || child.cutexSessionId !== owner.cutexSessionId
        || child.surface !== "timeline" || child.turnId !== owner.turnId
        || child.reason !== "carriedByOwner" || inputIds.has(id)) continue;
      children.push(child);
      inputIds.add(id);
    }
    if (children.length) byOwner.set(owner.inputId, children);
  }
  return { byOwner, inputIds };
}

/** Native bus items can represent several inputs. Never hide an unjoined sibling. */
export function carriedReceivedRow(entry: import("../timeline").TimelineEntry, index: import("./owner").TimelineRecordIndex, carried: ReadonlySet<string>): boolean {
  if (entry.kind !== "received") return false;
  const records = index.byItemId.get(entry.id) ?? (index.byInputId.has(entry.id) ? [index.byInputId.get(entry.id)!] : []);
  return records.length > 0 && records.every(record => carried.has(record.inputId));
}
