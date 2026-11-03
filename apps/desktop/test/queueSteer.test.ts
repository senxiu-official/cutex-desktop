// Queue tray 插话: queue-steer (cutex/userInput/queue/steer) instead of remove + submit `auto`, which
// cutex re-queues while an ask holds the session; refusals keep the item and read as notices.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", () => {
  class CutexApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false, readonly details?: unknown) {
      super(`${code}: ${message}`);
    }
  }
  return {
    CutexClient: class {
      queueList = vi.fn(async () => ({ revision: 7, items: [{ queueId: "q1", revision: 2, clientUserMessageId: "cm-1", origin: { kind: "other", clientId: "desktop" }, input: [{ type: "text", text: "hi", text_elements: [] }] }] }));
      queueRemove = vi.fn(async () => ({}));
      submitInput = vi.fn(async () => ({ disposition: "queued", queue: {} }));
      queueSteer = vi.fn(async () => ({ disposition: "steered", turnId: "t9", clientUserMessageId: "cm-1", queueRevision: 8 }));
      cutex = vi.fn(async () => ({}));
      queueMove = vi.fn(async () => ({ revision: 18 }));
      constructor(public endpoint: unknown) { fixture.clients.push(this); }
      host() { return new Promise(() => {}); }
    },
    CutexApiError,
    CutexUnreachableError: class extends Error {},
    EventFeed: class {},
    openStream: vi.fn(),
  };
});
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";
import { parseQueueSteerError, queueSteerErrorKind } from "../src/shared/queueSteer";
import { QUEUE_STEER_FEATURE, queueSteerNotice, queueSteerRaw } from "../src/renderer/src/lib/queueSteer";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import * as diagnostic from "../src/main/errorLog";

let service: DaemonService;
function connect() {
  service.useEndpoint({ baseUrl: "http://a.invalid", token: "fake" } as any, { remote: true });
  return fixture.clients.at(-1);
}
const refusal = (code: string, details?: unknown) => new (CutexApiError as any)(409, code, "kept", true, details);
const zh = (key: string, vars?: Record<string, string | number>) => (zhCN as Record<string, string>)[key]!.replace(/\{(\w+)\}/g, (_, n: string) => String(vars?.[n]));

beforeEach(() => {
  fixture.clients.length = 0;
  service = new DaemonService(() => {});
});
afterEach(() => service.stop());

describe("queuePromote with queue-steer", () => {
  it("preserves a definite offline-send admission refusal across IPC without replaying in main", async () => {
    const c=connect();
    c.submitInput.mockRejectedValueOnce(new CutexApiError(503,"admission_busy","variable text",true,{reason:"hostBusy",retryAfterMs:1700}));
    await expect(service.submit("s1","hi","auto",true,{clientUserMessageId:"fixed-owner-input"})).rejects.toThrow('host_action_busy:{"retryAfterMs":1700}');
    expect(c.submitInput).toHaveBeenCalledOnce();
    expect(c.submitInput.mock.calls[0]?.[3]).toMatchObject({startIfOffline:true,clientUserMessageId:"fixed-owner-input"});
    const uncertain=new CutexApiError(503,"admission_busy","uncertain",true,{reason:"hostBusy",resyncRequired:true});
    c.submitInput.mockRejectedValueOnce(uncertain);
    await expect(service.submit("s1","hi","auto",true)).rejects.toBe(uncertain);
  });
  it.each(["cutex/session/delete","cutex/runtime/online","cutex/session/retire"] as const)("preserves admission_busy details across IPC for %s without mutating parameters", async method => {
    const c=connect(),params={expectedRuntimeGeneration:7,expectedRevision:3};
    c.cutex.mockRejectedValueOnce(new CutexApiError(503,"admission_busy","busy",true,{reason:"hostBusy",retryAfterMs:1000}));
    await expect(service.sessionAction("s1",method,params)).rejects.toThrow('host_action_busy:{"retryAfterMs":1000}');
    expect(c.cutex).toHaveBeenCalledOnce();expect(c.cutex).toHaveBeenCalledWith("s1",method,params);
    const uncertain=new CutexApiError(503,"admission_busy","uncertain",true,{reason:"hostBusy",resyncRequired:true});
    c.cutex.mockRejectedValueOnce(uncertain);
    await expect(service.sessionAction("s1",method,params)).rejects.toBe(uncertain);
  });
  it.each(["constructor", "toString", "__proto__"])("flags inherited-looking error code %s instead of treating it as a mapped kind", code => {
    expect(queueSteerErrorKind(code, {})).toBe("unrecognized");
  });
  it("keeps the action pending during host contention and logs the unmapped reason code", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(diagnostic, "logError").mockImplementation(() => {});
    try {
      const c = connect();
      c.queueSteer.mockRejectedValueOnce(refusal("steer_unavailable", {reason:"admissionBusy"}));
      let done = false;
      const operation = service.queuePromote("s1","q1",2,true).then(r => {done=true;return r;});
      await vi.advanceTimersByTimeAsync(299);expect(done).toBe(false);
      expect(c.queueList).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.objectContaining({code:"steer_unavailable",reason:"admissionBusy",attempt:2}));
      await vi.advanceTimersByTimeAsync(1);await expect(operation).resolves.toMatchObject({result:{disposition:"steered"}});
      expect(c.queueSteer).toHaveBeenCalledTimes(2);
    } finally {log.mockRestore();vi.useRealTimers();}
  });
  it("reports exhausted contention as hostBusy rather than a runtime refusal or unknown send", async () => {
    vi.useFakeTimers();
    try {
      const c=connect();c.queueSteer.mockRejectedValue(refusal("steer_unavailable",{reason:"admissionBusy"}));
      const result=expect(service.queuePromote("s1","q1",2,true)).rejects.toThrow("queue_steer_refused:hostBusy");
      await vi.advanceTimersByTimeAsync(4100);await result;
      expect(c.queueSteer).toHaveBeenCalledTimes(5);expect(c.queueList).not.toHaveBeenCalled();
      expect(queueSteerNotice("queue_steer_refused:hostBusy",zh)).toContain("主机正忙");
    } finally {vi.useRealTimers();}
  });
  it("first click retries only the unsent capability gate with the same queue identity", async () => {
    const c = connect();
    c.queueSteer.mockRejectedValueOnce(refusal("steer_unavailable", { reason: "runtimeNoSteer" }));
    const result = await service.queuePromote("s1", "q1", 2, true);
    expect(result.result.disposition).toBe("steered");
    expect(c.queueSteer.mock.calls).toEqual([
      ["s1", "q1", 2, { ifIdle: "start" }],
      ["s1", "q1", 2, { ifIdle: "start" }],
    ]);
    expect(c.queueRemove).not.toHaveBeenCalled();
    expect(c.submitInput).not.toHaveBeenCalled();
  });

  it("does not claim unsupported when the bounded capability check still cannot confirm support", async () => {
    const c = connect();
    c.queueSteer.mockRejectedValue(refusal("steer_unavailable", { reason: "runtimeNoSteer" }));
    await expect(service.queuePromote("s1", "q1", 2, true)).rejects.toThrow("queue_steer_refused:runtimeNotReady");
    expect(c.queueSteer).toHaveBeenCalledTimes(2);
    expect(c.queueRemove).not.toHaveBeenCalled();
  });

  it("a native unsupported reply is reported immediately without another send", async () => {
    const c = connect();
    c.queueSteer.mockRejectedValue(refusal("steer_unavailable", { reason: "runtimeNoSteer", nativeError: { code: -32601 } }));
    await expect(service.queuePromote("s1", "q1", 2, true)).rejects.toThrow("queue_steer_refused:runtimeNoSteer");
    expect(c.queueSteer).toHaveBeenCalledOnce();
  });

  it("a resync requirement overrides a nominal capability refusal", async () => {
    const c = connect();
    c.queueSteer.mockRejectedValue(refusal("steer_unavailable", { reason: "runtimeNoSteer", resyncRequired: true }));
    await expect(service.queuePromote("s1", "q1", 2, true)).rejects.toThrow("queue_steer_refused:outcomeUnknown");
    expect(c.queueSteer).toHaveBeenCalledOnce();
    expect(c.queueRemove).not.toHaveBeenCalled();
  });
  it("passes explicit join identity atomically and refuses legacy fallback", async () => {
    const c = connect();
    const join = { askId: "ask-a", attempt: 2, expectedTurnId: "turn-a", runtimeGeneration: 7 };
    await service.queuePromote("s1", "q1", 2, true, join);
    expect(c.queueSteer).toHaveBeenCalledWith("s1", "q1", 2, { ifIdle: "fail", joinDelegation: join });
    await expect(service.queuePromote("s1", "q1", 2, false, join)).rejects.toThrow("joinChanged");
    c.queueSteer.mockRejectedValueOnce(refusal("steer_unavailable", { reason: "joinChanged" }));
    await expect(service.queuePromote("s1", "q1", 2, true, join)).rejects.toThrow("queue_steer_refused:joinChanged");
    expect(c.queueRemove).not.toHaveBeenCalled();
    expect(c.submitInput).not.toHaveBeenCalled();
  });

  it("reports the r263 non-owner gate as a definite refusal without sending or removing", async () => {
    const c = connect();
    const join = { askId: "ask-a", attempt: 2, expectedTurnId: "turn-a", runtimeGeneration: 7 };
    c.queueSteer.mockRejectedValueOnce(new CutexApiError(403, "owner_required", "this route is the host owner's"));
    await expect(service.queuePromote("s1", "q1", 2, true, join)).rejects.toThrow("queue_steer_refused:ownerRequired");
    expect(c.queueRemove).not.toHaveBeenCalled();
    expect(c.submitInput).not.toHaveBeenCalled();
    expect(queueSteerNotice("queue_steer_refused:ownerRequired", zh)).toBe("只有主机所有者可以加入此委托");
  });

  it("uses the atomic steer (ifIdle start) and maps its reply to QueuePromoteResult", async () => {
    const c = connect();
    const r = await service.queuePromote("s1", "q1", 2, true);
    expect(c.queueSteer).toHaveBeenCalledWith("s1", "q1", 2, { ifIdle: "start" });
    expect(c.queueRemove).not.toHaveBeenCalled();
    expect(c.submitInput).not.toHaveBeenCalled();
    expect(r).toEqual({ result: { disposition: "steered", turnId: "t9" }, clientUserMessageId: "cm-1" });
    expect(c.queueList).not.toHaveBeenCalled();
    c.queueSteer.mockResolvedValueOnce({ disposition: "started", turnId: "t10", clientUserMessageId: "cm-1", queueRevision: 8 });
    expect((await service.queuePromote("s1", "q1", 2, true)).result).toEqual({ disposition: "started", turnId: "t10" });
  });

  it("keeps remove + submit auto for cutex without queue-steer", async () => {
    const c = connect();
    const r = await service.queuePromote("s1", "q1", 2);
    expect(c.queueSteer).not.toHaveBeenCalled();
    expect(c.queueRemove).toHaveBeenCalledWith("s1", "q1", 2);
    expect(c.submitInput).toHaveBeenCalledWith("s1", [{ type: "text", text: "hi", text_elements: [] }], "auto", { clientUserMessageId: "cm-1", origin: { kind: "other", clientId: "desktop" } });
    expect(r.result.disposition).toBe("queued");
  });

  it("turns refusals into queue_steer_refused messages; other errors pass through", async () => {
    const c = connect();
    const cases: [unknown, string][] = [
      [refusal("steer_unavailable", { reason: "delegationTurn" }), "queue_steer_refused:delegationTurn"],
      [refusal("steer_unavailable", { reason: "runtimeNoSteer", nativeError: { code: -32601 } }), "queue_steer_refused:runtimeNoSteer"],
      [refusal("steer_unavailable", { reason: "runtimeRefused", nativeError: { message: "cannot steer a\n review turn" } }), "queue_steer_refused:runtimeRefused cannot steer a review turn"],
      [refusal("turn_conflict"), "queue_steer_refused:turnConflict"],
      // An unknown outcome carries the backend's words (详情 only); the v2 server says request_outcome_unknown.
      [refusal("outcome_unknown"), "queue_steer_refused:outcomeUnknown outcome_unknown: kept"],
      [refusal("request_outcome_unknown", { resyncRequired: true, originalCode: "outcome_unknown", originalDetails: {} }), "queue_steer_refused:outcomeUnknown request_outcome_unknown: kept (originalCode: outcome_unknown)"],
      [refusal("session_runtime_changed", { resyncRequired: true }), "queue_steer_refused:outcomeUnknown session_runtime_changed: kept"],
      [refusal("revision_conflict"), "queue_steer_refused:changed"],
    ];
    for (const [error, message] of cases) {
      c.queueSteer.mockRejectedValueOnce(error);
      await expect(service.queuePromote("s1", "q1", 2, true)).rejects.toThrow(new Error(message));
    }
    const other = refusal("persistence_failed");
    c.queueSteer.mockRejectedValueOnce(other);
    await expect(service.queuePromote("s1", "q1", 2, true)).rejects.toThrow("queue_steer_refused:unrecognized persistence_failed: kept");
    // The atomic route validates the revision; no preliminary list decides it.
    c.queueSteer.mockRejectedValueOnce(refusal("revision_conflict"));
    await expect(service.queuePromote("s1", "q1", 1, true)).rejects.toThrow("queue_steer_refused:changed");
    expect(c.queueRemove).not.toHaveBeenCalled();
  });
});

describe("queueMove (admission-order)", () => {
  it("passes the move through; named refusals become queue_move_refused messages", async () => {
    const c = connect();
    expect(await service.queueMove("s1", "q1", 17, { kind: "ask", id: "a1" })).toEqual({ revision: 18 });
    expect(c.queueMove).toHaveBeenCalledWith("s1", "q1", 17, { kind: "ask", id: "a1" });
    c.queueMove.mockRejectedValueOnce(refusal("passing_not_allowed"));
    await expect(service.queueMove("s1", "q1", 17, null)).rejects.toThrow(new Error("queue_move_refused:passingNotAllowed"));
    c.queueMove.mockRejectedValueOnce(refusal("revision_conflict"));
    await expect(service.queueMove("s1", "q1", 17, null)).rejects.toThrow(new Error("queue_move_refused:conflict"));
    const other = refusal("persistence_failed");
    c.queueMove.mockRejectedValueOnce(other);
    await expect(service.queueMove("s1", "q1", 17, null)).rejects.toBe(other);
  });
});

describe("queue-steer notices", () => {
  it.each([
    ["joinChanged", "joinChanged"], ["agentPaused", "agentPaused"],
    ["admissionBusy", "hostBusy"], ["delegationTurn", "delegationTurn"],
    ["runtimeNoSteer", "runtimeNoSteer"], ["runtimeRefused", "runtimeRefused"],
    ["noActiveTurn", "noActiveTurn"], ["imagePathRequired", "imagePathRequired"],
    ["imageUnavailable", "imageUnavailable"], ["turnFinishing", "turnFinishing"],
  ])("050 §5 steer refusal %s has its own mapping (%s)", (reason, kind) => {
    expect(queueSteerErrorKind("steer_unavailable", { reason })).toBe(kind);
    expect(queueSteerNotice(`queue_steer_refused:${kind}`, zh)).toBeTruthy();
  });
  it("classifies cutex codes; an unknown steer reason still counts as kept", () => {
    expect(QUEUE_STEER_FEATURE).toBe("queue-steer");
    expect(queueSteerErrorKind("steer_unavailable", { reason: "noActiveTurn" })).toBe("noActiveTurn");
    expect(queueSteerErrorKind("steer_unavailable", { reason: "somethingNew" })).toBe("unrecognized");
    expect(queueSteerErrorKind("session_offline", {})).toBe("sessionOffline");
    expect(queueSteerErrorKind("queue_input_already_submitted", {})).toBe("changed");
    expect(queueSteerErrorKind("persistence_failed", {})).toBe("unrecognized");
  });

  it("reads the message after Electron's IPC wrapping and maps it to readable text", () => {
    const wrapped = "Error invoking remote method 'invoke': Error: queue_steer_refused:delegationTurn";
    expect(parseQueueSteerError(wrapped)).toEqual({ kind: "delegationTurn", detail: "" });
    expect(parseQueueSteerError("queue_steer_refused:bogus")).toBeNull();
    expect(queueSteerNotice(wrapped, zh)).toBe("委托占用中（委托回合在跑，或委托结果正在送达）：消息留在队列，等委托这一轮结束后发送");
    expect(queueSteerNotice("Error: queue_steer_refused:turnConflict", zh)).toBe("回合刚变化，请再试一次");
    // The native's own words never reach the notice (queueSteerRaw: the 详情 tooltip).
    expect(queueSteerNotice("queue_steer_refused:runtimeRefused cannot steer a review turn", zh)).toBe("运行时拒绝插话；已留在队列");
    expect(queueSteerRaw("queue_steer_refused:runtimeRefused cannot steer a review turn")).toBe("cannot steer a review turn");
    expect(queueSteerNotice("queue_steer_refused:runtimeRefused", zh)).toBe("运行时拒绝插话；已留在队列");
    expect(queueSteerNotice("queue item changed or already sent", zh)).toBeNull();
    for (const key of Object.keys(zhCN).filter((k) => k.startsWith("queue.steer."))) expect((en as Record<string, string>)[key]).toBeTruthy();
  });
});

describe("image-input-steering (r264): queue-steer receipt, ifIdle fail, image refusals", () => {
  const enT = (key: string, vars?: Record<string, string | number>) => (en as Record<string, string>)[key]!.replace(/\{(\w+)\}/g, (_, n: string) => String(vars?.[n]));

  it("passes cutex's imageDelivery receipt through; none when cutex sent none", async () => {
    const c = connect();
    c.queueSteer.mockResolvedValueOnce({ disposition: "steered", turnId: "t9", clientUserMessageId: "cm-1", queueRevision: 8, imageDelivery: "pathText" });
    expect((await service.queuePromote("s1", "q1", 2, true)).result).toEqual({ disposition: "steered", turnId: "t9", imageDelivery: "pathText" });
    c.queueSteer.mockResolvedValueOnce({ disposition: "steered", turnId: "t9", clientUserMessageId: "cm-1", queueRevision: 8, imageDelivery: "somethingElse" });
    expect((await service.queuePromote("s1", "q1", 2, true)).result).toEqual({ disposition: "steered", turnId: "t9" });
  });

  it("a draft steered after cutex queued it never starts a turn (ifIdle fail)", async () => {
    const c = connect();
    await service.queuePromote("s1", "q1", 2, true, undefined, { ifIdle: "fail" });
    expect(c.queueSteer).toHaveBeenCalledWith("s1", "q1", 2, { ifIdle: "fail" });
  });

  it("imagePathRequired / imageUnavailable are kept-in-queue refusals with their own words", async () => {
    const c = connect();
    expect(queueSteerErrorKind("steer_unavailable", { reason: "imagePathRequired" })).toBe("imagePathRequired");
    expect(queueSteerErrorKind("steer_unavailable", { reason: "imageUnavailable" })).toBe("imageUnavailable");
    for (const reason of ["imagePathRequired", "imageUnavailable"]) {
      c.queueSteer.mockRejectedValueOnce(refusal("steer_unavailable", { reason }));
      await expect(service.queuePromote("s1", "q1", 2, true)).rejects.toThrow(new Error(`queue_steer_refused:${reason}`));
      expect(parseQueueSteerError(`Error invoking remote method: Error: queue_steer_refused:${reason}`)).toEqual({ kind: reason, detail: "" });
    }
    expect(c.queueRemove).not.toHaveBeenCalled();
    expect(queueSteerNotice("queue_steer_refused:imagePathRequired", zh)).toBe("图片需要先上传到这台主机才能插入当前回合：已留在队列，本回合结束后发送");
    expect(queueSteerNotice("queue_steer_refused:imageUnavailable", zh)).toBe("主机上的图片文件不可用（已删除或无法读取）：已留在队列");
    expect(queueSteerNotice("queue_steer_refused:imagePathRequired", enT)).toContain("must be uploaded to this host");
  });

  it("a runtime refusal names images only for a message with images on a runtime that declares unsupported", () => {
    const image = zh("queue.steer.imageUnsupported");
    expect(queueSteerNotice("queue_steer_refused:runtimeNoSteer", zh, { images: true, imageSteering: "unsupported" })).toBe(image);
    expect(queueSteerNotice("queue_steer_refused:runtimeNoSteer", zh, { images: false, imageSteering: "unsupported" })).toBe(zh("queue.steer.runtimeNoSteer"));
    expect(queueSteerNotice("queue_steer_refused:runtimeNoSteer", zh, { images: true, imageSteering: "pathText" })).toBe(zh("queue.steer.runtimeNoSteer"));
    expect(queueSteerNotice("queue_steer_refused:runtimeNoSteer", zh, { images: true, imageSteering: null })).toBe(zh("queue.steer.runtimeNoSteer"));
    expect(queueSteerNotice("queue_steer_refused:runtimeNoSteer", zh)).toBe("这个运行时只在回合之间接收新消息：已留在队列，本回合结束后发送");
  });
});
