import type { SessionResource } from "@cutex-desktop/protocol";
import { describe, expect, it, vi } from "vitest";
import { HostBusyActionExhausted } from "../src/renderer/src/lib/hostBusyActions";
import type { RuntimePackageRun, SidebarSnapshot } from "../src/shared/ipc";
import type { ClaudeRuntimeView } from "../src/shared/claudeRepin";
import {
  claudeBusyReason,
  combinedRuntimeCounts,
  combineRuntimeRuns,
  createClaudeRuntimeBatch,
  displayedRuntimeRuns,
  outdatedClaudeRuntimeAgents,
  runClaudeRuntimeBatch,
  type OutdatedClaudeRuntimeAgent,
} from "../src/renderer/src/lib/claudeRuntimeBatch";

const FEATURES = new Set(["claude-runtime-repin", "session-claude-runtime"]);

function session(id: string, release: string, over: { pending?: string | null; status?: string; turn?: string | null; thread?: unknown; backend?: string; lifecycle?: string } = {}): SessionResource {
  return {
    contractVersion: 2,
    cutexSessionId: id,
    displayName: id.toUpperCase(),
    lifecycle: over.lifecycle ?? "active",
    effectiveNextLaunch: { profile: null, source: over.backend ?? "claude_subscription" },
    native: { threadId: `thread-${id}`, schema: null },
    runtime: {
      backend: over.backend ?? "claude_subscription",
      status: over.status ?? "online",
      activeTurnId: over.turn ?? null,
      threadStatus: over.thread ?? { type: "idle" },
      claudeRuntime: { release, pendingRelease: over.pending ?? null },
    },
  } as unknown as SessionResource;
}

function sidebar(active: SessionResource[]): SidebarSnapshot {
  return { active, retired: [], projects: null, hostRows: {}, claudeRuntime: { selectedRelease: "claude-r25" } };
}

function candidate(id: string, over: Partial<OutdatedClaudeRuntimeAgent> = {}): OutdatedClaudeRuntimeAgent {
  return {
    cutexSessionId: id,
    name: id.toUpperCase(),
    current: "claude-r24",
    target: "claude-r25",
    runtimeStatus: "online",
    online: true,
    busy: false,
    busyReason: null,
    activeTurnId: null,
    threadStatus: "idle",
    runtimeGeneration: 7,
    ...over,
  };
}

function view(id: string, outcome: "applied" | "deferred" = "deferred", target = "claude-r25"): ClaudeRuntimeView {
  return {
    cutexSessionId: id,
    name: id.toUpperCase(),
    current: { release: "claude-r24", missing: false },
    pending: null,
    selected: { release: target },
    selectedError: null,
    direction: "upgrade",
    upgradeAvailable: true,
    dryRun: { outcome, reason: outcome === "deferred" ? "online: applies at the next start" : null, restartRequired: outcome === "deferred" },
  };
}

function nativeRun(over: Partial<RuntimePackageRun> = {}): RuntimePackageRun {
  return {
    runId: "rpu-native",
    kind: "upgrade",
    revertOf: null,
    revertedBy: [],
    state: "completed",
    startedAt: "2026-10-25T00:00:00Z",
    finishedAt: "2026-10-25T00:01:00Z",
    selected: { manifest: null, nativePath: null, nativeVersion: "0.160.0-r53", nativeRelease: "r53", facadePath: null, facadeRelease: "r258", readable: true },
    counts: { total: 0, pending: 0, moved: 0, skipped: 0, failed: 0 },
    currentAgentId: null,
    items: [],
    ...over,
  };
}

describe("outdated Claude runtime candidates", () => {
  it("uses the runtime-package idle rule and excludes current, pending, Codex and retired sessions", () => {
    const idle = session("idle", "claude-r24");
    const turn = session("turn", "claude-r23", { turn: "turn-1" });
    const thread = session("thread", "claude-r22", { thread: { type: "active" } });
    const offline = session("offline", "claude-r21", { status: "offline", thread: { type: "active" } });
    const current = session("current", "claude-r25");
    const pending = session("pending", "claude-r20", { pending: "claude-r25" });
    const codex = session("codex", "claude-r20", { backend: "profile" });
    const retired = session("retired", "claude-r20", { lifecycle: "retired" });
    const found = outdatedClaudeRuntimeAgents(FEATURES, sidebar([idle, turn, thread, offline, current, pending, codex, retired]));
    expect(found.map((agent) => [agent.cutexSessionId, agent.busyReason])).toEqual([
      ["idle", null],
      ["offline", null],
      ["thread", "threadActive"],
      ["turn", "activeTurn"],
    ]);
    expect(claudeBusyReason(offline)).toBeNull();
    expect(combinedRuntimeCounts([{ busy: false }, { busy: true }], found)).toEqual({ outdated: 6, idle: 3 });
    expect(outdatedClaudeRuntimeAgents(new Set(), sidebar([idle]))).toEqual([]);
    expect(outdatedClaudeRuntimeAgents(new Set([...FEATURES, "desktop:restricted"]), sidebar([idle]))).toEqual([]);
  });
});

describe("Claude runtime batch", () => {
  it("repins idle agents, records busy skips and preserves refusal reasons", async () => {
    const agents = [
      candidate("applied"),
      candidate("busy", { busy: true, busyReason: "activeTurn", activeTurnId: "turn-7" }),
      candidate("failed"),
    ];
    const claudeRuntime = vi.fn(async (id: string) => view(id));
    const sessionAction = vi.fn(async (_id: string, method: string) => ({ status: method.endsWith("online") ? "online" : "offline" }));
    const repinClaudeRuntime = vi.fn(async (id: string) => id === "failed"
      ? { ok: false as const, error: { code: "claude_repin_refused", message: "pin changed on disk" } }
      : { ok: true as const, done: { result: { outcome: "deferred" as const, reason: "online: applies at the next start", restartRequired: true, previous: "claude-r24", target: "claude-r25" }, runtime: { ...view(id), pending: { release: "claude-r25", requestedAt: "2026-10-25T00:00:01Z" } } } });
    const updates: RuntimePackageRun[] = [];
    const result = await runClaudeRuntimeBatch(
      createClaudeRuntimeBatch(agents, "rpu-native", "2026-10-25T00:00:00Z"),
      { claudeRuntime, repinClaudeRuntime, sessionAction },
      (batch) => updates.push(batch.run),
    );
    expect(claudeRuntime.mock.calls.map(([id]) => id)).toEqual(["applied", "failed"]);
    expect(repinClaudeRuntime.mock.calls.map(([id]) => id)).toEqual(["applied", "failed"]);
    expect(sessionAction.mock.calls.map(([id, method]) => [id, method])).toEqual([
      ["applied", "cutex/runtime/offline"],
      ["applied", "cutex/runtime/online"],
      ["failed", "cutex/runtime/offline"],
      ["failed", "cutex/runtime/online"],
    ]);
    expect(result.run.items.map((entry) => [entry.cutexSessionId, entry.state, entry.code])).toEqual([
      ["applied", "moved", null],
      ["busy", "skipped", "busy"],
      ["failed", "failed", "claude_repin_refused"],
    ]);
    expect(result.run.items[0]).toMatchObject({ backOnline: true, reason: null });
    expect(result.run.items[2]?.reason).toBe("pin changed on disk");
    expect(result.run.counts).toEqual({ total: 3, pending: 0, moved: 1, skipped: 1, failed: 1 });
    expect(result.run.state).toBe("completed");
    expect(updates.some((run) => run.items.some((entry) => entry.state === "running"))).toBe(true);
  });

  it("fails safely when the selected Claude target changes after confirmation", async () => {
    const repinClaudeRuntime = vi.fn();
    const result = await runClaudeRuntimeBatch(
      createClaudeRuntimeBatch([candidate("a")], null, "2026-10-25T00:00:00Z"),
      { claudeRuntime: async () => view("a", "deferred", "claude-r26"), repinClaudeRuntime, sessionAction: vi.fn() },
      () => {},
    );
    expect(repinClaudeRuntime).not.toHaveBeenCalled();
    expect(result.run.items[0]).toMatchObject({ state: "failed", code: "selectedChanged" });
  });

  it("rechecks idle state before each repin and never stops an agent that became busy", async () => {
    const repinClaudeRuntime = vi.fn();
    const sessionAction = vi.fn();
    const result = await runClaudeRuntimeBatch(
      createClaudeRuntimeBatch([candidate("a")], null, "2026-10-25T00:00:00Z"),
      { claudeRuntime: vi.fn(), repinClaudeRuntime, sessionAction },
      () => {},
      undefined,
      async () => candidate("a", { busy: true, busyReason: "activeTurn", activeTurnId: "turn-new" }),
    );
    expect(sessionAction).not.toHaveBeenCalled();
    expect(repinClaudeRuntime).not.toHaveBeenCalled();
    expect(result.run.items[0]).toMatchObject({ state: "skipped", code: "busy", reason: expect.stringContaining("turn-new") });
  });

  it("keeps an originally offline success neutral instead of reporting an online failure", async () => {
    const sessionAction = vi.fn();
    const result = await runClaudeRuntimeBatch(
      createClaudeRuntimeBatch([candidate("a", { online: false, runtimeStatus: "offline" })], null, "2026-10-25T00:00:00Z"),
      {
        claudeRuntime: async () => view("a", "applied"),
        repinClaudeRuntime: async () => ({ ok: true, done: { result: { outcome: "applied", reason: null, restartRequired: false, previous: "claude-r24", target: "claude-r25" }, runtime: view("a", "applied") } }),
        sessionAction,
      },
      () => {},
    );
    expect(sessionAction).not.toHaveBeenCalled();
    expect(result.run.items[0]).toMatchObject({ state: "moved", backOnline: null });
  });
});

describe("combined runtime result", () => {
  it.each(["success", "repinThrow", "repinRefused", "offlineThrow"])("continues after host busy on %s online/rollback without a generic online error", async mode => {
    const calls: string[] = [];
    const result = await runClaudeRuntimeBatch(
      createClaudeRuntimeBatch([candidate("a"), candidate("b")], null),
      {
        claudeRuntime: async id => view(id),
        repinClaudeRuntime: async id => {
          if (id === "a" && mode === "repinThrow") throw new Error("actual repin failure");
          if (id === "a" && mode === "repinRefused") return { ok: false, error: { code: "refused", message: "actual repin refusal" } };
          return { ok: true, done: { result: { outcome: "deferred", reason: "next start", restartRequired: true, previous: "claude-r24", target: "claude-r25" }, runtime: view(id) } };
        },
        sessionAction: async (id, method) => {
          calls.push(`${id}:${method}`);
          if (id === "a" && method.endsWith("/offline") && mode === "offlineThrow") throw new Error("actual stop failure");
          if (id === "a" && method.endsWith("/online")) throw new HostBusyActionExhausted();
          return { status: method.endsWith("/online") ? "online" : "offline" };
        },
      },
      () => {},
    );
    expect(calls).toEqual(["a:cutex/runtime/offline", "a:cutex/runtime/online", "b:cutex/runtime/offline", "b:cutex/runtime/online"]);
    const [a, b] = result.run.items;
    expect(a?.reason ?? "").not.toMatch(/back online failed|host_action_busy|admission_busy/);
    expect(a?.backOnline).toBeNull();
    expect(a?.state).toBe(mode === "success" ? "moved" : "failed");
    expect(b).toMatchObject({ state: "moved", backOnline: true });
    if (mode === "repinThrow") expect(a?.reason).toBe("actual repin failure");
    if (mode === "repinRefused") expect(a?.reason).toBe("actual repin refusal");
    if (mode === "offlineThrow") expect(a?.reason).toBe("actual stop failure");
  });

  it("shows native and Claude items in one run and keeps the matching last run", () => {
    const claude = createClaudeRuntimeBatch([candidate("claude", { busy: true, busyReason: "activeTurn", activeTurnId: "t" })], "rpu-native", "2026-10-25T00:00:02Z");
    const native = nativeRun({ items: [{
      cutexSessionId: "codex", name: "CODEX", state: "moved", step: null, code: null, reason: null, wasOnline: true, backOnline: true,
      previousRuntimeVersion: "r52", targetRuntimeVersion: "r53", previousFacadeRelease: "r257", targetFacadeRelease: "r258",
      actionId: "a", committedAt: "2026-10-25T00:00:30Z", previousContract: null, targetContract: null,
    }], counts: { total: 1, pending: 0, moved: 1, skipped: 0, failed: 0 } });
    const combined = combineRuntimeRuns(native, claude)!;
    expect(combined.items.map((entry) => entry.cutexSessionId)).toEqual(["codex", "claude"]);
    expect(combined.counts).toEqual({ total: 2, pending: 0, moved: 1, skipped: 1, failed: 0 });
    expect(combined.families).toEqual({ native: native.counts, claude: claude.run.counts });
    expect(combineRuntimeRuns(native, { ...claude, nativeRunId: "another-run" })?.families).toBeUndefined();
    expect(combineRuntimeRuns(null, claude)?.families).toBeUndefined();
    expect(displayedRuntimeRuns({ activeRun: null, lastRun: native }, claude).last?.items).toHaveLength(2);
    expect(displayedRuntimeRuns({ activeRun: { ...native, state: "running", finishedAt: null }, lastRun: null }, claude).active?.items).toHaveLength(2);

    const runningClaude = createClaudeRuntimeBatch([candidate("claude")], "rpu-native", "2026-10-25T00:00:02Z");
    const whileClaudeFinishes = displayedRuntimeRuns({ activeRun: null, lastRun: native }, runningClaude);
    expect(whileClaudeFinishes.active?.items.map((entry) => entry.cutexSessionId)).toEqual(["codex", "claude"]);
    expect(whileClaudeFinishes.last).toBeNull();

    const oldClaudeOnly = createClaudeRuntimeBatch([candidate("old", { busy: true, busyReason: "activeTurn", activeTurnId: "t" })], null, "2026-10-24T00:00:00Z");
    expect(displayedRuntimeRuns({ activeRun: null, lastRun: native }, oldClaudeOnly).last?.runId).toBe("rpu-native");
  });
});
