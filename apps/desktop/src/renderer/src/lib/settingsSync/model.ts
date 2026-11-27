// Settings that follow the person (design 056 §12, owner 2026-11-26): one section of the person's document on the
// memory host per category (`settings-<id>`), each field the last writer's (its time `t`). Pure; the engine is
// lib/settingsSync/engine.ts, the categories lib/settingsSync/categories.ts.

export type SyncValue = string | number | boolean | null | readonly SyncValue[] | { readonly [key: string]: SyncValue };
export type SyncValues = Record<string, SyncValue>;
export interface SyncField { v: SyncValue; t: number }
/** A category's section: field → its value and when it was set. Unknown keys of newer builds survive. */
export interface SyncDoc extends Record<string, unknown> { fields: Record<string, SyncField> }
/** One field set on this device (replayed against the latest document on a conflict). */
export interface SyncOp { key: string; v: SyncValue; t: number }

export const SECTION_PREFIX = "settings-";
export const sectionOf = (category: string): string => `${SECTION_PREFIX}${category}`;
/** Category ids fit the person document's section names (`[a-z][a-z0-9-]{0,31}` with the prefix). */
export const CATEGORY_ID = /^[a-z][a-z0-9-]{0,22}$/;

export const emptySyncDoc = (): SyncDoc => ({ fields: {} });

export function readSyncDoc(raw: Record<string, unknown> | null | undefined): SyncDoc {
  const d: SyncDoc = { ...(raw ?? {}), fields: {} };
  const fields = raw && typeof raw.fields === "object" && raw.fields && !Array.isArray(raw.fields) ? (raw.fields as Record<string, unknown>) : {};
  for (const [key, f] of Object.entries(fields)) {
    if (f && typeof f === "object" && "v" in f && typeof (f as SyncField).t === "number") d.fields[key] = { v: (f as SyncField).v, t: (f as SyncField).t };
  }
  return d;
}

export const sameValue = (a: SyncValue | undefined, b: SyncValue | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Each op wins over the stored field unless that one is newer (last writer per field). */
export function applySyncOps(doc: SyncDoc, ops: readonly SyncOp[]): SyncDoc {
  const fields = { ...doc.fields };
  for (const op of ops) {
    const cur = fields[op.key];
    if (!cur || cur.t <= op.t) fields[op.key] = { v: op.v, t: op.t };
  }
  return { ...doc, fields };
}

export const docValues = (doc: SyncDoc): SyncValues => Object.fromEntries(Object.entries(doc.fields).map(([k, f]) => [k, f.v]));

/** The fields that changed between two reads of this device's values. */
export function changedOps(before: SyncValues, after: SyncValues, t: number): SyncOp[] {
  return Object.keys(after).filter((k) => !sameValue(before[k], after[k])).map((k) => ({ key: k, v: after[k]!, t }));
}

/** Every field of this device's values, as ops (「把本机设置同步上去」). */
export const allOps = (values: SyncValues, t: number): SyncOp[] => Object.entries(values).map(([key, v]) => ({ key, v, t }));

/** The synced fields this device's values differ in (fields the synced side does not have are not a difference). */
export function differingKeys(local: SyncValues, synced: SyncValues): string[] {
  return Object.keys(synced).filter((k) => k in local && !sameValue(local[k], synced[k]));
}

/** The synced values this device should take: those it has a different value for (or lacks). */
export function toApply(local: SyncValues, synced: SyncValues): SyncValues {
  return Object.fromEntries(Object.entries(synced).filter(([k, v]) => !sameValue(local[k], v)));
}
