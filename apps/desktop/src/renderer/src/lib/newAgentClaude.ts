// New agent with a Claude profile (cutex `human-agent-claude`): before it, cutex refused Claude
// profiles in POST /v2/human/agents (`unsupported_profile: Claude subscription profiles are not
// supported by this creator`), so the form greys them out on such a host. With it, Claude agents
// use the profile's own write / exec rules: the Codex-only launch fields (sandbox, approval,
// network, writable roots) are not sent.
import type { ProfileItem } from "../../../shared/ipc";
import { launchFromForm, type LaunchForm, type LaunchOverrides } from "../../../shared/launch";

export const HUMAN_AGENT_CLAUDE_FEATURE = "human-agent-claude";

export const isClaudeProfile = (p: Pick<ProfileItem, "cliKind"> | null | undefined): boolean => p?.cliKind === "claude";

/** The profile a create request uses: the picked id, else the host's default (by name or id). */
export function effectiveProfile(profiles: { defaultProfile: string | null; profiles: ProfileItem[] } | null, picked: string): ProfileItem | null {
  const list = profiles?.profiles ?? [];
  if (picked) return list.find((p) => p.id === picked) ?? null;
  const d = profiles?.defaultProfile;
  return d ? (list.find((p) => p.name === d || p.id === d) ?? null) : null;
}

/** Launch overrides for a Claude agent: only model / effort (Claude uses the profile's rules). */
export function claudeLaunchFromForm(form: LaunchForm, touched: boolean): LaunchOverrides | undefined {
  const full = launchFromForm(form, touched);
  if (!full) return undefined;
  const launch: LaunchOverrides = {};
  if (full.model) launch.model = full.model;
  if (full.reasoningEffort) launch.reasoningEffort = full.reasoningEffort;
  return Object.keys(launch).length ? launch : undefined;
}

/** cutex without `human-agent-claude` refusing a Claude profile. */
export const isClaudeCreatorRefusal = (message: string): boolean => /Claude subscription profiles are not supported/.test(message);
