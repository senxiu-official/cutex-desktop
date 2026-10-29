// Optimistic session metadata (owner 2026-10-27: 「设置徽章、备注很慢」). A note / badge write used to show nothing until
// cutex/session/metadata/update answered AND the whole sidebar was read again (store.ts sessionAction awaits
// refreshHostSidebar), often a second or more on a remote host. Now the new value is drawn at once: the write's fields
// are held here until it settles and laid over every sidebar snapshot that arrives meanwhile (store.ts preparedSidebar),
// so a refresh that started before the write cannot flash the old value back. The values cutex last reported for
// those fields are kept beside it, so a conflict retry still compares against cutex, not against the held value
// (lib/menus rereadSession, lib/metadataRetry fieldsUnchanged). Settled: dropped (success: the refresh that ended the
// write already shows the value; failure: the caller puts cutex's values back and says why).
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../../../shared/ipc";

type Fields = Record<string, unknown>;

interface Held {
  token: number;
  fields: Fields;
}

/** Per agent (cutexSessionId: unique across hosts), the writes in flight, oldest first. */
const held = new Map<string, Held[]>();
/** Per agent, cutex's own values of the held fields as last seen (before any held write was laid over). */
const server = new Map<string, Fields>();
let next = 0;

/** Holds `fields` over agent `id` until release; `current` is the session as the app has it now (its cutex values). */
export function holdMetadata(id: string, fields: Fields, current: SessionResource | null): number {
  const token = ++next;
  const list = held.get(id) ?? [];
  const seen = server.get(id) ?? {};
  // A field already held keeps the cutex value seen before the first hold.
  for (const key of Object.keys(fields)) if (!(key in seen)) seen[key] = (current as Fields | null)?.[key] ?? null;
  server.set(id, seen);
  held.set(id, [...list, { token, fields }]);
  return token;
}

/** Drops hold `token`; returns cutex's values for the fields no other hold still covers (for a rollback). */
export function releaseMetadata(id: string, token: number): Fields {
  const list = (held.get(id) ?? []).filter((h) => h.token !== token);
  const seen = server.get(id) ?? {};
  if (!list.length) {
    held.delete(id);
    server.delete(id);
    return seen;
  }
  held.set(id, list);
  const still = new Set(list.flatMap((h) => Object.keys(h.fields)));
  const freed: Fields = {};
  for (const [key, value] of Object.entries(seen)) {
    if (still.has(key)) continue;
    freed[key] = value;
    delete seen[key];
  }
  return freed;
}

/** The held fields of agent `id` merged (later writes win), or null. */
export function heldFields(id: string): Fields | null {
  const list = held.get(id);
  return list?.length ? Object.assign({}, ...list.map((h) => h.fields)) : null;
}

/** `session` with the held fields laid over it (a copy; the same object when nothing is held). Records cutex's values. */
export function withHeld<S extends SessionResource>(session: S): S {
  const fields = heldFields(session.cutexSessionId);
  if (!fields) return session;
  const seen = server.get(session.cutexSessionId)!;
  for (const key of Object.keys(fields)) seen[key] = (session as Fields)[key] ?? null;
  return { ...session, ...fields };
}

/** A snapshot from cutex with the held writes laid over (the snapshot itself when none touch it). */
export function snapshotWithHeld(snapshot: SidebarSnapshot): SidebarSnapshot {
  if (!held.size) return snapshot;
  const over = (list: SessionResource[]) => {
    let changed = false;
    const out = list.map((s) => {
      const v = withHeld(s);
      if (v !== s) changed = true;
      return v;
    });
    return changed ? out : list;
  };
  const active = over(snapshot.active);
  const retired = over(snapshot.retired);
  return active === snapshot.active && retired === snapshot.retired ? snapshot : { ...snapshot, active, retired };
}

/** `session` as cutex has it: the held fields back at cutex's last reported values (a conflict retry compares these). */
export function serverView<S extends SessionResource>(session: S): S {
  const fields = heldFields(session.cutexSessionId);
  if (!fields) return session;
  return { ...session, ...server.get(session.cutexSessionId) };
}

/** Tests only. */
export function resetHeldMetadata(): void {
  held.clear();
  server.clear();
}
