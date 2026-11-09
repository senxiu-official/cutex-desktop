// 撤销文件改动 of a Codex turn (cutex `cutex/session/files/revert`, shared/filesRevert.ts; DESIGN §4.6,
// owner 2026-10-09): only from the turn summary's expanded state. 撤销这些改动 runs a dry run and shows
// its plan in place; 撤销 N 个文件 executes exactly that plan (its digest). A conflicting file blocks
// the whole revert. State per (host, agent, turn), memory only.
import { create } from "zustand";
import { SESSION_FILES_REVERT_FEATURE, type FilesRevertPlan } from "../../../shared/filesRevert";
import type { AgentFeatures } from "./agentFeatures";
import { hostApi } from "../store";

export type FilesRevertState =
  | { phase: "previewing" }
  | { phase: "preview"; plan: FilesRevertPlan; /** cutex answered plan_changed: the files changed since the last preview. */ changed?: boolean }
  | { phase: "applying"; plan: FilesRevertPlan }
  | { phase: "done"; plan: FilesRevertPlan }
  | { phase: "error"; code: string; message: string; plan: FilesRevertPlan | null; journalPath: string | null };

interface FilesRevertStore {
  /** `${hostId}|${sessionId}|${turnId}` → state (absent = closed). */
  byKey: Record<string, FilesRevertState>;
}

export const useFilesRevert = create<FilesRevertStore>(() => ({ byKey: {} }));

export const filesRevertKey = (hostId: string, sessionId: string, turnId: string) => `${hostId}|${sessionId}|${turnId}`;

/** Codex agents on a host with `session-files-revert`; Claude has its own rewind (回退并恢复文件), ACP runtimes keep no history items to plan from. */
export function canRevertTurnFiles(agent: AgentFeatures | null | undefined, host: { has(feature: string): boolean }): boolean {
  return agent?.runtime === "codex" && host.has(SESSION_FILES_REVERT_FEATURE);
}

/** The plan can run: at least one file `ok`, none blocking (cutex `applicable`). */
export const canApply = (plan: FilesRevertPlan) => plan.applicable && plan.files.some((f) => f.status === "ok");

function put(key: string, state: FilesRevertState | null): void {
  useFilesRevert.setState((s) => {
    const byKey = { ...s.byKey };
    if (state) byKey[key] = state;
    else delete byKey[key];
    return { byKey };
  });
}

const current = (key: string) => useFilesRevert.getState().byKey[key];

/** 撤销这些改动: dry run, the plan shown in place. */
export async function previewFilesRevert(hostId: string, sessionId: string, turnId: string): Promise<void> {
  const key = filesRevertKey(hostId, sessionId, turnId);
  if (current(key)?.phase === "previewing" || current(key)?.phase === "applying") return;
  put(key, { phase: "previewing" });
  const r = await hostApi(hostId).filesRevert(sessionId, turnId, { dryRun: true }).catch((e: unknown) => ({ ok: false as const, code: "unreachable", message: String((e as Error)?.message ?? e), plan: null, journalPath: null }));
  if (current(key)?.phase !== "previewing") return;
  put(key, r.ok ? { phase: "preview", plan: r.plan } : { phase: "error", code: r.code, message: r.message, plan: r.plan, journalPath: r.journalPath });
}

/**
 * 撤销 N 个文件: execute the previewed plan. `plan_changed` (files changed since the preview) shows
 * cutex's fresh plan to confirm again; a conflict / nothing-left answer shows its plan as an error.
 */
export async function applyFilesRevert(hostId: string, sessionId: string, turnId: string): Promise<boolean> {
  const key = filesRevertKey(hostId, sessionId, turnId);
  const state = current(key);
  if (state?.phase !== "preview" || !canApply(state.plan)) return false;
  const plan = state.plan;
  put(key, { phase: "applying", plan });
  const r = await hostApi(hostId).filesRevert(sessionId, turnId, { dryRun: false, expectedPlanDigest: plan.planDigest }).catch((e: unknown) => ({ ok: false as const, code: "unreachable", message: String((e as Error)?.message ?? e), plan: null, journalPath: null }));
  if (current(key)?.phase !== "applying") return false;
  if (r.ok) {
    put(key, { phase: "done", plan: r.plan });
    return true;
  }
  if (r.code === "plan_changed" && r.plan) put(key, { phase: "preview", plan: r.plan, changed: true });
  else put(key, { phase: "error", code: r.code, message: r.message, plan: r.plan, journalPath: r.journalPath });
  return false;
}

export function closeFilesRevert(hostId: string, sessionId: string, turnId: string): void {
  const key = filesRevertKey(hostId, sessionId, turnId);
  if (current(key)?.phase === "applying") return;
  put(key, null);
}
