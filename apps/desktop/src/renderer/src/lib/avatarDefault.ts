// Settings → 外观 → 默认头像 (UI pref `agentAvatarDefault`): what an agent without its own picture /
// emoji shows. "emoji" = a bundled emoji from its Profile's theme (lib/avatarThemes), "letter" = the
// initial, "important" (★ owner 2026-10-18, 仅重要智能体) = the emoji for important agents and, in
// list rows, a small Profile-coloured mark (the dot; drawn as an initial tile since 2026-10-24) for every other one, so a long sidebar is calmer and the
// agents that matter stand out. Important = Director, pinned, or an avatar of its own; nothing depends
// on which agent is open (owner 2026-10-18: avatars must not come and go while clicking around). The
// owner decides per agent with 显示头像 / 隐藏头像 (agent menu), which writes / clears its cutex avatar
// (the 拟人头像 / theme emoji it would show anyway), so the choice syncs across devices. Pure (no React).
//
// The default was "emoji" before; a stored "emoji" from then moves once to "important"
// (agentAvatarDefaultRev, like runningAgentsRev); an explicit "letter" stays, and choosing "emoji"
// again afterwards is kept.
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { isHexColor } from "./avatar";
import { isPictureAvatar } from "./agentPicture";
import { isDirectorAvatar } from "../../../shared/directorAvatars";

export type AgentAvatarDefault = "emoji" | "letter" | "important";
export const AGENT_AVATAR_DEFAULTS: readonly AgentAvatarDefault[] = ["emoji", "letter", "important"];
export const DEFAULT_AGENT_AVATAR: AgentAvatarDefault = "important";
export const AGENT_AVATAR_DEFAULT_REV = 1;

/** Stored value → setting: a pre-rev-1 "emoji" (the old default) becomes "important" once; any other choice is kept. */
export function migrateAgentAvatarDefault(v: unknown, rev: unknown): AgentAvatarDefault {
  if (!(AGENT_AVATAR_DEFAULTS as readonly unknown[]).includes(v)) return DEFAULT_AGENT_AVATAR;
  if (v === "emoji" && (typeof rev !== "number" || rev < AGENT_AVATAR_DEFAULT_REV)) return DEFAULT_AGENT_AVATAR;
  return v as AgentAvatarDefault;
}

/** The setting draws a default emoji (for every agent, or for the important ones). */
export const drawsEmoji = (mode: AgentAvatarDefault): boolean => mode !== "letter";

export interface MinorFacts {
  /** The agent leads a project. */
  isDirector: boolean;
  /** 置顶 (device-local pin). */
  pinned: boolean;
  /** Its stored avatar (cutex metadata). */
  avatar: SessionAvatar | null | undefined;
  /** A device-local picture. */
  picture: string | null | undefined;
}

/**
 * 仅重要智能体: whether an agent shows the dot instead of an avatar. Directors, pinned agents and
 * agents with their own emoji / icon / picture keep the avatar; a colour-only avatar is no picture,
 * so that agent gets the dot (in its own colour). Selection plays no part. Other settings never show the dot.
 */
export function isMinorAgent(mode: AgentAvatarDefault, facts: MinorFacts): boolean {
  if (mode !== "important") return false;
  if (facts.isDirector || facts.pinned) return false;
  if (facts.picture) return false;
  if (facts.avatar && facts.avatar.kind !== "color") return false;
  return true;
}

/**
 * The minor mark's edge for an avatar slot of `size` px: a rounded tile with the agent's initial (owner 2026-10-24,
 * option 甲 — a round dot read as a second host dot), 15 px in 20 px rows, 12 px in 16 px slots.
 */
export const minorTileSize = (size: number): number => (size >= 18 ? 15 : 12);

/**
 * The agent menu's avatar switch in 仅重要智能体 mode: "show" (显示头像) for an agent that shows the dot,
 * "hide" (隐藏头像) for one shown only because of its own emoji / icon / 拟人头像 avatar, null otherwise — other
 * modes (everyone has an avatar), Directors / pinned agents (always shown) and pictures / 「Director 头像」
 * portraits (device-local; 编辑信息 removes those).
 */
export type AvatarSwitch = "show" | "hide";
export function avatarSwitchOf(mode: AgentAvatarDefault, facts: { isDirector: boolean; pinned: boolean; avatar: SessionAvatar | null | undefined }): AvatarSwitch | null {
  if (mode !== "important" || facts.isDirector || facts.pinned) return null;
  const avatar = facts.avatar;
  if (!avatar || avatar.kind === "color") return "show";
  if (isPictureAvatar(avatar) || isDirectorAvatar(avatar)) return null;
  return "hide";
}

/**
 * 显示头像: the avatar to store — `base` is what the agent would show without the dot: a 拟人头像 of the enabled
 * themes for its model family (lib/portraitAssign shownPortrait) when one applies, else the theme's default emoji
 * (lib/avatarThemes themedEmoji), so the agent keeps that look. A colour of its own (a `color` avatar) stays on it
 * where the host can combine them (`agent-avatar-color`).
 */
export function shownAvatar(base: SessionAvatar, current: SessionAvatar | null | undefined, combineColor: boolean): SessionAvatar {
  const color = combineColor && current?.kind === "color" && isHexColor(current.value) ? current.value.toLowerCase() : null;
  return color ? { kind: base.kind, value: base.value, color } : { kind: base.kind, value: base.value };
}

/** 隐藏头像: back to no avatar (the dot); an own circle colour on the emoji stays as a `color` avatar. */
export function hiddenAvatar(current: SessionAvatar | null | undefined): SessionAvatar | null {
  return current && current.kind !== "color" && isHexColor(current.color) ? { kind: "color", value: current.color.toLowerCase() } : null;
}
