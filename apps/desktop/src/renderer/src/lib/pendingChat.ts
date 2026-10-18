// New-chat draft (PendingChat page): what the user picks before the session exists, and the order
// in which `createPendingChat()` (store) applies it once the first message is sent:
//   create session (profile + launch) → plan mode → goal → drafts in order.
// Each step is recorded as done, so a retry after a failure continues with the session that was
// already created instead of creating another. Pure, unit-tested.
import type { ExtraInput, ProfileItem } from "../../../shared/ipc";
import { imageInputItems, type DraftImage } from "../../../shared/input";
import type { ClaudeLaunchMode, LaunchOverrides } from "../../../shared/launch";
import type { PermissionMode } from "./permissionModes";
import { profileKind } from "./profileKind";
import { boundSkills } from "./slashCommands";

/** One queued draft message: text plus the composer attachments (images, `$skill` bindings). */
export interface PendingDraft {
  text: string;
  images: DraftImage[];
  /** Skills picked from the palette / "+"; only those still named as `$name` in the text are sent. */
  skills: { name: string; path: string }[];
}

export interface PendingChatState {
  /**
   * The host the chat is created on (multi-host P1: the draft page's host picker, RFC ★ Q10 default);
   * null = not chosen yet (the focus host when the session is created).
   */
  hostId: string | null;
  profile: string | null;
  launch: LaunchOverrides;
  /**
   * The composer mode the draft shows (launch over the host's quick-chat defaults). On a cutex
   * without launch-approvals-reviewer, 自动 gets its reviewer after creation (lib/permissionModes).
   */
  permissionMode?: PermissionMode | null;
  /**
   * The resolved profile is a Claude profile (synced by the draft page): the create request then
   * carries only model / effort and the Claude starting mode (lib/newAgentClaude claudeOnlyLaunch).
   */
  claude?: boolean;
  /** Claude starting modes the profile offers (cutex claude-launch-permission-mode); null = none. */
  claudeModes?: ClaudeLaunchMode[] | null;
  /** Start in plan mode (collaboration mode set before the first message). */
  plan: boolean;
  /** Goal objective set on the new thread before the first message; null = none. */
  goal: string | null;
  drafts: PendingDraft[];
  error: string | null;
  /** Set once cutex created the session: retries reuse it. */
  sessionId: string | null;
  /** Steps already applied to `sessionId`. */
  applied: { plan: boolean; goal: boolean };
}

export type PendingChatStep =
  | { kind: "create" }
  | { kind: "plan" }
  | { kind: "goal"; objective: string }
  | { kind: "submit"; text: string; extra: ExtraInput[] };

export function emptyPendingChat(profile: string | null, hostId: string | null = null): PendingChatState {
  return { hostId, profile, launch: {}, plan: false, goal: null, drafts: [], error: null, sessionId: null, applied: { plan: false, goal: false } };
}

export function hasDraftContent(draft: Pick<PendingDraft, "text" | "images">): boolean {
  return !!draft.text.trim() || draft.images.length > 0;
}

/** The submit payload for a draft, built like the composer's (images first, then bound skills). */
export function draftSubmit(draft: PendingDraft): { text: string; extra: ExtraInput[] } {
  return {
    text: draft.text,
    extra: [...imageInputItems(draft.images), ...boundSkills(draft.text, draft.skills).map((s) => ({ type: "skill" as const, name: s.name, path: s.path }))],
  };
}

/** The remaining steps, in order. Empty = done (or nothing to send yet). */
export function pendingChatSteps(p: Pick<PendingChatState, "sessionId" | "plan" | "goal" | "applied" | "drafts">): PendingChatStep[] {
  if (p.drafts.length === 0 && !p.sessionId) return [];
  const steps: PendingChatStep[] = [];
  if (!p.sessionId) steps.push({ kind: "create" });
  if (p.plan && !p.applied.plan) steps.push({ kind: "plan" });
  const objective = p.goal?.trim();
  if (objective && !p.applied.goal) steps.push({ kind: "goal", objective });
  for (const d of p.drafts) steps.push({ kind: "submit", ...draftSubmit(d) });
  return steps;
}

/** Plan / goal stay editable until applied (and never while the session is being set up). */
export function pendingSettingLocked(p: Pick<PendingChatState, "applied">, which: "plan" | "goal", creating: boolean): boolean {
  return creating || p.applied[which];
}

/** Whether the draft offers 设目标: the Claude runtime has no goals, so a resolved Claude
 * profile hides the entry (it would only fail after creation). Unknown profile (list not
 * loaded yet / none picked): offered, like before. */
export function draftOffersGoal(profile: Pick<ProfileItem, "cliKind" | "authKind" | "providerFamily"> | null | undefined): boolean {
  return !profile || profileKind(profile) !== "claude";
}

/** The draft's `/` palette commands; `goal` drops out for the same runtimes as above. */
export function draftSlashCommands(offersGoal: boolean): string[] {
  return offersGoal ? ["plan", "goal"] : ["plan"];
}
