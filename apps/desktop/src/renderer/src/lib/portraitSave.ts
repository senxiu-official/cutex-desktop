// 拟人头像 saved for agents the desktop did not create (owner 2026-10-23, board legacy-save-portrait: save) — quick
// chats, forks, members a Director made, agents from another desktop or from before the themes were enabled. Such
// an agent has no avatar stored and draws a portrait only at draw time (components/Avatar portraitFor), so the
// picture was not synced and two members of a project could wear the same one. The first time this desktop sees
// one drawing a portrait, it stores one through cutex/session/metadata/update (the avatar field only), picked like
// a new agent's (lib/portraitAssign: its family's pool of the enabled themes, skipping pictures worn in its
// project). From then on it is the agent's own avatar, the same on every device.
//
// Never: for emoji or letter style (the default emoji / initial is drawn, not owned: storing it made agents without an
// avatar keep a fixed emoji everywhere — one pinned once, then unpinned; a Director that stepped down; with 默认头像 =
// 表情 every agent, which then wore it on devices set to 仅重要智能体 too — owner 2026-10-25) or when its portrait pool is empty; for an agent with any stored avatar (emoji, icon, colour, picture, portrait);
// for an archived agent; for one drawn as a dot (默认头像 = 仅重要智能体: a portrait there would turn the dot into an
// avatar) or whose host's Profile list is not known yet (its family could still change); on a host without session-metadata.
// Each agent once per device (remembered); the write is fenced by the session's revision, so of two desktops the
// first write wins — the other one's conflict re-reads the agent on the next pass, which then has an avatar.
//
// The first avatar of an agent the 新建 page creates belongs to that page (owner 2026-10-23): it calls
// leaveFirstAvatarToCreator before writing, and no agent younger than YOUNG_MS is touched at all (its creator,
// here or on another device, may still be writing; the create's startup events are moving cutex's store too).
// A lost store CAS or a moved revision is retried briefly while the avatar is still unset (lib/metadataRetry).
import type { AvatarMode, SessionAvatar } from "@cutex-desktop/protocol";
import { featuresOf, useApp } from "../store";
import { agentIndex, lookOf, sessionProfileName } from "./agentLook";
import { isMinorAgent, type AgentAvatarDefault } from "./avatarDefault";
import { isRevisionConflict, isStoreConflict, writeMetadataRetrying } from "./metadataRetry";
import { rereadSession } from "./portraitAssign";
import { loadPortraitPacks, portraitIndexNow, subscribePortraitPacks, type PortraitFamily, type PortraitIndex } from "./portraitPacks";
import { effectiveAvatarStyle, subscribeAvatarStyles, type AvatarStyle } from "./avatarStyle";
import { pickStyleAvatar, styleAvatarKey } from "./avatarStyleAssign";
import { avatarThemesOverride, getUiPrefs, subscribeUiPrefs } from "./prefs";
import { onProfileLooksNoted, profileLookOf, profileLooksKnown } from "./profileLooks";

export interface SaveCandidate {
  seed: string;
  hostId: string;
  projectId: string | null;
  profileId?: string | null;
  /** The family it draws a portrait for; null = not known yet (its host's Profile list not loaded). */
  family: PortraitFamily | null;
  avatar: SessionAvatar | null;
  avatarMode?: AvatarMode;
  active: boolean;
  /** Drawn as a dot (仅重要智能体), not as an avatar. */
  minor: boolean;
  /** The host takes cutex/session/metadata/update. */
  writable: boolean;
  revision: number;
  /** When cutex created it (ms; null = unknown, treated as old). */
  createdAt: number | null;
}

/** An agent this young is left to its creator (the 新建 page writes its first avatar right after the create). */
export const YOUNG_MS = 60_000;
const isYoung = (a: Pick<SaveCandidate, "createdAt">, now: number) => a.createdAt !== null && now - a.createdAt < YOUNG_MS;

export interface PortraitSave {
  seed: string;
  hostId: string;
  revision: number;
  avatar: SessionAvatar;
  /** Present in style plans; reject a stale pick if its Profile/style/family changes before writing. */
  context?: { styleKey: string; profileId: string | null; family: PortraitFamily };
}

const projectOf = (a: Pick<SaveCandidate, "hostId" | "projectId" | "seed">) => JSON.stringify([a.hostId, a.projectId, a.projectId === null ? a.seed : null]);
export const saveKey = (a: Pick<SaveCandidate, "hostId" | "seed">) => `${a.hostId}\u0000${a.seed}`;

/**
 * Pure: portraits to store now (creation time then id, so older members reserve first). `done`: agents this device has
 * handled already. A pick skips the pictures worn in the agent's project — stored ones and the ones picked here.
 */
export function planPortraitSaves(index: PortraitIndex, enabled: readonly string[], agents: readonly SaveCandidate[], done: ReadonlySet<string>, now = Date.now()): PortraitSave[] {
  if (!enabled.length) return [];
  return planStyleSaves(index, agents, done, () => ({ kind: "portrait", portraitThemes: [...enabled] }), now);
}

/** First-seen fixed portrait writes (portrait style only: an emoji / letter default stays drawn, never stored).
 * Supply resolve for a pure planner; default resolves Profile→app. */
export function planStyleSaves(index: PortraitIndex, agents: readonly SaveCandidate[], done: ReadonlySet<string>,
  resolve: (agent: SaveCandidate) => AvatarStyle = agent => effectiveAvatarStyle(agent.hostId, agent.profileId ?? null), now = Date.now()): PortraitSave[] {
  const used = new Map<string, Set<string>>();
  const usedIn = (a: SaveCandidate) => {
    let set = used.get(projectOf(a));
    if (!set) used.set(projectOf(a), (set = new Set()));
    return set;
  };
  for (const a of agents) {
    const key = styleAvatarKey(a.avatar);
    if (key) usedIn(a).add(key);
  }
  const out: PortraitSave[] = [];
  for (const a of [...agents].sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0) || x.seed.localeCompare(y.seed) || x.hostId.localeCompare(y.hostId))) {
    if (a.avatarMode != null || a.avatar || !a.active || a.minor || !a.writable || !a.family || isYoung(a, now) || done.has(saveKey(a))) continue;
    const taken = usedIn(a);
    const style = resolve(a);
    if (style.kind !== "portrait") continue;
    const avatar = pickStyleAvatar(style, index, a.family, a.seed, taken);
    const key = styleAvatarKey(avatar);
    if (!avatar || !key) continue;
    taken.add(key);
    out.push({ seed: a.seed, hostId: a.hostId, revision: a.revision, avatar,
      context: { styleKey: JSON.stringify(style), profileId: a.profileId ?? null, family: a.family } });
  }
  return out;
}

/** Every agent the app holds, as the planner sees it. */
export function saveCandidatesNow(mode: AgentAvatarDefault = getUiPrefs().agentAvatarDefault): SaveCandidate[] {
  const state = useApp.getState();
  const out: SaveCandidate[] = [];
  for (const [seed, entry] of agentIndex(state)) {
    const profile = profileLookOf(entry.hostId, sessionProfileName(entry.session));
    const look = lookOf(entry, profile, profile ? avatarThemesOverride(entry.hostId, profile.id) : null);
    const avatar = entry.session.avatar ?? null;
    out.push({
      seed,
      hostId: entry.hostId,
      projectId: entry.row?.projectId ?? null,
      profileId: profile?.id ?? null,
      family: profileLooksKnown(entry.hostId) ? look.family : null,
      avatar,
      avatarMode: entry.session.avatarMode ?? null,
      active: entry.session.lifecycle === "active",
      minor: isMinorAgent(mode, { isDirector: entry.isDirector, pinned: entry.pinned, avatar, picture: null }),
      writable: featuresOf(state, entry.hostId).has("session-metadata"),
      revision: entry.session.revision,
      createdAt: entry.session.createdAt ? Date.parse(entry.session.createdAt) || null : null,
    });
  }
  return out;
}

// ── once per agent per device ──────────────────────────────────────────────────────────────────────

const DONE_KEY = "cutex-desktop.portraitSaved";
const DONE_MAX = 5000;
const MAX_CONFLICTS = 3;
/** Eligibility/style moved while a prior write awaited: reconsider next pass,
 * rather than marking an avatar-free agent permanently handled. */
class SaveDeferred extends Error {}

export function loadSaved(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

let doneSet: Set<string> | null = null;
const savedListeners = new Set<() => void>();
const savedChanged = () => { for (const listener of savedListeners) listener(); };
/** This device's handled agents (read once). */
const doneNow = (): Set<string> => (doneSet ??= loadSaved());

/** Read-only first-seen state, shared with prospective render assignments. */
export function styleSaveDoneSnapshot(): ReadonlySet<string> { return doneNow(); }
export function subscribeStyleSaveChanges(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => { savedListeners.delete(listener); };
}

/** The 新建 page writes this agent's first avatar itself: never save one for it here. */
export function leaveFirstAvatarToCreator(hostId: string, seed: string): void {
  remember(doneNow(), saveKey({ hostId, seed }));
}

/** Tests: forget the in-memory set (the stored one stays). */
export function resetPortraitSaveForTest(): void {
  doneSet = null;
  savedChanged();
}

function remember(done: Set<string>, key: string): void {
  const changed = !done.has(key);
  done.add(key);
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done].slice(-DONE_MAX)));
  } catch {
    // Not remembered: the stored avatar keeps it from being picked again anyway.
  }
  if (changed && done === doneSet) savedChanged();
}

/**
 * Stores the planned fixed avatars one by one (a host is not flooded). Success or a refusal (old host, unsupported,
 * gone): remembered, never tried again. A revision conflict (another desktop, or a turn moved the revision): not
 * remembered; the store re-reads the sidebar after every write (sessionAction) and the next pass decides again from
 * what cutex has now (given up after 3 conflicts for one agent, so a busy agent is not chased).
 */
export async function runPortraitSaves(
  saves: readonly PortraitSave[],
  done: Set<string>,
  write: (save: PortraitSave) => Promise<unknown>,
  conflicts: Map<string, number> = new Map(),
): Promise<number> {
  let written = 0;
  for (const save of saves) {
    try {
      await write(save);
      written++;
      remember(done, saveKey(save));
    } catch (error) {
      if (error instanceof SaveDeferred) continue;
      const key = saveKey(save);
      const tries = (conflicts.get(key) ?? 0) + 1;
      conflicts.set(key, tries);
      if (!(isRevisionConflict(error) || isStoreConflict(error)) || tries >= MAX_CONFLICTS) remember(done, key);
    }
  }
  return written;
}

/** Watches all followed hosts and stores fixed portrait/emoji styles as described above. */
export function startPortraitSave(): () => void {
  const done = doneNow();
  const conflicts = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let youngTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let stopped = false;
  const pass = async () => {
    timer = null;
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    const prefs = getUiPrefs();
    running = true;
    try {
      const now = Date.now();
      const candidates = saveCandidatesNow(prefs.agentAvatarDefault);
      const saves = planStyleSaves(portraitIndexNow(), candidates, done, undefined, now);
      await runPortraitSaves(
        saves,
        done,
        (s) =>
          writeMetadataRetrying({
            write: (fresh) => {
              const candidate = saveCandidatesNow().find(agent => agent.seed === s.seed && agent.hostId === s.hostId);
              if (stopped || !candidate || candidate.avatarMode != null || fresh?.avatarMode != null || fresh?.avatar || candidate.avatar || !candidate.active || candidate.minor || !candidate.writable || !candidate.family
                || isYoung(candidate, Date.now()) || (fresh && fresh.lifecycle !== "active")) throw new SaveDeferred();
              if (s.context && (candidate.profileId !== s.context.profileId || candidate.family !== s.context.family
                || JSON.stringify(effectiveAvatarStyle(candidate.hostId, candidate.profileId ?? null)) !== s.context.styleKey)) throw new SaveDeferred();
              // An earlier write or an owner choice can claim a picture while this queue awaits.
              // Re-plan against the current stored project members; never move an existing avatar.
              const next = planStyleSaves(portraitIndexNow(), saveCandidatesNow(), done, undefined, Date.now())
                .find(save => save.seed === s.seed && save.hostId === s.hostId);
              if (!next) throw new SaveDeferred();
              return useApp.getState().sessionAction(s.seed, "cutex/session/metadata/update", { avatar: next.avatar, expectedRevision: fresh?.revision ?? s.revision, ...(featuresOf(useApp.getState(), s.hostId).has("session-avatar-mode") ? { avatarMode: "fixed" } : {}) }, s.hostId);
            },
            reread: () => rereadSession(s.hostId, s.seed),
            before: { avatar: null, avatarMode: null },
            fenced: true,
            changed: () => new Error("avatar set meanwhile"),
          }),
        conflicts,
      );
      // A young agent left to its creator: look again once it is old enough (nothing else may change by then).
      if (!stopped && candidates.some((a) => a.avatarMode == null && !a.avatar && a.active && isYoung(a, now))) {
        youngTimer ??= setTimeout(() => {
          youngTimer = null;
          schedule();
        }, YOUNG_MS);
      }
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };
  // Sidebar snapshots change often (turns, status): at most one pass per 1.5 s.
  const schedule = () => {
    if (stopped) return;
    timer ??= setTimeout(() => void pass(), 1500);
  };
  const onApp = (s: ReturnType<typeof useApp.getState>, p: ReturnType<typeof useApp.getState>) => {
    if (s.sidebar !== p.sidebar || s.byHost !== p.byHost || s.features !== p.features || s.pinned !== p.pinned) schedule();
  };
  void loadPortraitPacks();
  const offs = [useApp.subscribe(onApp), subscribeUiPrefs(schedule), subscribePortraitPacks(schedule), subscribeAvatarStyles(schedule), onProfileLooksNoted(schedule)];
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (youngTimer) clearTimeout(youngTimer);
    timer = youngTimer = null;
    for (const off of offs) off();
  };
}
