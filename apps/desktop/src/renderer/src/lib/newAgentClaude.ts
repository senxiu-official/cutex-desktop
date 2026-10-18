// New agent with a Claude profile (cutex `human-agent-claude`): before it, cutex refused Claude
// profiles in POST /v2/human/agents (`unsupported_profile: Claude subscription profiles are not
// supported by this creator`), so the form greys them out on such a host. With it, Claude agents
// use the profile's own write / exec rules: the Codex-only launch fields (sandbox, approval,
// network, writable roots) are not sent. With cutex `claude-launch-permission-mode` (the profile lists
// `claudeLaunchPermissionModes`) the new agent / quick chat can start in one of Claude Code's own
// permission modes (`launch.claudePermissionMode`), shown with the composer's Claude mode names.
import type { ProfileItem } from "../../../shared/ipc";
import { CLAUDE_LAUNCH_MODES, launchFromForm, type ClaudeLaunchMode, type LaunchForm, type LaunchOverrides } from "../../../shared/launch";

export const HUMAN_AGENT_CLAUDE_FEATURE = "human-agent-claude";

export const isClaudeProfile = (p: Pick<ProfileItem, "cliKind"> | null | undefined): boolean => p?.cliKind === "claude";

/** The profile a create request uses: the picked id, else the host's default (by name or id). */
export function effectiveProfile(profiles: { defaultProfile: string | null; profiles: ProfileItem[] } | null, picked: string): ProfileItem | null {
  const list = profiles?.profiles ?? [];
  if (picked) return list.find((p) => p.id === picked) ?? null;
  const d = profiles?.defaultProfile;
  return d ? (list.find((p) => p.name === d || p.id === d) ?? null) : null;
}

/** The mode a Claude agent starts in when none is picked (the adapter's default). */
export const CLAUDE_DEFAULT_LAUNCH_MODE: ClaudeLaunchMode = "bypassPermissions";

/**
 * Claude modes a new agent of `profile` can start in (display order), or null: a Codex profile, an
 * older cutex (no `claudeLaunchPermissionModes`) or a Claude runtime that offers none.
 */
export function claudeLaunchModes(profile: Pick<ProfileItem, "cliKind" | "claudeLaunchPermissionModes"> | null | undefined): ClaudeLaunchMode[] | null {
  if (!isClaudeProfile(profile)) return null;
  const listed = profile?.claudeLaunchPermissionModes;
  if (!Array.isArray(listed)) return null;
  const modes = CLAUDE_LAUNCH_MODES.filter((m) => listed.includes(m));
  return modes.length ? modes : null;
}

/** The mode to show / send: the pick when this profile offers it, else the default (when offered), else the first. */
export function shownClaudeMode(picked: ClaudeLaunchMode | null | undefined, modes: readonly ClaudeLaunchMode[] | null): ClaudeLaunchMode | null {
  if (!modes) return null;
  if (picked && modes.includes(picked)) return picked;
  return modes.includes(CLAUDE_DEFAULT_LAUNCH_MODE) ? CLAUDE_DEFAULT_LAUNCH_MODE : modes[0]!;
}

/**
 * A create request's `launch` for a Claude profile: model / effort and, when offered, the picked
 * starting mode. Codex-only fields are dropped (cutex refuses them for Claude profiles).
 */
export function claudeOnlyLaunch(launch: LaunchOverrides | undefined, modes: readonly ClaudeLaunchMode[] | null): LaunchOverrides | undefined {
  const out: LaunchOverrides = {};
  if (launch?.model) out.model = launch.model;
  if (launch?.reasoningEffort) out.reasoningEffort = launch.reasoningEffort;
  if (launch?.claudePermissionMode && modes?.includes(launch.claudePermissionMode)) out.claudePermissionMode = launch.claudePermissionMode;
  return Object.keys(out).length ? out : undefined;
}

/** A Codex profile's `launch`: without the Claude starting mode (cutex refuses it there). */
export function codexOnlyLaunch(launch: LaunchOverrides): LaunchOverrides {
  const { claudePermissionMode: _dropped, ...rest } = launch;
  return rest;
}

/** Launch overrides for a Claude agent: model / effort (when Advanced was touched) and the picked mode. */
export function claudeLaunchFromForm(form: LaunchForm, touched: boolean, mode: ClaudeLaunchMode | null = null, modes: readonly ClaudeLaunchMode[] | null = null): LaunchOverrides | undefined {
  return claudeOnlyLaunch({ ...launchFromForm(form, touched), ...(mode ? { claudePermissionMode: mode } : {}) }, modes);
}

/** cutex without `human-agent-claude` refusing a Claude profile. */
export const isClaudeCreatorRefusal = (message: string): boolean => /Claude subscription profiles are not supported/.test(message);
