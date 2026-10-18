// An agent avatar's look from its id alone (components/Avatar `seed`): which host and Profile it runs
// on — hence its Profile colour and 头像主题 (lib/avatarThemes) — and whether it counts as important
// for 默认头像 = 仅重要智能体 (lib/avatarDefault: Director, pinned, own avatar). Read from the sidebar
// snapshots the store already holds (focus host + other connected hosts), indexed once per snapshot
// set, plus the Profile lists (lib/profileLooks). An id the app does not know (not loaded yet, another
// host not followed) → null: callers keep the colour they were given / the hash colour and the full set.
import type { HostSessionRow, SessionAvatar, SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { pinnedOn, useApp } from "../store";
import { isMinorAgent } from "./avatarDefault";
import { avatarThemesOf, type AvatarThemeId } from "./avatarThemes";
import { avatarThemesOverride, useUiPrefs } from "./prefs";
import { profileLookOf, useProfileLooksVersion, type ProfileLook } from "./profileLooks";
import { profileColor } from "./profileLook";

interface Entry {
  hostId: string;
  session: SessionResource;
  row: HostSessionRow | undefined;
  isDirector: boolean;
  pinned: boolean;
}

type Index = Map<string, Entry>;

function addSnapshot(index: Index, hostId: string, snapshot: SidebarSnapshot | null, pins: ReadonlySet<string>): void {
  if (!snapshot) return;
  const directors = new Set((snapshot.projects?.projects ?? []).map((p) => p.director_cutex_session_id).filter((id): id is string => !!id));
  for (const session of [...snapshot.active, ...snapshot.retired]) {
    const id = session.cutexSessionId;
    if (index.has(id)) continue;
    index.set(id, { hostId, session, row: snapshot.hostRows[id], isDirector: directors.has(id), pinned: pins.has(id) });
  }
}

let memo: { sidebar: unknown; byHost: unknown; pinned: unknown; focus: string; index: Index } | null = null;

type IndexSource = { sidebar: SidebarSnapshot | null; byHost: Record<string, { sidebar: SidebarSnapshot | null }>; pinned: ReadonlySet<string>; hosts: { active?: string } | null };

/** seed → entry over every snapshot the store holds (the focus host first). */
export function agentIndex(s: IndexSource): Index {
  const focus = s.hosts?.active ?? "local";
  if (memo && memo.sidebar === s.sidebar && memo.byHost === s.byHost && memo.pinned === s.pinned && memo.focus === focus) return memo.index;
  const index: Index = new Map();
  addSnapshot(index, focus, s.sidebar, s.pinned);
  for (const [hostId, slice] of Object.entries(s.byHost)) if (hostId !== focus) addSnapshot(index, hostId, slice.sidebar, pinnedOn(hostId));
  memo = { sidebar: s.sidebar, byHost: s.byHost, pinned: s.pinned, focus, index };
  return index;
}

/** The Profile an agent runs on (as the sidebar names it: launched, else configured). */
export const sessionProfileName = (session: SessionResource): string | null => session.launchedProfile ?? session.configuredProfile ?? session.profile ?? null;

/** Model / runtime of an agent whose Profile is not in a loaded list: what the session itself says. */
function sessionModelFacts(session: SessionResource): { model: string | null; cliKind: string | null } {
  const claude = !!session.runtime?.claudeRuntime || /claude/i.test(String(session.runtime?.backend ?? "")) || /claude/i.test(session.native?.schema?.protocol ?? "");
  const defaults = session.runtimeDefaults as { model?: unknown } | null;
  const model = session.effectiveNextLaunch?.model ?? (typeof defaults?.model === "string" ? defaults.model : null);
  return { model: model ?? null, cliKind: claude ? "claude" : null };
}

export interface AgentLook {
  /** Profile colour (its own / cutex's effective, else the Profile name's hash); null = Profile unknown. */
  color: string | null;
  /** The Profile's 头像主题 (lib/avatarThemes themedEmoji picks from their union). */
  themes: AvatarThemeId[];
  isDirector: boolean;
  pinned: boolean;
}

/** Pure: the look of an indexed agent, given its Profile (null = not in a loaded list) and the owner's theme choice. */
export function lookOf(entry: Entry, profile: ProfileLook | null, override: readonly AvatarThemeId[] | null): AgentLook {
  const style = entry.row?.profileStyle as { color?: unknown } | null | undefined;
  const styled = typeof style?.color === "string" ? style.color : null;
  const color = styled ?? (profile ? profileColor(profile) : null);
  const facts = profile ? { model: profile.model, cliKind: profile.cliKind } : sessionModelFacts(entry.session);
  return {
    color,
    themes: avatarThemesOf(facts, override),
    isDirector: entry.isDirector,
    pinned: entry.pinned,
  };
}

/** The look of agent `seed` (its cutexSessionId), or null when the app does not hold it. */
export function useAgentLook(seed: string | null | undefined): AgentLook | null {
  const entry = useApp((s) => (seed ? (agentIndex(s).get(seed) ?? null) : null));
  useProfileLooksVersion();
  useUiPrefs(); // theme overrides
  if (!entry) return null;
  const profile = profileLookOf(entry.hostId, sessionProfileName(entry.session));
  const override = profile ? avatarThemesOverride(entry.hostId, profile.id) : null;
  return lookOf(entry, profile, override);
}

/** Outside React (menus): the 头像主题 agent `seed` draws its default emoji from now (null = unknown agent: the whole set, like Avatar). */
export function agentThemesNow(seed: string): AvatarThemeId[] | null {
  const entry = agentIndex(useApp.getState()).get(seed);
  if (!entry) return null;
  const profile = profileLookOf(entry.hostId, sessionProfileName(entry.session));
  return lookOf(entry, profile, profile ? avatarThemesOverride(entry.hostId, profile.id) : null).themes;
}

/**
 * 默认头像 = 仅重要智能体 in a list row (`minor`: the caller's place allows the dot): whether agent
 * `seed` shows the Profile-coloured dot instead of its avatar. Unknown agents keep the avatar.
 */
export function useMinorDot(seed: string | null | undefined, avatar: SessionAvatar | null | undefined, picture: string | null | undefined, minor: boolean | undefined): boolean {
  const { agentAvatarDefault } = useUiPrefs();
  const look = useAgentLook(minor && agentAvatarDefault === "important" ? seed : null);
  if (!minor || !seed || !look) return false;
  return isMinorAgent(agentAvatarDefault, { isDirector: look.isDirector, pinned: look.pinned, avatar, picture });
}
