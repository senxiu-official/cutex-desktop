// 升级运行时 (cutex claude-runtime-repin): when the agent menu offers it, the click flow, and the main
// process calls (GET view, POST repin with the shown target, a 409 refusal as `ok: false`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", () => {
  class CutexApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: unknown) {
      super(`${code}: ${message}`);
    }
  }
  return {
    CutexClient: class {
      request = vi.fn();
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
import { CLAUDE_REPIN_FEATURE, releaseNumber, repinOffer, sessionRepinOffer, type ClaudeRepinResult, type ClaudeRuntimeView } from "../src/shared/claudeRepin";
import { cachedClaudeRuntime, loadClaudeRuntime, pinInSession, repinApplies, repinMenuOffer, repinOfferNow, runRepinFlow, useRepinCache, type RepinFlow } from "../src/renderer/src/lib/claudeRepin";
import { translate } from "../src/renderer/src/i18n";
import { RESTRICTED_FEATURE } from "../src/shared/users";

const view = (over: Partial<ClaudeRuntimeView> = {}): ClaudeRuntimeView => ({
  cutexSessionId: "sora",
  name: "Sora",
  current: { release: "claude-r17", missing: false },
  pending: null,
  selected: { release: "claude-r19" },
  selectedError: null,
  direction: "upgrade",
  upgradeAvailable: true,
  dryRun: { outcome: "applied", reason: null, restartRequired: false },
  ...over,
});

describe("repinOffer", () => {
  it("offers current → selected only when cutex says an upgrade is available", () => {
    expect(repinOffer(view())).toEqual({ from: "claude-r17", to: "claude-r19", restartRequired: false, refusal: null });
    expect(repinOffer(view({ dryRun: { outcome: "deferred", reason: "online: applies at the next start", restartRequired: true } }))?.restartRequired).toBe(true);
    expect(repinOffer(view({ dryRun: { outcome: "skipped", reason: "restore the pre-r8 state", restartRequired: false } }))?.refusal).toBe("restore the pre-r8 state");
    expect(repinOffer(view({ upgradeAvailable: false, direction: "downgrade" }))).toBeNull();
    expect(repinOffer(view({ dryRun: { outcome: "unchanged", reason: null, restartRequired: false } }))).toBeNull();
    expect(repinOffer(view({ selected: null, dryRun: null, selectedError: "not installed" }))).toBeNull();
    expect(repinOffer(null)).toBeNull();
  });
});

describe("sessionRepinOffer (session-claude-runtime)", () => {
  const pin = (release: string, pendingRelease: string | null = null) => ({ release, pendingRelease });
  const host = (selectedRelease: string | null) => ({ selectedRelease });
  it("offers pinned → selected when the selected release number is higher and not already pending", () => {
    expect(sessionRepinOffer(pin("claude-r17"), host("claude-r19"))).toEqual({ from: "claude-r17", to: "claude-r19" });
    // By number, not by string order.
    expect(sessionRepinOffer(pin("claude-r9"), host("claude-r10"))).toEqual({ from: "claude-r9", to: "claude-r10" });
    expect(sessionRepinOffer(pin("claude-r17", "claude-r19"), host("claude-r19"))).toBeNull();
    // A pending repin to another release does not hide a newer one.
    expect(sessionRepinOffer(pin("claude-r17", "claude-r18"), host("claude-r19"))?.to).toBe("claude-r19");
    expect(sessionRepinOffer(pin("claude-r19"), host("claude-r19"))).toBeNull();
    expect(sessionRepinOffer(pin("claude-r19"), host("claude-r17"))).toBeNull();
    expect(sessionRepinOffer(pin("claude-r17"), host(null))).toBeNull();
    expect(sessionRepinOffer(pin("adapter"), host("claude-r19"))).toBeNull();
  });
  it("is undefined when the list does not say (older cutex)", () => {
    expect(sessionRepinOffer(undefined, host("claude-r19"))).toBeUndefined();
    expect(sessionRepinOffer(pin("claude-r17"), undefined)).toBeUndefined();
    expect(releaseNumber("claude-r19")).toBe(19);
    expect(releaseNumber("claude")).toBeNull();
  });
});

describe("repinMenuOffer", () => {
  beforeEach(() => useRepinCache.setState({ byKey: {} }));
  const sora = (claudeRuntime?: { release: string; pendingRelease: string | null }) => ({ cutexSessionId: "sora", runtime: { claudeRuntime } }) as any;
  it("decides at once from the session and the host's selected release, without a request", () => {
    const claudeRuntime = vi.fn(async () => view());
    const offer = repinMenuOffer(() => ({ claudeRuntime }), "h1", sora({ release: "claude-r17", pendingRelease: null }), { selectedRelease: "claude-r19" });
    expect(offer).toEqual({ from: "claude-r17", to: "claude-r19" });
    expect(claudeRuntime).not.toHaveBeenCalled();
    expect(pinInSession(sora({ release: "claude-r17", pendingRelease: null }), { selectedRelease: "claude-r19" })).toBe(true);
  });
  it("falls back to the cached view on older cutex (loading it for the next open)", async () => {
    const claudeRuntime = vi.fn(async () => view());
    expect(repinMenuOffer(() => ({ claudeRuntime }), "h1", sora(), undefined)).toBeNull();
    expect(claudeRuntime).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(repinMenuOffer(() => ({ claudeRuntime }), "h1", sora(), undefined)?.to).toBe("claude-r19");
    expect(pinInSession(sora(), undefined)).toBe(false);
  });
});

describe("repinApplies", () => {
  const claude = { lifecycle: "active", runtime: { backend: "claude_subscription", status: "online" } } as any;
  it("needs the capability, the owner, an active Claude agent", () => {
    expect(repinApplies(new Set([CLAUDE_REPIN_FEATURE]), claude)).toBe(true);
    expect(repinApplies(new Set(), claude)).toBe(false);
    expect(repinApplies(new Set([CLAUDE_REPIN_FEATURE, RESTRICTED_FEATURE]), claude)).toBe(false);
    expect(repinApplies(new Set([CLAUDE_REPIN_FEATURE]), { ...claude, lifecycle: "retired" })).toBe(false);
    expect(repinApplies(new Set([CLAUDE_REPIN_FEATURE]), { lifecycle: "active", runtime: { backend: "codex", status: "online" } } as any)).toBe(false);
    expect(repinApplies(new Set([CLAUDE_REPIN_FEATURE]), null)).toBe(false);
  });
});

describe("cache", () => {
  beforeEach(() => useRepinCache.setState({ byKey: {} }));
  it("loads per host and keeps the last view when a call fails", async () => {
    expect(repinOfferNow("h1", "sora")).toBeNull();
    await loadClaudeRuntime({ claudeRuntime: async () => view() }, "h1", "sora");
    expect(repinOfferNow("h1", "sora")?.to).toBe("claude-r19");
    expect(repinOfferNow("h2", "sora")).toBeNull();
    expect(await loadClaudeRuntime({ claudeRuntime: async () => { throw new Error("offline"); } }, "h1", "sora")).toBeNull();
    expect(cachedClaudeRuntime("h1", "sora")?.current.release).toBe("claude-r17");
  });
});

function flow(over: { view?: ClaudeRuntimeView; result?: ClaudeRepinResult; confirms?: boolean[]; busy?: boolean } = {}) {
  const confirms = [...(over.confirms ?? [true])];
  const calls = { confirm: [] as string[], notice: [] as string[], notify: [] as string[], restart: 0, repin: [] as string[] };
  const done = (outcome: "applied" | "deferred" | "unchanged"): ClaudeRepinResult => ({
    ok: true,
    done: {
      result: { outcome, reason: null, restartRequired: outcome === "deferred", previous: "claude-r17", target: "claude-r19" },
      runtime: view({ current: { release: outcome === "applied" ? "claude-r19" : "claude-r17", missing: false }, upgradeAvailable: false }),
    },
  });
  const f: RepinFlow = {
    api: {
      claudeRuntime: vi.fn(async () => over.view ?? view()),
      repinClaudeRuntime: vi.fn(async (_id: string, target: string) => (calls.repin.push(target), over.result ?? done("applied"))),
    },
    hostId: "h1",
    session: { cutexSessionId: "sora", displayName: "Sora", runtime: { activeTurnId: over.busy ? "t1" : null } } as any,
    t: (key, vars) => translate(key, vars),
    confirm: async (message) => (calls.confirm.push(message), confirms.shift() ?? false),
    notice: async (message) => void calls.notice.push(message),
    notify: (message) => void calls.notify.push(message),
    restart: async () => void calls.restart++,
  };
  return { f, calls, done };
}

describe("runRepinFlow", () => {
  beforeEach(() => useRepinCache.setState({ byKey: {} }));

  it("confirms current → new, repins with the shown target and reports the move", async () => {
    const { f, calls } = flow();
    expect(await runRepinFlow(f)).toBe("applied");
    expect(calls.confirm[0]).toContain("claude-r17");
    expect(calls.confirm[0]).toContain("claude-r19");
    expect(calls.repin).toEqual(["claude-r19"]);
    expect(calls.notify).toHaveLength(1);
    expect(cachedClaudeRuntime("h1", "sora")?.upgradeAvailable).toBe(false);
  });

  it("does nothing when cancelled", async () => {
    const { f, calls } = flow({ confirms: [false] });
    expect(await runRepinFlow(f)).toBe("cancelled");
    expect(calls.repin).toEqual([]);
  });

  it("shows a dry-run refusal instead of asking", async () => {
    const { f, calls } = flow({ view: view({ dryRun: { outcome: "skipped", reason: "restore the pre-r8 state", restartRequired: false } }) });
    expect(await runRepinFlow(f)).toBe("refused");
    expect(calls.confirm).toEqual([]);
    expect(calls.notice[0]).toContain("restore the pre-r8 state");
    expect(calls.repin).toEqual([]);
  });

  it("shows cutex's refusal of the repin itself", async () => {
    const { f, calls } = flow({ result: { ok: false, error: { code: "claude_runtime_changed", message: "the selected Claude runtime is claude-r20 now" } } });
    expect(await runRepinFlow(f)).toBe("refused");
    expect(calls.notice[0]).toContain("claude-r20");
  });

  it("offers the restart for a running agent (deferred) and restarts only on yes", async () => {
    const deferredView = view({ dryRun: { outcome: "deferred", reason: "online: applies at the next start", restartRequired: true } });
    const later = flow({ view: deferredView, confirms: [true, false] });
    later.f.api.repinClaudeRuntime = vi.fn(async () => later.done("deferred"));
    expect(await runRepinFlow(later.f)).toBe("deferred");
    expect(later.calls.confirm).toHaveLength(2);
    expect(later.calls.restart).toBe(0);

    const now = flow({ view: deferredView, confirms: [true, true], busy: true });
    now.f.api.repinClaudeRuntime = vi.fn(async () => now.done("deferred"));
    expect(await runRepinFlow(now.f)).toBe("restarted");
    expect(now.calls.restart).toBe(1);
    expect(now.calls.confirm[1]).not.toBe(later.calls.confirm[1]);
  });

  it("explains that there is nothing to upgrade", async () => {
    const { f, calls } = flow({ view: view({ upgradeAvailable: false, direction: "none", dryRun: { outcome: "unchanged", reason: null, restartRequired: false } }) });
    expect(await runRepinFlow(f)).toBe("none");
    expect(calls.notice[0]).toContain("claude-r17");
  });
});

describe("main process calls", () => {
  let service: DaemonService;
  beforeEach(() => {
    fixture.clients.length = 0;
    service = new DaemonService(() => {});
    service.useEndpoint({ baseUrl: "http://a.invalid", token: "fake" } as any, { remote: true });
  });
  afterEach(() => service.stop());

  it("reads the view and posts the repin with the target", async () => {
    const c = fixture.clients.at(-1);
    c.request.mockResolvedValueOnce(view());
    expect((await service.claudeRuntime("a/b")).selected?.release).toBe("claude-r19");
    expect(c.request).toHaveBeenLastCalledWith("GET", "/v2/sessions/a%2Fb/claude-runtime");
    const done = { result: { outcome: "applied", reason: null, restartRequired: false, previous: "claude-r17", target: "claude-r19" }, runtime: view() };
    c.request.mockResolvedValueOnce(done);
    expect(await service.repinClaudeRuntime("sora", "claude-r19")).toEqual({ ok: true, done });
    expect(c.request).toHaveBeenLastCalledWith("POST", "/v2/sessions/sora/claude-runtime/repin", { body: { target: "claude-r19" } });
  });

  it("turns a 409 refusal into ok: false and rethrows other failures", async () => {
    const c = fixture.clients.at(-1);
    c.request.mockRejectedValueOnce(new (CutexApiError as any)(409, "claude_repin_refused", "restore the pre-r8 state", { outcome: "skipped" }));
    expect(await service.repinClaudeRuntime("sora", "claude-r19")).toEqual({ ok: false, error: { code: "claude_repin_refused", message: "restore the pre-r8 state" } });
    c.request.mockRejectedValueOnce(new (CutexApiError as any)(503, "session_store_unavailable", "down"));
    await expect(service.repinClaudeRuntime("sora", "claude-r19")).rejects.toThrow("down");
    await expect(service.repinClaudeRuntime("sora", "")).rejects.toThrow("bad runtime target");
  });
});
