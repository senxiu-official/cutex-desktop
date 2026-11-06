import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { RELAY_CODES, BROWSER_REFUSAL_CODES, type RelayErrorCode, type RelayState } from "./relayTypes";

export type BrowserAuditStage = "execute" | "mount_wait" | "mount" | "navigation" | "grant_http" | "hold_prepare" | "prepare" | "activate_http" | "open_confirm" | "cleanup" | "result_http";
export interface BrowserAuditEvent {
  event: "state" | "lateResult" | "rejected" | "stage";
  requestId?: string; state?: RelayState; code?: RelayErrorCode; abortCause?: RelayErrorCode;
  cause?: "relay_inflight_limit" | "ledger_capacity" | "guest_already_mounted";
  stage?: BrowserAuditStage; elapsedMs?: number; inflight?: number; ledgerSize?: number;
}
const stages: BrowserAuditStage[] = ["execute", "mount_wait", "mount", "navigation", "grant_http", "hold_prepare", "prepare", "activate_http", "open_confirm", "cleanup", "result_http"];
const codes: readonly string[] = [...RELAY_CODES, ...BROWSER_REFUSAL_CODES];
/** Rebuild from a whitelist at the disk boundary; no exception, URL or page payload is logged. */
export function browserAuditRecord(value: BrowserAuditEvent): Record<string, unknown> {
  const record: Record<string, unknown> = { time: new Date().toISOString() };
  if (["state", "lateResult", "rejected", "stage"].includes(value.event)) record.event = value.event;
  if (typeof value.requestId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.requestId)) record.requestId = value.requestId;
  if (value.state && ["accepted", "dispatched", "running", "succeeded", "failed", "cancelled", "outcome_unknown"].includes(value.state)) record.state = value.state;
  for (const key of ["code", "abortCause"] as const) if (value[key] && codes.includes(value[key])) record[key] = value[key];
  if (value.cause && ["relay_inflight_limit", "ledger_capacity", "guest_already_mounted"].includes(value.cause)) record.cause = value.cause;
  if (value.stage && stages.includes(value.stage)) record.stage = value.stage;
  for (const [key, limit] of [["elapsedMs", 86_400_000], ["inflight", 256], ["ledgerSize", 256]] as const) {
    const n = value[key]; if (typeof n === "number" && Number.isFinite(n) && n >= 0) record[key] = Math.min(limit, Math.floor(n));
  }
  return record;
}
/** Bounded queue and two bounded files. Audit I/O never blocks browser authority. */
export function createBrowserAudit(path: string, maxBytes = 2 * 1024 * 1024) {
  let tail = Promise.resolve(), pending = 0, dropped = 0;
  return {
    write(value: BrowserAuditEvent): void {
      if (pending >= 256) { dropped++; return; }
      const record = browserAuditRecord(value); pending++;
      tail = tail.then(async () => {
        await mkdir(dirname(path), { recursive: true });
        const line = JSON.stringify({ ...record, dropped }) + "\n"; dropped = 0;
        const size = await stat(path).then(s => s.size, () => 0);
        if (size + Buffer.byteLength(line) > maxBytes) await rename(path, path + ".1");
        await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
      }).catch(() => { dropped++; }).finally(() => { pending--; });
    },
    flush: () => tail,
  };
}
