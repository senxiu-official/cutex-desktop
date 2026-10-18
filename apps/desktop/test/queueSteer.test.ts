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
import { QUEUE_STEER_FEATURE, queueSteerNotice } from "../src/renderer/src/lib/queueSteer";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

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
  it("uses the atomic steer (ifIdle start) and maps its reply to QueuePromoteResult", async () => {
    const c = connect();
    const r = await service.queuePromote("s1", "q1", 2, true);
    expect(c.queueSteer).toHaveBeenCalledWith("s1", "q1", 2, { ifIdle: "start" });
    expect(c.queueRemove).not.toHaveBeenCalled();
    expect(c.submitInput).not.toHaveBeenCalled();
    expect(r).toEqual({ result: { disposition: "steered", turnId: "t9" }, clientUserMessageId: "cm-1", input: [{ type: "text", text: "hi", text_elements: [] }] });
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
      [refusal("steer_unavailable", { reason: "runtimeNoSteer" }), "queue_steer_refused:runtimeNoSteer"],
      [refusal("steer_unavailable", { reason: "runtimeRefused", nativeError: { message: "cannot steer a\n review turn" } }), "queue_steer_refused:runtimeRefused cannot steer a review turn"],
      [refusal("turn_conflict"), "queue_steer_refused:turnConflict"],
      [refusal("outcome_unknown"), "queue_steer_refused:outcomeUnknown"],
      [refusal("revision_conflict"), "queue_steer_refused:changed"],
    ];
    for (const [error, message] of cases) {
      c.queueSteer.mockRejectedValueOnce(error);
      await expect(service.queuePromote("s1", "q1", 2, true)).rejects.toThrow(new Error(message));
    }
    const other = refusal("persistence_failed");
    c.queueSteer.mockRejectedValueOnce(other);
    await expect(service.queuePromote("s1", "q1", 2, true)).rejects.toBe(other);
    // Changed before the steer: listed under another revision.
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
  it("classifies cutex codes; an unknown steer reason still counts as kept", () => {
    expect(QUEUE_STEER_FEATURE).toBe("queue-steer");
    expect(queueSteerErrorKind("steer_unavailable", { reason: "noActiveTurn" })).toBe("noActiveTurn");
    expect(queueSteerErrorKind("steer_unavailable", { reason: "somethingNew" })).toBe("runtimeRefused");
    expect(queueSteerErrorKind("session_offline", {})).toBe("sessionOffline");
    expect(queueSteerErrorKind("queue_input_already_submitted", {})).toBe("changed");
    expect(queueSteerErrorKind("persistence_failed", {})).toBeNull();
  });

  it("reads the message after Electron's IPC wrapping and maps it to readable text", () => {
    const wrapped = "Error invoking remote method 'invoke': Error: queue_steer_refused:delegationTurn";
    expect(parseQueueSteerError(wrapped)).toEqual({ kind: "delegationTurn", detail: "" });
    expect(parseQueueSteerError("queue_steer_refused:bogus")).toBeNull();
    expect(queueSteerNotice(wrapped, zh)).toBe("委托占用中（委托回合在跑，或委托结果正在送达），暂时不能插话；已留在队列");
    expect(queueSteerNotice("Error: queue_steer_refused:turnConflict", zh)).toBe("回合刚变化，请再试一次");
    expect(queueSteerNotice("queue_steer_refused:runtimeRefused cannot steer a review turn", zh)).toBe("运行时拒绝插话（cannot steer a review turn）；已留在队列");
    expect(queueSteerNotice("queue_steer_refused:runtimeRefused", zh)).toBe("运行时拒绝插话；已留在队列");
    expect(queueSteerNotice("queue item changed or already sent", zh)).toBeNull();
    for (const key of Object.keys(zhCN).filter((k) => k.startsWith("queue.steer."))) expect((en as Record<string, string>)[key]).toBeTruthy();
  });
});
