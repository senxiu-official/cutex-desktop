// @vitest-environment jsdom
// cutex after r288: a Claude prune item blocked by claude_process_unresolved carries a host-wide summary of the Claude
// processes whose runtime it could not resolve. The 运行时版本 panel shows it once, as a quiet hint with the processes
// listed (PID + agent name from the session list, else the id as text); older hosts send nothing and nothing shows.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RuntimePruneClaudeProcesses, RuntimePrunePlan, RuntimePruneVersion } from "../src/shared/runtimes";
const env = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({ runtimePrunePlan: () => env.get(), cancelRuntimePrunePlan: () => {}, pruneRuntimes: () => Promise.reject(new Error("no")) }) }));
vi.mock("../src/renderer/src/lib/useArchivedAgents", () => ({ useArchivedAgents: () => {} }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ hosts: { active: "a" }, daemon: { kind: "connected" }, features: new Set(["runtime-prune-v1"]), byHost: { a: { daemon: { kind: "connected" }, features: new Set(["runtime-prune-v1"]) } } }) } }));
vi.mock("../src/renderer/src/lib/runtimesStore", () => ({ refreshRuntimes: () => Promise.resolve() }));
vi.mock("../src/renderer/src/lib/componentStore", () => ({ loadComponents: () => Promise.resolve() }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostData: () => HOST }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "a" }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: object) => key + (vars ? JSON.stringify(vars) : "") }) }));
const HOST = {
  daemon: { kind: "connected" },
  features: new Set(["runtime-prune-v1"]),
  sidebar: { active: [{ cutexSessionId: "cutex.11111111-1111-4111-8111-111111111111", displayName: "Eva" }], retired: [{ cutexSessionId: "cutex.22222222-2222-4222-8222-222222222222", displayName: "Old Yui" }], projects: null, hostRows: {} },
};
const { fireHostReset } = await import("../src/renderer/src/lib/hostSwitch");
const { RuntimeGroup } = await import("../src/renderer/src/components/RuntimeVersions");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UNKNOWN = "cutex.33333333-3333-4333-8333-333333333333";
const claude = (release: string, inspection?: RuntimePruneClaudeProcesses): RuntimePruneVersion => ({
  id: `opaque:claude:${release}`, kind: "claude", release, bytes: 1024, canPrune: false,
  blockedReasons: inspection ? ["claude_process_unresolved"] : ["rollback"], ...(inspection ? { claudeProcessInspection: inspection } : {}),
});
const native = (release: string): RuntimePruneVersion => ({ id: `opaque:native:${release}`, kind: "native", release, bytes: 1024, canPrune: true, blockedReasons: [] });
const plan = (...versions: RuntimePruneVersion[]): RuntimePrunePlan => ({ versions });

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  fireHostReset("a"); vi.clearAllMocks();
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); });
// Both groups, as in Settings → 运行时版本: the hint belongs to the panel once, under Claude.
const render = () => act(async () => root.render(h("div", null, h(RuntimeGroup, { key: "native", kind: "native", title: "native", list: [] }), h(RuntimeGroup, { key: "claude", kind: "claude", title: "claude", list: [] }))));
const items = () => [...node.querySelectorAll("[data-claude-process]")].map(li => li.textContent);

it("an older cutex without the field: nothing new is shown", async () => {
  env.get.mockResolvedValue(plan(native("r1"), claude("claude-r1")));
  await render();
  expect(node.querySelector("[data-claude-processes]")).toBeNull();
  expect(node.textContent).not.toContain("claudeProcess");
});

it("present: one quiet hint for the whole panel; PID + agent name, or the id as text when the agent is unknown", async () => {
  const inspection: RuntimePruneClaudeProcesses = {
    unresolvedProcessCount: 4,
    processes: [
      { pid: 41872, sessionId: "cutex.11111111-1111-4111-8111-111111111111" },
      { pid: 41873, sessionId: "cutex.22222222-2222-4222-8222-222222222222" },
      { pid: 39120, sessionId: UNKNOWN },
      { pid: 40011 },
    ],
    message: "Claude runtime cleanup waits until unresolved Claude processes restart.",
  };
  // The same host-wide copy on every blocked Claude item.
  env.get.mockResolvedValue(plan(native("r1"), claude("claude-r26", inspection), claude("claude-r25", inspection)));
  await render();
  const hints = node.querySelectorAll("[data-claude-processes]");
  expect(hints).toHaveLength(1);
  expect(hints[0]!.closest("[data-runtime-cleanup]")!.getAttribute("data-runtime-cleanup")).toBe("claude");
  expect(hints[0]!.querySelector("summary")!.textContent).toBe('runtimes.prune.claudeProcesses{"n":4}');
  // Quiet: not an alert, and cutex's English message is not shown.
  expect(node.querySelector("[role=alert]")).toBeNull();
  expect(node.textContent).not.toContain(inspection.message);
  expect(items()).toEqual(["PID 41872Eva", "PID 41873Old Yui", `PID 39120${UNKNOWN}`, "PID 40011runtimes.prune.claudeProcessNoAgent"]);
  expect(node.querySelector("[data-claude-processes-more]")).toBeNull();
  // The process's session id is not authenticated: the list offers no action.
  expect(hints[0]!.querySelectorAll("button")).toHaveLength(0);
  // Each blocked version names the reason.
  expect(node.textContent).toContain("runtimes.prune.claude_process_unresolved");
});

it("more than 20: at most 20 listed and the rest counted", async () => {
  const processes = Array.from({ length: 25 }, (_, i) => ({ pid: 1000 + i }));
  env.get.mockResolvedValue(plan(claude("claude-r26", { unresolvedProcessCount: 56, processes, message: "" })));
  await render();
  expect(items()).toHaveLength(20);
  expect(items()[19]).toBe("PID 1019runtimes.prune.claudeProcessNoAgent");
  expect(node.querySelector("[data-claude-processes-more]")!.textContent).toBe('runtimes.prune.claudeProcessesMore{"n":36}');
});
