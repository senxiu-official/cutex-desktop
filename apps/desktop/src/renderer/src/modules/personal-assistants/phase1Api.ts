// The host calls of 个人助理 phase 1 (the bridge's fixed routes: /v2/personal-assistants/{id}/scope-rules · /brief ·
// /reminders and POST /v2/owner-pins; main checks bodies and replies with shared/personalAssistantsPhase1.ts). Nothing
// else in the module calls the host for these; each read is gated by its feature (no feature → null, the host is not
// asked).
import { hostApi } from "../../lib/hostLists";
import { PA_BRIEF_FEATURE, PA_SCOPE_RULES_FEATURE, type OwnerPinCreateInput, type PaBriefScheduleInput, type PaReminderCreateInput, type PaScopeSaveInput } from "./phase1Contract";

/** A host's features as a set (the module's host rows carry them; tests pass plain sets). */
export type FeatureSet = ReadonlySet<string> | null | undefined;

export const phase1 = {
  scopeRules: (hostId: string, features: FeatureSet, id: string) => (features?.has(PA_SCOPE_RULES_FEATURE) ? hostApi(hostId).paScopeRules(id) : Promise.resolve(null)),
  saveScopeRules: (hostId: string, id: string, body: PaScopeSaveInput) => hostApi(hostId).paScopeRulesSave(id, body),
  brief: (hostId: string, features: FeatureSet, id: string) => (features?.has(PA_BRIEF_FEATURE) ? hostApi(hostId).paBrief(id) : Promise.resolve(null)),
  saveBriefSchedule: (hostId: string, id: string, body: PaBriefScheduleInput) => hostApi(hostId).paBriefSchedule(id, body),
  addReminder: (hostId: string, id: string, body: PaReminderCreateInput) => hostApi(hostId).paReminderCreate(id, body),
  captureMemo: (hostId: string, body: OwnerPinCreateInput) => hostApi(hostId).ownerPinCreate(body),
};
