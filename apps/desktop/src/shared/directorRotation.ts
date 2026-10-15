// Owner-initiated Director rotation (cutex `owner-rotation`): the request the main process sends
// and the rules the dialog shows. cutex validates again; this keeps renderer input well-formed.
import type { DirectorRotationStart, DirectorRotationState, PredecessorDisposition } from "./ipc";

export const OWNER_ROTATION_FEATURE = "owner-rotation";
export const ROTATION_UPDATED_METHOD = "cutex/ownerRotation/updated";
export const MIN_HANDOFF_TIMEOUT_SECS = 60;
export const MAX_HANDOFF_TIMEOUT_SECS = 86_400;
export const DISPOSITIONS: readonly PredecessorDisposition[] = ["member", "operator", "archive"];
export const ROTATION_ID = /^rot-[A-Za-z0-9-]{1,80}$/;

/** The steps the dialog lists, in order. */
export type RotationStep = "handoff" | "successor" | "rebind" | "dispose" | "start";
export const ROTATION_STEPS: readonly RotationStep[] = ["handoff", "successor", "rebind", "dispose", "start"];
export type StepStatus = "done" | "current" | "pending" | "failed" | "waiting";

/** Steps finished once cutex reports this state. */
const DONE_STEPS: Partial<Record<DirectorRotationState, number>> = {
  requested: 0,
  handoff_requested: 0,
  timeout: 0,
  handoff_written: 1,
  successor_created: 2,
  authority_rebound: 3,
  predecessor_disposed: 4,
  done: 5,
};

/** Each step's status: done / current / pending, the step a failure stopped at, and `waiting`
 *  for the handoff step after a timeout (the owner decides). */
export function rotationProgress(r: { state: DirectorRotationState; history: { state: DirectorRotationState }[]; handoff: { skipped: boolean } }): Record<RotationStep, StepStatus> {
  const terminal = r.state === "failed" || r.state === "cancelled";
  const reached = terminal ? [...r.history].reverse().find((h) => h.state !== "failed" && h.state !== "cancelled")?.state ?? "requested" : r.state;
  let done = DONE_STEPS[reached] ?? 0;
  if (done === 0 && r.handoff.skipped) done = 1;
  const out = {} as Record<RotationStep, StepStatus>;
  ROTATION_STEPS.forEach((step, i) => {
    if (i < done) out[step] = "done";
    else if (i > done || r.state === "done") out[step] = "pending";
    else if (r.state === "failed") out[step] = "failed";
    else if (r.state === "cancelled") out[step] = "pending";
    else if (r.state === "timeout" && !r.handoff.skipped) out[step] = "waiting";
    else out[step] = "current";
  });
  return out;
}

export function isTerminalRotation(state: DirectorRotationState): boolean {
  return state === "done" || state === "cancelled" || state === "failed";
}

/** cutex `Rotation::cancellable`: until the successor creation begins. */
export function rotationCancellable(r: { state: DirectorRotationState; successorCreateStartedAt: string | null }): boolean {
  return (r.state === "requested" || r.state === "handoff_requested" || r.state === "timeout") && !r.successorCreateStartedAt;
}

/** 不等交接继续: while cutex still waits for the note. */
export function rotationWaiting(r: { state: DirectorRotationState }): boolean {
  return r.state === "requested" || r.state === "handoff_requested" || r.state === "timeout";
}

/** cutex `next_successor_name`: `<base>-rN` → `<base>-r(N+1)`, otherwise `<name>-r2`. */
export function nextSuccessorName(name: string): string {
  const m = /^(.+)-r(\d{1,6})$/.exec(name);
  if (m && m[1]) return `${m[1]}-r${Number(m[2]) + 1}`;
  return `${name}-r2`;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) return undefined;
  return v;
}

/** A well-formed start body or an Error (bad input from the renderer). Empty successor fields are dropped (= follow the Director). */
export function directorRotationBody(input: unknown): DirectorRotationStart {
  const r = (input ?? {}) as Record<string, unknown>;
  const requestId = text(r.requestId, 256);
  const projectId = text(r.projectId, 200);
  const director = text(r.expectedDirectorCutexSessionId, 256);
  const epoch = r.expectedAuthorityEpoch;
  if (!requestId || !projectId || !director) throw new Error("bad rotation request");
  if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 1) throw new Error("bad authority epoch");
  if (!DISPOSITIONS.includes(r.predecessor as PredecessorDisposition)) throw new Error("bad predecessor disposition");
  const body: DirectorRotationStart = { requestId, projectId, expectedDirectorCutexSessionId: director, expectedAuthorityEpoch: epoch, predecessor: r.predecessor as PredecessorDisposition, successor: {} };
  if (r.handoffTimeoutSecs !== undefined) {
    const secs = r.handoffTimeoutSecs;
    if (typeof secs !== "number" || !Number.isInteger(secs) || secs < MIN_HANDOFF_TIMEOUT_SECS || secs > MAX_HANDOFF_TIMEOUT_SECS) throw new Error("bad handoff timeout");
    body.handoffTimeoutSecs = secs;
  }
  const s = (r.successor ?? {}) as Record<string, unknown>;
  for (const key of ["name", "profile", "model", "reasoningEffort", "cwd"] as const) {
    const v = text(s[key], key === "name" ? 128 : 4096);
    if (v) body.successor[key] = v;
  }
  return body;
}
