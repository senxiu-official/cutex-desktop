// @vitest-environment jsdom
// cutex r295 Claude launch / runtime diagnostics (claude-runtime-diagnostics-v1,
// docs/management/claude-launch-diagnostics.md): startup warnings and long hooks in the runtime status area,
// 连接不上运行时 / 连接不上模型服务, the credential's newest observation, and a background subagent's tool
// approval declined unattended. Older hosts send none of it: nothing changes.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope, SessionRuntime } from "@cutex-desktop/protocol";

const fx = vi.hoisted(() => ({ openSettings: vi.fn() }));
vi.mock("../src/renderer/src/i18n", async (original) => ({
  ...(await original<typeof import("../src/renderer/src/i18n")>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }),
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ openSettings: fx.openSettings }) } }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} } }));

import { CLAUDE_DIAGNOSTICS_FEATURE, claudeDiagnosticsChange, claudeDiagnosticsOf, nextSlowHookIn, slowestHook } from "../src/shared/claudeDiagnostics";
import { BackgroundWorkProjection } from "../src/shared/backgroundWork";
import { isRuntimeUnreachable, runtimeUnreachableWire } from "../src/shared/runtimeUnreachable";
import { turnDiagnosticCode, turnErrorText } from "../src/renderer/src/lib/timeline";
import { translate } from "../src/renderer/src/i18n";
import { claudeAccountQuota } from "../src/shared/claudeAccounts";
import { quotaNote } from "../src/renderer/src/modules/claude-accounts/accountView";
import { quotaDetailReason } from "../src/renderer/src/lib/quotaPeer";
import { claudeTaskApprovalFromEvent } from "../src/renderer/src/lib/subagents";
import { claudeTaskApprovalKey, forgetClaudeTaskApprovals, noteClaudeTaskApproval, resetClaudeTaskApprovals, useClaudeTaskApprovals } from "../src/renderer/src/lib/claudeTaskApprovals";
import { withoutClaudeDiagnostics } from "../src/shared/claudeDiagnostics";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { ClaudeDiagnosticsNote } from "../src/renderer/src/components/ClaudeDiagnosticsNote";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = 1_764_000_000_000;

describe("snapshot parsing and hooks", () => {
  it("keeps known warnings once and well-formed hooks; a non-snapshot is null", () => {
    expect(claudeDiagnosticsOf({ warnings: ["mcpAuthenticationRequired", "x", "configurationNotApplied", "configurationNotApplied"], activeHooks: [{ event: "Stop", startedAtMs: 5 }, { event: "Stop", startedAtMs: -1 }, { startedAtMs: 3 }] }))
      .toEqual({ warnings: ["configurationNotApplied", "mcpAuthenticationRequired"], activeHooks: [{ event: "Stop", startedAtMs: 5 }] });
    expect(claudeDiagnosticsOf({ warnings: [] })).toBeNull();
    expect(claudeDiagnosticsChange({ cutexSessionId: "a", runtimeGeneration: 2, claudeDiagnostics: null })).toEqual({ cutexSessionId: "a", runtimeGeneration: 2, claudeDiagnostics: null });
    expect(claudeDiagnosticsChange({ cutexSessionId: "a", runtimeGeneration: -1, claudeDiagnostics: null })).toBeNull();
    expect(claudeDiagnosticsChange({ cutexSessionId: "a", runtimeGeneration: 1, claudeDiagnostics: { warnings: [] } })).toBeNull();
  });
  it("a hook shows from 30 s, the oldest first; an unknown event is a plain hook; clock skew counts as zero", () => {
    const d = (startedAtMs: number, event = "PreToolUse") => ({ warnings: [], activeHooks: [{ event, startedAtMs }] });
    expect(slowestHook(d(NOW - 29_999), NOW)).toBeNull();
    expect(nextSlowHookIn(d(NOW - 29_000), NOW)).toBe(1000);
    expect(slowestHook(d(NOW - 30_000), NOW)).toEqual({ event: "PreToolUse", elapsedMs: 30_000 });
    expect(slowestHook({ warnings: [], activeHooks: [{ event: "Stop", startedAtMs: NOW - 40_000 }, { event: "other", startedAtMs: NOW - 90_000 }] }, NOW)).toEqual({ event: null, elapsedMs: 90_000 });
    expect(slowestHook(d(NOW + 60_000), NOW)).toBeNull();
    expect(nextSlowHookIn(d(NOW + 60_000), NOW)).toBe(90_000);
    expect(slowestHook({ warnings: [], activeHooks: [] }, NOW)).toBeNull();
  });
  it("the projection fences runtime generations and keeps rows unchanged when nothing differs", () => {
    const p = new BackgroundWorkProjection();
    const row = (generation: number, claudeDiagnostics?: unknown) => ({ cutexSessionId: "a", runtime: { runtimeGeneration: generation, ...(claudeDiagnostics === undefined ? {} : { claudeDiagnostics }) } }) as never;
    const snap = (r: unknown) => ({ active: [r], retired: [] }) as never as { active: { cutexSessionId: string; runtime: SessionRuntime }[]; retired: never[] };
    const same = snap(row(1, { warnings: [], activeHooks: [] }));
    expect(p.project(same)).toBe(same);
    p.recordClaudeDiagnostics({ cutexSessionId: "a", runtimeGeneration: 1, claudeDiagnostics: { warnings: ["managedHooksNotLoaded"], activeHooks: [] } });
    expect(p.project(snap(row(1))).active[0]!.runtime.claudeDiagnostics).toEqual({ warnings: ["managedHooksNotLoaded"], activeHooks: [] });
    // A newer runtime read retires the overlay; a frame for the old runtime is ignored.
    expect(p.project(snap(row(2, null))).active[0]!.runtime.claudeDiagnostics).toBeNull();
    p.recordClaudeDiagnostics({ cutexSessionId: "a", runtimeGeneration: 1, claudeDiagnostics: { warnings: ["mcpConnectionFailed"], activeHooks: [] } });
    expect(p.project(snap(row(2, null))).active[0]!.runtime.claudeDiagnostics).toBeNull();
    // A background-work frame of a newer runtime drops the older runtime's diagnostics.
    p.recordClaudeDiagnostics({ cutexSessionId: "a", runtimeGeneration: 2, claudeDiagnostics: { warnings: ["mcpConnectionFailed"], activeHooks: [] } });
    p.record({ cutexSessionId: "a", runtimeGeneration: 3, backgroundWork: { running: true } });
    const next = p.project(snap(row(3, { warnings: [], activeHooks: [] }))).active[0]!.runtime;
    expect(next.claudeDiagnostics).toEqual({ warnings: [], activeHooks: [] });
    expect(next.backgroundWork).toEqual({ running: true });
  });
});

describe("unreachable runtime / provider", () => {
  it("only cutex's classified refusal becomes the fixed message, also through IPC", () => {
    const wire = runtimeUnreachableWire({ code: "runtime_unreachable", details: { diagnosticCode: "unreachable" } });
    expect(wire).toBeTruthy();
    expect(runtimeUnreachableWire({ code: "runtime_unreachable", details: {} })).toBeNull();
    expect(runtimeUnreachableWire({ code: "other", details: { diagnosticCode: "unreachable" } })).toBeNull();
    expect(isRuntimeUnreachable(new Error(`Error invoking remote method 'daemon:sessionAction': Error: ${wire}`))).toBe(true);
    expect(isRuntimeUnreachable(wire)).toBe(true);
    expect(isRuntimeUnreachable(new Error("runtime start failed"))).toBe(false);
  });
  it("a failed turn with diagnosticCode unreachable reads 连接不上模型服务, never the JSON; anything else is unchanged", () => {
    const error = { message: "Claude request failed", additionalDetails: JSON.stringify({ diagnosticCode: "unreachable" }) };
    expect(turnDiagnosticCode(error)).toBe("unreachable");
    expect(turnErrorText(error)).toBe(`${translate("turn.error.unreachable")}\nClaude request failed`);
    expect(turnErrorText({ additionalDetails: '{"diagnosticCode":"unreachable"}' })).toBe(translate("turn.error.unreachable"));
    expect(turnDiagnosticCode({ message: "x", additionalDetails: "{not json" })).toBeNull();
    expect(turnErrorText({ message: "HTTP 401", additionalDetails: "{not json" })).toBe("HTTP 401\n{not json");
    expect(turnErrorText({ message: "x", additionalDetails: '{"diagnosticCode":"other"}' })).toBe('x\n{"diagnosticCode":"other"}');
  });
});

describe("Claude credential (nativeQuota.loginDiagnostic)", () => {
  const gauge = { id: "claude-0", kind: "window", label: "Claude" } as never;
  const read = (meta: Record<string, unknown>) => claudeAccountQuota({ source: "claude", gauges: [gauge], nativeQuota: { stale: false, lastError: null, ...meta } })!;
  it("the newest observation wins over credentialsExpired; older hosts keep the old note", () => {
    expect(quotaNote(read({ credentialsExpired: true, credentialsExpiredAt: 900, loginDiagnostic: "loginExpired" }))).toEqual({ key: "claude-accounts.loginExpired", tone: "muted", at: 900 });
    expect(quotaNote(read({ credentialsExpired: true, credentialsExpiredAt: 2000, loginDiagnostic: "loginExpiring" }))).toEqual({ key: "claude-accounts.loginExpiring", tone: "muted", at: 2000 });
    expect(quotaNote(read({ credentialsExpired: true, loginDiagnostic: null }))).toBeNull();
    expect(quotaNote(read({ credentialsExpired: true, credentialsExpiredAt: 5 }))).toEqual({ key: "claude-accounts.quotaTokenExpired", tone: "muted" });
    expect(read({ credentialsExpired: true, loginDiagnostic: "bogus" }).loginDiagnostic).toBeNull();
    // A read error still comes first.
    expect(quotaNote(read({ lastError: "boom", loginDiagnostic: "loginExpired" }))?.key).toBe("claude-accounts.quotaError");
  });
  it("the Profile card: an about-to-expire credential still reads (no local reason); expired does", () => {
    const detail = (meta: Record<string, unknown>) => ({ source: "claude", gauges: [], nativeQuota: meta });
    expect(quotaDetailReason(detail({ credentialsExpired: true, loginDiagnostic: "loginExpiring" }))).toBeNull();
    expect(quotaDetailReason(detail({ credentialsExpired: true, loginDiagnostic: "loginExpired" }))).toEqual({ kind: "expiredLogin" });
    expect(quotaDetailReason(detail({ credentialsExpired: true }))).toEqual({ kind: "expiredLogin" });
  });
});

describe("background subagent approval declined unattended", () => {
  const timeline = timelineFromThreadRead({ thread: { id: "thread-k", turns: [{ id: "t1", status: "inProgress", items: [
    { type: "dynamicToolCall", id: "c1", namespace: "claude", tool: "Agent", arguments: { run_in_background: true }, status: "completed", contentItems: [], success: true, agentThreadId: "claude:s:task:bg" },
    { type: "subAgentActivity", id: "a1", kind: "started", agentThreadId: "claude:s:task:bg", agentPath: "/claude/bg" },
  ] }] } }, []);
  const update = (task: Record<string, unknown>) => ({ native: { kind: "notification", message: { method: "claude/task/updated", params: { threadId: "thread-k", task: { taskId: "bg", taskType: "local_agent", status: "running", ...task } } } } }) as unknown as EventEnvelope;
  it("follows the task's newest update, keyed by its reference; status untouched", () => {
    expect(claudeTaskApprovalFromEvent(update({ approvalState: "deniedUnattended" }), timeline)).toEqual({ threadId: "claude:s:task:bg", denied: true });
    expect(claudeTaskApprovalFromEvent(update({}), timeline)).toEqual({ threadId: "claude:s:task:bg", denied: false });
    expect(claudeTaskApprovalFromEvent(update({ taskId: "unknown", approvalState: "deniedUnattended" }), timeline)).toBeNull();
    const key = claudeTaskApprovalKey("local", "claude:s:task:bg");
    const denied = () => !!useClaudeTaskApprovals.getState().byKey[key];
    noteClaudeTaskApproval("local", "claude:s:task:bg", true, 3);
    expect(denied()).toBe(true);
    expect(useClaudeTaskApprovals.getState().byKey[claudeTaskApprovalKey("other", "claude:s:task:bg")]).toBeUndefined();
    const kept = useClaudeTaskApprovals.getState().byKey;
    noteClaudeTaskApproval("local", "claude:s:task:bg", true, 3);
    expect(useClaudeTaskApprovals.getState().byKey).toBe(kept);
    // An older runtime's update is fenced out; the current one decides.
    noteClaudeTaskApproval("local", "claude:s:task:bg", false, 2);
    expect(denied()).toBe(true);
    noteClaudeTaskApproval("local", "claude:s:task:bg", false, 3);
    expect(denied()).toBe(false);
    noteClaudeTaskApproval("local", "claude:s:task:bg", true, 2);
    expect(denied()).toBe(false);
    // A re-read forgets the fence too: the next update (any generation) decides.
    noteClaudeTaskApproval("local", "claude:s:task:bg", true, 4);
    forgetClaudeTaskApprovals("local", ["claude:s:task:bg"]);
    expect(denied()).toBe(false);
    expect(useClaudeTaskApprovals.getState().seenAt[key]).toBeUndefined();
    resetClaudeTaskApprovals();
  });
});

describe("ClaudeDiagnosticsNote", () => {
  afterEach(() => { vi.useRealTimers(); fx.openSettings.mockClear(); document.body.innerHTML = ""; });
  const runtime = (claudeDiagnostics: unknown, status = "online") => ({ status, runtimeGeneration: 1, claudeDiagnostics }) as unknown as SessionRuntime;
  const mount = (rt: SessionRuntime | undefined, features: ReadonlySet<string> = new Set([CLAUDE_DIAGNOSTICS_FEATURE])) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(h(ClaudeDiagnosticsNote, { runtime: rt, features, hostId: "local", profile: "claude" })));
    return { host, root };
  };
  it("lists the startup warnings with links to Profile / MCP settings", () => {
    const { host } = mount(runtime({ warnings: ["configurationNotApplied", "mcpConnectionFailed"], activeHooks: [] }));
    expect(host.querySelector("[data-claude-warnings]")!.textContent).toContain("claudeDiag.warning.configurationNotApplied · claudeDiag.warning.mcpConnectionFailed");
    const [profile, mcp] = [...host.querySelectorAll("button")];
    act(() => profile!.click());
    act(() => mcp!.click());
    expect(fx.openSettings.mock.calls).toEqual([["profiles", { profile: "claude" }], ["mcp"]]);
  });
  it("shows a hook from 30 s and hides it when the snapshot clears", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { host, root } = mount(runtime({ warnings: [], activeHooks: [{ event: "PreToolUse", startedAtMs: NOW - 25_000 }] }));
    expect(host.querySelector("[data-claude-hook]")).toBeNull();
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(host.querySelector("[data-claude-hook='PreToolUse']")!.textContent).toBe('claudeDiag.hookNamed {"hook":"PreToolUse","elapsed":"30s"}');
    act(() => root.render(h(ClaudeDiagnosticsNote, { runtime: runtime({ warnings: [], activeHooks: [] }), features: new Set([CLAUDE_DIAGNOSTICS_FEATURE]), hostId: "local", profile: null })));
    expect(host.querySelector("[data-claude-diagnostics]")).toBeNull();
  });
  // audit P2-2: the time is read at each render, so a hook arriving after an empty snapshot is judged against now.
  it("a hook arriving later is timed from the current time: already past 30 s shows at once, else at the crossing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const features = new Set([CLAUDE_DIAGNOSTICS_FEATURE]);
    const { host, root } = mount(runtime({ warnings: [], activeHooks: [] }));
    expect(host.innerHTML).toBe("");
    // Two minutes on with no timer pending (nothing to wait for), then a hook that started 40 s ago arrives.
    vi.setSystemTime(NOW + 120_000);
    act(() => root.render(h(ClaudeDiagnosticsNote, { runtime: runtime({ warnings: [], activeHooks: [{ event: "Stop", startedAtMs: NOW + 80_000 }] }), features, hostId: "local", profile: null })));
    expect(host.querySelector("[data-claude-hook='Stop']")!.textContent).toBe('claudeDiag.hookNamed {"hook":"Stop","elapsed":"40s"}');
    // Cleared, then much later a hook 29 s old arrives: it shows one second later, not up to a minute late.
    act(() => root.render(h(ClaudeDiagnosticsNote, { runtime: runtime({ warnings: [], activeHooks: [] }), features, hostId: "local", profile: null })));
    vi.setSystemTime(NOW + 600_000);
    act(() => root.render(h(ClaudeDiagnosticsNote, { runtime: runtime({ warnings: [], activeHooks: [{ event: "PreToolUse", startedAtMs: NOW + 571_000 }] }), features, hostId: "local", profile: null })));
    expect(host.querySelector("[data-claude-hook]")).toBeNull();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(host.querySelector("[data-claude-hook='PreToolUse']")!.textContent).toBe('claudeDiag.hookNamed {"hook":"PreToolUse","elapsed":"30s"}');
  });
  it("strips diagnostics from a snapshot (lost connection, kept list), same object when there are none", () => {
    const plain = { active: [{ runtime: { status: "online" } as never }], retired: [] };
    expect(withoutClaudeDiagnostics(plain)).toBe(plain);
    expect(withoutClaudeDiagnostics({ active: [{ runtime: { status: "online", claudeDiagnostics: null } }], retired: [] })).toEqual({ active: [{ runtime: { status: "online" } }], retired: [] });
  });
  it("nothing without the capability, offline, or without a snapshot", () => {
    const d = { warnings: ["managedHooksNotLoaded"], activeHooks: [] };
    expect(mount(runtime(d), new Set()).host.innerHTML).toBe("");
    expect(mount(runtime(d, "offline")).host.innerHTML).toBe("");
    expect(mount(runtime(null)).host.innerHTML).toBe("");
    expect(mount(runtime(undefined)).host.innerHTML).toBe("");
    expect(mount({ ...runtime(d), appServerConnected: false } as SessionRuntime).host.innerHTML).toBe("");
  });
});
