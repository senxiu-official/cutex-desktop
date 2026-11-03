import type { AskSummary } from "../../../shared/ipc";
import { QUOTA_CONTINUE_FEATURE } from "../../../shared/quotaContinue";
import { featuresOf, sidebarOf, useApp } from "../store";
import { runtimeOf } from "./agentList";
import { useQuotaContinue } from "./quotaContinue";

/** A peer target belongs to the peer's cache, never this record host's cache. */
export function useDelegationQuota(host: string, d: Pick<AskSummary, "target" | "remote">) {
  const applies = useApp((s) => {
    if (d.remote || !d.target || !featuresOf(s, host).has(QUOTA_CONTINUE_FEATURE)) return false;
    const sidebar = sidebarOf(s, host);
    const row = sidebar?.active.find((r) => r.cutexSessionId === d.target)
      ?? sidebar?.retired.find((r) => r.cutexSessionId === d.target);
    const known = row && (row.launchBinding?.runtime || row.runtime?.backend || row.effectiveNextLaunch?.source || row.native?.schema?.protocol);
    return !known || runtimeOf(row!) === "claude";
  });
  const view = useQuotaContinue(host, d.target, applies);
  return applies && view?.cutexSessionId === d.target ? view : null;
}

export function gateClosed(d: AskSummary): boolean {
  return !d.closed && !d.remote && (d.execution === "queued" || d.execution === "admitted")
    && d.hold?.reason === "heldByRuntime" && d.hold.native === "gate_closed";
}

/** Only the attached attempt error is evidence; a previous quota outcome is not a hold cause. */
export function gateClosedCause(d: AskSummary): "quota" | "server_error" | null {
  if (!gateClosed(d)) return null;
  const error = d.attempt?.lastError;
  if (!error) return null;
  if (/\bserver_error\b/i.test(error)) return "server_error";
  if (/\bquota\b/i.test(error)) return "quota";
  return null;
}
