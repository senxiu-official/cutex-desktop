// An agent avatar's look from its id alone (components/Avatar `seed`): which host and Profile it runs
// on — hence its Profile colour and 头像主题 (lib/avatarThemes) — and whether it counts as important
// for 默认头像 = 仅重要智能体 (lib/avatarDefault: Director, pinned, own avatar). Read from the sidebar
// snapshots the store already holds (focus host + other connected hosts), indexed once per snapshot
// set, plus the Profile lists (lib/profileLooks). An id the app does not know (not loaded yet, another
// host not followed) → null: callers keep the colour they were given / the hash colour and the full set.
import { useMemo } from "react";
import type { AvatarMode, HostSessionRow, ProjectSummary, SessionAvatar, SessionBadge, SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { portraitKey, portraitRefOf } from "../../../shared/portraitPacks";
import { featuresOf, pinnedOn, useApp } from "../store";
import { distinctMarks } from "./projectMark";
import { isMinorAgent } from "./avatarDefault";
import { avatarThemesOf, modelFamily, type AvatarThemeId, type ModelFamily } from "./avatarThemes";
import { avatarThemesOverride, useUiPrefs } from "./prefs";
import { profileLookOf, useProfileLooksVersion, type ProfileLook } from "./profileLooks";
import { profileColor } from "./profileLook";
import { effectiveAvatarStyle, useAvatarStyleVersion, type AvatarStyle } from "./avatarStyle";

interface Entry {
  hostId: string;
  session: SessionResource;
  row: HostSessionRow | undefined;
  isDirector: boolean;
  isOperator?: boolean;
  pinned: boolean;
  /** The one project this agent directs (null: not a Director, or of several). */
  project?: DirectedProject | null;
}

/** What the project mark (lib/projectMark) is made from. */
export interface DirectedProject {
  hostId: string;
  id: string;
  name: string;
  badge: string;
  color: string;
  /** The mark's text, distinct among the projects the index holds (lib/projectMark distinctMarks). */
  mark: string;
}

type Index = Map<string, Entry>;

function addSnapshot(index: Index, hostId: string, snapshot: SidebarSnapshot | null, pins: ReadonlySet<string>): void {
  if (!snapshot) return;
  const projects = snapshot.projects?.projects ?? [];
  const directors = new Set(projects.map((p) => p.director_cutex_session_id).filter((id): id is string => !!id));
  for (const session of [...snapshot.active, ...snapshot.retired]) {
    const id = session.cutexSessionId;
    if (index.has(id)) continue;
    index.set(id, { hostId, session, row: snapshot.hostRows[id], isDirector: directors.has(id), isOperator: !directors.has(id) && !!snapshot.hostRows[id]?.projectId && snapshot.projectOperators?.[snapshot.hostRows[id]!.projectId!]?.includes(id) === true, pinned: pins.has(id), project: directedProject(projects, hostId, id) });
  }
}

/** The single project `id` directs, or null (not a Director / several projects). */
function directedProject(projects: readonly ProjectSummary[], hostId: string, id: string): DirectedProject | null {
  const mine = projects.filter((p) => p.director_cutex_session_id === id);
  const p = mine.length === 1 ? mine[0]! : null;
  return p ? { hostId, id: p.project_id, name: p.presentation?.display_name || p.project_id, badge: p.presentation?.badge_label ?? "", color: p.presentation?.color ?? "blue", mark: "" } : null;
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
  const projects = [...new Map([...index.values()].flatMap((e) => (e.project ? [[`${e.project.hostId}/${e.project.id}`, e.project] as const] : []))).values()];
  const marks = distinctMarks(projects.map((p) => ({ key: `${p.hostId}/${p.id}`, name: p.name, badge: p.badge })));
  for (const p of projects) p.mark = marks.get(`${p.hostId}/${p.id}`) ?? "";
  memo = { sidebar: s.sidebar, byHost: s.byHost, pinned: s.pinned, focus, index };
  return index;
}

const projectKeyOf = (hostId: string, projectId: string | null | undefined) => `${hostId}\u0000${projectId ?? ""}`;
const NO_PORTRAITS: ReadonlySet<string> = new Set();
let worn: { index: Index; byProject: Map<string, Set<string>> } | null = null;

/**
 * The 拟人头像 pictures (`pack/theme/stem`) stored by the agents of a project (`projectId` null = no project) on a
 * host, over every snapshot the store holds. A new agent's pick skips them — when it is stored (the 新建 page,
 * 显示头像, lib/portraitSave) and when it is only drawn (components/Avatar), so both are the same picture.
 */
export function portraitsWornIn(index: Index, hostId: string, projectId: string | null | undefined): ReadonlySet<string> {
  if (projectId == null) return NO_PORTRAITS;
  if (worn?.index !== index) {
    const byProject = new Map<string, Set<string>>();
    for (const e of index.values()) {
      const ref = portraitRefOf(e.session.avatar);
      if (!ref) continue;
      const k = projectKeyOf(e.hostId, e.row?.projectId);
      let set = byProject.get(k);
      if (!set) byProject.set(k, (set = new Set()));
      set.add(portraitKey(ref));
    }
    worn = { index, byProject };
  }
  return worn.byProject.get(projectKeyOf(hostId, projectId)) ?? NO_PORTRAITS;
}

/**
 * Avatar: the pictures agent `seed`'s pick skips (portraitsWornIn of its project); empty for an agent with an avatar
 * of its own or one the app does not hold. Subscribed as a string, so a sidebar refresh that leaves them alone
 * re-renders nothing.
 */
export function useProjectPortraitsWorn(seed: string | null | undefined, ownAvatar: boolean): ReadonlySet<string> {
  const joined = useApp((s) => {
    if (!seed || ownAvatar) return "";
    const index = agentIndex(s);
    const entry = index.get(seed);
    return entry ? [...portraitsWornIn(index, entry.hostId, entry.row?.projectId)].sort().join("\n") : "";
  });
  return useMemo(() => (joined ? new Set(joined.split("\n")) : NO_PORTRAITS), [joined]);
}

/** Shared portrait/emoji pool for the style rendered before its first fixed save. */
export function useProjectStyleWorn(seed: string | null | undefined, ownAvatar: boolean): ReadonlySet<string> {
  const joined = useApp((s) => {
    if (!seed || ownAvatar) return "";
    const index = agentIndex(s), entry = index.get(seed);
    if (!entry || entry.row?.projectId == null) return "";
    const used = new Set<string>();
    for (const [otherSeed, other] of index) {
      if (otherSeed === seed || other.hostId !== entry.hostId || (other.row?.projectId ?? null) !== (entry.row?.projectId ?? null)) continue;
      const avatar = other.session.avatar, ref = portraitRefOf(avatar);
      if (ref) used.add(portraitKey(ref));
      else if (avatar?.kind === "emoji") used.add(avatar.value);
    }
    return [...used].sort().join("\n");
  });
  return useMemo(() => joined ? new Set(joined.split("\n")) : NO_PORTRAITS, [joined]);
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
  hostId?: string;
  style?: AvatarStyle;
  avatarMode?: AvatarMode;
  fixedLetter?: boolean;
  /** Profile colour (its own / cutex's effective, else the Profile name's hash); null = Profile unknown. */
  color: string | null;
  /** The Profile's 头像主题 (lib/avatarThemes themedEmoji picks from their union). */
  themes: AvatarThemeId[];
  /** The Profile's model family: the provider colour of 头像底色 = 按模型 (components/Avatar). */
  family: ModelFamily;
  isDirector: boolean;
  isOperator?: boolean;
  pinned: boolean;
  project: DirectedProject | null;
  /** The owner's badge on the agent (cutex `badge`; null where its host lacks session-badge): drawn as the avatar's
   *  mark (lib/projectMark avatarMark). */
  badge?: SessionBadge | null;
}

/** Pure: the look of an indexed agent, given its Profile (null = not in a loaded list) and the owner's theme choice. */
export function lookOf(entry: Entry, profile: ProfileLook | null, override: readonly AvatarThemeId[] | null): AgentLook {
  const style = entry.row?.profileStyle as { color?: unknown } | null | undefined;
  const styled = typeof style?.color === "string" ? style.color : null;
  const color = styled ?? (profile ? profileColor(profile) : null);
  // A Profile may carry no model of its own (agents created with a per-session model, e.g. MCP `agent_create` on
  // a shared Profile): the session's own model then fills the gap, so the agent does not read as family "other"
  // (owner 2026-10-28: Osprey / Kittiwake, Profile Shared without a model, drew GLM faces from the unknown pool).
  const sessionFacts = sessionModelFacts(entry.session);
  const facts = profile ? { model: profile.model || sessionFacts.model, cliKind: profile.cliKind ?? sessionFacts.cliKind } : sessionFacts;
  return {
    hostId: entry.hostId,
    style: effectiveAvatarStyle(entry.hostId, profile?.id ?? null),
    avatarMode: entry.session.avatarMode ?? null,
    fixedLetter: entry.session.avatarMode === "fixed" && !entry.session.avatar,
    color,
    themes: avatarThemesOf(facts, override),
    family: modelFamily(facts),
    isDirector: entry.isDirector,
    isOperator: entry.isOperator === true,
    pinned: entry.pinned,
    project: entry.project ?? null,
    badge: entry.session.badge ?? null,
  };
}

/** The look of agent `seed` (its cutexSessionId), or null when the app does not hold it. */
export function useAgentLook(seed: string | null | undefined): AgentLook | null {
  const entry = useApp((s) => (seed ? (agentIndex(s).get(seed) ?? null) : null));
  const badges = useApp((s) => !!entry && featuresOf(s, entry.hostId).has("session-badge"));
  useProfileLooksVersion();
  useAvatarStyleVersion();
  useUiPrefs(); // theme overrides
  if (!entry) return null;
  const profile = profileLookOf(entry.hostId, sessionProfileName(entry.session));
  const override = profile ? avatarThemesOverride(entry.hostId, profile.id) : null;
  const look = lookOf(entry, profile, override);
  return badges ? look : { ...look, badge: null };
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
