// @vitest-environment jsdom
// Per-agent MCP switches (cutex scoped-mcp): the view parser, the live startup statuses per runtime
// generation, the gate, and the dialog — config and running state apart, a switch writes the agent's
// `disabled` list with the revision it read, a conflict reads again, built-ins can't be switched.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ agentMcp: vi.fn(), setAgentMcpDisabled: vi.fn(), session: null as unknown }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: () => () => {} }, apiFor: () => ({ agentMcp: fx.agentMcp, setAgentMcpDisabled: fx.setAgentMcpDisabled }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (s: unknown) => unknown) => select({}), sidebarOf: () => ({ active: fx.session ? [fx.session] : [] }) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars && "name" in vars ? `${key}:${vars.name}` : key) }) }));
vi.mock("../src/renderer/src/lib/hostSwitch", () => ({ captureHostAction: () => () => true, onHostReset: () => () => {}, onHostSwitch: () => () => {} }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ closeDialog: vi.fn() }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Toggle: ({ checked, onChange, disabled, label }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; label?: string }) =>
    h("button", { role: "switch", "aria-checked": checked, disabled, "aria-label": label, onClick: () => onChange(!checked) }),
}));
import { agentMcpView, mcpStartupStatusOf, SCOPED_MCP_FEATURE, switchable, type AgentMcpView } from "../src/shared/sessionMcp";
import { agentMcpKey, liveStatusOf, noteMcpStartup, useAgentMcpLive } from "../src/renderer/src/lib/agentMcpLive";
import { showsAgentMcp } from "../src/renderer/src/lib/agentMcp";
import { AgentMcpDialog } from "../src/renderer/src/components/AgentMcpDialog";
import { zhCN } from "../src/renderer/src/modules/agent-config/i18n";
import { en } from "../src/renderer/src/modules/agent-config/i18n.en";

const effective = (servers: Record<string, unknown>[]) => ({ contractVersion: 2, cutexSessionId: "a", appliesOn: "next launch", servers });
const builtin = { name: "cutex", layer: "builtin", layers: ["builtin"], enabled: true, disabledBy: null, config: null };
const github = (enabled = true) => ({ name: "github", layer: "global", layers: ["global"], enabled, disabledBy: enabled ? null : "agent", config: { url: "https://x/mcp", bearer_token_env_var: "<redacted>" } });
const linear = { name: "linear", layer: "global", layers: ["global"], enabled: false, disabledBy: "config", config: { url: "https://l", enabled: false } };
const notes = { name: "notes", layer: "agent", layers: ["agent"], enabled: true, disabledBy: null, config: { command: "notes-mcp" } };
const view = (disabled: string[] = [], revision = 3): AgentMcpView =>
  agentMcpView("a", { revision, disabled, servers: { notes: { command: "notes-mcp" } } }, effective([builtin, github(!disabled.includes("github")), linear, notes]))!;

describe("scoped MCP view", () => {
  it("reads cutex's two answers", () => {
    const v = view(["github"]);
    expect(v).toMatchObject({ cutexSessionId: "a", revision: 3, disabled: ["github"], agentServers: ["notes"], appliesOn: "next launch" });
    expect(v.servers.map((s) => [s.name, s.layer, s.enabled, s.disabledBy, s.transport])).toEqual([
      ["cutex", "builtin", true, null, null], ["github", "global", false, "agent", "http"], ["linear", "global", false, "config", "http"], ["notes", "agent", true, null, "stdio"],
    ]);
    expect(agentMcpView("a", { servers: {} }, effective([]))).toBeNull();
    expect(agentMcpView("a", { revision: 1 }, { servers: "x" })).toBeNull();
  });

  it("built-ins and the agent's own servers aren't switchable", () => {
    const v = view();
    expect(v.servers.map((s) => [s.name, switchable(v, s)])).toEqual([["cutex", false], ["github", true], ["linear", true], ["notes", false]]);
  });

  it("reads native startup statuses only", () => {
    const env = (method: string, params: unknown) => ({ native: { message: { method, params } }, receivedAt: "t" });
    expect(mcpStartupStatusOf(env("mcpServer/startupStatus/updated", { name: "github", status: "failed", error: "boom", threadId: null }))).toEqual({ name: "github", status: "failed", error: "boom", at: "t" });
    expect(mcpStartupStatusOf(env("mcpServer/startupStatus/updated", { name: "github", status: "weird" }))).toBeNull();
    expect(mcpStartupStatusOf(env("turn/started", {}))).toBeNull();
  });

  it("keeps the statuses of the current runtime generation", () => {
    useAgentMcpLive.setState({ byKey: {} });
    const st = (name: string, status: "ready" | "failed") => ({ name, status, error: null, at: null });
    noteMcpStartup("h", "a", 2, st("github", "ready"));
    noteMcpStartup("h", "a", 2, st("linear", "failed"));
    const online = (gen: number) => ({ runtime: { status: "online", runtimeGeneration: gen } }) as never;
    const live = () => useAgentMcpLive.getState().byKey[agentMcpKey("h", "a")];
    expect(liveStatusOf(live(), online(2), "github")).toMatchObject({ status: "ready" });
    expect(liveStatusOf(live(), online(2), "other")).toBe("unknown");
    expect(liveStatusOf(live(), online(3), "github")).toBe("unknown");
    expect(liveStatusOf(live(), { runtime: { status: "offline", runtimeGeneration: 2 } } as never, "github")).toBeNull();
    noteMcpStartup("h", "a", 1, st("github", "failed"));
    expect(live()!.servers.github!.status).toBe("ready");
    noteMcpStartup("h", "a", 3, st("github", "failed"));
    expect(Object.keys(live()!.servers)).toEqual(["github"]);
    expect(liveStatusOf(live(), online(3), "github")).toMatchObject({ status: "failed" });
  });

  it("offered on hosts with scoped-mcp, not for retired or ACP agents", () => {
    const host = (on: boolean) => ({ has: (f: string) => on && f === SCOPED_MCP_FEATURE });
    const s = (over: Record<string, unknown> = {}) => ({ cutexSessionId: "a", lifecycle: "active", runtime: {}, ...over }) as never;
    expect(showsAgentMcp(s(), host(true))).toBe(true);
    expect(showsAgentMcp(s(), host(false))).toBe(false);
    expect(showsAgentMcp(s({ lifecycle: "retired" }), host(true))).toBe(false);
    expect(showsAgentMcp(s({ launchBinding: { runtime: "dsh" } }), host(true))).toBe(false);
  });

  it("every string has zh-CN and en", () => {
    const keys = Object.keys(zhCN).filter((k) => k.startsWith("agent-config.mcp."));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect((en as Record<string, string>)[k], k).toBeTruthy();
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let div: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const row = (name: string) => div.querySelector(`[data-mcp-server="${name}"]`) as HTMLElement;
const toggle = (name: string) => row(name).querySelector('[role="switch"]') as HTMLButtonElement | null;
const render = () => act(async () => root.render(h(AgentMcpDialog, { sessionId: "a", hostId: "h", resolve: () => {} })));

describe("agent MCP dialog", () => {
  beforeEach(() => {
    useAgentMcpLive.setState({ byKey: {} });
    fx.agentMcp.mockReset();
    fx.setAgentMcpDisabled.mockReset();
    fx.session = { cutexSessionId: "a", displayName: "Eva", runtime: { status: "online", runtimeGeneration: 2 } };
    div = document.createElement("div");
    document.body.append(div);
    root = createRoot(div);
  });
  afterEach(() => { act(() => root.unmount()); div.remove(); });

  it("shows config and running state apart; built-ins and own servers are fixed", async () => {
    noteMcpStartup("h", "a", 2, { name: "github", status: "ready", error: null, at: null });
    // A failed connection is the running state, not a change waiting for the next start.
    noteMcpStartup("h", "a", 2, { name: "notes", status: "failed", error: "spawn ENOENT", at: null });
    fx.agentMcp.mockResolvedValue({ ok: true, view: view() });
    await render();
    expect(div.textContent).toContain("agent-config.mcp.appliesNextLaunch");
    expect(row("github").textContent).toContain("agent-config.mcp.config.on");
    expect(row("github").textContent).toContain("agent-config.mcp.live.ready");
    expect(row("linear").textContent).toContain("agent-config.mcp.config.offShared");
    expect(row("linear").textContent).toContain("agent-config.mcp.live.unknown");
    expect(toggle("linear")!.disabled).toBe(true);
    expect(toggle("cutex")).toBeNull();
    expect(toggle("notes")).toBeNull();
    expect(row("cutex").textContent).toContain("agent-config.mcp.fixed");
    expect(row("notes").textContent).toContain("agent-config.mcp.live.failed");
    expect(row("notes").textContent).toContain("spawn ENOENT");
    expect(div.querySelector("[data-mcp-pending]")).toBeNull();
  });

  it("a switch writes the agent's disabled list with the read revision; the running server waits for the next start", async () => {
    noteMcpStartup("h", "a", 2, { name: "github", status: "ready", error: null, at: null });
    fx.agentMcp.mockResolvedValue({ ok: true, view: view([], 3) });
    fx.setAgentMcpDisabled.mockResolvedValue({ ok: true, view: view(["github"], 4) });
    await render();
    await act(async () => toggle("github")!.click());
    expect(fx.setAgentMcpDisabled).toHaveBeenCalledWith("a", ["github"], 3);
    expect(toggle("github")!.getAttribute("aria-checked")).toBe("false");
    expect(row("github").textContent).toContain("agent-config.mcp.config.offHere");
    expect(row("github").querySelector("[data-mcp-pending]")).not.toBeNull();
    fx.setAgentMcpDisabled.mockResolvedValue({ ok: true, view: view([], 5) });
    await act(async () => toggle("github")!.click());
    expect(fx.setAgentMcpDisabled).toHaveBeenLastCalledWith("a", [], 4);
  });

  it("a revision conflict reads again and says so", async () => {
    fx.agentMcp.mockResolvedValueOnce({ ok: true, view: view([], 3) }).mockResolvedValueOnce({ ok: true, view: view(["github"], 7) });
    fx.setAgentMcpDisabled.mockResolvedValue({ ok: false, code: "revision_conflict", message: "" });
    await render();
    await act(async () => toggle("github")!.click());
    expect(fx.agentMcp).toHaveBeenCalledTimes(2);
    expect(div.textContent).toContain("agent-config.mcp.error.revision_conflict");
    expect(toggle("github")!.getAttribute("aria-checked")).toBe("false");
  });

  it("an offline agent shows no running state; a host without the route says so", async () => {
    fx.session = { cutexSessionId: "a", displayName: "Eva", runtime: { status: "offline", runtimeGeneration: 2 } };
    fx.agentMcp.mockResolvedValue({ ok: true, view: view() });
    await render();
    expect(row("github").textContent).toContain("agent-config.mcp.live.offline");
    fx.agentMcp.mockResolvedValue({ ok: false, code: "unsupported", message: "" });
    act(() => root.unmount());
    root = createRoot(div);
    await render();
    expect(div.textContent).toContain("agent-config.mcp.error.unsupported");
  });
});
