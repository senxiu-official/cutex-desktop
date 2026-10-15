// End-to-end check of the main-process DaemonService against the ISOLATED dev daemon
// (scripts/dev-daemon.ps1, 127.0.0.1:24370; CUTEX_IT_URL for another port). Skipped unless CUTEX_IT=1.
//   $env:CUTEX_IT=1; pnpm exec vitest run test/devdaemon.integration.test.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { openExternal: async () => {} } }));

const { DaemonService } = await import("../src/main/daemon");
const { discoverLocalDaemon } = await import("@cutex-desktop/cutex-client/node");

describe.skipIf(!process.env.CUTEX_IT)("dev daemon integration", () => {
  const events: { event: string; payload: unknown }[] = [];
  const daemon = new DaemonService((event, payload) => events.push({ event, payload }));
  let sessionId = "";
  let profile = "";

  beforeAll(async () => {
    daemon.useEndpoint(await discoverLocalDaemon({ home: join(homedir(), ".cutex-desktop-dev"), baseUrl: process.env.CUTEX_IT_URL ?? "http://127.0.0.1:24370" }), { remote: false });
    await vi.waitFor(() => expect(daemon.currentState.kind).toBe("connected"), { timeout: 20_000, interval: 200 });
  }, 30_000);
  afterAll(() => daemon.stop());

  it("connects and lists sessions", async () => {
    const state = await daemon.daemonState();
    expect(state.kind).toBe("connected");
    const sidebar = await daemon.sidebar();
    expect(sidebar.active.length + sidebar.retired.length).toBeGreaterThan(0);
    const s = sidebar.active.find((x) => x.cwd) ?? sidebar.active[0]!;
    sessionId = s.cutexSessionId;
    profile = s.profile ?? s.effectiveNextLaunch.profile ?? "";
    const boot = await daemon.bootstrap(sessionId);
    expect(boot).toBeTruthy();
  });

  it("reads capabilities with every merged feature", async () => {
    const caps = await daemon.capabilities();
    for (const f of ["profiles-api", "settings-api", "profile-models", "project-memory", "usage-ledger", "workspace-fs", "workspace-git", "codex-config", "scoped-mcp", "offline-history", "offline-submit"]) {
      expect(caps?.featureList).toContain(f);
    }
  });

  it("offline history reads stored turns without starting the runtime", async () => {
    const sidebar = await daemon.sidebar();
    const offline = sidebar.active.find((x) => x.runtime.status !== "online" && x.native.threadId);
    if (!offline) return; // nothing offline with a thread on this dev home
    const h = await daemon.history(offline.cutexSessionId);
    expect(h?.source).toBe("offline");
    expect(Array.isArray((h?.native.result as { thread?: { turns?: unknown[] } }).thread?.turns)).toBe(true);
    const after = (await daemon.sidebar()).active.find((x) => x.cutexSessionId === offline.cutexSessionId);
    expect(after?.runtime.status).not.toBe("online");
  }, 60_000);

  // history-pages: the newest page from the bootstrap (live) or history (offline), older pages via
  // history?cursor= — together exactly the turns of a full read, oldest first.
  it("pages a thread's turns newest first (history-pages)", async () => {
    const caps = await daemon.capabilities();
    if (!caps?.featureList.includes("history-pages")) return;
    const turnIds = (result: unknown) => ((result as { thread?: { turns?: { id: string }[] } }).thread?.turns ?? []).map((t) => t.id);
    const sidebar = await daemon.sidebar();
    const live = sidebar.active.find((x) => x.runtime.appServerConnected && x.native.threadId);
    if (live) {
      const full = await daemon.bootstrap(live.cutexSessionId);
      expect(full.historyPage).toBeUndefined();
      const all = turnIds(full.native!.result);
      const first = await daemon.bootstrap(live.cutexSessionId, 2);
      expect(first.historyPage?.limit).toBe(2);
      const pages = [turnIds(first.native!.result)];
      expect(pages[0]).toEqual(all.slice(-2));
      for (let cursor = first.historyPage!.nextCursor; cursor; ) {
        const page = await daemon.history(live.cutexSessionId, cursor, 2);
        expect(page?.source).toBe("live");
        pages.unshift(turnIds(page!.native.result));
        cursor = page!.page.nextCursor;
      }
      expect(pages.flat()).toEqual(all);
    }
    const offline = sidebar.active.find((x) => !x.runtime.appServerConnected && x.native.threadId);
    if (offline) {
      const all = turnIds((await daemon.history(offline.cutexSessionId, null, 200))!.native.result);
      const pages: string[][] = [];
      for (let cursor: string | null = null, n = 0; n === 0 || cursor; n++) {
        const page = await daemon.history(offline.cutexSessionId, cursor, 2);
        expect(page?.source).toBe("offline");
        pages.unshift(turnIds(page!.native.result));
        cursor = page!.page.nextCursor;
      }
      expect(pages.flat()).toEqual(all);
    }
  }, 120_000);

  it("profiles, models, quota, settings, instructions", async () => {
    const list = await daemon.listProfiles();
    expect(list?.profiles.length).toBeGreaterThan(0);
    profile ||= list!.profiles[0]!.name;
    const detail = await daemon.getProfile(profile);
    expect(detail).toBeTruthy();
    const models = await daemon.profileModels(profile);
    expect(Array.isArray(models.models)).toBe(true);
    expect(Array.isArray(await daemon.profileQuota(profile))).toBe(true);
    expect(await daemon.quotaConfig(profile)).toBeTruthy();
    const settings = await daemon.getSettings();
    expect(typeof settings.agentBusEnabled).toBe("boolean");
    const ins = await daemon.userInstructions();
    expect(typeof ins.revision).toBe("string");
  });

  it("usage ledger", async () => {
    const report = await daemon.usage({ groupBy: ["day", "profile"] });
    expect(report).toBeTruthy();
    expect(await daemon.usagePrices()).toBeTruthy();
  });

  it("workspace fs + git", async () => {
    const scope = { kind: "session" as const, id: sessionId };
    const dir = await daemon.fsDir(scope, "");
    expect(Array.isArray(dir.entries)).toBe(true);
    const git = await daemon.gitStatus(scope);
    expect(typeof git.isRepo).toBe("boolean");
  });

  it("terminal: create, stream output, input, resize, kill", async () => {
    const scope = { kind: "session" as const, id: sessionId };
    const term = await daemon.terminalCreate(scope, 100, 24);
    try {
      await daemon.terminalAttach(term.terminalId);
      // ConPTY asks for the cursor position (ESC[6n) before starting the shell. In the app xterm.js
      // answers it; here the test answers by hand.
      await new Promise((r) => setTimeout(r, 500));
      await daemon.terminalInput(term.terminalId, "\x1b[1;1R");
      await new Promise((r) => setTimeout(r, 1500));
      await daemon.terminalInput(term.terminalId, "echo cutex-desktop-it\r");
      await daemon.terminalResize(term.terminalId, 120, 30);
      const seen = async () => {
        const text = events
          .filter((e) => e.event === "terminalOutput" && (e.payload as { terminalId: string }).terminalId === term.terminalId)
          .map((e) => Buffer.from((e.payload as { data: string }).data, "base64").toString("utf8"))
          .join("");
        return text.includes("cutex-desktop-it");
      };
      for (let i = 0; i < 50 && !(await seen()); i++) await new Promise((r) => setTimeout(r, 200));
      expect(await seen()).toBe(true);
      expect((await daemon.terminalList(scope)).some((x) => x.terminalId === term.terminalId)).toBe(true);
    } finally {
      await daemon.terminalKill(term.terminalId);
    }
  }, 30_000);

  // Slow (a runtime start takes ~1–2 min on the dev box): CUTEX_IT_START=1.
  it.skipIf(!process.env.CUTEX_IT_START)("starts an offline agent without a terminal, then stops it", async () => {
    const sidebar = await daemon.sidebar();
    const target = sidebar.active.find((x) => x.runtime.status === "offline" && x.native.threadId && !/claude/i.test(x.runtime.backend));
    if (!target) return;
    const id = target.cutexSessionId;
    const result = (await daemon.sessionAction(id, "cutex/runtime/online", {
      expectedRuntimeGeneration: target.runtime.runtimeGeneration,
      openVisibleTerminal: false,
    })) as { status?: string; foregroundRequiredReason?: string };
    expect(result.foregroundRequiredReason).toBeUndefined();
    let now = (await daemon.sidebar()).active.find((x) => x.cutexSessionId === id)!;
    for (let i = 0; i < 90 && now.runtime.status !== "online"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      now = (await daemon.sidebar()).active.find((x) => x.cutexSessionId === id)!;
    }
    expect(now.runtime.status).toBe("online");
    await daemon.sessionAction(id, "cutex/runtime/offline", { expectedRuntimeGeneration: now.runtime.runtimeGeneration });
  }, 240_000);

  it("creates an independent agent (not started), archives it in one call, then restores it", async () => {
    const name = `it-agent-${Date.now().toString(36)}`;
    const { cutexSessionId } = await daemon.createAgent({ name, cwd: join(homedir(), ".cutex-desktop-dev"), start: false });
    const created = (await daemon.sidebar()).active.find((x) => x.cutexSessionId === cutexSessionId);
    expect(created?.displayName).toBe(name);
    expect(created?.runtime.status).not.toBe("online");
    // One call, no review step, no fences (cutex cleanup phase 2).
    await daemon.sessionAction(cutexSessionId, "cutex/session/retire", { reason: "integration test" });
    const after = await daemon.sidebar();
    expect(after.active.some((x) => x.cutexSessionId === cutexSessionId)).toBe(false);
    expect(after.retired.some((x) => x.cutexSessionId === cutexSessionId)).toBe(true);
    await daemon.sessionAction(cutexSessionId, "cutex/session/restore", {});
    expect((await daemon.sidebar()).active.some((x) => x.cutexSessionId === cutexSessionId)).toBe(true);
    // Leave the dev home tidy.
    await daemon.sessionAction(cutexSessionId, "cutex/session/retire", { reason: "integration test cleanup" });
  }, 180_000);

  it("notification level round-trips and restores", async () => {
    const s = (await daemon.sidebar()).active.find((x) => x.native.threadId)!;
    const tid = s.native.threadId!;
    const before = await daemon.notificationLevel(tid);
    const next = before === "important" ? "normal" : "important";
    expect(await daemon.setNotificationLevel(tid, next)).toBe(next);
    expect(await daemon.notificationLevel(tid)).toBe(next);
    await daemon.setNotificationLevel(tid, before);
  });

  it("profile account state reads without secrets", async () => {
    const list = await daemon.listProfiles();
    const codex = list?.profiles.find((p) => p.cliKind !== "claude");
    if (!codex) return;
    const view = await daemon.profileAccount(codex.id);
    expect(view).not.toBeNull();
    expect(typeof view!.account.loggedIn).toBe("boolean");
    expect(JSON.stringify(view)).not.toMatch(/sk-|access_token|refresh_token|id_token/);
  });

  it("services: register an external service, reassign owner, list, delete", async () => {
    const slug = `it-svc-${Date.now().toString(36)}`;
    const created = await daemon.registerService({ slug, displayName: "IT service", runtime: "external" });
    expect(created.port).toBeGreaterThanOrEqual(24400); // allocated from the range
    expect((await daemon.patchService(slug, { ownerCutexSessionId: sessionId })).ownerCutexSessionId).toBe(sessionId);
    expect((await daemon.patchService(slug, { ownerCutexSessionId: null })).ownerCutexSessionId).toBeNull();
    await expect(daemon.patchService(slug, { ownerCutexSessionId: "cutex-session-does-not-exist" })).rejects.toThrow(/owner_session_not_found|invalid_request|40d/);
    const list = await daemon.services();
    expect(list.services.find((x) => x.slug === slug)?.health).toMatch(/unreachable|reachable/);
    await daemon.deleteService(slug);
    expect((await daemon.services()).services.some((x) => x.slug === slug)).toBe(false);
  });

  it("codex config + managed MCP", async () => {
    const cfg = (await daemon.codexRequest("config/read", {})) as { config: unknown };
    expect(cfg.config).toBeTruthy();
    const managed = await daemon.managedMcp();
    expect(managed?.servers.map((s) => s.name)).toContain("cutex");
  });

  it("session metadata via sessionAction (rename and restore)", async () => {
    const before = (await daemon.sidebar()).active.find((s) => s.cutexSessionId === sessionId)!;
    await daemon.sessionAction(sessionId, "cutex/session/metadata/update", { expectedRevision: before.revision, note: "it-check" });
    const mid = (await daemon.sidebar()).active.find((s) => s.cutexSessionId === sessionId)!;
    expect(mid.note).toBe("it-check");
    await daemon.sessionAction(sessionId, "cutex/session/metadata/update", { expectedRevision: mid.revision, note: before.note ?? null });
    const after = (await daemon.sidebar()).active.find((s) => s.cutexSessionId === sessionId)!;
    expect(after.note ?? null).toBe(before.note ?? null);
  });

  it("rejects non-allowlisted session methods", async () => {
    await expect(daemon.sessionAction(sessionId, "cutex/session/groups/set" as never, {})).rejects.toThrow(/not allowed/);
  });

  // ---------- composer slash commands (need an online codex agent; skipped otherwise) ----------
  // With CUTEX_IT_START=1 and nothing online, one offline agent is started for these and stopped after.
  const onlineAgent = async () => (await daemon.sidebar()).active.find((x) => x.runtime.status === "online" && x.native.threadId && !/claude/i.test(x.runtime.backend));
  let startedForSlash: string | null = null;
  it.skipIf(!process.env.CUTEX_IT_START)("(setup) brings an agent online for the slash-command checks", async () => {
    if (await onlineAgent()) return;
    const target = (await daemon.sidebar()).active.find((x) => x.runtime.status === "offline" && x.native.threadId && !/claude/i.test(x.runtime.backend));
    if (!target) return;
    await daemon.sessionAction(target.cutexSessionId, "cutex/runtime/online", { expectedRuntimeGeneration: target.runtime.runtimeGeneration, openVisibleTerminal: false });
    startedForSlash = target.cutexSessionId;
    for (let i = 0; i < 90 && !(await onlineAgent()); i++) await new Promise((r) => setTimeout(r, 2000));
    expect(await onlineAgent()).toBeTruthy();
  }, 240_000);
  afterAll(async () => {
    if (!startedForSlash) return;
    const s = (await daemon.sidebar()).active.find((x) => x.cutexSessionId === startedForSlash);
    if (s) await daemon.sessionAction(startedForSlash, "cutex/runtime/offline", { expectedRuntimeGeneration: s.runtime.runtimeGeneration });
  });

  it("collaboration modes list includes plan; thread/settings/update switches and restores the mode", async ({ skip }) => {
    const s = await onlineAgent();
    if (!s) return skip("no online codex agent on the dev daemon");
    const modes = await daemon.collaborationModes(s.cutexSessionId);
    expect(modes.map((m) => m.mode)).toContain("plan");
    const tid = s.native.threadId!;
    const plan = modes.find((m) => m.mode === "plan")!;
    const model = (s.runtime.threadSettings as { model?: string } | null)?.model ?? "";
    await daemon.updateThreadSettings(s.cutexSessionId, tid, { collaborationMode: { mode: "plan", settings: { model: plan.model ?? model, reasoning_effort: plan.reasoning_effort ?? null, developer_instructions: null } } });
    await daemon.updateThreadSettings(s.cutexSessionId, tid, { collaborationMode: { mode: "default", settings: { model, reasoning_effort: null, developer_instructions: null } } });
  });

  it("goal: set (paused, so no auto-continuation), read back, clear — only on a thread without a goal", async ({ skip }) => {
    const s = await onlineAgent();
    if (!s) return skip("no online codex agent on the dev daemon");
    const tid = s.native.threadId!;
    let existing;
    try {
      existing = await daemon.threadGoal(s.cutexSessionId, tid);
    } catch (e) {
      // Goals feature disabled in this runtime: the call itself is forwarded (not a policy denial).
      expect(String(e)).not.toMatch(/native_method_denied/);
      return skip("goals disabled in this runtime");
    }
    if (existing) return skip("thread already has a goal"); // never touch a real goal
    const set = await daemon.setThreadGoal(s.cutexSessionId, tid, { objective: "it-check goal", status: "paused" });
    expect(set).toMatchObject({ objective: "it-check goal", status: "paused" });
    expect((await daemon.threadGoal(s.cutexSessionId, tid))?.objective).toBe("it-check goal");
    expect(await daemon.clearThreadGoal(s.cutexSessionId, tid)).toBe(true);
    expect(await daemon.threadGoal(s.cutexSessionId, tid)).toBeNull();
  });

  it("experimental features: native catalogue or the config.toml fallback", async ({ skip }) => {
    const s = await onlineAgent();
    if (!s) return skip("no online codex agent on the dev daemon");
    const view = await daemon.experimentalFeatures(s.cutexSessionId, s.native.threadId);
    expect(["native", "config"]).toContain(view.source);
  });

  // Starts a real review turn (spends tokens, adds to the thread): CUTEX_IT_REVIEW=1. Interrupted right away.
  it.skipIf(!process.env.CUTEX_IT_REVIEW)("review/start runs inline on the bound thread", async ({ skip }) => {
    const s = await onlineAgent();
    if (!s || s.runtime.activeTurnId) return skip("no idle online codex agent");
    const { turnId } = await daemon.startReview(s.cutexSessionId, s.native.threadId!, { type: "uncommittedChanges" });
    expect(turnId).toBeTruthy();
    await daemon.interrupt(s.cutexSessionId, s.native.threadId!, turnId);
  }, 60_000);
});
