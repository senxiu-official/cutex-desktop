import { CutexApiError } from "@cutex-desktop/cutex-client";
import { retryableHostBusy } from "./queueSteerRetry";

/** b83ba561 / design050§5.4b. Direct management routes have no desktop entry yet. */
export const HOST_BUSY_ACTION_CONTRACT = [
  {route:"/v2/sessions/{id}/cutex/requests",operation:"cutex/session/delete",kind:"delete"},
  {route:"/v2/sessions/{id}/cutex/requests",operation:"cutex/runtime/online",kind:"runtimeStart"},
  {route:"/v2/sessions/{id}/cutex/requests",operation:"cutex/userInput/submit",kind:"runtimeStart",startIfOffline:true},
  {route:"/v2/sessions/{id}/cutex/requests",operation:"cutex/session/retire",kind:"archive"},
  {route:"/v2/agent-management/explicit-launch",operation:"review_runtime",kind:"explicitReview"},
  {route:"/v2/agent-management/explicit-launch",operation:"run",kind:"runtimeStart"},
  {route:"/v2/agent-management/explicit-launch",operation:"activate",kind:"runtimeStart"},
  {route:"/v2/agent-management/explicit-launch",operation:"reconcile_exited_runtime",kind:"explicitReconcile"},
  {route:"/v2/agent-management/archive-actions",operation:"archive",kind:"archive"},
] as const;
export type HostBusyActionKind = (typeof HOST_BUSY_ACTION_CONTRACT)[number]["kind"];
const PREFIX = "host_action_busy:";

/** r271 mislabeled this definite admission refusal as runtime_mutation_failed.
 * Accept only that typed HTTP error and its leading admission reason, never an
 * embedded message or native/uncertain outcome. Remove after r271 is retired. */
function actionBusyError(error: unknown): CutexApiError | null {
  if (!(error instanceof CutexApiError)) return null;
  if (error.code === "admission_busy" && retryableHostBusy(error)) return error;
  const details = error.details as { reason?: unknown; retryAfterMs?: unknown; resyncRequired?: unknown; nativeError?: unknown; originalCode?: unknown } | null | undefined;
  if (error.status !== 500 || error.code !== "runtime_mutation_failed" || !error.retryable || details?.resyncRequired === true ||
      details?.nativeError !== undefined || details?.originalCode !== undefined ||
      (details?.reason !== undefined && details.reason !== "hostBusy")) return null;
  const message = error.message.replace(/^runtime_mutation_failed:\s*/, "");
  if (!/^(?:admission_busy:\s*(?:host_busy|hostBusy)(?=[:/\s]|$)|hostBusy(?=[:/\s]|$))/.test(message)) return null;
  return new CutexApiError(503, "admission_busy", "hostBusy", true, { reason: "hostBusy", retryAfterMs: details?.retryAfterMs ?? 1000 });
}

/** Narrow, fixed error envelope: no message body or arbitrary daemon details cross IPC. */
export function hostBusyActionWire(error: unknown): string | null {
  const busy = actionBusyError(error);
  if (!busy) return null;
  const hint = (busy.details as { retryAfterMs?: unknown }).retryAfterMs;
  return PREFIX + JSON.stringify({ retryAfterMs: typeof hint === "number" && Number.isSafeInteger(hint) && hint >= 0 && hint <= 2_147_483_647 ? hint : undefined });
}

export function hostBusyActionError(error: unknown): CutexApiError | null {
  if (error instanceof CutexApiError) return actionBusyError(error);
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '(?:cutex-desktop:invoke|daemon:sessionAction|daemon:deleteSession|invoke)': (?:Error: )?/, "");
  const match = /^host_action_busy:(\{[^{}]*\})$/.exec(message);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]!) as { retryAfterMs?: unknown };
    if (Object.keys(data).some(key => key !== "retryAfterMs")) return null;
    if (data.retryAfterMs !== undefined && (typeof data.retryAfterMs !== "number" || !Number.isSafeInteger(data.retryAfterMs) || data.retryAfterMs < 0)) return null;
    return new CutexApiError(503, "admission_busy", "hostBusy", true, { reason: "hostBusy", retryAfterMs: data.retryAfterMs });
  } catch { return null; }
}
