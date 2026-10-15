// Settings → Profiles "添加" form and lifecycle helpers (cutex profile-create / -duplicate /
// -delete / profile-switch-family). Pure so they are unit-testable; cutex owns the presets (their
// official base URLs: lib/profilePresets) and validates everything again.
import { DEFAULT_CLAUDE_ACCOUNT } from "../../../shared/claudeAccounts";
import type { CutexRefusal, ProfileCreateKind, ProfileCreateRequest, ProfileItem, ProfilePreset } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import { createUrlFields, FALLBACK_PRESETS, presetById } from "./profilePresets";

/** cutex capability: profiles carry `providerFamily`; mid-session switching stays within one family. */
export const PROFILE_FAMILY_FEATURE = "profile-switch-family";
/** cutex capability: `/v2/settings` `quickChatDefaultProfile`. */
export const QUICK_CHAT_PROFILE_FEATURE = "quick-chat-default-profile";
/** cutex capability: `/v2/settings` `autoThreadTitles` / `threadTitleModel`. */
export const AUTO_TITLES_FEATURE = "auto-thread-titles";

export interface ProfileCreateForm {
  name: string;
  kind: ProfileCreateKind;
  /** API key only: a preset id (cutex `GET /v2/profile-presets`), or "" for a custom provider. */
  preset: string;
  /**
   * API key only, the Base URL input. With a preset: empty or its official URL = the preset's own,
   * anything else replaces it. Custom: required.
   */
  baseUrl: string;
  /** Claude only, with cutex `claude-accounts`: the 账户 select (`default` / absent = the shared account). */
  claudeAccount?: string;
}

export type ProfileFormError = "nameEmpty" | "nameInvalid" | "nameTaken" | "baseUrlMissing" | "baseUrlInvalid";

/** Profile names become config keys / directory names: no path separators or control characters. */
export function profileNameError(name: string, existing: readonly string[]): ProfileFormError | null {
  const n = name.trim();
  if (!n) return "nameEmpty";
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(n) || n.length > 64) return "nameInvalid";
  if (existing.some((x) => x.toLowerCase() === n.toLowerCase())) return "nameTaken";
  return null;
}

/**
 * `POST /v2/profiles` body. API key: the preset id, plus `baseUrl` only when the input differs from
 * the preset's official URL (custom: `baseUrl` alone, required).
 */
export function createRequestOf(form: ProfileCreateForm, existing: readonly string[], presets: readonly ProfilePreset[] = FALLBACK_PRESETS): { request: ProfileCreateRequest } | { error: ProfileFormError } {
  const nameError = profileNameError(form.name, existing);
  if (nameError) return { error: nameError };
  const request: ProfileCreateRequest = { name: form.name.trim(), kind: form.kind };
  if (form.kind === "apiKey") {
    const fields = createUrlFields({ id: form.preset, preset: presetById(form.preset, presets) }, form.baseUrl);
    if ("error" in fields) return { error: fields.error };
    Object.assign(request, fields);
  }
  // POST /v2/profiles {kind:"claude", claudeAccount?}: only a Claude profile, only another account than the shared one.
  if (form.kind === "claude" && form.claudeAccount && form.claudeAccount !== DEFAULT_CLAUDE_ACCOUNT) request.claudeAccount = form.claudeAccount;
  return { request };
}

/** "<name>-copy", then "-copy-2", … — the first name not taken. */
export function copyName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((x) => x.toLowerCase()));
  let candidate = `${name}-copy`;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${name}-copy-${i}`;
  return candidate;
}

/**
 * Mid-session switch targets. With `profile-switch-family` (the current profile reports a
 * `providerFamily`): only the same family. Otherwise the old rule: same CLI kind.
 */
export function switchTargets<P extends Pick<ProfileItem, "name" | "cliKind" | "providerFamily">>(currentName: string | null, profiles: readonly P[], familyAware: boolean): P[] {
  const current = profiles.find((p) => p.name === currentName);
  const others = profiles.filter((p) => p.name !== currentName);
  if (familyAware && current?.providerFamily) return others.filter((p) => p.providerFamily === current.providerFamily);
  return others.filter((p) => p.cliKind === (current?.cliKind ?? "codex"));
}

/** i18n key for a known cutex refusal code; null = show cutex's own message. */
const REFUSAL_KEYS: Record<string, MessageKey> = {
  profile_in_use: "refusal.profile_in_use",
  profile_is_default: "refusal.profile_is_default",
  session_referenced: "refusal.session_referenced",
  session_busy: "refusal.session_busy",
  session_not_found: "refusal.session_not_found",
  provider_family_mismatch: "refusal.provider_family_mismatch",
};

export function refusalText(r: CutexRefusal, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  const key = r.code === "session_referenced" && r.forkReferences ? "refusal.session_fork_referenced" : REFUSAL_KEYS[r.code];
  if (!key) return r.message ? `${r.message} (${r.code})` : r.code;
  const names = (r.sessions ?? []).map((s) => s.displayName).join("、");
  return t(key, { names: names || "—", n: r.sessions?.length ?? 0 });
}
