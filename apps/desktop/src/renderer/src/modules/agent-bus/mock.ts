// Mock cutex for the browser preview.
// - `wake-busy-wait`: `/v2/settings` agentBus.wakeBusyWaitSecs (PATCH {agentBus} lands in core.settings;
//   a negative value reads as null = never early, like cutex). Default 120 s; `?wakeoff` starts with null
//   (the old 本轮结束后处理 label).
// - `agent-bus-stuck-messages`: five stuck messages in cutex's wire shape (`GET /v2/agent-bus/stuck-messages`,
//   run through the same adapter main uses), and a discard that removes them like cutex (a Task / Job /
//   control message needs allowProtected, a changed digest or a missing id is refused). `?stuck=empty`:
//   nothing is stuck; `?stuck=down`: the live bus cannot be read; `?stuck=fail`: discarding the ordinary
//   message "m-a1" is refused (message_digest_mismatch).
import { asStuckDiscarded, asStuckView } from "../../../../shared/agentBusStuck";
import type { MessageSettlement, MessageSettlementCloseRequest } from "@cutex-desktop/protocol";
import { MESSAGE_SETTLEMENT_EVENT, MESSAGE_SETTLEMENT_FEATURE, STALE_ACK_SETTLEMENT_FEATURE } from "../../../../shared/messageSettlement";
import type { ModuleMock } from "../../dev/mockTypes";

const DEFAULT_SECS = 120;
const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const startOff = params.has("wakeoff");
const STUCK = params.get("stuck");

// Preview-only facts stay inside this module mock; production code never imports fixtures.
function settlementFixture(): MessageSettlement {
  return {
    state: "outcome_unknown", canClose: true, evidenceToken: "settlement-evidence-1",
    evidence: { runtime: "claude", runtimeGeneration: 3, threadId: "settlement-thread", actualTurnId: "settlement-turn", terminalStatus: "interrupted", observedAt: new Date().toISOString() },
    closure: null,
  };
}

function wakeBusyWaitSecs(settings: Record<string, unknown>): number | null {
  const agentBus = settings.agentBus as { wakeBusyWaitSecs?: unknown } | undefined;
  if (!agentBus || !("wakeBusyWaitSecs" in agentBus)) return startOff ? null : DEFAULT_SECS;
  const secs = agentBus.wakeBusyWaitSecs;
  return typeof secs === "number" && secs >= 0 ? secs : null;
}

interface WireRow {
  settlement?: MessageSettlement;
  messageId: string;
  state: string;
  durable: boolean;
  to: { id: string; name: string | null };
  from: { id: string; name: string | null } | null;
  /** Seconds before now. */
  waitedSecs: number;
  senderKind: string;
  protectedControl?: boolean;
  nativeSubmissionPresent?: boolean;
  error?: { source: string; code: string; message: string } | null;
  reasons: string[];
  contentPreview: string;
}

const sha = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const party = (name: string) => ({ id: `cutex.${name.toLowerCase()}-7f3a`, name });

let rows: WireRow[] =
  STUCK === "empty"
    ? []
    : [
        {
          messageId: "m-a1", state: "pending", durable: true, to: party("Misato"), from: party("Beta"), waitedSecs: 6 * 3600 + 900, senderKind: "cutex",
          reasons: ["not in any live runtime queue: the recipient runtime is not registered; it is redriven when the recipient registers again"],
          contentPreview: "Misato, the migration branch is rebased onto integ/side-20261010. Please re-run the module tests and reply with the failing names, if any. I will hold the merge until I hear from you.",
        },
        {
          messageId: "m-b2", state: "stale_held", durable: true, to: party("Rei"), from: { id: "owner", name: null }, waitedSecs: 2 * 86_400 + 4000, senderKind: "owner",
          reasons: ["held at startup redrive: older than the stale threshold, never submitted to the native runtime"],
          contentPreview: "把预览截图发我一下，浅色和深色各一张。",
        },
        {
          messageId: "m-c3", state: "pending", durable: true, to: party("Shinji"), from: null, waitedSecs: 3 * 3600 + 120, senderKind: "job_service", protectedControl: true,
          reasons: ["queued for a registered runtime that keeps polling it without ACK", "Task / Job / control message: check its assignment or job before discarding"],
          contentPreview: "Job job-4f2e1a finished: exit 0 after 41 min. Summary: cargo test --release passed (1,204 tests). Output: job read job-4f2e1a",
        },
        {
          messageId: "m-d4", state: "live_only", durable: false, to: party("Kaji"), from: { id: "cutex-alarm", name: null }, waitedSecs: 5400, senderKind: "alarm_service",
          reasons: ["queued for a registered runtime that keeps polling it without ACK", "no durable record (in-memory only): discard withdraws it from the queue; its producer may queue it again"],
          contentPreview: "Alarm: check the nightly build of cutex r220 at 09:00.",
        },
        {
          messageId: "m-e5", state: "pending", durable: true, to: party("Mari"), from: party("Rei"), waitedSecs: 4000, senderKind: "cutex", nativeSubmissionPresent: true,
          error: { source: "cutex", code: "native_ingress_timeout", message: "the native runtime did not confirm the input" },
          reasons: ["frozen for the native runtime, not confirmed", "last error: native_ingress_timeout", "discard quarantines it; the native runtime may still hold a copy"],
          contentPreview: "Mari: the diff review is ready in the shared worktree. Findings: 2 blocking, 3 nits. Start with the daemon.ts hunk, it changes the refusal path.",
        },
      ];

const settlementRow: WireRow = {
  messageId: "m-settlement", state: "inbox_accepted", durable: true, to: { id: "scratch", name: "Scratch" }, from: party("Mika"), waitedSecs: 8000,
  senderKind: "cutex", nativeSubmissionPresent: true, reasons: [], contentPreview: "请检查迁移结果并回复。", settlement: settlementFixture(),
};
if (params.has("settlement")) rows.push(settlementRow);
const closeRequests = new Map<string, { request: MessageSettlementCloseRequest; settlement: MessageSettlement }>();

function wire(row: WireRow, nowSecs: number): Record<string, unknown> {
  return {
    messageId: row.messageId,
    ...(row.settlement ? { settlement: row.settlement } : {}),
    state: row.state,
    durable: row.durable,
    to: row.to,
    from: row.from,
    createdAtEpochSecs: nowSecs - row.waitedSecs,
    ageSecs: row.waitedSecs,
    senderKind: row.senderKind,
    protectedControl: row.protectedControl ?? false,
    nativeSubmissionPresent: row.nativeSubmissionPresent ?? false,
    semanticSha256: row.durable ? sha(row.messageId.charCodeAt(2)) : null,
    error: row.error ?? null,
    reasons: row.reasons,
    contentPreview: row.contentPreview,
  };
}

export const mock: ModuleMock = {
  features: { new: ["wake-busy-wait", "agent-bus-stuck-messages", MESSAGE_SETTLEMENT_FEATURE, STALE_ACK_SETTLEMENT_FEATURE] },
  cutexState: (sessionId) => ({
    ...(params.has("settlement") && sessionId === "scratch" ? { agentBusMessages: rows.filter((r) => r.settlement).map((r) => ({ ...wire(r, Date.now() / 1000), fromCutexSessionId: "mika", toCutexSessionId: "scratch", body: r.contentPreview, deliveryKind: "wake" })) } : {}),
  }),
  settings: (core) => ({
    agentBus: { wakeBusyWaitSecs: wakeBusyWaitSecs(core.settings) },
    agentBusDefault: { wakeBusyWaitSecs: DEFAULT_SECS },
    agentBusRange: { wakeBusyWaitSecs: [0, 86_400] },
  }),
  api: (core) => ({
    async stuckBusMessages(minAgeSecs) {
      if (core.legacy) return null;
      await new Promise((r) => setTimeout(r, 250));
      const now = Math.floor(Date.now() / 1000);
      const listed = rows.filter((r) => r.settlement?.state !== "closed" && r.waitedSecs >= minAgeSecs).sort((a, b) => b.waitedSecs - a.waitedSecs);
      return asStuckView(
        {
          messages: listed.map((r) => wire(r, now)),
          total: listed.length,
          liveQueue: STUCK === "down" ? { available: false, error: "connection refused (127.0.0.1:24260)" } : { available: true },
          minAgeSecs,
          generatedAt: new Date().toISOString(),
        },
        minAgeSecs,
      );
    },
    async busMessageEvidence({ messageId }) {
      const row = rows.find(r => r.messageId === messageId);
      return row ? { ok: true, result: { messageId, settlement: row.settlement ?? null } }
        : { ok: false, error: { status: 404, code: "message_not_found", message: "Unknown message" } };
    },
    async closeBusMessage(request) {
      await new Promise((r) => setTimeout(r, 350));
      const refuse = (status: number, code: string) => ({ ok: false as const, error: { status, code, message: code } });
      const previous = closeRequests.get(request.requestId);
      if (previous) return JSON.stringify(previous.request) === JSON.stringify(request)
        ? { ok: true, result: { messageId: request.messageId, changed: false, settlement: previous.settlement } }
        : refuse(409, "request_key_conflict");
      const row = rows.find((r) => r.messageId === request.messageId);
      if (!row?.settlement) return refuse(404, "message_not_found");
      if (row.settlement.evidenceToken !== request.expectedEvidenceToken || !row.settlement.canClose) return refuse(409, "evidence_changed");
      row.settlement = { ...row.settlement, state: "closed", canClose: false, closure: { actor: "owner", closedAt: new Date().toISOString(), reason: request.reason, requestId: request.requestId } };
      closeRequests.set(request.requestId, { request: { ...request }, settlement: row.settlement });
      core.emitCutex("scratch", MESSAGE_SETTLEMENT_EVENT, { messageId: row.messageId, requestId: request.requestId, settlement: row.settlement });
      return { ok: true, result: { messageId: row.messageId, changed: true, settlement: row.settlement } };
    },
    async discardStuckBusMessage(request) {
      await new Promise((r) => setTimeout(r, 350));
      const refuse = (code: string, message: string) => ({ ok: false as const, error: { code, message } });
      const row = rows.find((r) => r.messageId === request.messageId);
      if (!row) return refuse("message_not_found", "no stuck message has this id");
      if (STUCK === "fail" && row.messageId === "m-a1") return refuse("message_digest_mismatch", "the message changed since it was listed");
      if (row.durable && request.expectedSemanticSha256 && request.expectedSemanticSha256 !== sha(row.messageId.charCodeAt(2))) return refuse("message_digest_mismatch", "the message changed since it was listed");
      if (row.protectedControl && !request.allowProtected) return refuse("message_protected", "Task / Job / control messages need allowProtected");
      rows = rows.filter((r) => r !== row);
      // cutex: the record becomes terminal (discarded, or quarantined when the native runtime may hold it) and the bus drops it.
      return { ok: true, discarded: asStuckDiscarded({ messageId: row.messageId, discarded: true, changed: true, liveWithdrawn: [{ agentId: row.to.id }] }, row.messageId) };
    },
  }),
};
