// What one write of the 项目 table's batch (archive / restore a project, pause / resume its members) proves, decided in
// main where the cutex error's status and code are still known. An HTTP success only says the host answered; a lost
// reply (unreachable, timeout, 5xx, cutex's own "outcome unknown") says nothing, so it is `unknown`, never a failure that
// invites a blind retry: the renderer reads the state again before another write (same rule as cutex-mobile
// lib/controlIntents.ts). r295's batch endpoint answers 409 `request_outcome_unknown` for the same case.
import type { DelegationControlRequest, DelegationOperationResult } from "@cutex-desktop/protocol";
import { delegationEffect } from "./delegationUpgradeAdapter";

export type WriteOutcome =
  /** Applied. */
  | { outcome: "done" }
  /** Taken, still settling (a pause waits for each member's current 回合). */
  | { outcome: "settling" }
  /** The host refused it before any effect (stale revision / epoch, not allowed), or it was never sent. */
  | { outcome: "refused"; code: string }
  /** Sent; whether it took effect is not known. Read the state before writing again. */
  | { outcome: "unknown"; code?: string };

/** Codes that are cutex's own way of saying "I may have done it". */
const UNCERTAIN_CODES = new Set(["outcome_unknown", "request_outcome_unknown", "persistence_unavailable"]);

/**
 * A thrown write error. Only cutex's own structured refusal proves nothing happened: an unstructured reply (the client's
 * `http_<status>`, also what a proxy or anything else between here and cutex answers) proves nothing, whatever its status.
 */
export function writeErrorOutcome(e: unknown): WriteOutcome {
  const err = e as { name?: unknown; status?: unknown; code?: unknown; message?: unknown } | null;
  if (err && err.name === "CutexApiError" && typeof err.status === "number") {
    const code = typeof err.code === "string" && err.code ? err.code : String(err.message ?? "refused");
    return err.status >= 500 || err.status === 408 || UNCERTAIN_CODES.has(code) || /^http_\d+$/.test(code) ? { outcome: "unknown", code } : { outcome: "refused", code };
  }
  // The client's own checks before any request (capability, owner route).
  const message = err && typeof err.message === "string" ? err.message : "";
  if (/^(unsupported|owner delegation route required|bad |not connected)/i.test(message)) return { outcome: "refused", code: message };
  return { outcome: "unknown" };
}

/**
 * A pause / resume answer, from what the shared receipt validator (delegationEffect) proves: only a matching, completed,
 * committed receipt is `done`; a pending partial one is `settling`; whatever it calls unknown (also completed + partial,
 * pending + committed / none) stays `unknown`.
 */
export function controlOutcome(result: DelegationOperationResult, actionId: string, operation: "project.pause" | "project.resume"): WriteOutcome {
  const { effectState, receipt } = delegationEffect(result, actionId, operation);
  if (!receipt || effectState === "unknown") return { outcome: "unknown" };
  if (receipt.status === "pending" && effectState === "partial") return { outcome: "settling" };
  if (receipt.status === "completed" && effectState === "committed") return { outcome: "done" };
  if (receipt.status === "completed" && effectState === "none") return { outcome: "refused", code: "not_effective" };
  return { outcome: "unknown" };
}

/** A project-wide pause / resume as the table sends it (the run control was just read: its epoch and pause id). */
export type RunControlWrite =
  | { kind: "pause"; actionId: string; expectedEpoch: number; mode: "afterTurn"; scope: "all" }
  | { kind: "resume"; actionId: string; expectedEpoch: number; pauseId: string };

const ID = /^(?!\.+$)[A-Za-z0-9_.:-]{1,256}$/;
const epochOk = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const bad = (what: string): never => { throw new Error(`bad project batch request: ${what}`); };

/** Main's check of an archive / restore from the table (the IPC payload is the renderer's, so checked at run time). */
export function checkLifecycleRequest(projectId: unknown, expected: unknown, kind: unknown): { projectId: string; expected: { authorityEpoch: number; projectRevision: number }; kind: "archive" | "restore" } {
  if (typeof projectId !== "string" || !ID.test(projectId)) bad("project");
  if (kind !== "archive" && kind !== "restore") bad("kind");
  const e = expected as { authorityEpoch?: unknown; projectRevision?: unknown } | null;
  if (!e || typeof e !== "object" || Object.keys(e).some((k) => k !== "authorityEpoch" && k !== "projectRevision") || !epochOk(e.authorityEpoch) || !epochOk(e.projectRevision)) bad("expected");
  return { projectId: projectId as string, expected: { authorityEpoch: e!.authorityEpoch as number, projectRevision: e!.projectRevision as number }, kind: kind as "archive" | "restore" };
}

/**
 * Main's check of a table pause / resume, and the one request it builds: a pause is always after the current 回合 and
 * for every member; a resume lifts the pause just read. Anything else (another control, mode, scope, extra field) throws.
 */
export function runControlRequest(projectId: unknown, action: unknown): DelegationControlRequest {
  if (typeof projectId !== "string" || !ID.test(projectId)) bad("project");
  const a = action as Record<string, unknown> | null;
  if (!a || typeof a !== "object" || Array.isArray(a)) return bad("action");
  if (typeof a.actionId !== "string" || !ID.test(a.actionId) || !epochOk(a.expectedEpoch)) bad("action");
  const id = projectId as string, actionId = a.actionId as string, expectedEpoch = a.expectedEpoch as number;
  const only = (keys: string[]) => { if (Object.keys(a).some((k) => !keys.includes(k))) bad("fields"); };
  if (a.kind === "pause") {
    only(["kind", "actionId", "expectedEpoch", "mode", "scope"]);
    if (a.mode !== "afterTurn" || a.scope !== "all") bad("pause");
    return { kind: "pause", projectId: id, body: { actionId, expectedEpoch, mode: "afterTurn", scope: "all" } };
  }
  if (a.kind === "resume") {
    only(["kind", "actionId", "expectedEpoch", "pauseId"]);
    if (typeof a.pauseId !== "string" || !ID.test(a.pauseId)) bad("pause id");
    return { kind: "resume", projectId: id, body: { actionId, pauseId: a.pauseId as string, expectedEpoch } };
  }
  return bad("kind");
}

/**
 * One table batch at a time across every window (main/projectBatchLease): `begin` takes the lease or names the batch
 * holding it; `renew` keeps it while the batch runs (a window that reloads or crashes stops renewing, and the lease
 * lapses); `end` gives it back.
 */
export type ProjectBatchLeaseRequest =
  | { op: "begin"; kind: "archive" | "restore" | "pause" | "resume"; total: number }
  | { op: "renew"; token: string }
  | { op: "end"; token: string };
export type ProjectBatchLeaseResult =
  | { ok: true; token: string }
  | { ok: false; busy: { kind: "archive" | "restore" | "pause" | "resume"; total: number } | null };
