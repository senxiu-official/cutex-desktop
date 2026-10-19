// Owner approvals (cutex `owner-approvals`, docs/agent-tool-security.md §7): an agent action that
// exceeds the caller's envelope (managed services run unsandboxed as the owner) or uses a profile
// marked `agentUseRequiresApproval` waits for the owner. The agent retries the same call after the
// decision. Pure helpers: the pending-list reducer for `cutex/approvals/changed` and display rows.
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { ApprovalDecision, ApprovalDecisionOrigin, ApprovalRecord } from "../../../shared/ipc";
import type { PeerCaps } from "../../../shared/peers";
import { deviceScopeOf, type HostUserAccess } from "../../../shared/users";

export const APPROVALS_FEATURE = "owner-approvals";
export const APPROVALS_CHANGED_EVENT = "cutex/approvals/changed";
/**
 * cutex watches its approval store, so approvals the Agent Bus requested (services, agent profiles)
 * reach the host stream live. Older cutex only published those in the Bus process — never live: the
 * desktop then reads them from the tool result (lib/approvals `approvalOfTool`) and reloads the list.
 */
export const APPROVALS_LIVE_FEATURE = "approvals-live";
/** cutex tells the requesting agent when the owner decided (retry now / do not retry). */
export const APPROVAL_NOTICE_FEATURE = "approval-decision-notice";
/**
 * cutex holds the agent's gated tool call up to 120 s for the decision (record `wait`): approved in
 * the window the call simply goes on; after that it answers approval_required as before.
 */
export const APPROVAL_WAIT_FEATURE = "approval-wait";
/**
 * cutex records who decided (`decidedBy`) and takes the deciding client's facts (`client`): the desktop
 * then says where (inline dock card / 审批) and how (pointer / touch / keyboard) the owner decided.
 */
export const APPROVAL_DECIDED_BY_FEATURE = "approval-decided-by";

/**
 * How a decision button was activated. Chromium dispatches a keyboard-activated click (Enter / Space on
 * the focused button) with `detail` 0 and no pointer type; a mouse / pen / touch click has `detail` ≥ 1.
 */
export function decisionInput(event: { detail: number; nativeEvent?: unknown }): ApprovalDecisionOrigin["input"] {
  const pointerType = (event.nativeEvent as { pointerType?: unknown } | undefined)?.pointerType;
  if (pointerType === "touch") return "touch";
  if (pointerType === "mouse" || pointerType === "pen") return "pointer";
  if (event.detail === 0) return "keyboard";
  return event.detail > 0 ? "pointer" : "unknown";
}

/** One errors.jsonl line (`reported`) per owner decision on this desktop: no note text, no details. */
export function approvalDecisionTrace(record: Pick<ApprovalRecord, "approvalId" | "kind" | "requesterCutexSessionId">, decision: ApprovalDecision, origin: ApprovalDecisionOrigin, hostId: string): string {
  return JSON.stringify({ source: "approval-decision", approvalId: record.approvalId, kind: record.kind, requester: record.requesterCutexSessionId, hostId, decision, ...origin });
}

/** Milliseconds the requesting call still holds for this decision (cutex approval-wait), else null. */
export function holdLeftMs(record: Pick<ApprovalRecord, "wait">, nowMs: number): number | null {
  const wait = record.wait;
  if (!wait || wait.end) return null;
  const until = Date.parse(wait.until);
  if (!Number.isFinite(until)) return null;
  const left = until - nowMs;
  return left > 0 ? left : null;
}

/** The call held for this request and stopped holding (timed out, its turn ended, …): it answered approval_required. */
export function holdEnded(record: Pick<ApprovalRecord, "wait">, nowMs: number): boolean {
  return !!record.wait && holdLeftMs(record, nowMs) === null;
}

/** "1:42" for a hold's remaining time (rounded up to whole seconds). */
export function formatHold(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** An owner approval a cutex tool call answered with (`approval_required` / `approval_denied`). */
export interface ToolApproval {
  approvalId: string;
  code: "approval_required" | "approval_denied";
  /** What it asks for, from the refusal text (cutex record summary), if readable. */
  summary: string | null;
}

const APPROVAL_ID = /\bapr-[0-9a-f]{8,64}\b/;

function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const content = (value as { content?: unknown }).content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join("\n");
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * The owner approval behind a finished cutex tool call (mcpToolCall on server `cutex`, Codex and
 * Claude alike), read from its result alone — works with every cutex since owner-approvals. Covers
 * the plain refusal (`{status: approval_required, approval_id}`) and Agent Management's receipt text
 * (`… (approval_id apr-…)`). Null for anything else. Pure and cheap enough for `timeline.tool` match.
 */
export function approvalOfTool(item: { type: string; server?: unknown; status?: unknown; result?: unknown; error?: unknown }): ToolApproval | null {
  if (item.type !== "mcpToolCall" || item.server !== "cutex") return null;
  if (item.status === "inProgress" || item.status === "running") return null;
  const text = resultText(item.result) || resultText(item.error);
  const code = text.includes("approval_required") ? "approval_required" : text.includes("approval_denied") ? "approval_denied" : null;
  if (!code) return null;
  const id = APPROVAL_ID.exec(text)?.[0];
  if (!id) return null;
  const summary = /needs the owner's approval \((.+?)\)\. The owner/.exec(text)?.[1] ?? null;
  return { approvalId: id, code, summary: summary ? summary.replace(/\\"/g, "\"") : null };
}

/** The tool approval carried by a host / session event (a cutex tool call finished), or null. */
export function approvalOfToolEvent(envelope: EventEnvelope): { item: ToolApproval; threadId: string | null } | null {
  const message = envelope.native?.message;
  if (!message || message.method !== "item/completed") return null;
  const params = message.params as { item?: { type?: unknown }; threadId?: unknown } | undefined;
  const item = params?.item;
  if (!item || typeof item !== "object" || typeof item.type !== "string") return null;
  const found = approvalOfTool(item as { type: string });
  return found ? { item: found, threadId: typeof params?.threadId === "string" ? params.threadId : null } : null;
}

/**
 * This connection may decide owner approvals on a host: the host has owner-approvals in this
 * connection's feature set (owner-only, so a non-owner connection never has it — the 审批 page's own
 * gate) and the device scope is `full` (a `chat` / `read` owner device cannot approve; an unknown
 * scope = an older cutex = not narrowed).
 */
export function canDecideApprovals(features: ReadonlySet<string>, access: HostUserAccess): boolean {
  return features.has(APPROVALS_FEATURE) && (deviceScopeOf(access) ?? "full") === "full";
}

/**
 * The owner review of a delegation (cutex pendingReview → an `ask_delivery` approval whose
 * `details.askId` names it; peers-v2 incoming asks the peer policy gates are the same kind) in a
 * host's pending list; null when the list is not loaded or has none for it.
 */
export function askReviewApproval(pending: readonly ApprovalRecord[] | null | undefined, askId: string): ApprovalRecord | null {
  return pending?.find((a) => a.kind === "ask_delivery" && a.state === "pending" && a.details?.askId === askId) ?? null;
}

/** Kinds whose requester retries its own call after the decision (cutex approval-decision-notice tells it). */
export const RETRYING_KINDS: ReadonlySet<string> = new Set(["managed_service", "service_lifetime", "static_root", "agent_profile", "browser_open"]);

/** Decisions seen this run (approvalId → state): the pending list drops them, the tool line still says what happened. */
const decided = new Map<string, ApprovalRecord["state"]>();

/** Remember a record's decided state (cutex/approvals/changed, a decision made here). */
export function noteApprovalState(record: Pick<ApprovalRecord, "approvalId" | "state">): void {
  if (record.state === "pending") return;
  decided.delete(record.approvalId);
  decided.set(record.approvalId, record.state);
  if (decided.size > 500) decided.delete(decided.keys().next().value!);
}

/** The decided state seen this run, if any. */
export function knownApprovalState(approvalId: string): ApprovalRecord["state"] | undefined {
  return decided.get(approvalId);
}

/**
 * Pending approvals of one agent that its own conversation shows as a card (browser claims have their own).
 * With cutex approval-wait (`holds`), a request whose call already stopped holding leaves the conversation —
 * the call answered approval_required, the request stays on 审批 and the tool line links there — and a
 * holding one comes first (the agent is waiting on it right now).
 */
export function agentPendingApprovals(pending: readonly ApprovalRecord[] | null, sessionId: string, nowMs: number, holds = false): ApprovalRecord[] {
  const mine = livePending(pending, nowMs).filter((a) => a.requesterCutexSessionId === sessionId);
  if (!holds) return mine;
  const shown = mine.filter((a) => !holdEnded(a, nowMs));
  return [...shown.filter((a) => holdLeftMs(a, nowMs) !== null), ...shown.filter((a) => holdLeftMs(a, nowMs) === null)];
}

export interface ApprovalChange {
  reason: "requested" | "approved" | "denied" | (string & {});
  approval: ApprovalRecord;
}

/** The change carried by a host event, or null for any other event. */
export function approvalChangeOf(envelope: EventEnvelope): ApprovalChange | null {
  if (envelope.cutex?.method !== APPROVALS_CHANGED_EVENT) return null;
  const params = envelope.cutex.params as { reason?: unknown; approval?: unknown } | undefined;
  const approval = params?.approval as ApprovalRecord | undefined;
  if (!approval || typeof approval.approvalId !== "string") return null;
  return { reason: typeof params?.reason === "string" ? params.reason : "", approval };
}

/** Newest first (cutex lists them that way too). */
export function sortApprovals(list: readonly ApprovalRecord[]): ApprovalRecord[] {
  return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.approvalId.localeCompare(a.approvalId));
}

/**
 * Apply a change to the pending list: a pending record is added / replaced, anything else leaves
 * it. A null list (not loaded yet) stays null — the next full load has the change.
 */
export function applyApprovalChange(pending: readonly ApprovalRecord[] | null, change: ApprovalChange): ApprovalRecord[] | null {
  if (!pending) return null;
  const rest = pending.filter((a) => a.approvalId !== change.approval.approvalId);
  return change.approval.state === "pending" ? sortApprovals([...rest, change.approval]) : rest;
}

/** Remove a record the owner just decided (before the event arrives). */
export function withoutApproval(pending: readonly ApprovalRecord[] | null, approvalId: string): ApprovalRecord[] | null {
  return pending ? pending.filter((a) => a.approvalId !== approvalId) : null;
}

/** Pending records that are still within cutex's 24 h lapse (an expired one may linger until reloaded). */
export function livePending(pending: readonly ApprovalRecord[] | null, nowMs: number): ApprovalRecord[] {
  const day = 24 * 3600 * 1000;
  return (pending ?? []).filter((a) => a.state === "pending" && !(Date.parse(a.createdAt) + day < nowMs));
}

/**
 * Approving grants authority the agent does not have itself: a managed service runs unsandboxed as
 * the owner; an approval-gated profile launches an agent on it. The approve button names it.
 */
export function grantKind(record: Pick<ApprovalRecord, "kind"> & { details?: ApprovalRecord["details"] }): "runAsOwner" | "useProfile" | "claimBrowser" | "openBrowser" | "runWorkflow" | "serveRoot" | "other" {
  // A static service root outside the agent's cwd / project workspace: every file under it is served.
  if (record.kind === "static_root") return "serveRoot";
  // A persistent service whose managed command the agent could not run unsandboxed itself: one
  // approval covers both, so the button names the larger grant.
  if (record.kind === "service_lifetime") return record.details?.managedExecution === true ? "runAsOwner" : typeof record.details?.staticRoot === "string" ? "serveRoot" : "other";
  return record.kind === "managed_service" ? "runAsOwner" : record.kind === "agent_profile" ? "useProfile"
    : record.kind === "browser_claim" ? "claimBrowser" : record.kind === "browser_open" ? "openBrowser" : record.kind === "workflow_run" ? "runWorkflow" : "other";
}

/** Fields of `details` in display order (known keys first), as label / text pairs; empty values skipped. */
const ORDER = ["op", "operation", "slug", "name", "staticRoot", "allowedRoots", "lifetime", "runtime", "command", "cwd", "port", "envKeys", "profile", "model", "sandboxMode", "approvalPolicy", "grants"];
/** Service records: shown by the approve button / warning line already, not as a raw fact. */
const HIDDEN = new Set(["managedExecution"]);

/** Shown by their own line (peers-v2 review cards), not as raw facts. */
const OWN_LINE = new Set(["claimedCaps", "claimedCapsLabel", "differences"]);

export function approvalFacts(details: ApprovalRecord["details"], kind?: ApprovalRecord["kind"]): { key: string; value: string; mono: boolean }[] {
  if (!details || typeof details !== "object") return [];
  if (kind === "browser_claim" || kind === "browser_open") {
    // Browser identities/digests are authority metadata, not request facts. Never stringify the
    // payload or display query/fragment credentials, including from a malformed older daemon.
    const fields = kind === "browser_claim" ? ["reason", "urlHint"] : ["title", "url"];
    return fields.flatMap(key => {
      const raw = details[key]; if (typeof raw !== "string" || !raw) return [];
      let value = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 2000);
      if (key === "url" || key === "urlHint") {
        if (value === "about:blank") return [{ key, value, mono: false }];
        const service = /^cutex:service\/([a-z0-9][a-z0-9-]{0,62})(?:\/|$)/.exec(value);
        if (service) return [{ key, value: `cutex:service/${service[1]}`, mono: false }];
        try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) return [];
          url.username = ""; url.password = ""; url.search = ""; url.hash = ""; value = url.href;
        } catch { return []; }
      }
      return [{ key, value, mono: false }];
    });
  }
  if (kind === "workflow_run") return workflowFacts(details);
  const keys = [...ORDER.filter((k) => k in details), ...Object.keys(details).filter((k) => !ORDER.includes(k) && !OWN_LINE.has(k) && !HIDDEN.has(k)).sort()];
  const out: { key: string; value: string; mono: boolean }[] = [];
  for (const key of keys) {
    const raw = details[key];
    if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) continue;
    const value = Array.isArray(raw) ? raw.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(key === "command" ? " " : ", ") : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    out.push({ key, value, mono: key === "command" || key === "cwd" || key === "slug" || key === "envKeys" || key === "port" });
  }
  return out;
}

/** A workflow run plan (cutex workflows): what the run may spend and on which profiles; digests stay out. */
function workflowFacts(details: Record<string, unknown>): { key: string; value: string; mono: boolean }[] {
  const out: { key: string; value: string; mono: boolean }[] = [];
  const text = (key: string, value: unknown, mono = false) => {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return;
    out.push({ key, value: Array.isArray(value) ? value.map(String).join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value), mono });
  };
  text("name", details.name);
  text("description", details.description);
  const phases = Array.isArray(details.phases) ? details.phases.map((p) => (p && typeof p === "object" && typeof (p as { title?: unknown }).title === "string" ? (p as { title: string }).title : null)).filter(Boolean) : [];
  if (phases.length) out.push({ key: "phases", value: phases.join(" → "), mono: false });
  text("stepProfiles", details.stepProfiles);
  text("claudeProfiles", details.claudeProfiles);
  text("models", details.models);
  if (typeof details.maxAgents === "number") out.push({ key: "workflowLimits", value: `${details.maxAgents} · ${details.maxConcurrency ?? "?"} · ${typeof details.maxTokens === "number" ? details.maxTokens.toLocaleString() : "?"}`, mono: false });
  if (details.hardStop === true) out.push({ key: "hardStop", value: "✓", mono: false });
  text("cwd", details.cwd, true);
  text("args", details.args, true);
  text("draftPath", details.draftPath, true);
  text("resumedFrom", details.resumedFrom, true);
  text("runId", details.runId, true);
  return out;
}

/**
 * A review card of a delegation from a paired host (peers-v2): cutex files the requester as
 * `peer:<peerId>:<remote session>` named 「name@label」, and puts what the requesting host says about
 * its agent in `details.claimedCaps` (display only). Null for anything else.
 */
export function approvalPeer(record: Pick<ApprovalRecord, "requesterCutexSessionId" | "requesterName" | "details">): { name: string; label: string; peerId: string; claimedCaps: PeerCaps | null } | null {
  const m = /^peer:(ci-[A-Fa-f0-9]{32}):(.+)$/.exec(record.requesterCutexSessionId ?? "");
  if (!m) return null;
  const full = record.requesterName ?? "";
  const at = full.lastIndexOf("@");
  const name = at > 0 ? full.slice(0, at) : full || m[2]!;
  const label = at > 0 ? full.slice(at + 1) : "";
  const caps = record.details?.claimedCaps;
  return { name, label, peerId: m[1]!, claimedCaps: caps && typeof caps === "object" && !Array.isArray(caps) ? (caps as PeerCaps) : null };
}

export type ApprovalDifferenceValue = string | number | boolean | null | (string | number | boolean | null)[];
export interface ApprovalDifference { field: string; requester: ApprovalDifferenceValue; target: ApprovalDifferenceValue }

/** Known cutex capability comparisons only; preserve unfamiliar payloads as collapsed JSON. */
export function approvalDifferences(raw: unknown): ApprovalDifference[] | null {
  if (!Array.isArray(raw)) return null;
  const scalar = (v: unknown) => v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v);
  const value = (v: unknown) => scalar(v) || Array.isArray(v) && v.every(scalar);
  return raw.every(row => row && typeof row === "object" && !Array.isArray(row)
    && typeof row.field === "string" && row.field.trim()
    && Object.hasOwn(row, "requester") && Object.hasOwn(row, "target")
    && Object.keys(row).every(key => ["field", "requester", "target"].includes(key))
    && value(row.requester) && value(row.target)) ? raw : null;
}
