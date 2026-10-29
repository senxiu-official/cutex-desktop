// 「全部合并插入」 (shared/queueMerge + DaemonService.queueMergeInsert): queued owner messages merged in
// queue order into ONE steered input; CAS removes, the merged text always lives in a cutex queue item,
// a refused steer keeps it as ONE queued item at the front; delegations are never merged.
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
      items: any[] = [];
      admission: any = null;
      calls: string[] = [];
      queueList = vi.fn(async () => ({ revision: 7, items: this.items.map((x) => ({ ...x })), admission: this.admission }));
      queueRemove = vi.fn(async (_s: string, id: string, rev: number) => {
        this.calls.push(`remove ${id}@${rev}`);
        const at = this.items.findIndex((x) => x.queueId === id);
        if (at < 0) throw new CutexApiError(404, "queue_item_not_found", "gone");
        if (this.items[at].revision !== rev) throw new CutexApiError(409, "revision_conflict", "changed");
        this.items.splice(at, 1);
        return {};
      });
      queueUpdate = vi.fn(async (_s: string, id: string, rev: number, input: unknown[]) => {
        this.calls.push(`update ${id}@${rev}`);
        const item = this.items.find((x) => x.queueId === id);
        if (!item || item.revision !== rev) throw new CutexApiError(409, "revision_conflict", "changed");
        Object.assign(item, { input, revision: rev + 1 });
        return { ...item };
      });
      queueSteer = vi.fn(async (_s: string, id: string, rev: number) => {
        this.calls.push(`steer ${id}@${rev}`);
        this.items = this.items.filter((x) => x.queueId !== id);
        return { disposition: "steered", turnId: "t9", clientUserMessageId: `cm-${id}`, queueRevision: 9 };
      });
      submitInput = vi.fn(async (_s: string, input: unknown[], strategy: string, extra: any) => {
        this.calls.push(`submit ${strategy}`);
        if (strategy === "queue") {
          const item = { queueId: "qN", revision: 1, clientUserMessageId: extra.clientUserMessageId, origin: extra.origin, input };
          this.items.push(item);
          return { disposition: "queued", queue: item };
        }
        return { disposition: "steered", turnId: "t9" };
      });
      queueMove = vi.fn(async (_s: string, id: string) => {
        this.calls.push(`move ${id}`);
        return { revision: 18 };
      });
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
import { mergeQueueInputs, mergedText, parseQueueMergeError, planQueueMerge, QUEUE_MERGE_SEPARATOR } from "../src/shared/queueMerge";
import { mergeInsertShown } from "../src/renderer/src/lib/insertTarget";
import { queueMergeNotice } from "../src/renderer/src/lib/queueSteer";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const OWNER = { kind: "other", clientId: "desktop" };
const text = (t: string) => ({ type: "text", text: t, text_elements: [] });
const image = (n: number) => ({ type: "image", url: `data:image/png;base64,AAA${n}` });
const queued = (id: string, input: unknown[], origin: any = OWNER, revision = 2) => ({ queueId: id, revision, clientUserMessageId: `cm-${id}`, origin, input, position: 0, state: "queued", createdAt: "", updatedAt: "" });
const zh = (key: string, vars?: Record<string, string | number>) => (zhCN as Record<string, string>)[key]!.replace(/\{(\w+)\}/g, (_, n: string) => String(vars?.[n]));
const refs = (...ids: string[]) => ids.map((queueId) => ({ queueId, revision: 2 }));

let service: DaemonService;
function connect(items: any[]) {
  service.useEndpoint({ baseUrl: "http://a.invalid", token: "fake" } as any, { remote: true });
  const c = fixture.clients.at(-1);
  c.items = items;
  c.admission = { revision: 3, orderRevision: 4, items: [{ kind: "ask", id: "a1", position: 1 }, ...items.map((x: any, i: number) => ({ kind: "owner", id: x.queueId, position: i + 2 }))] };
  return c;
}

beforeEach(() => {
  fixture.clients.length = 0;
  service = new DaemonService(() => {});
});
afterEach(() => service.stop());

describe("mergeQueueInputs / planQueueMerge", () => {
  it("merges texts in queue order with a blank line, then every attachment in order", () => {
    const input = mergeQueueInputs([[text("first"), image(1)], [text("  second  "), { type: "localImage", path: "/a.png" }], [image(2)], [text("third\nline")]]);
    expect(input).toEqual([text(`first${QUEUE_MERGE_SEPARATOR}second${QUEUE_MERGE_SEPARATOR}third\nline`), image(1), { type: "localImage", path: "/a.png" }, image(2)]);
    expect(mergedText(input)).toBe("first\n\nsecond\n\nthird\nline");
  });

  it("shifts text_elements byte ranges and keeps a skill named twice once", () => {
    const el = (start: number, end: number) => ({ byte_range: { start, end }, placeholder: "$s" });
    const skill = { type: "skill", name: "s", path: "/s" };
    const input = mergeQueueInputs([[{ type: "text", text: "我a", text_elements: [el(0, 3)] }, skill], [{ type: "text", text: " $s go", text_elements: [el(1, 3)] }, skill]]);
    // "我a" is 4 bytes, then "\n\n" (2): the second message's "$s" (trimmed one leading space) starts at 6.
    expect(input[0]).toEqual({ type: "text", text: "我a\n\n$s go", text_elements: [el(0, 3), el(6, 8)] });
    expect(input.slice(1)).toEqual([skill]);
  });

  it("never merges delegations / bus input, needs two owner messages and stays within the size budget", () => {
    const items = [queued("q1", [text("a")]), queued("d1", [text("delegation")], { kind: "agent_bus", clientId: "x" }), queued("q2", [text("b")]), queued("q3", [text("c".repeat(400))])];
    const plan = planQueueMerge(items)!;
    expect(plan.items.map((x) => x.queueId)).toEqual(["q1", "q2", "q3"]);
    expect(mergedText(plan.input)).not.toContain("delegation");
    // Budget: the big third message stays queued (a prefix is merged).
    expect(planQueueMerge(items, 200)!.items.map((x) => x.queueId)).toEqual(["q1", "q2"]);
    expect(planQueueMerge(items, 20)).toBeNull();
    expect(planQueueMerge([items[0]!, items[1]!])).toBeNull();
  });
});

describe("visibility", () => {
  it("shows while a turn runs that takes inserts, with ≥ 2 owner messages, not during a drag", () => {
    expect(mergeInsertShown(true, 2, null, false, true)).toBe(true);
    expect(mergeInsertShown(true, 1, null, false, true)).toBe(false);
    expect(mergeInsertShown(false, 3, null, false, true)).toBe(false);
    expect(mergeInsertShown(true, 3, "askTurn", false, true)).toBe(false);
    expect(mergeInsertShown(true, 3, "noSteer", false, true)).toBe(false);
    expect(mergeInsertShown(true, 3, null, true, true)).toBe(false);
    expect(mergeInsertShown(true, 3, null, false, false)).toBe(false);
  });
});

describe("DaemonService.queueMergeInsert", () => {
  it("keeps merged input queued when the captured delegation attempt changed", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
    const join = { askId: "ask-a", attempt: 1, expectedTurnId: "turn-a", runtimeGeneration: 7 };
    c.queueSteer.mockRejectedValueOnce(new CutexApiError(409, "steer_unavailable", "kept", true, { reason: "joinChanged" }));
    await expect(service.queueMergeInsert("s1", refs("q1", "q2"), true, join)).rejects.toThrow("queue_merge_failed:kept queue_steer_refused:joinChanged");
    expect(c.queueSteer).toHaveBeenCalledWith("s1", "q1", expect.any(Number), { ifIdle: "fail", joinDelegation: join });
    expect(c.items).toHaveLength(1);
    expect(JSON.stringify(c.items[0].input)).toContain("one");
    expect(JSON.stringify(c.items[0].input)).toContain("two");
    expect(c.submitInput).not.toHaveBeenCalled();
  });

  it("keeps the merged text after the non-owner gate rejects joining", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
    const join = { askId: "ask-a", attempt: 1, expectedTurnId: "turn-a", runtimeGeneration: 7 };
    c.queueSteer.mockRejectedValueOnce(new CutexApiError(403, "owner_required", "this route is the host owner's"));
    await expect(service.queueMergeInsert("s1", refs("q1", "q2"), true, join)).rejects.toThrow("queue_merge_failed:kept queue_steer_refused:ownerRequired");
    expect(c.items).toHaveLength(1);
    expect(JSON.stringify(c.items[0].input)).toContain("one");
    expect(JSON.stringify(c.items[0].input)).toContain("two");
    expect(c.submitInput).not.toHaveBeenCalled();
  });

  it("removes 2..N at their revisions, updates the first to the merged input, steers it once", async () => {
    const c = connect([queued("q1", [text("one"), image(1)]), queued("q2", [text("two")]), queued("q3", [image(2), text("three")])]);
    const r = await service.queueMergeInsert("s1", refs("q1", "q2", "q3"), true);
    expect(c.calls).toEqual(["remove q2@2", "remove q3@2", "update q1@2", "steer q1@3"]);
    const merged = [text("one\n\ntwo\n\nthree"), image(1), image(2)];
    expect(c.queueUpdate).toHaveBeenCalledWith("s1", "q1", 2, merged);
    expect(c.queueSteer).toHaveBeenCalledWith("s1", "q1", 3, { ifIdle: "start" });
    expect(r).toEqual({ result: { disposition: "steered", turnId: "t9" }, clientUserMessageId: "cm-q1", input: merged, merged: ["q1", "q2", "q3"], skipped: [] });
    expect(c.items).toEqual([]);
  });

  it("a cold capability refusal retries only the merged carrier, never the merge mutations", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
    c.queueSteer.mockRejectedValueOnce(new (CutexApiError as any)(409, "steer_unavailable", "kept", true, { reason: "runtimeNoSteer" }));
    await expect(service.queueMergeInsert("s1", refs("q1", "q2"), true)).resolves.toMatchObject({ result: { disposition: "steered" } });
    expect(c.queueRemove).toHaveBeenCalledOnce();
    expect(c.queueUpdate).toHaveBeenCalledOnce();
    expect(c.queueSteer).toHaveBeenCalledTimes(2);
    expect(c.queueSteer.mock.calls[0]).toEqual(c.queueSteer.mock.calls[1]);
    expect(c.submitInput).not.toHaveBeenCalled();
  });

  it("does not run retry or recovery operations on a replaced connection", async () => {
    vi.useFakeTimers();
    try {
      const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
      c.queueSteer.mockRejectedValueOnce(new (CutexApiError as any)(409, "steer_unavailable", "kept", true, { reason: "runtimeNoSteer" }));
      const result = service.queueMergeInsert("s1", refs("q1", "q2"), true).catch(e => e);
      await vi.advanceTimersByTimeAsync(0);
      expect(c.queueSteer).toHaveBeenCalledOnce();
      service.useEndpoint({ baseUrl: "http://new.invalid", token: "fake" } as any, { remote: true });
      const replacement = fixture.clients.at(-1);
      await vi.advanceTimersByTimeAsync(150);
      expect(await result).toBeInstanceOf(Error);
      expect(c.queueSteer).toHaveBeenCalledOnce();
      expect(c.queueMove).not.toHaveBeenCalled();
      expect(replacement.queueList).not.toHaveBeenCalled();
      expect(replacement.queueSteer).not.toHaveBeenCalled();
      expect(replacement.queueMove).not.toHaveBeenCalled();
      expect(replacement.submitInput).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("treats a transport failure on the retry as unknown, never as kept or permission to resend", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
    c.queueSteer.mockRejectedValueOnce(new (CutexApiError as any)(409, "steer_unavailable", "kept", true, { reason: "runtimeNoSteer" }));
    c.queueSteer.mockRejectedValueOnce(new Error("connection reset"));
    await expect(service.queueMergeInsert("s1", refs("q1", "q2"), true)).rejects.toThrow("queue_steer_refused:outcomeUnknown");
    expect(c.queueSteer).toHaveBeenCalledTimes(2);
    expect(c.queueMove).not.toHaveBeenCalled();
    expect(c.submitInput).not.toHaveBeenCalled();
    expect(c.queueUpdate).toHaveBeenCalledOnce();
  });

  it("never moves or reports kept when a nominal capability refusal requires resync", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
    c.queueSteer.mockRejectedValue(new (CutexApiError as any)(409, "steer_unavailable", "resync", true, { reason: "runtimeNoSteer", resyncRequired: true }));
    await expect(service.queueMergeInsert("s1", refs("q1", "q2"), true)).rejects.toThrow("queue_steer_refused:outcomeUnknown");
    expect(c.queueSteer).toHaveBeenCalledOnce();
    expect(c.queueMove).not.toHaveBeenCalled();
    expect(c.submitInput).not.toHaveBeenCalled();
  });

  it("touches nothing when an item changed before the merge (revision conflict up front)", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")], OWNER, 5)]);
    await expect(service.queueMergeInsert("s1", refs("q1", "q2"), true)).rejects.toThrow("queue_merge_failed:changed");
    expect(c.calls).toEqual([]);
  });

  it("a conflict while removing stops there: merged so far is steered, the rest stays queued", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")]), queued("q3", [text("three")]), queued("q4", [text("four")])]);
    // Edited on another device between the list and its remove.
    c.queueRemove.mockImplementationOnce(async (_s: string, id: string, rev: number) => {
      c.calls.push(`remove ${id}@${rev}`);
      c.items = c.items.filter((x: any) => x.queueId !== id);
      return {};
    });
    c.queueRemove.mockImplementationOnce(async () => {
      c.calls.push("remove q3 conflict");
      throw new (CutexApiError as any)(409, "revision_conflict", "changed");
    });
    const r = await service.queueMergeInsert("s1", refs("q1", "q2", "q3", "q4"), true);
    expect(c.calls).toEqual(["remove q2@2", "remove q3 conflict", "update q1@2", "steer q1@3"]);
    expect(r.merged).toEqual(["q1", "q2"]);
    expect(r.skipped).toEqual(["q3", "q4"]);
    expect(mergedText(r.input)).toBe("one\n\ntwo");
    expect(c.items.map((x: any) => x.queueId)).toEqual(["q3", "q4"]);
  });

  it("nothing removed (first remove conflicts): nothing is merged or sent", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
    c.queueRemove.mockRejectedValueOnce(new (CutexApiError as any)(409, "revision_conflict", "changed"));
    await expect(service.queueMergeInsert("s1", refs("q1", "q2"), true)).rejects.toThrow("queue_merge_failed:changed");
    expect(c.queueUpdate).not.toHaveBeenCalled();
    expect(c.queueSteer).not.toHaveBeenCalled();
  });

  it("a refused steer keeps the merged text as ONE queued item, moved to the front (no loss)", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two"), image(1)])]);
    c.queueSteer.mockRejectedValue(new (CutexApiError as any)(409, "steer_unavailable", "kept", true, { reason: "runtimeNoSteer" }));
    const error = await service.queueMergeInsert("s1", refs("q1", "q2"), true).catch((e: Error) => e);
    expect(parseQueueMergeError((error as Error).message)).toEqual({ kind: "kept", detail: "queue_steer_refused:runtimeNotReady" });
    expect(c.items).toHaveLength(1);
    expect(c.items[0]).toMatchObject({ queueId: "q1", clientUserMessageId: "cm-q1", input: [text("one\n\ntwo"), image(1)] });
    expect(c.queueMove).toHaveBeenCalledWith("s1", "q1", 4, { kind: "ask", id: "a1" });
    expect(c.submitInput).not.toHaveBeenCalled();
  });

  it("an unknown steer outcome is never moved or re-sent", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
    c.queueSteer.mockRejectedValueOnce(new (CutexApiError as any)(409, "outcome_unknown", "?"));
    await expect(service.queueMergeInsert("s1", refs("q1", "q2"), true)).rejects.toThrow("queue_steer_refused:outcomeUnknown");
    expect(c.queueMove).not.toHaveBeenCalled();
    expect(c.submitInput).not.toHaveBeenCalled();
  });

  it("the first item changed after the removes: the removed ones come back as ONE item at the front", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")]), queued("q3", [image(3), text("three")])]);
    c.queueUpdate.mockRejectedValueOnce(new (CutexApiError as any)(409, "queue_input_already_submitted", "sent"));
    await expect(service.queueMergeInsert("s1", refs("q1", "q2", "q3"), true)).rejects.toThrow(/queue_merge_failed:kept/);
    expect(c.submitInput).toHaveBeenCalledWith("s1", [text("two\n\nthree"), image(3)], "queue", expect.objectContaining({ origin: OWNER }));
    expect(c.queueMove).toHaveBeenCalledWith("s1", "qN", 4, { kind: "ask", id: "a1" });
    expect(c.queueSteer).not.toHaveBeenCalled();
    expect(c.items.map((x: any) => x.queueId)).toEqual(["q1", "qN"]);
  });

  it("a transport error on a remove counts the item as merged only if it is gone", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
    c.queueRemove.mockImplementationOnce(async () => {
      c.items = c.items.filter((x: any) => x.queueId !== "q2");
      throw new Error("socket hang up");
    });
    const r = await service.queueMergeInsert("s1", refs("q1", "q2"), true);
    expect(r.merged).toEqual(["q1", "q2"]);
    expect(mergedText(r.input)).toBe("one\n\ntwo");
  });

  it("older cutex (no queue-steer): CAS-remove + submit auto; a failed submit is queued again as one item", async () => {
    const c = connect([queued("q1", [text("one")]), queued("q2", [text("two")])]);
    c.submitInput.mockRejectedValueOnce(new Error("boom"));
    await expect(service.queueMergeInsert("s1", refs("q1", "q2"))).rejects.toThrow(/queue_merge_failed:kept/);
    expect(c.calls).toEqual(["remove q2@2", "update q1@2", "remove q1@3", "submit queue", "move qN"]);
    expect(c.items).toHaveLength(1);
    expect(mergedText(c.items[0].input)).toBe("one\n\ntwo");
    c.items = [queued("q1", [text("one")]), queued("q2", [text("two")])];
    const r = await service.queueMergeInsert("s1", refs("q1", "q2"));
    expect(c.submitInput).toHaveBeenLastCalledWith("s1", [text("one\n\ntwo")], "auto", { clientUserMessageId: "cm-q1", origin: OWNER });
    expect(r.result.disposition).toBe("steered");
  });

  it("never merges a delegation passed along", async () => {
    const c = connect([queued("q1", [text("one")]), queued("d1", [text("bus")], { kind: "agent_bus", clientId: "a" }), queued("q2", [text("two")])]);
    const r = await service.queueMergeInsert("s1", refs("q1", "d1", "q2"), true);
    expect(r.merged).toEqual(["q1", "q2"]);
    expect(c.queueRemove).not.toHaveBeenCalledWith("s1", "d1", expect.anything());
    expect(c.items.map((x: any) => x.queueId)).toEqual(["d1"]);
  });
});

describe("queueMergeNotice", () => {
  it("reads merge refusals (after IPC wrapping), with the steer reason for kept", () => {
    const wrap = (m: string) => `Error invoking remote method 'invoke': Error: ${m}`;
    expect(queueMergeNotice(wrap("queue_merge_failed:changed"), zh)).toBe(zh("queue.merge.changed"));
    expect(queueMergeNotice(wrap("queue_merge_failed:tooLarge"), zh)).toBe(zh("queue.merge.tooLarge"));
    expect(queueMergeNotice(wrap("queue_merge_failed:kept"), zh)).toBe(zh("queue.merge.kept"));
    expect(queueMergeNotice(wrap("queue_merge_failed:kept queue_steer_refused:runtimeNoSteer"), zh)).toBe(zh("queue.merge.keptReason", { reason: zh("queue.steer.runtimeNoSteer") }));
    expect(queueMergeNotice(wrap("queue_steer_refused:outcomeUnknown"), zh)).toBe(zh("queue.steer.outcomeUnknown"));
    // Anything else is never shown raw (a toast has no 详情).
    expect(queueMergeNotice("plain", zh)).toBe(zh("queue.merge.failed"));
    expect(queueMergeNotice(wrap("queue_merge_failed:kept revision_conflict: stale"), zh)).toBe(zh("queue.merge.kept"));
  });
});
