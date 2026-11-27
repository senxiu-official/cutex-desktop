// 个人助理 phase 1 (owner 2026-11-27): 范围规则, 简报时间, adding a reminder and 记一下 (an owner note in 备忘). The
// contract is cutex's (shared/personalAssistantsPhase1.ts: types, feature names and the strict parsers main applies);
// this file re-exports it for the module and adds what only the UI needs. Each call is gated by its host feature: a
// host without it says "unsupported" (null) without being asked (./phase1Api).
import type { PaRole, PaScope } from "../../../../shared/personalAssistantsPhase1";

export {
  OWNER_PINS_CREATE_FEATURE, PA_BRIEF_FEATURE, PA_REMINDERS_WRITE_FEATURE, PA_SCOPE_RULES_FEATURE,
  type OwnerPinCreateInput, type PaBriefPending, type PaBriefScheduleInput, type PaBriefView, type PaProjectRole, type PaReminderCreateInput,
  type PaRole, type PaScope, type PaScopeRule, type PaScopeRuleSet, type PaScopeSaveInput,
} from "../../../../shared/personalAssistantsPhase1";

/** 只看 / 协调 / 代你确认, in that order. `confirmForYou` = routine requests go to the Director without asking (default off). */
export const PA_ROLES: readonly PaRole[] = ["observe", "coordinate", "confirmForYou"];
/** The role of a project no rule covers. */
export const PA_DEFAULT_ROLE: PaRole = "coordinate";
export type PaScopeKind = PaScope["kind"];

/** cutex's limits on an owner note (ownerPinCreateBody): longer text is cut here rather than refused there. */
export const OWNER_NOTE_TITLE_MAX = 120;
export const OWNER_NOTE_DETAIL_MAX = 2000;
