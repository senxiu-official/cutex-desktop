// What a `[profile: "…"]` reference (lib/profileMentions) shows: the profile's name and avatar, looked up on the host of
// the conversation it is written in (the agent's host, never the focused one). The wire keeps the ID: it stays exact
// across renames and the receiving agent passes it straight to agent_create, which takes a name or an ID.
// Unresolved (another host offline, a deleted profile): a short form of the reference, never a whole UUID.
import { useEffect, useState } from "react";
import type { ProfileItem } from "../../../shared/ipc";
import { cachedProfileList, loadProfileList } from "./profileSnapshot";

/** A chip whose profile is missing reads its host's list again at most this often (many chips, one deleted profile). */
const REREAD_MS = 30_000;
const lastRead = new Map<string, number>();
export function resetMentionProfileReadsForTest(): void { lastRead.clear(); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID → its first 8 characters + …; another over-long reference → its start + …; a short name as it is. */
export function shortProfileRef(ref: string): string {
  if (UUID.test(ref)) return `${ref.slice(0, 8)}…`;
  const chars = [...ref];
  return chars.length > 24 ? `${chars.slice(0, 20).join("")}…` : ref;
}

/** A reference matches a profile by ID first, then by name (agents and owners may write either). */
export function findMentionProfile(profiles: readonly ProfileItem[] | undefined, ref: string): ProfileItem | null {
  if (!profiles) return null;
  return profiles.find(p => p.id === ref) ?? profiles.find(p => p.name === ref) ?? null;
}

/**
 * The profile a chip names, on `hostId` (undefined = the focus host). `settled`: the host's list was read (or failed)
 * at least once since mount, so an unmatched reference is really unknown. One read per chip and reference, deduplicated
 * by profileSnapshot; its result is never a dependency of the effect, so a list that lacks the profile cannot loop.
 */
export function useMentionProfile(hostId: string | null | undefined, ref: string | null): { profile: ProfileItem | null; settled: boolean } {
  const host = hostId ?? undefined;
  const cached = () => (ref ? findMentionProfile(cachedProfileList(host)?.profiles, ref) : null);
  const [state, setState] = useState<{ key: string; profile: ProfileItem | null; settled: boolean }>(() => ({ key: `${host}\n${ref}`, profile: cached(), settled: false }));
  const key = `${host}\n${ref}`;
  const current = state.key === key ? state : { key, profile: cached(), settled: false };
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    const settle = (profile: ProfileItem | null) => { if (alive) setState({ key, profile, settled: true }); };
    const hit = cached();
    const readKey = host ?? "";
    if (hit) { settle(hit); return () => { alive = false; }; }
    if (cachedProfileList(host) && Date.now() - (lastRead.get(readKey) ?? 0) < REREAD_MS) { settle(null); return () => { alive = false; }; }
    lastRead.set(readKey, Date.now());
    try {
      loadProfileList(host).then(list => settle(findMentionProfile(list?.profiles, ref)), () => settle(cached()));
    } catch { settle(cached()); }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { profile: current.profile ?? (ref ? cached() : null), settled: current.settled };
}
