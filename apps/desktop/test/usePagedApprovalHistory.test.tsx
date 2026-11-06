// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRecord } from "../src/shared/ipc";
import { NOTIFICATION_PAGES_FEATURE } from "../src/shared/notificationPaging";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
import { APPROVAL_HISTORY_PAGE_SIZE, usePagedApprovalHistory } from "../src/renderer/src/lib/usePagedApprovalHistory";

const apis = vi.hoisted(() => new Map<string, { approvalsPage: ReturnType<typeof vi.fn>; approvals: ReturnType<typeof vi.fn> }>());
vi.mock("../src/renderer/src/lib/hostLists", () => ({ hostApi: (id: string) => apis.get(id) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row = (id: string): ApprovalRecord => ({ approvalId: id, kind: "managed_service", reason: "test", summary: id, details: null, requestSha256: "x", requesterCutexSessionId: "agent", state: "approved", createdAt: "2026-11-04T00:00:00Z" });
const host = (hostId: string, paged = true) => ({ hostId, features: new Set(paged ? [NOTIFICATION_PAGES_FEATURE] : []), approvals: [] as ApprovalRecord[] });
type Hosts = ReturnType<typeof host>[];
type Page = { approvals: ApprovalRecord[]; nextCursor?: string | null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root, node: HTMLDivElement;
let view: ReturnType<typeof usePagedApprovalHistory>;
function Probe({ hosts, scope }: { hosts: Hosts; scope: string }) {
  view = usePagedApprovalHistory(hosts, scope);
  return null;
}
const draw = (hosts: Hosts, scope = "a") => act(async () => { root.render(h(Probe, { hosts, scope })); });
function api(id: string) {
  const mock = { approvalsPage: vi.fn().mockResolvedValue({ approvals: [] }), approvals: vi.fn().mockResolvedValue([]) };
  apis.set(id, mock);
  return mock;
}
beforeEach(() => { apis.clear(); node = document.createElement("div"); root = createRoot(node); });
afterEach(() => { act(() => root.unmount()); node.remove(); });

describe("approval history bounded per-host reads", () => {
  it("loads one bounded page, never eagerly drains, then appends and deduplicates at a boundary", async () => {
    const a = api("a");
    const first = Array.from({ length: APPROVAL_HISTORY_PAGE_SIZE }, (_, i) => row(String(i)));
    a.approvalsPage.mockResolvedValueOnce({ approvals: first, nextCursor: "opaque+/=cursor" })
      .mockResolvedValueOnce({ approvals: [row("99"), row("100")], nextCursor: null });
    await draw([host("a")]);
    expect(a.approvalsPage).toHaveBeenCalledExactlyOnceWith("all", { limit: APPROVAL_HISTORY_PAGE_SIZE });
    expect(view.pages.a!.value).toHaveLength(100);
    await act(async () => { await view.loadMore("a"); });
    expect(a.approvalsPage).toHaveBeenLastCalledWith("all", { limit: APPROVAL_HISTORY_PAGE_SIZE, cursor: "opaque+/=cursor" });
    expect(view.pages.a!.value).toHaveLength(101);
    expect(a.approvals).not.toHaveBeenCalled();
  });

  it.each([undefined, null])("treats nextCursor=%s as exhausted even on a full page", async nextCursor => {
    const a = api("a");
    a.approvalsPage.mockResolvedValue({ approvals: Array.from({ length: 100 }, (_, i) => row(String(i))), ...(nextCursor === undefined ? {} : { nextCursor }) });
    await draw([host("a")]);
    await act(async () => { await view.loadMore("a"); });
    expect(view.pages.a!.nextCursor).toBeNull();
    expect(a.approvalsPage).toHaveBeenCalledTimes(1);
  });

  it("follows continuation through short and empty pages", async () => {
    const a = api("a");
    a.approvalsPage.mockResolvedValueOnce({ approvals: [row("first")], nextCursor: "short" })
      .mockResolvedValueOnce({ approvals: [], nextCursor: "empty" })
      .mockResolvedValueOnce({ approvals: [row("last")] });
    await draw([host("a")]);
    await act(async () => { await view.loadMore("a"); });
    expect(view.pages.a!.nextCursor).toBe("empty");
    await act(async () => { await view.loadMore("a"); });
    expect(view.pages.a!.value!.map(r => r.approvalId)).toEqual(["first", "last"]);
    expect(a.approvalsPage.mock.calls[2]![1].cursor).toBe("empty");
  });

  it("deduplicates concurrent load-more calls synchronously", async () => {
    const a = api("a"), next = deferred<Page>();
    a.approvalsPage.mockResolvedValueOnce({ approvals: [], nextCursor: "next" }).mockReturnValueOnce(next.promise);
    await draw([host("a")]);
    let loading!: Promise<void>;
    await act(async () => { loading = view.loadMore("a"); void view.loadMore("a"); });
    expect(a.approvalsPage).toHaveBeenCalledTimes(2);
    expect(view.pages.a!.loading).toBe(true);
    await act(async () => { next.resolve({ approvals: [row("one")] }); await loading; });
    expect(view.pages.a!.value).toEqual([row("one")]);
  });

  it.each([["a", "a"], ["a", "b", "a"], ["a", "b", "c", "a"]])("rejects cursor cycle %j and restarts only on user retry", async (...cursors) => {
    const a = api("a");
    for (const nextCursor of cursors) a.approvalsPage.mockResolvedValueOnce({ approvals: [], nextCursor });
    a.approvalsPage.mockResolvedValueOnce({ approvals: [row("fresh")], nextCursor: "a" });
    await draw([host("a")]);
    for (let i = 1; i < cursors.length; i++) await act(async () => { await view.loadMore("a"); });
    expect(view.pages.a!.error).toContain("cursor repeated");
    expect(view.pages.a!.loading).toBe(false);
    expect(a.approvalsPage).toHaveBeenCalledTimes(cursors.length);
    await act(async () => { await view.loadMore("a"); });
    expect(a.approvalsPage).toHaveBeenLastCalledWith("all", { limit: 100 });
    expect(view.pages.a!.value).toEqual([row("fresh")]);
    expect(view.pages.a!.nextCursor).toBe("a");
    expect(view.pages.a!.error).toBeNull();
    expect(a.approvals).not.toHaveBeenCalled();
  });

  it.each(["reload", "host-reset", "pending-refresh", "scope-switch"])("%s clears previously seen cursors", async reset => {
    const a = api("a");
    const hosts = [host("a")];
    a.approvalsPage.mockResolvedValueOnce({ approvals: [], nextCursor: "a" })
      .mockResolvedValueOnce({ approvals: [], nextCursor: "b" })
      .mockResolvedValueOnce({ approvals: [row("reset")], nextCursor: "a" });
    await draw(hosts);
    await act(async () => { await view.loadMore("a"); });
    if (reset === "pending-refresh") await draw([{ ...hosts[0]!, approvals: [row("pending-change")] }]);
    else if (reset === "scope-switch") await draw(hosts, "other-focus");
    else await act(async () => { if (reset === "reload") view.reload("a"); else fireHostReset("a"); });
    expect(view.pages.a!.value).toEqual([row("reset")]);
    expect(view.pages.a!.nextCursor).toBe("a");
    expect(view.pages.a!.error).toBeNull();
  });

  it("tracks identical opaque cursors independently on different hosts", async () => {
    for (const id of ["a", "b"]) {
      api(id).approvalsPage.mockResolvedValueOnce({ approvals: [], nextCursor: "shared-first" })
        .mockResolvedValueOnce({ approvals: [], nextCursor: "shared-second" });
    }
    await draw([host("a"), host("b")]);
    await act(async () => { await view.loadMore("a"); await view.loadMore("b"); });
    expect(view.pages.a!.nextCursor).toBe("shared-second");
    expect(view.pages.b!.nextCursor).toBe("shared-second");
    expect(view.pages.a!.error).toBeNull();
    expect(view.pages.b!.error).toBeNull();
  });

  it.each([
    Object.assign(new Error("400 invalid_filter"), { status: 400, code: "invalid_filter" }),
    Object.assign(new Error("409 conflict"), { status: 409, code: "conflict" }),
    new Error("Error invoking remote method: Error: 400 bad_request"),
    new Error("409 not_resync_required"),
  ])("ordinary HTTP failures retain rows and cursor: %s", async error => {
    const a = api("a");
    a.approvalsPage.mockResolvedValueOnce({ approvals: [row("kept")], nextCursor: "cursor" })
      .mockRejectedValueOnce(error).mockResolvedValueOnce({ approvals: [row("next")] });
    await draw([host("a")]);
    await act(async () => { await view.loadMore("a"); });
    expect(view.pages.a!.value).toEqual([row("kept")]);
    await act(async () => { await view.loadMore("a"); });
    expect(a.approvalsPage).toHaveBeenLastCalledWith("all", { limit: 100, cursor: "cursor" });
    expect(view.pages.a!.value).toEqual([row("kept"), row("next")]);
    expect(view.pages.a!.error).toBeNull();
  });

  it("uses the legacy full-list API only on old hosts", async () => {
    const a = api("a"); a.approvals.mockResolvedValue([row("legacy")]);
    await draw([host("a", false)]);
    expect(a.approvals).toHaveBeenCalledExactlyOnceWith("all");
    expect(a.approvalsPage).not.toHaveBeenCalled();
    expect(view.pages.a!.value).toEqual([row("legacy")]);
  });

  it("isolates cursors, duplicate IDs, errors and loading across hosts", async () => {
    const a = api("a"), b = api("b"), pending = deferred<Page>();
    a.approvalsPage.mockResolvedValueOnce({ approvals: [row("same")], nextCursor: "cursor-a" }).mockReturnValueOnce(pending.promise);
    b.approvalsPage.mockResolvedValueOnce({ approvals: [row("same")], nextCursor: "cursor-b" }).mockRejectedValueOnce(new Error("b offline"));
    await draw([host("a"), host("b")]);
    await act(async () => { void view.loadMore("a"); await view.loadMore("b"); });
    expect(view.pages.a!.value).toHaveLength(1);
    expect(view.pages.b!.value).toHaveLength(1);
    expect(view.pages.a!.loading).toBe(true);
    expect(view.pages.a!.error).toBeNull();
    expect(view.pages.b!.error).toBe("b offline");
    expect(b.approvalsPage.mock.calls[1]![1].cursor).toBe("cursor-b");
    await act(async () => { pending.resolve({ approvals: [] }); });
  });

  it("a pending-array event refresh fences old reads and refreshes only that host's first page", async () => {
    const a = api("a"), b = api("b"), stale = deferred<Page>();
    const hosts = [host("a"), host("b")];
    a.approvalsPage.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ approvals: [row("fresh")], nextCursor: "fresh-cursor" });
    await draw(hosts);
    await draw([{ ...hosts[0]!, approvals: [row("new-pending")] }, hosts[1]!]);
    await act(async () => { stale.resolve({ approvals: [row("stale")], nextCursor: "stale-cursor" }); });
    expect(view.pages.a!.value).toEqual([row("fresh")]);
    expect(view.pages.a!.nextCursor).toBe("fresh-cursor");
    expect(b.approvalsPage).toHaveBeenCalledTimes(1);
    expect(a.approvalsPage.mock.calls.every(call => !call[1].cursor)).toBe(true);
  });

  it("explicit reload fences an in-flight next page and clears its old cursor and rows", async () => {
    const a = api("a"), stale = deferred<Page>();
    a.approvalsPage.mockResolvedValueOnce({ approvals: [row("old")], nextCursor: "old-cursor" })
      .mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ approvals: [row("fresh")] });
    await draw([host("a")]);
    await act(async () => { void view.loadMore("a"); });
    await act(async () => { view.reload("a"); });
    await act(async () => { stale.resolve({ approvals: [row("stale")] }); });
    expect(view.pages.a!.value).toEqual([row("fresh")]);
    expect(a.approvalsPage).toHaveBeenLastCalledWith("all", { limit: 100 });
  });

  it.each([
    "400 invalid_cursor", "409 resync_required",
    'Error invoking remote method: Error: HTTP 400 {"code":"invalid_cursor"}',
    'Error invoking remote method: Error: HTTP 409 {"code":"resync_required"}',
  ])("%s waits for user retry, restarts once, and never falls back", async error => {
    const a = api("a");
    a.approvalsPage.mockResolvedValueOnce({ approvals: [row("old")], nextCursor: "bad" })
      .mockRejectedValueOnce(new Error(error)).mockRejectedValueOnce(new Error(error))
      .mockResolvedValueOnce({ approvals: [row("new")] });
    await draw([host("a")]);
    await act(async () => { await view.loadMore("a"); });
    expect(a.approvalsPage).toHaveBeenCalledTimes(2);
    expect(view.pages.a!.error).toBe(error);
    await act(async () => { await view.loadMore("a"); });
    expect(a.approvalsPage).toHaveBeenCalledTimes(3);
    expect(a.approvalsPage).toHaveBeenLastCalledWith("all", { limit: 100 });
    expect(view.pages.a!.value).toBeNull();
    await act(async () => { await view.loadMore("a"); });
    expect(view.pages.a!.value).toEqual([row("new")]);
    expect(a.approvals).not.toHaveBeenCalled();
  });

  it("scope changes and host connection replacements fence stale completions", async () => {
    const a = api("a"), b = api("b"), stale = deferred<Page>(), replaced = deferred<Page>();
    a.approvalsPage.mockReturnValueOnce(stale.promise);
    b.approvalsPage.mockReturnValueOnce(replaced.promise).mockResolvedValueOnce({ approvals: [row("reconnected")] });
    await draw([host("a")]);
    await draw([host("b")], "b");
    await act(async () => { fireHostReset("b"); });
    await act(async () => { stale.resolve({ approvals: [row("wrong-host")] }); replaced.resolve({ approvals: [row("wrong-connection")] }); });
    expect(Object.keys(view.pages)).toEqual(["b"]);
    expect(view.pages.b!.value).toEqual([row("reconnected")]);
  });

  it("unmount prevents old results reaching a remounted page", async () => {
    const a = api("a"), stale = deferred<Page>();
    a.approvalsPage.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ approvals: [row("remounted")] });
    await draw([host("a")]);
    act(() => root.unmount()); root = createRoot(node);
    await draw([host("a")]);
    await act(async () => { stale.resolve({ approvals: [row("unmounted")] }); });
    expect(view.pages.a!.value).toEqual([row("remounted")]);
  });

  it("a null response on a capable host is retryable, never an unbounded fallback", async () => {
    const a = api("a"); a.approvalsPage.mockResolvedValue(null);
    await draw([host("a")]);
    expect(view.pages.a!.error).toBeTruthy();
    expect(a.approvals).not.toHaveBeenCalled();
  });
});
