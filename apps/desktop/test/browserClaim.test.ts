import { describe, expect, it, vi } from "vitest";
import type { ApprovalRecord } from "../src/shared/ipc";
import { DEFAULT_BROWSER_CONTROL_SETTINGS, type BrowserTabView } from "../src/shared/browser";
import { BrowserClaimController, browserClaimApproval, browserClaimTabs, browserClaimTabDisplay, type BrowserClaimScope } from "../src/renderer/src/modules/approvals/browserClaimUi";
import { approvalFacts, grantKind } from "../src/renderer/src/lib/approvals";
import { zhCN, en } from "../src/renderer/src/modules/approvals/i18n";

const now = Date.parse("2026-10-11T12:00:00Z"), digest = "a".repeat(64);
const approval = (extra: Partial<ApprovalRecord> = {}): ApprovalRecord => ({ approvalId: "approval-1", kind: "browser_claim", state: "pending",
  reason: "browser_owner_tab_selection", requesterCutexSessionId: "session", requesterName: "Builder", summary: "Select owner tab",
  requestSha256: digest, createdAt: "2026-10-11T11:00:00Z", details: { version: 1, cutexSessionId: "session", agentName: "Builder",
    requestId: "request", deviceId: "device", hostId: "ssh-bound", connectionGeneration: "connection", threadId: "thread", runtimeGeneration: 2,
    intentDigest: digest, reason: "Inspect the preview", sharesOwnerLogin: true }, ...extra });
const tab = (extra: Partial<BrowserTabView> = {}): BrowserTabView => ({ hostId: "ssh-bound", tabKey: "tab", guestId: "guest", pool: "owner",
  status: "attached", pageGeneration: 1, url: "http://localhost/", title: "Preview", loading: false, canGoBack: false, canGoForward: false, ...extra });
const settings = DEFAULT_BROWSER_CONTROL_SETTINGS;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
function fixture() {
  const scope: BrowserClaimScope = { hostId: "ssh-bound", epoch: "epoch", approval: approval() };
  const state: { enabled: boolean; epoch: string | null; approval?: ApprovalRecord } = { enabled: true, epoch: "epoch", approval: approval() };
  let tabs = [tab()], pending: ApprovalRecord[] | null = [approval()], time = now;
  const api = { list: vi.fn(async () => tabs), grantAgent: vi.fn(async () => {}), claimOpen: vi.fn(async () => {}) };
  const browser = vi.fn((_host: string) => api), approvals = vi.fn(async (_host: string) => pending), afterHostsDelivered = vi.fn(async () => {});
  const controller = new BrowserClaimController({ current: () => state, browser, approvals, afterHostsDelivered, now: () => time });
  return { scope, state, api, browser, approvals, controller, afterHostsDelivered,
    setTabs: (value: BrowserTabView[]) => { tabs = value; }, setApprovals: (value: ApprovalRecord[] | null) => { pending = value; }, setNow: (value: number) => { time = value; } };
}

describe("browser claim strict eligibility", () => {
  it("accepts only current pending claims for the exact bound host/session/digest", () => {
    expect(browserClaimApproval(approval(), "ssh-bound", now)?.agentName).toBe("Builder");
    for (const record of [approval({ kind: "browser_open" }), approval({ state: "approved" }), approval({ state: "denied" }),
      approval({ state: "consumed" }), approval({ createdAt: "bad" }), approval({ createdAt: "2026-10-10T11:00:00Z" }),
      approval({ requesterCutexSessionId: "other" }), approval({ requestSha256: "bad" }), approval({ details: null })])
      expect(browserClaimApproval(record, "ssh-bound", now)).toBeNull();
    expect(browserClaimApproval(approval(), "focus-host", now)).toBeNull();
    for (const change of [{ version: 2 }, { hostId: "other" }, { cutexSessionId: "other" }, { sharesOwnerLogin: false },
      { intentDigest: "b".repeat(64) }, { agentName: "" }, { runtimeGeneration: -1 }, { runtimeGeneration: 1.2 }, { requestId: "../wrong" }])
      expect(browserClaimApproval(approval({ details: { ...approval().details, ...change } }), "ssh-bound", now)).toBeNull();
  });
  it("never offers cross-host, unknown-pool, detached, controlled or leased tabs; agent-pool tabs are offered", () => {
    const lease = { leaseId: "lease", sessionId: "session", agentName: "Builder", state: "active" as const, origin: "owner" as const };
    const values = [tab(), tab({ hostId: "other" }), tab({ pool: "agent", tabKey: "agent-tab", guestId: "agent-guest" }), tab({ pool: undefined }), tab({ status: "closed" }),
      tab({ status: "pending" }), tab({ status: "unmounted" }), tab({ status: "crashed" }), tab({ lease }),
      tab({ control: { grantee: "Builder", state: "paused", operating: false } })];
    expect(browserClaimTabs(values, "ssh-bound")).toEqual([tab(), tab({ pool: "agent", tabKey: "agent-tab", guestId: "agent-guest" })]);
    expect(browserClaimTabs(Array(513).fill(tab()), "ssh-bound")).toEqual([]);
  });
  it("loads host-bound tabs without opening, revealing, granting or deciding an approval", async () => {
    const f = fixture(); expect(await f.controller.tabs(f.scope)).toEqual([tab()]);
    expect(f.browser).toHaveBeenCalledWith("ssh-bound"); expect(f.api.list).toHaveBeenCalledOnce();
    expect(f.api.grantAgent).not.toHaveBeenCalled(); expect(f.approvals).not.toHaveBeenCalled();
  });
  it("drops a late tab list when the host epoch changes", async () => {
    const f = fixture(), pending = deferred<BrowserTabView[]>(); f.api.list.mockReturnValue(pending.promise);
    const list = f.controller.tabs(f.scope); await flush(); f.state.epoch = "replacement"; pending.resolve([tab()]);
    expect(await list).toEqual([]); expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
});

describe("browser claim explicit owner confirmation", () => {
  it("revalidates approval and exact tab on both sides of confirmation then grants once with approval ID", async () => {
    const f = fixture(), confirm = vi.fn(async () => true);
    expect(await f.controller.grant(f.scope, tab(), settings, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledExactlyOnceWith("Builder", tab());
    expect(f.api.list).toHaveBeenCalledTimes(2); expect(f.approvals.mock.calls).toEqual([["ssh-bound"], ["ssh-bound"]]);
    expect(f.api.grantAgent).toHaveBeenCalledExactlyOnceWith("tab", "session", settings, "approval-1", { guestId: "guest", pageGeneration: 1 });
    expect(f.afterHostsDelivered).toHaveBeenCalled();
  });
  it("does nothing after the owner cancels", async () => {
    const f = fixture(); expect(await f.controller.grant(f.scope, tab(), settings, async () => false)).toBe(false);
    expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
  it.each(["disabled", "epoch", "missing", "denied", "expired", "digest", "session", "payloadHost"])("refuses %s changes while confirmation is open", async change => {
    const f = fixture(), prompt = deferred<boolean>();
    const work = f.controller.grant(f.scope, tab(), settings, () => prompt.promise); await flush();
    if (change === "disabled") f.state.enabled = false;
    if (change === "epoch") f.state.epoch = "replacement";
    if (change === "missing") f.state.approval = undefined;
    if (change === "denied") f.state.approval = approval({ state: "denied" });
    if (change === "expired") f.setNow(now + 86_400_000);
    if (change === "digest") f.state.approval = approval({ requestSha256: "b".repeat(64) });
    if (change === "session") f.state.approval = approval({ requesterCutexSessionId: "other" });
    if (change === "payloadHost") f.state.approval = approval({ details: { ...approval().details, hostId: "other" } });
    prompt.resolve(true); expect(await work).toBe(false); expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
  it.each(["guest", "page", "url", "title", "host", "pool", "closed", "lease", "controlled"])("refuses %s tab changes after confirmation", async change => {
    const f = fixture(), prompt = deferred<boolean>();
    const work = f.controller.grant(f.scope, tab(), settings, () => prompt.promise); await flush();
    const changes: Record<string, Partial<BrowserTabView>> = { guest: { guestId: "new" }, page: { pageGeneration: 2 }, url: { url: "http://localhost/other" },
      title: { title: "Other" }, host: { hostId: "other" }, pool: { pool: "agent" }, closed: { status: "closed" },
      lease: { lease: { leaseId: "l", sessionId: "s", agentName: "Other", state: "active", origin: "owner" } },
      controlled: { control: { grantee: "Other", state: "granted", operating: false } } };
    f.setTabs([tab(changes[change])]); prompt.resolve(true); expect(await work).toBe(false); expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
  it("rechecks the authoritative pending list even if the renderer has not received its decision event", async () => {
    for (const records of [null, [], [approval({ state: "denied" })], [approval(), approval()],
      [approval({ details: { ...approval().details, connectionGeneration: "new" } })]]) {
      const f = fixture(), prompt = deferred<boolean>();
      const work = f.controller.grant(f.scope, tab(), settings, () => prompt.promise); await flush();
      f.setApprovals(records); prompt.resolve(true); expect(await work).toBe(false); expect(f.api.grantAgent).not.toHaveBeenCalled();
    }
  });
  it("will not show confirmation for an already-unavailable approval or tab", async () => {
    const f = fixture(), confirm = vi.fn(async () => true); f.setApprovals([]);
    expect(await f.controller.grant(f.scope, tab(), settings, confirm)).toBe(false); expect(confirm).not.toHaveBeenCalled();
    f.setApprovals([approval()]); f.setTabs([]);
    expect(await f.controller.grant(f.scope, tab(), settings, confirm)).toBe(false); expect(confirm).not.toHaveBeenCalled();
  });
  it("does not let double-clicks or a stale unmounted confirmation dispatch a grant", async () => {
    const f = fixture(), prompt = deferred<boolean>(), confirm = vi.fn(() => prompt.promise);
    const work = f.controller.grant(f.scope, tab(), settings, confirm); await flush();
    expect(await f.controller.grant(f.scope, tab(), settings, confirm)).toBe(false);
    f.controller.cancel(); prompt.resolve(true); expect(await work).toBe(false);
    expect(confirm).toHaveBeenCalledOnce(); expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
  it("never retries an uncertain grant or follows it with ordinary approve", async () => {
    const f = fixture(); f.api.grantAgent.mockRejectedValue(new Error("outcome_unknown"));
    await expect(f.controller.grant(f.scope, tab(), settings, async () => true)).rejects.toThrow("outcome_unknown");
    expect(f.api.grantAgent).toHaveBeenCalledOnce(); expect(Object.keys(f.api).sort()).toEqual(["claimOpen", "grantAgent", "list"]); expect(f.api.claimOpen).not.toHaveBeenCalled();
  });
});

describe("browser approval display and warnings", () => {
  it("uses the approval whitelist for tab labels without URL credentials or queries", () => {
    expect(browserClaimTabDisplay(tab({ title: " Page\nname ", url: "https://user:password@example.invalid/path?token=secret#private" })))
      .toEqual({ title: "Page name", url: "https://example.invalid/path" });
    expect(browserClaimTabDisplay(tab({ title: "a".repeat(199) + "🙂", url: "cutex:service/web/path%3Ftoken%3Dsecret" })))
      .toEqual({ title: "a".repeat(199) + "🙂", url: "cutex:service/web" });
    expect(browserClaimTabDisplay(tab({ title: "", url: "javascript:private" }))).toEqual({ title: "", url: "" });
  });
  it("distinguishes browser selection from ordinary open approval", () => {
    expect(grantKind({ kind: "browser_claim" })).toBe("claimBrowser");
    expect(grantKind({ kind: "browser_open" })).toBe("openBrowser");
    expect(grantKind({ kind: "managed_service" })).toBe("runAsOwner");
  });
  it("shows only human facts and strips URL credentials/query/fragment", () => {
    const details = { ...approval().details, urlHint: "https://user:password@example.invalid/path?token=secret#private", unexpected: { secret: "never" } };
    expect(approvalFacts(details, "browser_claim")).toEqual([
      { key: "reason", value: "Inspect the preview", mono: false }, { key: "urlHint", value: "https://example.invalid/path", mono: false }]);
    expect(approvalFacts({ ...details, title: "Preview", url: "cutex:service/web/path%3Ftoken%3Dsecret" }, "browser_open"))
      .toEqual([{ key: "title", value: "Preview", mono: false }, { key: "url", value: "cutex:service/web", mono: false }]);
    expect(approvalFacts({ url: "javascript:private", title: { hidden: "private" } }, "browser_open")).toEqual([]);
  });
  it("keeps both locales complete with explicit login reuse and new-tool-call wording", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
    expect(zhCN["approvals.browser.confirmClaim"]).toContain("沿用你的登录态");
    expect(en["approvals.browser.confirmClaim"]).toContain("reuses your login state");
    expect(en["approvals.browser.retryHint"]).toContain("new tool call");
  });
});
