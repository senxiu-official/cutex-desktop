// r289 owner dispositions (plan .claude/agent-artifacts/state-surfaces-fix-plan.md WP-D0): the new owner routes name
// the stored record and work for archived / deleted agents; each call prefers its route when the host advertises it and
// keeps today's session path on older hosts. What an older host cannot do is refused before any write.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
import { CutexClient } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";
import { jobCanCloseFollowUp, ownerDispositionFeatureList, ownerDispositionSupport } from "../src/shared/ownerDispositions";

const NOTE = { notificationId: "n1", agentId: "gone", agentName: "Gone", origin: "agent", text: "hi", level: "attention", requestedLevel: "attention", downgraded: null, muted: false, channels: [], needsReply: false, delegation: null, job: null, turnId: null, state: "dismissed", createdAt: "2026-11-17T00:00:00Z", acknowledgedAt: null, reply: null, closedAt: "2026-11-17T00:01:00Z" };
const SETTLEMENT = { state: "closed", outcome: "unconfirmed", by: "owner", canClose: false, evidence: null, evidenceToken: "", closure: { actor: "owner", closedAt: "2026-11-17T00:00:00Z", reason: "r", requestId: "act-1" } };
const ERR = (status: number, code: string) => Response.json({ contractVersion: 2, error: { source: "cutex", code, message: code, retryable: false } }, { status });

type Call = { method: string; path: string; body: unknown };
/** A daemon whose host advertises `caps`; `route(call)` answers everything else (default: a plausible success). */
function fixture(caps: Record<string, unknown>, route: (call: Call) => Response | undefined = () => undefined, jobCaps: unknown = { humanOperations: ["list", "cancel"] }) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    if (url.pathname === "/v2/capabilities") return Response.json({ hostId: "h", ...caps });
    calls.push(call);
    const own = route(call);
    if (own) return own;
    if (url.pathname === "/v2/job-service/capabilities") return Response.json(jobCaps);
    if (url.pathname.startsWith("/v2/asks/")) return Response.json({ ask: { askId: "a1", closed: "stopped" }, receipt: { actionId: "act-1" }, stopping: false });
    if (url.pathname.startsWith("/v2/owner-notifications/")) return Response.json({ notification: NOTE, changed: true });
    if (url.pathname === "/v2/agent-bus/stuck-messages/end-follow-up") return Response.json({ messageId: "m1", changed: true, settlement: SETTLEMENT });
    if (url.pathname === "/v2/job-service/close-follow-up") return Response.json({ jobId: "j1", state: "unconfirmed", terminalReason: "followUpEnded", revision: 4 });
    if (url.pathname.endsWith("/cutex/requests")) return Response.json({ cutex: { result: { notification: NOTE } } });
    return Response.json({});
  });
  const daemon = new DaemonService(() => {});
  (daemon as unknown as { client: CutexClient }).client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "synthetic" }, { fetch });
  return { daemon, calls };
}
const NEW = { featureList: ["owner-ask-disposition-v1", "owner-notify-direct-v1", "agent-bus-owner-end-followup-v1"] };
const OLD = { featureList: ["services"] };

describe("capability probes", () => {
  it("reads kebab names, camel `features` flags and top-level camel flags; older hosts have none", () => {
    expect(ownerDispositionSupport({ featureList: ["owner-ask-disposition-v1", "stop-answer-admission-v1"] })).toEqual({ askDisposition: true, ownerNotifyDirect: false, messageEndFollowUp: false, askStopSettlement: false, stopAnswerAdmission: true });
    expect(ownerDispositionSupport({ featureList: [], features: { askStopSettlementV1: true, ownerNotifyDirectV1: true } })).toMatchObject({ askStopSettlement: true, ownerNotifyDirect: true, askDisposition: false });
    expect(ownerDispositionSupport({ featureList: [], stopAnswerAdmissionV1: true } as never).stopAnswerAdmission).toBe(true);
    expect(Object.values(ownerDispositionSupport(OLD)).some(Boolean)).toBe(false);
    expect(Object.values(ownerDispositionSupport(null)).some(Boolean)).toBe(false);
    expect(ownerDispositionFeatureList({ featureList: [], features: { askStopSettlementV1: true } })).toEqual(["ask-stop-settlement-v1"]);
    expect(jobCanCloseFollowUp({ humanOperations: ["list", "closeFollowUp"] })).toBe(true);
    expect(jobCanCloseFollowUp({ humanOperations: ["list", "cancel"] })).toBe(false);
    expect(jobCanCloseFollowUp(null)).toBe(false);
  });

  it("main adds the kebab names of camel flags to featureList (the renderer gates on features.has)", async () => {
    const { daemon } = fixture({ featureList: ["services"], features: { askStopSettlementV1: true }, stopAnswerAdmissionV1: true });
    const caps = await daemon.capabilities();
    expect(caps?.featureList).toEqual(expect.arrayContaining(["services", "ask-stop-settlement-v1", "stop-answer-admission-v1"]));
    expect(await daemon.ownerDispositionSupport()).toMatchObject({ askStopSettlement: true, stopAnswerAdmission: true, askDisposition: false });
  });
});

describe("askDispose", () => {
  it("new host: POST /v2/asks/{askId}/close with outcome + actionId only; no session involved", async () => {
    const { daemon, calls } = fixture(NEW);
    expect(await daemon.askDispose("archived-agent", "a1", "followUpEnded", "act-1")).toEqual({ ok: true, route: "ask", ask: { askId: "a1", closed: "stopped" } });
    expect(calls).toEqual([{ method: "POST", path: "/v2/asks/a1/close", body: { outcome: "followUpEnded", actionId: "act-1" } }]);
    for (const outcome of ["stop", "abandoned", "accepted"] as const) await daemon.askDispose("", "a1", outcome, `act-${outcome}`);
    expect(calls.slice(1).map((c) => c.body)).toEqual([{ outcome: "stop", actionId: "act-stop" }, { outcome: "abandoned", actionId: "act-abandoned" }, { outcome: "accepted", actionId: "act-accepted" }]);
  });

  it("new host refusals come back as refusals (idempotency_conflict, owner_required)", async () => {
    const { daemon } = fixture(NEW, (c) => (c.path === "/v2/asks/a1/close" ? ERR(409, "idempotency_conflict") : undefined));
    expect(await daemon.askDispose("t", "a1", "stop", "act-1")).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
  });

  it("older host: stop / close on the target's session as before; 结束跟进 refused with no request", async () => {
    const { daemon, calls } = fixture(OLD);
    expect(await daemon.askDispose("eva", "a1", "stop", "act-1")).toEqual({ ok: true, route: "session" });
    expect(await daemon.askDispose("eva", "a1", "abandoned", "act-2")).toEqual({ ok: true, route: "session" });
    expect(calls.map((c) => [c.path, (c.body as { method: string; params: unknown }).method, (c.body as { params: unknown }).params])).toEqual([
      ["/v2/sessions/eva/cutex/requests", "cutex/ask/stop", { askId: "a1" }],
      ["/v2/sessions/eva/cutex/requests", "cutex/ask/close", { askId: "a1", outcome: "abandoned" }],
    ]);
    expect(await daemon.askDispose("eva", "a1", "followUpEnded", "act-3")).toEqual({ ok: false, error: { code: "owner_disposition_unsupported", message: expect.any(String) } });
    expect(calls).toHaveLength(2);
  });

  it("refuses malformed input before any request", async () => {
    const { daemon, calls } = fixture(NEW);
    await expect(daemon.askDispose("t", "../x", "stop", "act")).rejects.toThrow("bad ask id");
    await expect(daemon.askDispose("t", "a1", "delete" as never, "act")).rejects.toThrow("bad outcome");
    await expect(daemon.askDispose("t", "a1", "stop", "")).rejects.toThrow("bad action id");
    expect(calls).toEqual([]);
  });
});

describe("owner notices and safety blocks", () => {
  it("new host: ack / dismiss / delete by the notice's own id (an archived agent's notice too); reply stays on the session", async () => {
    const { daemon, calls } = fixture(NEW);
    for (const action of ["ack", "dismiss", "delete"] as const) expect(await daemon.ownerNotifyAction("gone", action, "n1")).toMatchObject({ ok: true, notification: { notificationId: "n1" } });
    await daemon.ownerNotifyAction("gone", "reply", "n1", "ok");
    expect(calls.map((c) => c.path)).toEqual(["/v2/owner-notifications/n1/ack", "/v2/owner-notifications/n1/dismiss", "/v2/owner-notifications/n1/delete", "/v2/sessions/gone/cutex/requests"]);
  });

  it("older host: every action on the agent's session as before", async () => {
    const { daemon, calls } = fixture(OLD);
    await daemon.ownerNotifyAction("eva", "dismiss", "n1");
    expect(calls).toEqual([{ method: "POST", path: "/v2/sessions/eva/cutex/requests", body: expect.objectContaining({ method: "cutex/ownerNotify/dismiss", params: { notificationId: "n1" } }) }]);
  });

  // cutex makes the notice's id (ntf-…) apart from the runtime's block id (sb-…): the direct route names the notice,
  // the session methods name the block (mobile-approvals review, desktop daemon.ts).
  const SAFETY = { ...NOTE, notificationId: "ntf-7", systemKind: "safetyBlock", safetyBlock: { blockId: "sb-runtime-distinct", state: "dismissed" } };
  it("new host: 不批准 goes to safety-dismiss by the NOTICE id (no runtime); 批准一次 still names the block on the live agent", async () => {
    const { daemon, calls } = fixture(NEW, (c) =>
      c.path === "/v2/owner-notifications/ntf-7/safety-dismiss" ? Response.json({ notification: SAFETY, block: SAFETY.safetyBlock })
      : c.path.startsWith("/v2/owner-notifications/") ? ERR(404, "safety_block_not_found")
      : undefined);
    expect(await daemon.safetyCheckDecide("gone", "sb-runtime-distinct", "dismiss", "ntf-7")).toMatchObject({ ok: true, notification: { notificationId: "ntf-7" }, noticeError: null });
    await daemon.safetyCheckDecide("gone", "sb-runtime-distinct", "grant", "ntf-7");
    expect(calls.map((c) => c.path)).toEqual(["/v2/owner-notifications/ntf-7/safety-dismiss", "/v2/sessions/gone/cutex/requests"]);
    expect(calls[1]!.body).toMatchObject({ method: "cutex/safetyCheck/grant", params: { blockId: "sb-runtime-distinct" } });
  });

  it("older host: 不批准 stays on the session and names the block", async () => {
    const { daemon, calls } = fixture(OLD);
    await daemon.safetyCheckDecide("eva", "sb-runtime-distinct", "dismiss", "ntf-7");
    expect(calls).toEqual([{ method: "POST", path: "/v2/sessions/eva/cutex/requests", body: expect.objectContaining({ method: "cutex/safetyCheck/dismiss", params: { blockId: "sb-runtime-distinct" } }) }]);
  });

  it.each([
    ["r289+ noticeError", { noticeError: { code: "agent_bus_unavailable", message: "approval notice delivery failed", retryable: true } }],
    ["older submitError", { submitError: { code: "agent_bus_unavailable", message: "approval notice delivery failed", retryable: true } }],
  ])("granted but the agent was not told (%s): ok with the warning, the grant stands, sent once", async (_name, extra) => {
    const granted = { ...SAFETY, state: "acknowledged", safetyBlock: { blockId: "sb-runtime-distinct", state: "granted" } };
    const { daemon, calls } = fixture(NEW, (c) => (c.path.endsWith("/cutex/requests") ? Response.json({ cutex: { result: { notification: granted, block: granted.safetyBlock, ...extra } } }) : undefined));
    const r = await daemon.safetyCheckDecide("gone", "sb-runtime-distinct", "grant", "ntf-7");
    expect(r).toMatchObject({ ok: true, notification: { notificationId: "ntf-7", state: "acknowledged" } });
    expect(r.ok && r.noticeError).toEqual({ code: "agent_bus_unavailable", message: "approval notice delivery failed" });
    expect(calls.filter((c) => c.path.endsWith("/cutex/requests"))).toHaveLength(1);
  });

  it("a direct-route refusal keeps today's refusal shape", async () => {
    const { daemon } = fixture(NEW, (c) => (c.path.startsWith("/v2/owner-notifications/") ? ERR(404, "notification_not_found") : undefined));
    expect(await daemon.ownerNotifyAction("gone", "delete", "n1")).toMatchObject({ ok: false, error: { code: "notification_not_found" } });
  });
});

describe("jobs: 结束跟进", () => {
  it("a Job Service with closeFollowUp gets the revision-guarded request; an older one is refused before any write", async () => {
    const yes = fixture(NEW, undefined, { humanOperations: ["list", "cancel", "closeFollowUp"] });
    expect(await yes.daemon.jobCloseFollowUp("j1", 3, "  owner ended  ")).toEqual({ ok: true, value: { jobId: "j1", state: "unconfirmed", terminalReason: "followUpEnded", revision: 4 } });
    expect(yes.calls.at(-1)).toEqual({ method: "POST", path: "/v2/job-service/close-follow-up", body: { jobId: "j1", expectedRevision: 3, reason: "owner ended" } });
    const no = fixture(NEW);
    expect(await no.daemon.jobCloseFollowUp("j1", 3, "r")).toMatchObject({ ok: false, code: "unsupported" });
    expect(no.calls.map((c) => c.path)).toEqual(["/v2/job-service/capabilities"]);
    await expect(no.daemon.jobCloseFollowUp("j1", -1, "r")).rejects.toThrow("bad revision");
    await expect(no.daemon.jobCloseFollowUp("j1", 1, " ")).rejects.toThrow("bad reason");
  });
});

describe("agent-bus messages", () => {
  it("结束跟进: the owner settlement comes back as sent; an older host refuses before any write", async () => {
    const { daemon, calls } = fixture(NEW);
    const sha = "ab".repeat(32);
    expect(await daemon.messageEndFollowUp({ messageId: "m1", actionId: "act-1", reason: "recipient archived", expectedSemanticSha256: sha })).toEqual({ ok: true, result: { messageId: "m1", changed: true, settlement: SETTLEMENT } });
    expect(calls).toEqual([{ method: "POST", path: "/v2/agent-bus/stuck-messages/end-follow-up", body: { messageId: "m1", actionId: "act-1", reason: "recipient archived", expectedSemanticSha256: sha } }]);
    const old = fixture(OLD);
    expect(await old.daemon.messageEndFollowUp({ messageId: "m1", actionId: "act-1", reason: "r" })).toMatchObject({ ok: false, error: { code: "owner_disposition_unsupported" } });
    expect(old.calls).toEqual([]);
  });

  it("action_id_conflict and live_discard_capacity are refusals the UI can name", async () => {
    const conflict = fixture(NEW, (c) => (c.path.endsWith("/end-follow-up") ? ERR(409, "action_id_conflict") : undefined));
    expect(await conflict.daemon.messageEndFollowUp({ messageId: "m1", actionId: "act-1", reason: "r" })).toMatchObject({ ok: false, error: { code: "action_id_conflict" } });
    const full = fixture(NEW, (c) => (c.path.endsWith("/discard") ? ERR(409, "live_discard_capacity") : undefined));
    expect(await full.daemon.discardStuckBusMessage({ messageId: "m1", expectedSemanticSha256: undefined } as never)).toMatchObject({ ok: false, error: { code: "live_discard_capacity" } });
  });
});

it("the new methods are in both narrow IPC allowlists", () => {
  for (const file of ["../src/main/index.ts", "../src/preload/index.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const name of ["askDispose", "ownerDispositionSupport", "jobCloseFollowUp", "messageEndFollowUp"]) expect(source).toContain(`"${name}",`);
  }
});

// Review 2026-11-17 (peer-review, owner-dispositions-review): a capability reply from a replaced connection must
// never decide a write on its successor. Each call reads the capabilities of the connection it captured and writes on
// that same one; if the connection changed meanwhile it refuses (connection_changed, nothing sent, retryable).
describe("one connection lifetime per disposition", () => {
  /** Connection A answers its capability read only when told; B records every request (an older host). */
  function replaced(path: string, answer: unknown) {
    let reply!: (response: Response) => void;
    let requested!: () => void;
    const began = new Promise<void>((resolve) => { requested = resolve; });
    const oldCalls: string[] = [];
    const oldFetch = vi.fn(async (input: RequestInfo | URL) => {
      const at = new URL(String(input)).pathname;
      oldCalls.push(at);
      if (at === path) { requested(); return new Promise<Response>((resolve) => { reply = resolve; }); }
      return Response.json({});
    });
    const newCalls: string[] = [];
    const newFetch = vi.fn(async (input: RequestInfo | URL) => {
      const at = new URL(String(input)).pathname;
      newCalls.push(at);
      return at === "/v2/capabilities" ? Response.json({ hostId: "b", featureList: [] }) : ERR(404, "not_found");
    });
    const daemon = new DaemonService(() => {});
    const handle = daemon as unknown as { client: CutexClient };
    handle.client = new CutexClient({ baseUrl: "http://old-instance.invalid", token: "synthetic" }, { fetch: oldFetch });
    const swap = async () => {
      await began;
      // The host connection is replaced before the old capability read finishes.
      handle.client = new CutexClient({ baseUrl: "http://replacement.invalid", token: "synthetic" }, { fetch: newFetch });
      reply(Response.json(answer));
    };
    return { daemon, swap, oldCalls, newCalls };
  }

  it("jobCloseFollowUp: the old connection's Job capability does not authorise the route on the new one (reviewer's case)", async () => {
    const r = replaced("/v2/job-service/capabilities", { humanOperations: ["list", "closeFollowUp"] });
    const pending = r.daemon.jobCloseFollowUp("j1", 3, "end follow-up");
    await r.swap();
    expect(await pending).toEqual({ ok: false, code: "connection_changed", message: expect.any(String) });
    expect(r.newCalls).not.toContain("/v2/job-service/close-follow-up");
    expect(r.oldCalls).not.toContain("/v2/job-service/close-follow-up");
  });

  const hostCaps = { hostId: "a", featureList: ["owner-ask-disposition-v1", "owner-notify-direct-v1", "agent-bus-owner-end-followup-v1"] };
  it.each([
    ["askDispose", (d: DaemonService) => d.askDispose("eva", "a1", "followUpEnded", "act-1")],
    ["ownerNotifyAction", (d: DaemonService) => d.ownerNotifyAction("eva", "dismiss", "n1")],
    ["safetyCheckDecide", (d: DaemonService) => d.safetyCheckDecide("eva", "b1", "dismiss", "n1")],
    ["messageEndFollowUp", (d: DaemonService) => d.messageEndFollowUp({ messageId: "m1", actionId: "act-1", reason: "r" })],
  ])("%s: refuses (nothing sent on either connection) when the connection changed during the capability read", async (_name, call) => {
    const r = replaced("/v2/capabilities", hostCaps);
    const pending = call(r.daemon);
    await r.swap();
    expect(await pending).toMatchObject({ ok: false, error: { code: "connection_changed" } });
    expect(r.oldCalls).toEqual(["/v2/capabilities"]);
    expect(r.newCalls).toEqual([]);
  });
});

describe("agent-bus mock: an actionId replays only the identical request", () => {
  it("same body replays (changed false); another reason or digest with it is action_id_conflict", async () => {
    const { mock } = await import("../src/renderer/src/modules/agent-bus/mock");
    const api = mock.api!({ emitCutex: () => {} } as never) as { messageEndFollowUp: (r: object) => Promise<unknown> };
    const first = { messageId: "m-a1", actionId: "mock-act-1", reason: "recipient archived" };
    expect(await api.messageEndFollowUp(first)).toMatchObject({ ok: true, result: { changed: true, settlement: { outcome: "unconfirmed", by: "owner" } } });
    expect(await api.messageEndFollowUp({ ...first, reason: " recipient archived " })).toMatchObject({ ok: true, result: { changed: false } });
    expect(await api.messageEndFollowUp({ ...first, reason: "something else" })).toMatchObject({ ok: false, error: { code: "action_id_conflict" } });
    expect(await api.messageEndFollowUp({ ...first, expectedSemanticSha256: "ab".repeat(32) })).toMatchObject({ ok: false, error: { code: "action_id_conflict" } });
    expect(await api.messageEndFollowUp({ ...first, messageId: "m-other" })).toMatchObject({ ok: false, error: { code: "action_id_conflict" } });
  });
});

// Re-review 2026-11-17: binding the Job calls to a captured client must not change the disconnected result. Every Job
// API (and the new 结束跟进) still resolves `unreachable` instead of throwing.
it.each([
  ["capabilities", (d: DaemonService) => d.jobServiceCapabilities()],
  ["list", (d: DaemonService) => d.jobs({})],
  ["cancel", (d: DaemonService) => d.cancelJob("j1", 1)],
  ["output", (d: DaemonService) => d.jobOutput("j1", "stdout", 0)],
  ["closeFollowUp", (d: DaemonService) => d.jobCloseFollowUp("j1", 1, "end follow-up")],
])("keeps the existing unreachable JobResult when disconnected: %s", async (_name, call) => {
  const daemon = new DaemonService(() => {});
  await expect(call(daemon)).resolves.toMatchObject({ ok: false, code: "unreachable" });
});
