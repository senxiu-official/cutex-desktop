import { describe, expect, it, vi } from "vitest";
import type { ApprovalRecord } from "../src/shared/ipc";
import { browserClaimOpenTarget, browserClaimOrigin, browserLocalPage, pickBrowserClaimTab, planBrowserClaim, type BrowserClaimMode, type BrowserClaimTab } from "../src/shared/browserClaim";
import { BrowserClaimAudit, BrowserClaimCoordinator, BrowserClaimPolicyStore, BrowserClaimSessionAllows, type BrowserClaimDeps } from "../src/main/browser/claims";

const digest = "d".repeat(64);
const claim = (id = "apr-1", session = "reader", urlHint?: string): ApprovalRecord => ({ approvalId: id, kind: "browser_claim", state: "pending",
  reason: "browser_owner_tab_selection", requesterCutexSessionId: session, requesterName: "Reader", summary: "Select an owner browser tab",
  requestSha256: digest, createdAt: new Date().toISOString(), details: { version: 1, cutexSessionId: session, agentName: "Reader",
    requestId: "request", deviceId: "device", hostId: "local", connectionGeneration: "connection", threadId: "thread", runtimeGeneration: 1,
    intentDigest: digest, reason: "Read the page", sharesOwnerLogin: true, ...(urlHint ? { urlHint } : {}) } });
const tab = (url: string, extra: Partial<BrowserClaimTab> = {}): BrowserClaimTab => ({ guestId: `g:${url}`, tabKey: `k:${url}`, url, title: url, pageGeneration: 1, pool: "owner", ...extra });

function fixture(options: { mode?: BrowserClaimMode; tabs?: BrowserClaimTab[]; owned?: string[]; profile?: string | null } = {}) {
  let tabs = options.tabs ?? [];
  const allows = new BrowserClaimSessionAllows(), log = vi.fn(), audit = new BrowserClaimAudit(log);
  const deps = {
    mode: vi.fn((_host: string, _profile: string | null) => options.mode ?? "local"),
    profileOf: vi.fn(async () => options.profile ?? "kimi"),
    ownedServices: vi.fn(async () => options.owned ?? []),
    tabs: vi.fn(() => tabs),
    grant: vi.fn(async () => {}),
    openTab: vi.fn(async (_host: string, url: string) => tab(url)),
    approval: vi.fn(async (): Promise<ApprovalRecord | null> => null),
    granted: vi.fn(),
  } satisfies BrowserClaimDeps;
  return { deps, allows, audit, log, coordinator: new BrowserClaimCoordinator(deps, allows, audit), setTabs: (next: BrowserClaimTab[]) => { tabs = next; } };
}

describe("claim page classification", () => {
  it("only loopback hosts and cutex services count as local pages", () => {
    for (const url of ["http://127.0.0.1:5199/", "http://localhost/x", "http://[::1]:8080/", "https://localhost/", "cutex:service/yemao/index.html", "http://docs.svc.localhost/a"])
      expect(browserLocalPage(url)).toBe(true);
    for (const url of ["https://mail.example.com/", "http://127.0.0.2/", "http://localhost.evil.com/", "http://10.0.0.1/", "file:///etc/passwd", "javascript:alert(1)", "about:blank", ""])
      expect(browserLocalPage(url)).toBe(false);
    expect(browserClaimOrigin("cutex:service/yemao/a?b")).toBe("cutex:service/yemao");
    expect(browserClaimOrigin("http://docs.svc.localhost/a")).toBe("cutex:service/docs");
    expect(browserClaimOrigin("https://mail.example.com/inbox")).toBe("https://mail.example.com");
  });
  it("prefers the urlHint's exact page, then its path, then its origin, then the agent's own service", () => {
    const tabs = [tab("https://mail.example.com/"), tab("cutex:service/mine/"), tab("http://localhost:3000/"), tab("http://localhost:3000/app/view"), tab("http://localhost:3000/app")];
    expect(pickBrowserClaimTab(tabs, "http://localhost:3000/app")?.url).toBe("http://localhost:3000/app");
    expect(pickBrowserClaimTab(tabs.slice(0, 4), "http://localhost:3000/app")?.url).toBe("http://localhost:3000/app/view");
    expect(pickBrowserClaimTab(tabs.slice(0, 3), "http://localhost:3000/other")?.url).toBe("http://localhost:3000/");
    expect(pickBrowserClaimTab(tabs, undefined, ["mine"])?.url).toBe("cutex:service/mine/");
    expect(pickBrowserClaimTab(tabs, undefined, [])).toBeUndefined();
  });
  it("opens only local targets: the hint, or the agent's only service", () => {
    expect(browserClaimOpenTarget("http://user:pw@localhost:3000/a#frag", [])).toBe("http://localhost:3000/a");
    expect(browserClaimOpenTarget("http://docs.svc.localhost/a/b", [])).toBe("cutex:service/docs/a/b");
    expect(browserClaimOpenTarget("https://mail.example.com/", ["mine"])).toBeNull();
    expect(browserClaimOpenTarget(undefined, ["mine"])).toBe("cutex:service/mine");
    expect(browserClaimOpenTarget(undefined, ["a", "b"])).toBeNull();
  });
  it("plans by mode: ask never auto-grants; local only local pages; always every matching tab", () => {
    const local = tab("cutex:service/yemao/"), mail = tab("https://mail.example.com/");
    const plan = (mode: BrowserClaimMode, tabs: BrowserClaimTab[], hint?: string, allowed = false) => planBrowserClaim({ mode, tabs, hint, ownedSlugs: [], allowed: () => allowed });
    expect(plan("local", [local], "cutex:service/yemao/")).toEqual({ action: "grant", tab: local, reason: "local" });
    expect(plan("ask", [local], "cutex:service/yemao/")).toEqual({ action: "ask", tab: local });
    expect(plan("local", [mail], "https://mail.example.com/")).toEqual({ action: "ask", tab: mail });
    expect(plan("local", [mail], "https://mail.example.com/", true)).toEqual({ action: "grant", tab: mail, reason: "session" });
    expect(plan("ask", [mail], "https://mail.example.com/", true)).toEqual({ action: "grant", tab: mail, reason: "session" });
    expect(plan("always", [mail], "https://mail.example.com/")).toEqual({ action: "grant", tab: mail, reason: "profile" });
    expect(plan("always", [mail], undefined)).toEqual({ action: "ask" });
    expect(plan("local", [], "http://localhost:4000/x")).toEqual({ action: "open", url: "http://localhost:4000/x", reason: "local" });
    expect(plan("ask", [], "http://localhost:4000/x")).toEqual({ action: "ask" });
    expect(plan("always", [], "https://mail.example.com/")).toEqual({ action: "ask" });
  });
});

describe("main claim coordinator", () => {
  it("auto-grants a local page through the claim and records it", async () => {
    const f = fixture({ tabs: [tab("cutex:service/yemao/")] }), record = claim("apr-1", "reader", "cutex:service/yemao/");
    expect(await f.coordinator.observe("local", record)).toBe("granted");
    expect(f.deps.grant).toHaveBeenCalledExactlyOnceWith("local", tab("cutex:service/yemao/"), record, "local");
    expect(f.deps.granted).toHaveBeenCalledWith("local", tab("cutex:service/yemao/"), "Reader", "local");
    expect(f.audit.list("local")).toEqual([expect.objectContaining({ approvalId: "apr-1", reason: "local", origin: "cutex:service/yemao" })]);
    expect(f.log.mock.calls[0]![0]).toContain("auto: local page");
    expect(f.coordinator.pendingFor("local")).toEqual([]);
  });
  it("leaves a non-local tab to the owner card", async () => {
    const f = fixture({ tabs: [tab("https://mail.example.com/")] });
    expect(await f.coordinator.observe("local", claim("apr-2", "reader", "https://mail.example.com/"))).toBe("ask");
    expect(f.deps.grant).not.toHaveBeenCalled(); expect(f.deps.openTab).not.toHaveBeenCalled();
    expect(f.coordinator.pendingFor("local").map(r => r.approvalId)).toEqual(["apr-2"]);
  });
  it("一直允许 auto-grants this agent's same-origin tabs until revoked, never another agent's", async () => {
    const f = fixture({ tabs: [tab("https://mail.example.com/other")] });
    f.allows.allow("local", "reader", "Reader", "https://mail.example.com");
    expect(await f.coordinator.observe("local", claim("apr-3", "other-agent", "https://mail.example.com/"))).toBe("ask");
    expect(await f.coordinator.observe("local", claim("apr-4", "reader", "https://mail.example.com/"))).toBe("granted");
    expect(f.deps.grant).toHaveBeenLastCalledWith("local", expect.anything(), expect.objectContaining({ approvalId: "apr-4" }), "session");
    f.allows.revoke("local", "reader", "https://mail.example.com");
    expect(await f.coordinator.observe("local", claim("apr-5", "reader", "https://mail.example.com/"))).toBe("ask");
    expect(f.deps.grant).toHaveBeenCalledOnce();
  });
  it("Profile 总是允许 grants a matching login tab; 每次询问 asks even for local pages", async () => {
    const always = fixture({ mode: "always", tabs: [tab("https://mail.example.com/")] });
    expect(await always.coordinator.observe("local", claim("apr-6", "reader", "https://mail.example.com/"))).toBe("granted");
    expect(always.deps.grant).toHaveBeenCalledWith("local", expect.anything(), expect.anything(), "profile");
    expect(always.deps.mode).toHaveBeenCalledWith("local", "kimi");
    const ask = fixture({ mode: "ask", tabs: [tab("http://localhost:3000/")] });
    expect(await ask.coordinator.observe("local", claim("apr-7", "reader", "http://localhost:3000/"))).toBe("ask");
    expect(ask.deps.grant).not.toHaveBeenCalled();
  });
  it("opens a local urlHint when no tab is open, then grants the opened tab", async () => {
    const f = fixture(), record = claim("apr-8", "reader", "http://localhost:4000/yemao");
    expect(await f.coordinator.observe("local", record)).toBe("granted");
    expect(f.deps.openTab).toHaveBeenCalledExactlyOnceWith("local", "http://localhost:4000/yemao", "reader");
    expect(f.deps.grant).toHaveBeenCalledWith("local", tab("http://localhost:4000/yemao"), record, "local");
  });
  it("never repeats a failed attempt on the same tab, but tries a new one", async () => {
    const f = fixture({ tabs: [tab("http://localhost:3000/")] }), record = claim("apr-9", "reader", "http://localhost:3000/");
    f.deps.grant.mockRejectedValueOnce(new Error("lease_conflict"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await f.coordinator.observe("local", record)).toBe("ask");
    f.coordinator.retry("local"); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.deps.grant).toHaveBeenCalledOnce();
    f.setTabs([tab("http://localhost:3000/", { pageGeneration: 2 })]);
    expect(await f.coordinator.consider("local", record)).toBe("granted");
    warn.mockRestore();
  });
  it("ignores decided, malformed and other-host claims", async () => {
    const f = fixture({ tabs: [tab("http://localhost:3000/")] });
    expect(await f.coordinator.observe("local", { ...claim("apr-10", "reader", "http://localhost:3000/"), state: "consumed" })).toBe("skip");
    expect(await f.coordinator.observe("remote", claim("apr-11", "reader", "http://localhost:3000/"))).toBe("skip");
    expect(await f.coordinator.observe("local", { ...claim("apr-12"), details: { version: 1 } })).toBe("skip");
    expect(f.deps.grant).not.toHaveBeenCalled();
  });
  it("owner 打开并交给它 uses cutex's record and refuses a non-local page", async () => {
    const f = fixture();
    f.deps.approval.mockResolvedValueOnce(claim("apr-13", "reader", "https://mail.example.com/"));
    await expect(f.coordinator.ownerOpen("local", "apr-13")).rejects.toMatchObject({ code: "external_pages_unavailable" });
    f.deps.approval.mockResolvedValueOnce(null);
    await expect(f.coordinator.ownerOpen("local", "apr-14")).rejects.toMatchObject({ code: "approval_denied" });
    expect(f.deps.openTab).not.toHaveBeenCalled();
    const record = claim("apr-15", "reader", "http://localhost:4000/");
    f.deps.approval.mockResolvedValueOnce(record);
    await f.coordinator.ownerOpen("local", "apr-15");
    expect(f.deps.grant).toHaveBeenCalledExactlyOnceWith("local", tab("http://localhost:4000/"), record);
  });
});

describe("claim policy store", () => {
  it("defaults to 本机页面免问, stores per host + profile, resets, and ignores untrusted file content", () => {
    const files = new Map<string, string>([["p.json", JSON.stringify({ version: 1, modes: { [JSON.stringify(["local", "a"])]: "always", [JSON.stringify(["local", "b"])]: "root" } })]]);
    const store = new BrowserClaimPolicyStore("p.json", { read: path => { const v = files.get(path); if (v === undefined) throw Error("missing"); return v; }, write: (path, text) => { files.set(path, text); } });
    expect(store.get("local", "a")).toEqual({ mode: "always", stored: "always", defaultMode: "local" });
    expect(store.get("local", "b")).toEqual({ mode: "local", stored: null, defaultMode: "local" });
    expect(store.get("remote", "a").mode).toBe("local");
    expect(store.get("local", null).mode).toBe("local");
    expect(store.set("local", "c", "ask").mode).toBe("ask");
    expect(JSON.parse(files.get("p.json")!).modes[JSON.stringify(["local", "c"])]).toBe("ask");
    expect(store.set("local", "c", null)).toEqual({ mode: "local", stored: null, defaultMode: "local" });
    const broken = new BrowserClaimPolicyStore("x", { read: () => "{not json", write: () => {} });
    expect(broken.get("local", "a").mode).toBe("local");
  });
});

describe("claim fast path (cutex browser_claim waits ~3 s for a grant)", () => {
  it("grants an open local tab straight from the approvals event: no timer, no service lookup", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ tabs: [tab("http://localhost:3000/app")] }), record = claim("apr-f", "reader", "http://localhost:3000/app");
      const outcome = f.coordinator.observe("local", record);
      await vi.advanceTimersByTimeAsync(0); // microtasks only, no clock time
      expect(f.deps.grant).toHaveBeenCalledOnce();
      expect(await outcome).toBe("granted");
      expect(f.deps.ownedServices).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("still asks for the agent's services when no open tab matches the hint (service fallback)", async () => {
    const f = fixture({ tabs: [tab("cutex:service/mine/")], owned: ["mine"] });
    expect(await f.coordinator.observe("local", claim("apr-s", "reader", "http://localhost:9/none"))).toBe("granted");
    expect(f.deps.ownedServices).toHaveBeenCalledOnce();
    expect(f.deps.grant).toHaveBeenCalledWith("local", tab("cutex:service/mine/"), expect.anything(), "local");
  });
  it("a retry that arrives while a consider runs is not lost: it runs once more right after", async () => {
    let release!: (profile: string) => void;
    const f = fixture({ tabs: [] }), record = claim("apr-r", "reader", "http://localhost:3000/");
    f.deps.profileOf.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; }));
    const first = f.coordinator.observe("local", record);
    await Promise.resolve();
    f.setTabs([tab("http://localhost:3000/")]);
    f.deps.mode.mockReturnValueOnce("ask"); // the running consider decides ask (e.g. the policy read before the change)
    f.coordinator.retry("local"); // skipped while the first runs, remembered
    release("kimi");
    expect(await first).toBe("ask");
    await vi.waitFor(() => expect(f.deps.grant).toHaveBeenCalledOnce());
  });
});
