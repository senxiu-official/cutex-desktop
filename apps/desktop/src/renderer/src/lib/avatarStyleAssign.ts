// Fixed avatars picked from the current app/Profile style. Only explicit reset
// and batch actions replace stored style avatars; changing a style never follows
// through to an agent that already owns an avatar.
import type { AvatarMode, SessionAvatar } from "@cutex-desktop/protocol";
import { useApp } from "../store";
import { agentIndex, lookOf, sessionProfileName } from "./agentLook";
import { AVATAR_THEME_IDS, themedEmoji, themesEmoji, type AvatarThemeId } from "./avatarThemes";
import { effectiveAvatarStyle, type AvatarStyle } from "./avatarStyle";
import { avatarThemesOverride } from "./prefs";
import { isHexColor } from "./avatar";
import { profileLookOf } from "./profileLooks";
import { pickForNewAgent, portraitIndexNow, portraitKey, portraitRefOf, type AgentForPortrait, type PortraitFamily, type PortraitIndex } from "./portraitPacks";

export type StyleAgent = AgentForPortrait & { profileId?: string | null; avatarMode?: AvatarMode };
export type StyleAvatarChange = { seed: string; hostId: string; before: SessionAvatar | null; after: SessionAvatar | null; beforeMode?: AvatarMode; afterMode?: AvatarMode };

/** Worn keys use the existing portrait key or the stored emoji glyph. */
export function styleAvatarKey(avatar: SessionAvatar | null): string | null {
  const portrait = portraitRefOf(avatar);
  return portrait ? portraitKey(portrait) : avatar?.kind === "emoji" ? avatar.value : null;
}

export function familyThemes(family: PortraitFamily | null): AvatarThemeId[] {
  if (family === "claude") return ["animals"];
  if (family === "openai") return ["gems"];
  if (family === "deepseek") return ["sea"];
  return [...AVATAR_THEME_IDS];
}

/** Pure and stable across devices. When all project choices are worn, reuse
 * the seed's own pick, just as portrait assignment does. Letter stores nothing. */
export function pickStyleAvatar(style: AvatarStyle, index: PortraitIndex, family: PortraitFamily | null, seed: string, worn: ReadonlySet<string> = new Set()): SessionAvatar | null {
  if (style.kind === "letter") return null;
  if (style.kind === "portrait") return pickForNewAgent(index, style.portraitThemes, family, seed, worn);
  const themes = style.emojiThemes ?? familyThemes(family);
  const first = themedEmoji(seed, themes);
  const pool = themesEmoji(themes);
  const start = pool.findIndex(emoji => emoji.glyph === first.glyph);
  for (let offset = 0; offset < pool.length; offset++) {
    const emoji = pool[(start + offset) % pool.length]!;
    if (!worn.has(emoji.glyph)) return { kind: "emoji", value: emoji.glyph };
  }
  return { kind: "emoji", value: first.glyph };
}

function wornInProject(hostId: string, projectId: string | null, exceptSeed: string): Set<string> {
  const worn = new Set<string>();
  if (projectId === null) return worn;
  for (const [seed, entry] of agentIndex(useApp.getState())) {
    if (seed === exceptSeed || entry.hostId !== hostId || (entry.row?.projectId ?? null) !== projectId) continue;
    const key = styleAvatarKey(entry.session.avatar ?? null);
    if (key) worn.add(key);
  }
  return worn;
}

export function newAgentStyleAvatar(seed: string, hostId: string, projectId: string | null, family: PortraitFamily | null, profileId: string | null = null): SessionAvatar | null {
  return pickStyleAvatar(effectiveAvatarStyle(hostId, profileId), portraitIndexNow(), family, seed, wornInProject(hostId, projectId, seed));
}

/** Explicit owner reset/show: resolve the current style once, then persist that
 * fixed avatar (or null for letter). The caller owns confirmation and writing. */
export function shownStyleAvatar(seed: string, hostId: string): SessionAvatar | null {
  const entry = agentIndex(useApp.getState()).get(seed);
  if (!entry || entry.hostId !== hostId) return null;
  const profile = profileLookOf(hostId, sessionProfileName(entry.session));
  const look = lookOf(entry, profile, profile ? avatarThemesOverride(hostId, profile.id) : null);
  return newAgentStyleAvatar(seed, hostId, entry.row?.projectId ?? null, look.family, profile?.id ?? null);
}

const projectKey = (agent: StyleAgent) => JSON.stringify([agent.hostId, agent.projectId, agent.projectId === null ? agent.seed : null]);

/** Explicit batch operations include emoji (manual and automatic emoji have no
 * provenance marker), but preserve uploaded pictures, ordinary icons and colors.
 * Reassign rerolls current styles; the old missing-picture repair stays separate.
 * Supply all project agents and return null from resolve to preserve non-targets. */
export function planStyleChanges(index: PortraitIndex, agents: readonly StyleAgent[], resolve: (agent: StyleAgent) => AvatarStyle | null,
  kind: "replace" | "reassign" = "replace", nonce = "reassign"): StyleAvatarChange[] {
  const sorted = [...agents].sort((a, b) => a.seed.localeCompare(b.seed) || a.hostId.localeCompare(b.hostId));
  const styles = new Map<StyleAgent, AvatarStyle>();
  for (const agent of sorted) {
    if (agent.avatarMode === "inherit") continue;
    if (agent.avatar && !styleAvatarKey(agent.avatar)) continue;
    const style = resolve(agent);
    if (style?.kind === "portrait" && !pickStyleAvatar(style, index, agent.family, agent.seed)) continue;
    if (style) styles.set(agent, style);
  }
  const used = new Map<string, Set<string>>();
  const worn = (agent: StyleAgent) => {
    let set = used.get(projectKey(agent));
    if (!set) used.set(projectKey(agent), set = new Set());
    return set;
  };
  for (const agent of sorted) {
    if (kind === "replace" && styles.has(agent)) continue;
    const key = styleAvatarKey(agent.avatar);
    if (key) worn(agent).add(key);
  }
  const changes: StyleAvatarChange[] = [];
  for (const [agent, style] of styles) {
    const taken = worn(agent);
    const seed = kind === "reassign" ? `${agent.seed}\u0000${nonce}` : agent.seed;
    const oldKey = styleAvatarKey(agent.avatar);
    let after = pickStyleAvatar(style, index, agent.family, seed, taken);
    if (style.kind !== "letter" && !after) {
      if (oldKey) taken.add(oldKey);
      continue;
    }
    // When every project choice is worn, prioritize an alternative to this
    // agent's own avatar over uniqueness (which is no longer possible).
    if (kind === "reassign" && oldKey && styleAvatarKey(after) === oldKey) {
      after = pickStyleAvatar(style, index, agent.family, seed, new Set([oldKey]));
    }
    if (after && isHexColor(agent.avatar?.color)) after = { ...after, color: agent.avatar.color.toLowerCase() };
    const nextKey = styleAvatarKey(after);
    if (nextKey) taken.add(nextKey);
    if (agent.avatar?.kind !== after?.kind || agent.avatar?.value !== after?.value || (agent.avatarMode !== undefined && agent.avatarMode !== "fixed")) {
      changes.push({ seed: agent.seed, hostId: agent.hostId, before: agent.avatar, after, ...(agent.avatarMode !== undefined ? { beforeMode: agent.avatarMode, afterMode: "fixed" as const } : {}) });
    }
  }
  return changes;
}
