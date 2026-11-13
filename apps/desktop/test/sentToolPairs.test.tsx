// @vitest-environment jsdom
// One row per sent message (lib/sentToolPairs). Shapes as the live Host-A daemon wrote them on 2026-11-05: the
// Director's turn 1bdb11ca sent the same text as a plain agent_tell to agent-rename-impl and as revision v8 of
// delegation-7f2ea8 to r276-integrator; cutex's messageSent came between item/started and item/completed. The tool
// result (fix/tell-result-message-id) names the bus message by messageId; the bus event carries the same id.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";

const prefs = vi.hoisted(() => ({ agentMessages: "compact" }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (selector: (state: Record<string, never>) => unknown) => selector({}), sidebarOf: () => null }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvHost: () => "local", useConvScope: () => null, convFeaturesOf: () => ({ has: () => true }) }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => prefs }));
vi.mock("../src/renderer/src/lib/userLayoutToggle", () => ({ useUserLayoutToggle: () => (action: () => void) => action() }));
vi.mock("../src/renderer/src/lib/wakeBusyWaitView", () => ({ useWakeHint: () => null }));
vi.mock("../src/renderer/src/lib/agentMessageStore", () => ({ useAgentMessage: () => null }));
vi.mock("../src/renderer/src/components/MessageSettlementControl", () => ({ MessageSettlementControl: () => null }));
vi.mock("../src/renderer/src/components/AgentMessageParts", () => ({
  KindTag: () => null, EnvelopeBadges: () => null,
  SentStatus: ({ messageId }: { messageId: string }) => h("span", { "data-sent-status": messageId }),
}));
vi.mock("../src/renderer/src/components/SystemAvatar", () => ({ SenderAvatar: () => null }));

const { applyEvent, orderedEntries, timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const { pairSentCalls } = await import("../src/renderer/src/lib/sentToolPairs");
const { BusMessage } = await import("../src/renderer/src/components/BusMessage");

const ME = "cutex.46ce41c5-b601-50e5-b875-93b6c6324d52";
const RENAME = "cutex.f5fa0dcf-255b-51df-bdf2-931bfca013ae";
const INTEGRATOR = "cutex.7d6793bf-fec1-5ff0-b85b-3bbcfa855cc4";
const TURN = "ca5c7a01-b424-5e8f-a9e9-e8f64f7eefa8";
const TEXT = "Pin decision: the local normaliser skips pins for remote addresses; peers/* owns those with its current digests. No *_with_digest helper needed.";
const REVISION_BODY = `[delegation delegation-7f2ea8 · revision v8] from cutex-chief-HostA-Alice\n${TEXT}\n(Confirm you applied it: delegation_progress(delegation="delegation-7f2ea8", ack="v8", text="…").)`;

const base = { contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "", cutexSessionId: ME, hostId: "Host-A", sensitivity: "owner", correlation: {} } as const;
const native = (method: string, params: unknown): EventEnvelope => ({ ...base, source: "app_server", native: { kind: "notification", message: { method, params } } } as EventEnvelope);
const messageSent = (messageId: string, to: string, name: string, body: string): EventEnvelope => ({
  ...base, source: "cutex", correlation: { agentBusMessageId: messageId },
  cutex: { method: "cutex/agentBus/messageSent", params: {
    messageId, fromCutexSessionId: ME, toCutexSessionId: to, deliveryMode: "passive", deliveryKind: "note", content: body, body,
    recipient: { id: to, name, runtime: "codex" }, sender: { id: ME, name: "cutex-chief-HostA-Alice", runtime: "claude" }, senderTurnId: TURN,
  } },
} as EventEnvelope);
const tell = (id: string, args: Record<string, unknown>, result?: Record<string, unknown>) => ({
  type: "mcpToolCall", id, server: "cutex", tool: "agent_tell", arguments: args, status: result ? "completed" : "inProgress", error: null,
  result: result ? { _meta: null, content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: null } : null,
});
const plainResult = { action_id: "auto-6fea38d943322ff3b33d89778b772e58", deliveryKind: "note", detail: "Sent as a note. agent-rename-impl is busy: it reads the note at its next step; no new turn starts.", name: "agent-rename-impl", ok: true, recipientState: "busy", to: "cutex.…f0727a" };
const revisionResult = { action_id: "auto-e5245edb21365b3c3e43272e24dbc976", delegation: "delegation-7f2ea8", deliveryKind: "note", detail: "Sent as a note. r276-integrator is busy: it reads the note at its next step; no new turn starts.", name: "r276-integrator", ok: true, recipientState: "busy", revision: { id: "v8", level: "sent", supersedes: null }, to: "cutex.…8cfc52" };
// fix/tell-result-message-id: the result names the bus message it sent (the messageSent event's messageId).
const PLAIN_ID = "7b5a49ae-4695-5410-9eed-baa5e25f30c9", REV_ID = "142d1748-6253-57ec-ba56-f91e2b57b680";
const withId = (result: Record<string, unknown>, messageId: string) => ({ ...result, messageId });

function turn(steps: (state: ReturnType<typeof timelineFromThreadRead>) => void) {
  const state = timelineFromThreadRead({ thread: { id: "th", turns: [] } });
  applyEvent(state, native("turn/started", { threadId: "th", turn: { id: TURN, status: "inProgress", items: [] } }));
  steps(state);
  return state;
}
const item = (phase: "started" | "completed", value: unknown) => native(`item/${phase}`, { threadId: "th", turnId: TURN, item: value });
const rows = (state: ReturnType<typeof timelineFromThreadRead>) => pairSentCalls(orderedEntries(state)).map(e => e.kind === "sent" ? { sent: e.messageId, preview: e.preview, text: e.text } : { [e.kind]: e.id });
const plainArgs = { to: "agent-rename-impl", text: TEXT }, revisionArgs = { delegation: "delegation-7f2ea8", text: TEXT };

describe("a sent message and the call that sent it are one row, paired by messageId", () => {
  it("the Director's turn: the same text as a plain note and as a revision, each with its own call", () => {
    const state = turn(s => {
      // Calls listed in the other order than their bus events: only the id decides.
      applyEvent(s, item("started", tell("44536333", revisionArgs)));
      applyEvent(s, item("started", tell("593ac4be", plainArgs)));
      applyEvent(s, messageSent(PLAIN_ID, RENAME, "agent-rename-impl", TEXT));
      applyEvent(s, messageSent(REV_ID, INTEGRATOR, "r276-integrator", REVISION_BODY));
      applyEvent(s, item("completed", tell("593ac4be", plainArgs, withId(plainResult, PLAIN_ID))));
      applyEvent(s, item("completed", tell("44536333", revisionArgs, withId(revisionResult, REV_ID))));
    });
    expect(orderedEntries(state)).toHaveLength(4);
    expect(rows(state)).toEqual([
      { sent: PLAIN_ID, preview: undefined, text: TEXT },
      // The revision row reads as the Director wrote it (the call's text argument); the whole body stays on the entry.
      { sent: REV_ID, preview: TEXT, text: REVISION_BODY },
    ]);
  });

  it("between the bus event and item/completed both rows show; then the call's row goes and the sent row keeps its place and key", () => {
    const state = turn(s => {
      applyEvent(s, item("completed", { type: "commandExecution", id: "cmd-before", command: "git status", status: "completed" }));
      applyEvent(s, item("started", tell("44536333", revisionArgs)));
      applyEvent(s, messageSent(REV_ID, INTEGRATOR, "r276-integrator", REVISION_BODY));
    });
    const during = pairSentCalls(orderedEntries(state));
    expect(during.map(e => e.id)).toEqual(["cmd-before", "44536333", `sent:${REV_ID}`]);
    applyEvent(state, item("completed", { type: "commandExecution", id: "cmd-after", command: "git log", status: "completed" }));
    applyEvent(state, item("completed", tell("44536333", revisionArgs, withId(revisionResult, REV_ID))));
    const after = pairSentCalls(orderedEntries(state));
    expect(after.map(e => e.id)).toEqual(["cmd-before", `sent:${REV_ID}`, "cmd-after"]);
    expect(after[1]).toMatchObject({ kind: "sent", preview: TEXT, text: REVISION_BODY, messageId: REV_ID });
  });

  it("no messageId (a host before the release, a refusal): both rows stay, the same text pairs nothing", () => {
    const refused = { ok: false, status: "no_write", code: "tell_refused", detail: "target offline" };
    const state = turn(s => {
      applyEvent(s, item("completed", tell("593ac4be", plainArgs, plainResult)));
      applyEvent(s, messageSent(PLAIN_ID, RENAME, "agent-rename-impl", TEXT));
      applyEvent(s, item("completed", tell("x1", plainArgs, refused)));
    });
    const entries = orderedEntries(state);
    expect(pairSentCalls(entries)).toBe(entries);
    expect(rows(state)).toEqual([{ tool: "593ac4be" }, { sent: PLAIN_ID, preview: undefined, text: TEXT }, { tool: "x1" }]);
  });

  it("a messageId with no sent row here (an older page, another stream) leaves the call's row", () => {
    const state = turn(s => {
      applyEvent(s, item("completed", tell("44536333", revisionArgs, withId(revisionResult, REV_ID))));
      applyEvent(s, messageSent(PLAIN_ID, RENAME, "agent-rename-impl", TEXT));
    });
    expect(rows(state)).toEqual([{ tool: "44536333" }, { sent: PLAIN_ID, preview: undefined, text: TEXT }]);
  });

  it("the paired entry keeps its identity across renders", () => {
    const state = turn(s => {
      applyEvent(s, messageSent(REV_ID, INTEGRATOR, "r276-integrator", REVISION_BODY));
      applyEvent(s, item("completed", tell("44536333", revisionArgs, withId(revisionResult, REV_ID))));
    });
    const entries = orderedEntries(state);
    expect(pairSentCalls([...entries])[0]).toBe(pairSentCalls(entries)[0]);
  });
});

describe("the kept row", () => {
  const render = () => renderToStaticMarkup(h(BusMessage, { direction: "out", name: "r276-integrator", mode: "passive", text: REVISION_BODY, preview: TEXT, kind: "note", messageId: "m-rev", recipientId: INTEGRATOR, onContextMenu: () => {} }));
  it("collapsed: the Director's own words, its delivery status; no raw revision header", () => {
    prefs.agentMessages = "compact";
    const html = render();
    const preview = html.match(/data-testid="bus-message-preview"[^>]*>(.*?)<\/span><svg/)![1]!;
    expect(preview).toContain("Pin decision: the local normaliser");
    expect(preview).not.toContain("[delegation");
    expect(html).toContain('data-sent-status="m-rev"');
  });
  it("opened: the whole body as sent, header and confirmation hint included", () => {
    prefs.agentMessages = "full";
    const html = render();
    expect(html).toContain("message-body");
    expect(html).toContain("[delegation delegation-7f2ea8 · revision v8] from cutex-chief-HostA-Alice");
    expect(html).toContain("ack=&quot;v8&quot;");
    expect(html).toContain('data-sent-status="m-rev"');
  });
});
