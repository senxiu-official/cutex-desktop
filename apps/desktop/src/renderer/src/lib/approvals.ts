// Owner approvals (cutex `owner-approvals`, docs/agent-tool-security.md §7): an agent action that
// exceeds the caller's envelope (managed services run unsandboxed as the owner) or uses a profile
// marked `agentUseRequiresApproval` waits for the owner. The agent retries the same call after the
// decision. Pure helpers: the pending-list reducer for `cutex/approvals/changed` and display rows.
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { ApprovalRecord } from "../../../shared/ipc";
import type { PeerCaps } from "../../../shared/peers";

export const APPROVALS_FEATURE = "owner-approvals";
export const APPROVALS_CHANGED_EVENT = "cutex/approvals/changed";

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
export function grantKind(record: Pick<ApprovalRecord, "kind">): "runAsOwner" | "useProfile" | "claimBrowser" | "openBrowser" | "runWorkflow" | "other" {
  return record.kind === "managed_service" ? "runAsOwner" : record.kind === "agent_profile" ? "useProfile"
    : record.kind === "browser_claim" ? "claimBrowser" : record.kind === "browser_open" ? "openBrowser" : record.kind === "workflow_run" ? "runWorkflow" : "other";
}

/** Fields of `details` in display order (known keys first), as label / text pairs; empty values skipped. */
const ORDER = ["op", "operation", "slug", "name", "runtime", "command", "cwd", "port", "envKeys", "profile", "model", "sandboxMode", "approvalPolicy"];

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
  const keys = [...ORDER.filter((k) => k in details), ...Object.keys(details).filter((k) => !ORDER.includes(k) && !OWN_LINE.has(k)).sort()];
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
