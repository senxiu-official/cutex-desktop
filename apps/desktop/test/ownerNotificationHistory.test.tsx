// @vitest-environment jsdom
import { act, createElement as h, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerNotification, OwnerNotificationList } from "@cutex-desktop/protocol";
import { NOTIFICATION_PAGES_FEATURE } from "../src/shared/notificationPaging";
import { OWNER_NOTIFY_FEATURE } from "../src/shared/ownerNotify";
const fx = vi.hoisted(() => ({ page: vi.fn(), remotePage: vi.fn(), action: vi.fn(), pending: vi.fn(async () => []), features: new Set<string>(), handlers: {} as Record<string, (p: unknown) => void> }));
vi.mock("../src/renderer/src/bridge", () => ({ api: { ownerNotifyAction: fx.action, ownerNotificationsPage: fx.page, ownerNotifications: fx.pending }, apiFor: (hostId: string) => ({ ownerNotificationsPage: hostId === "local" ? fx.page : fx.remotePage, ownerNotifications: fx.pending }), bridge: { on: (name: string, fn: (p: unknown) => void) => { fx.handlers[name] = fn; } } }));
vi.mock("../src/renderer/src/lib/notifyEvents", () => ({ emitNotify: vi.fn(), retractNotify: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }), translate: (key: string) => key }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvFeatures: () => fx.features }));
import { loadOwnerNotificationHistory as load, ownerNotificationHistoryKey as key, ownerNotifyAct, refreshPendingOwnerNotes, removeOwnerNote, seedOwnerNotes, startOwnerNotifySync, useOwnerNotify } from "../src/renderer/src/lib/ownerNotifyStore";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
import { OwnerNotificationHistory } from "../src/renderer/src/components/OwnerNotificationHistory";
const rec = (notificationId: string, over: Partial<OwnerNotification> = {}): OwnerNotification => ({ notificationId, agentId: "eva", origin: "agent", agentName: "Eva", text: "hello", level: "info", requestedLevel: "info", downgraded: null, muted: false, channels: [], needsReply: false, delegation: null, job: null, turnId: null, state: "open", createdAt: "2026-11-04T00:00:00Z", acknowledgedAt: null, closedAt: null, reply: null, ...over });
const deferred = () => { let resolve!: (p: OwnerNotificationList) => void; const promise = new Promise<OwnerNotificationList>(r => { resolve = r; }); return { promise, resolve }; };
const state = { features: new Set<string>(), selectedId: "eva", view: { kind: "conversation" }, sidebar: null, hosts: { active: "local", hosts: [] }, byHost: { remote: { features: new Set<string>(), sidebar: null } }, select: async () => {} };
const page = (host = "local", agent = "eva") => useOwnerNotify.getState().history[key(host, agent)];
const event = (record: OwnerNotification) => fx.handlers.hostEvent!({ hostId: "local", envelope: { cutex: { method: "cutex/ownerNotify/updated", params: { notification: record } } } });
let root: Root | undefined, container: HTMLDivElement | undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => startOwnerNotifySync({ getState: () => state, subscribe: () => () => {} }));
beforeEach(() => { useOwnerNotify.getState().reset(); fx.page.mockReset().mockResolvedValue({ notifications: [] }); fx.remotePage.mockReset().mockResolvedValue({ notifications: [] }); fx.pending.mockReset().mockResolvedValue([]); fx.action.mockReset(); state.hosts.active = "local"; state.features = new Set([OWNER_NOTIFY_FEATURE, NOTIFICATION_PAGES_FEATURE]); state.byHost.remote.features = new Set(state.features); fx.features = state.features; });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; container?.remove(); container = undefined; });
async function mount(hostId = "local", agentId = "eva") { container = document.createElement("div"); document.body.append(container); root = createRoot(container); await act(async () => root!.render(h(StrictMode, null, h(OwnerNotificationHistory, { hostId, agentId })))); }

describe("bounded notification history", () => {
  it("explicit bounded first page merges bootstrap once, retains short-page continuation and never drains", async () => {
    seedOwnerNotes([rec("ntf-bootstrap")]); fx.page.mockResolvedValue({ notifications: [rec("ntf-bootstrap"), rec("ntf-1")], nextCursor: "opaque cursor" }); await load("local", "eva");
    expect(fx.page).toHaveBeenCalledExactlyOnceWith({ filter: "all", agentId: "eva", limit: 50 }); expect(Object.keys(useOwnerNotify.getState().byId)).toEqual(["ntf-bootstrap", "ntf-1"]); expect(page()).toEqual({ cursor: "opaque cursor", loading: false, error: null }); expect(fx.pending).not.toHaveBeenCalled();
  });
  it("follows empty-page opaque continuation on the next request, then stops at EOF", async () => {
    fx.page.mockResolvedValueOnce({ notifications: [], nextCursor: "opaque/==" }).mockResolvedValueOnce({ notifications: [rec("ntf-old")] }); await load("local", "eva"); expect(fx.page).toHaveBeenCalledTimes(1); await load("local", "eva"); expect(fx.page.mock.calls[1]![0]).toEqual({ filter: "all", agentId: "eva", limit: 50, cursor: "opaque/==" }); await load("local", "eva"); expect(fx.page).toHaveBeenCalledTimes(2); expect(page()?.cursor).toBeNull();
  });
  it("accepts null continuation as EOF", async () => { fx.page.mockResolvedValue({ notifications: [], nextCursor: null }); await load("local", "eva"); await load("local", "eva"); expect(fx.page).toHaveBeenCalledTimes(1); });
  it("deduplicates concurrent loads and merges the returned page exactly once", async () => {
    const d = deferred(); fx.page.mockReturnValue(d.promise); let merges = 0; const off = useOwnerNotify.subscribe((s, prev) => { if (s.byId !== prev.byId) merges++; });
    const a = load("local", "eva"), b = load("local", "eva"); expect(a).toBe(b); await Promise.resolve(); expect(fx.page).toHaveBeenCalledTimes(1); expect(page()?.loading).toBe(true); d.resolve({ notifications: [rec("ntf-1")] }); await a; off(); expect(merges).toBe(1); expect(page()?.loading).toBe(false);
  });
  it("does not overwrite newer live/bootstrap records or resurrect deleted IDs", async () => {
    seedOwnerNotes([rec("ntf-known", { text: "bootstrap authoritative" })]); const d = deferred(); fx.page.mockReturnValue(d.promise); const pending = load("local", "eva"); await Promise.resolve(); seedOwnerNotes([rec("ntf-known", { text: "bootstrap authoritative" })]); event(rec("ntf-live", { text: "new live text" })); removeOwnerNote("ntf-deleted"); d.resolve({ notifications: [rec("ntf-known"), rec("ntf-live"), rec("ntf-deleted"), rec("ntf-fresh")] }); await pending;
    expect(useOwnerNotify.getState().byId["ntf-known"]?.text).toBe("bootstrap authoritative"); expect(useOwnerNotify.getState().byId["ntf-live"]?.text).toBe("new live text"); expect(useOwnerNotify.getState().byId["ntf-deleted"]).toBeUndefined(); expect(useOwnerNotify.getState().byId["ntf-fresh"]).toBeDefined();
  });
  it("pending snapshot cannot overwrite intervening live updates/deletion or reread a newly live note", async () => {
    seedOwnerNotes([rec("ntf-live", { needsReply: true }), rec("ntf-deleted", { needsReply: true })]);
    let resolve!: (rows: OwnerNotification[]) => void;
    fx.pending.mockReturnValueOnce(new Promise<OwnerNotification[]>(r => { resolve = r; }) as never);
    const refresh = refreshPendingOwnerNotes("local");
    event(rec("ntf-live", { needsReply: true, text: "new live" }));
    event(rec("ntf-new-live", { needsReply: true })); removeOwnerNote("ntf-deleted");
    resolve([rec("ntf-live", { needsReply: true }), rec("ntf-deleted", { needsReply: true })]); await refresh;
    expect(useOwnerNotify.getState().byId["ntf-live"]?.text).toBe("new live");
    expect(useOwnerNotify.getState().byId["ntf-deleted"]).toBeUndefined(); expect(fx.pending).toHaveBeenCalledTimes(1);
    const d = deferred(); fx.page.mockReturnValueOnce(d.promise); const history = load("local", "eva"); await Promise.resolve();
    event(rec("ntf-live", { needsReply: true, text: "live during history" }));
    d.resolve({ notifications: [rec("ntf-live"), rec("ntf-deleted")], nextCursor: "next" }); await history;
    expect(useOwnerNotify.getState().byId["ntf-live"]?.text).toBe("live during history"); expect(useOwnerNotify.getState().byId["ntf-deleted"]).toBeUndefined();
  });
  it("a pending reconciliation reread also cannot overwrite a newer live copy", async () => {
    seedOwnerNotes([rec("ntf-live", { needsReply: true })]);
    let resolve!: (rows: OwnerNotification[]) => void;
    fx.pending.mockResolvedValueOnce([]).mockReturnValueOnce(new Promise<OwnerNotification[]>(r => { resolve = r; }) as never);
    await refreshPendingOwnerNotes("local"); event(rec("ntf-live", { needsReply: true, text: "live after reread" }));
    resolve([rec("ntf-live", { needsReply: true })]); await Promise.resolve();
    expect(useOwnerNotify.getState().byId["ntf-live"]?.text).toBe("live after reread");
  });
  it("reconciles stable cached open rows with a newer answered page", async () => {
    seedOwnerNotes([rec("ntf-old", { needsReply: true })]);
    fx.page.mockResolvedValue({ notifications: [rec("ntf-old", { needsReply: true, state: "answered", closedAt: "2026-11-04T01:00:00Z", reply: { text: "done", repliedAt: "2026-11-04T01:00:00Z", clientUserMessageId: "reply-1" } })] });
    await load("local", "eva"); expect(useOwnerNotify.getState().byId["ntf-old"]).toMatchObject({ state: "answered", reply: { text: "done" } });
  });
  it("an action result during a page read wins even over a same-state older page", async () => {
    seedOwnerNotes([rec("ntf-action")]); const d = deferred(); fx.page.mockReturnValueOnce(d.promise);
    const pending = load("local", "eva"); await Promise.resolve();
    fx.action.mockResolvedValueOnce({ ok: true, notification: rec("ntf-action", { state: "acknowledged", text: "new action copy" }) });
    await ownerNotifyAct(rec("ntf-action"), "ack");
    d.resolve({ notifications: [rec("ntf-action", { state: "acknowledged", text: "older page copy" })] }); await pending;
    expect(useOwnerNotify.getState().byId["ntf-action"]?.text).toBe("new action copy");
  });
  it("keeps newer safety decisions when old safety snapshots arrive", async () => {
    const safety = { blockId: "sb-1", runtime: "claude", threadId: "t", turnId: "old-turn", itemId: "item", toolName: "Bash", toolInput: {}, command: "rm x", reason: "check", state: "used" as const, blockedAt: "2026-11-01", decidedAt: "2026-11-02", expiresAt: null, usedAt: "2026-11-03", grantSeconds: 1800 };
    event(rec("ntf-safety", { origin: "system", state: "acknowledged", safetyBlock: safety })); fx.page.mockResolvedValue({ notifications: [rec("ntf-safety", { origin: "system", state: "acknowledged", safetyBlock: { ...safety, state: "granted" } })] }); await load("local", "eva"); expect(useOwnerNotify.getState().byId["ntf-safety"]?.safetyBlock?.state).toBe("used");
  });
  it("fences host reset responses without disturbing a fresh request", async () => {
    const d = deferred(); fx.page.mockReturnValueOnce(d.promise).mockResolvedValueOnce({ notifications: [rec("ntf-new")], nextCursor: "new" }); const old = load("local", "eva"); await Promise.resolve(); fireHostReset("local"); expect(page()).toBeUndefined(); await load("local", "eva"); d.resolve({ notifications: [rec("ntf-old")], nextCursor: "stale" }); await old; expect(Object.keys(useOwnerNotify.getState().byId)).toEqual(["ntf-new"]); expect(page()?.cursor).toBe("new");
  });
  it("fences reset before the scheduled RPC; reset clears all views", async () => { const old = load("local", "eva"); useOwnerNotify.getState().reset(); await old; expect(fx.page).not.toHaveBeenCalled(); expect(useOwnerNotify.getState().history).toEqual({}); });
  it("isolates host/agent cursors, routes remote reads and resets only that host", async () => {
    fx.page.mockImplementation(async ({ agentId }) => ({ notifications: [rec(`ntf-${agentId}`, { agentId })], nextCursor: agentId })); fx.remotePage.mockResolvedValue({ notifications: [rec("ntf-remote")], nextCursor: "remote" }); await Promise.all([load("local", "eva"), load("local", "mika"), load("remote", "eva")]); expect(page()?.cursor).toBe("eva"); expect(page("local", "mika")?.cursor).toBe("mika"); expect(page("remote")?.cursor).toBe("remote"); expect(useOwnerNotify.getState().others.remote?.["ntf-remote"]).toBeDefined(); fireHostReset("remote"); expect(page("remote")).toBeUndefined(); expect(page()?.cursor).toBe("eva");
  });
  it("binds the host before a focus switch and keeps cursor retries on that host", async () => {
    const pending = load("local", "eva"); state.hosts.active = "remote";
    fx.page.mockRejectedValueOnce(new Error("resync_required: changed")).mockResolvedValueOnce({ notifications: [rec("ntf-local")] });
    await pending; expect(fx.page).toHaveBeenCalledTimes(2); expect(fx.remotePage).not.toHaveBeenCalled();
    expect(useOwnerNotify.getState().others.local?.["ntf-local"]).toBeDefined();
  });
  it("never pages older hosts or a similar capability name", async () => { state.features = new Set([OWNER_NOTIFY_FEATURE, "owner-notify-approval-pages-v2"]); await load("local", "eva"); expect(fx.page).not.toHaveBeenCalled(); expect(page()).toBeUndefined(); });
  it.each([[400, "invalid_cursor"], [409, "resync_required"]])("restarts %s %s once from first page, keeping records", async (status, code) => {
    fx.page.mockResolvedValueOnce({ notifications: [rec("ntf-live")], nextCursor: "expired" }).mockRejectedValueOnce(Object.assign(new Error(`${code}: changed`), { status, code })).mockResolvedValueOnce({ notifications: [rec("ntf-restart")], nextCursor: "new" }); await load("local", "eva"); await load("local", "eva"); expect(fx.page.mock.calls.map(c => c[0].cursor)).toEqual([undefined, "expired", undefined]); expect(Object.keys(useOwnerNotify.getState().byId)).toEqual(["ntf-live", "ntf-restart"]); expect(page()?.cursor).toBe("new");
  });
  it.each(["invalid_cursor: changed", "resync_required: changed", "Error invoking remote method 'cutex:invoke': Error: resync_required: changed"])("recognizes Electron code-preserving message: %s", async message => { fx.page.mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce({ notifications: [] }); await load("local", "eva"); expect(fx.page).toHaveBeenCalledTimes(2); expect(page()?.error).toBeNull(); });
  it("stops after one restart, exposes actual error and provides bounded retry", async () => { fx.page.mockRejectedValue(new Error("resync_required: changed again")); await load("local", "eva"); expect(fx.page).toHaveBeenCalledTimes(2); expect(page()?.error).toBe("resync_required: changed again"); fx.page.mockResolvedValue({ notifications: [] }); await load("local", "eva"); expect(fx.page).toHaveBeenCalledTimes(3); expect(fx.pending).not.toHaveBeenCalled(); });
  it.each([[403, "invalid_cursor"], [500, "resync_required"], [409, "permission_denied"]])("does not restart unrelated status/code %s %s", async (status, code) => { fx.page.mockRejectedValue(Object.assign(new Error("actual refusal"), { status, code })); await load("local", "eva"); expect(fx.page).toHaveBeenCalledTimes(1); expect(page()?.error).toBe("actual refusal"); });
  it("rejects cyclic cursors with retry and does not merge a bad page", async () => {
    fx.page.mockResolvedValueOnce({ notifications: [], nextCursor: "A" }).mockResolvedValueOnce({ notifications: [], nextCursor: "B" }).mockResolvedValueOnce({ notifications: [rec("ntf-cycle")], nextCursor: "A" }); await load("local", "eva"); await load("local", "eva"); await load("local", "eva"); expect(page()).toMatchObject({ cursor: null, loading: false, error: "Notification history cursor did not advance" }); expect(useOwnerNotify.getState().byId["ntf-cycle"]).toBeUndefined(); fx.page.mockResolvedValueOnce({ notifications: [rec("ntf-retry")] }); await load("local", "eva"); expect(useOwnerNotify.getState().byId["ntf-retry"]).toBeDefined(); expect(fx.page.mock.calls.at(-1)![0].cursor).toBeUndefined();
  });
  it("rejects immediate repeated cursor", async () => { fx.page.mockResolvedValue({ notifications: [], nextCursor: "A" }); await load("local", "eva"); await load("local", "eva"); expect(page()?.error).toContain("did not advance"); expect(page()?.cursor).toBeNull(); expect(fx.page).toHaveBeenCalledTimes(2); });
  it("discards records outside requested agent scope", async () => { fx.page.mockResolvedValue({ notifications: [rec("ntf-wrong", { agentId: "mika" })] }); await load("local", "eva"); expect(useOwnerNotify.getState().byId).toEqual({}); });
});
describe("history control", () => {
  it("deduplicates first read under StrictMode; further pages wait for owner click", async () => { fx.page.mockResolvedValueOnce({ notifications: [], nextCursor: "next" }).mockResolvedValueOnce({ notifications: [rec("ntf-earlier", { turnId: "old-native-turn" })] }); await mount(); expect(fx.page).toHaveBeenCalledTimes(1); expect(container!.textContent).toBe("ownerNotify.historyMore"); await act(async () => { container!.querySelector("button")!.click(); }); expect(fx.page).toHaveBeenCalledTimes(2); expect(container!.textContent).toBe(""); expect(useOwnerNotify.getState().byId["ntf-earlier"]?.turnId).toBe("old-native-turn"); });
  it("shows actual error/retry, disables loading, and never refetches on rerender", async () => { fx.page.mockRejectedValueOnce(new Error("network detail")); await mount(); expect(container!.textContent).toContain("network detail"); expect(container!.textContent).toContain("ownerNotify.historyRetry"); const d = deferred(); fx.page.mockReturnValueOnce(d.promise); await act(async () => { container!.querySelector("button")!.click(); }); expect(container!.querySelector("button")!.disabled).toBe(true); expect(container!.textContent).toContain("ownerNotify.historyLoading"); await act(async () => { d.resolve({ notifications: [] }); }); expect(container!.textContent).toBe(""); });
  it("has no control or request on older host", async () => { fx.features = state.features = new Set([OWNER_NOTIFY_FEATURE]); await mount(); expect(container!.textContent).toBe(""); expect(fx.page).not.toHaveBeenCalled(); });
  it("reset starts one new bounded read and never drains continuation", async () => { fx.page.mockResolvedValue({ notifications: [], nextCursor: "next" }); await mount(); await act(async () => { fireHostReset("local"); }); expect(fx.page).toHaveBeenCalledTimes(2); expect(container!.textContent).toBe("ownerNotify.historyMore"); });
});
