// NCI remote (external) jobs: pure helpers for the 作业 page (source, PBS id, stale hint, 手动标记) and
// Settings → NCI 远程作业 (mailbox, the address agents get, Gadi verification). See shared/remoteJobs.ts;
// the setup guide's step states are in lib/nciSetup.ts.
import type { JobRow } from "../../../shared/ipc";
import type { ExternalTerminalState, InboundMailInput, InboundMailStatus, MarkExternalInput } from "../../../shared/remoteJobs";
import { isExternalJob, isJobFinished } from "./jobs";

export { isExternalJob };

/** Module `nci` (NCI 远程作业, default off): while it is off, no NCI UI shows anywhere. */
export const NCI_MODULE = "nci";

/** Short source name for a badge: nci → NCI. */
export function sourceLabel(source: string | null | undefined): string {
  if (!source || source === "local") return "";
  return source === "nci" ? "NCI" : source.toUpperCase();
}

/** The owner may settle an unfinished external job by hand (host feature job-external). */
export function canMarkExternal(job: Pick<JobRow, "source" | "state" | "exitCode">, hasFeature: boolean): boolean {
  return hasFeature && isExternalJob(job) && !isJobFinished(job);
}

export type MarkChoice = "succeeded" | "exitCode" | "failed" | "cancelled";
export interface MarkDraft {
  choice: MarkChoice;
  /** Text of the exit-code field (only for `exitCode`). */
  exitCode: string;
  note: string;
}
export type MarkError = "exitCodeInvalid" | "noteTooLong";

/**
 * The 手动标记 dialog's draft → the mark-external body. 成功 = exited 0; 退出码 N = exited N (a
 * nonnegative integer, as the scheduler reports it); 失败 / 已取消 carry no exit code.
 */
export function markInput(job: Pick<JobRow, "jobId" | "revision">, draft: MarkDraft): { input: MarkExternalInput } | { error: MarkError } {
  if (draft.note.length > 2048) return { error: "noteTooLong" };
  const note = draft.note.trim() ? { note: draft.note.trim() } : {};
  const base = { jobId: job.jobId, expectedRevision: job.revision };
  const state: Record<MarkChoice, ExternalTerminalState> = { succeeded: "exited", exitCode: "exited", failed: "failed", cancelled: "cancelled" };
  if (draft.choice === "succeeded") return { input: { ...base, state: "exited", exitCode: 0, ...note } };
  if (draft.choice === "exitCode") {
    const text = draft.exitCode.trim();
    if (!/^\d{1,10}$/.test(text) || Number(text) > 2 ** 31 - 1) return { error: "exitCodeInvalid" };
    return { input: { ...base, state: "exited", exitCode: Number(text), ...note } };
  }
  return { input: { ...base, state: state[draft.choice], ...note } };
}

/** What agents get as `qsub -M` and, when nothing, the message key explaining why. */
export function mailToView(status: InboundMailStatus | null | undefined): { address: string | null; reason: MailToReason | null; jobServiceMissing: boolean } {
  if (!status) return { address: null, reason: "unknown", jobServiceMissing: false };
  const address = typeof status.nciMailTo === "string" && status.nciMailTo ? status.nciMailTo : null;
  const known: readonly string[] = ["mailbox_not_configured", "nci_source_disabled", "receiver_disabled", "address_required"];
  const code = status.nciMailToStatus;
  const reason: MailToReason | null = address ? null : code && known.includes(code) ? (code as MailToReason) : status.nciMailToStatus === undefined ? "unsupported" : "unknown";
  // `jobServiceNotifyFile` false: cutex knows the address but the Job Service was not started with
  // `--external-notify-file`, so agents still get none.
  return { address, reason, jobServiceMissing: !!address && status.jobServiceNotifyFile === false };
}
export type MailToReason = "mailbox_not_configured" | "nci_source_disabled" | "receiver_disabled" | "address_required" | "unsupported" | "unknown";

/** The mailbox form, filled from the saved status (never a password). */
export function mailboxDraft(status: InboundMailStatus | null | undefined): Required<Omit<InboundMailInput, "address" | "password">> & { address: string; password: string } {
  return {
    enabled: status?.configured ? !!status.enabled : true,
    server: status?.server ?? "",
    port: status?.port ?? 993,
    username: status?.username ?? "",
    mailbox: status?.mailbox ?? "INBOX",
    sources: status?.configured ? (status.sources ?? []) : ["nci"],
    address: status?.address ?? "",
    password: "",
  };
}

/**
 * Whether saving needs the password again: a first configuration, or a changed server / port / login
 * (cutex keeps the saved password only for the same account).
 */
export function mailPasswordRequired(status: InboundMailStatus | null | undefined, draft: Pick<InboundMailInput, "server" | "port" | "username">): boolean {
  if (!status?.configured) return true;
  return status.server !== draft.server.trim() || status.port !== draft.port || status.username !== draft.username.trim();
}

/** Same conservative syntax cutex / the Job Service accept for `qsub -M`. */
export function validMailAddress(address: string): boolean {
  const at = address.indexOf("@");
  if (at < 1 || at !== address.lastIndexOf("@") || address.length > 254) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const labels = domain.split(".");
  return (
    local.length <= 64 &&
    /^[A-Za-z0-9._%+-]+$/.test(local) &&
    !/^[-.]/.test(local) &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    domain.length <= 253 &&
    labels.length >= 2 &&
    labels.every((l) => /^[A-Za-z0-9-]{1,63}$/.test(l) && !l.startsWith("-") && !l.endsWith("-"))
  );
}

const HOST_KEY_TYPES = ["ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"];

/**
 * Pinned Gadi host keys from pasted text: one per line, `TYPE BASE64` or a known_hosts /
 * `ssh-keyscan` line (`HOST TYPE BASE64 …`); blank and `#` lines are skipped. Duplicates dropped.
 */
export function parseHostKeys(text: string): { keys: string[]; invalid: number } {
  const keys: string[] = [];
  let invalid = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const at = parts.findIndex((p) => HOST_KEY_TYPES.includes(p));
    const blob = at >= 0 ? parts[at + 1] : undefined;
    if (at < 0 || !blob || !/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) {
      invalid++;
      continue;
    }
    const key = `${parts[at]} ${blob}`;
    if (!keys.includes(key)) keys.push(key);
  }
  return { keys, invalid };
}

/** Hours / days for a poll interval: 21600 → "6h", 86400 → "1d", 1800 → "30m". */
export function intervalLabel(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${Math.round(seconds / 60)}m`;
}
