// Agent avatars: cutex stores `{kind: emoji|color|icon, value, color?}` (or null) via
// `cutex/session/metadata/update`; null falls back to the profile color / a stable hash color.
// `color` (#rrggbb) on an emoji / icon avatar needs the host capability `agent-avatar-color`.
import type { SessionAvatar } from "@cutex-desktop/protocol";

export const AVATAR_PALETTE = ["#4c8dff", "#22b8cf", "#40c057", "#d6336c", "#fab005", "#7950f2", "#fd7e14", "#12b886"];
/** cutex SESSION_AVATAR_VALUE_MAX_CHARS. */
export const AVATAR_VALUE_MAX = 64;

export function hashColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]!;
}

/** cutex capability: an emoji / icon avatar may carry its own circle colour. */
export const AVATAR_COLOR_FEATURE = "agent-avatar-color";

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColor = (value: string | null | undefined): value is string => !!value && HEX.test(value);

/** The value cutex would accept (non-empty, ≤ 64 chars, no control chars, `color` only `#rrggbb` on emoji / icon); null = default avatar. */
export function cleanAvatar(avatar: SessionAvatar | null): SessionAvatar | null {
  if (!avatar) return null;
  const value = avatar.value.trim();
  // eslint-disable-next-line no-control-regex
  if (!value || [...value].length > AVATAR_VALUE_MAX || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return null;
  const color = avatar.kind !== "color" && isHexColor(avatar.color) ? avatar.color.toLowerCase() : null;
  return color ? { kind: avatar.kind, value, color } : { kind: avatar.kind, value };
}

/** The circle colour an avatar sets itself (a `color` avatar, or an emoji / icon with `color`); null = profile / hash colour. */
export function avatarColor(avatar: SessionAvatar | null | undefined): string | null {
  if (!avatar) return null;
  if (avatar.kind === "color") return avatar.value;
  return isHexColor(avatar.color) ? avatar.color : null;
}

export interface AgentInfo {
  avatar: SessionAvatar | null;
  note: string | null;
  /** 显示名 (cutex `displayNameOverride`); undefined = not edited here. */
  displayName?: string | null;
}

/** `cutex/session/metadata/update` params for what changed (empty = nothing to send). */
export function agentInfoPatch(before: AgentInfo, after: AgentInfo): Partial<AgentInfo> {
  const patch: Partial<AgentInfo> = {};
  const avatar = cleanAvatar(after.avatar);
  const was = before.avatar ?? null;
  if (avatar?.kind !== was?.kind || avatar?.value !== was?.value || (avatar?.color ?? null) !== (was?.color ?? null)) patch.avatar = avatar;
  const note = after.note?.trim() || null;
  if (note !== (before.note ?? null)) patch.note = note;
  if (after.displayName !== undefined) {
    const name = after.displayName?.trim() || null;
    if (name !== (before.displayName ?? null)) patch.displayName = name;
  }
  return patch;
}

/** What the 编辑信息 dialog may edit on this host. */
export interface AgentInfoOptions {
  /** The agent's real name (placeholder of 显示名, shown under it). */
  realName: string;
  /** `agent-avatar-color`: 表情 / 图片 and 颜色 combine. */
  combineColor: boolean;
  /** `session-metadata` displayName: the 显示名 field. */
  editName: boolean;
}
