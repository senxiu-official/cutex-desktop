import { describe, expect, it, vi } from "vitest";
import { agentFeaturesOf, CODEX_FEATURES, describeError, lacks, maxImageBytes, steerAction } from "../src/renderer/src/lib/agentFeatures";
import { runSlash, SLASH_COMMANDS, slashUnavailable, type SlashContext } from "../src/renderer/src/lib/slashCommands";
import { strategyFor } from "../src/renderer/src/lib/sendKeys";
import { toolDetail, toolOutput } from "../src/renderer/src/lib/workGroups";
import { parseUnsupported, unsupportedFeatureOf, unsupportedMessage } from "../src/shared/unsupported";
import { CLAUDE_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES } from "../src/shared/ipc";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const claude = (features: Record<string, unknown> | null) => ({ native: { schema: { protocol: "claude-app-server-subset", capabilities: { experimentalApi: true, features } } } });

describe("agentFeaturesOf / lacks", () => {
  it("requires Claude to explicitly support ephemeral side chats", () => {
    for (const value of [undefined, false, null, "true"]) expect(lacks(agentFeaturesOf(claude({ sideChat: value })), "sideChat")).toBe(true);
    expect(lacks(agentFeaturesOf(claude(null)), "sideChat")).toBe(true);
    expect(lacks(agentFeaturesOf(claude({ sideChat: true })), "sideChat")).toBe(false);
    expect(lacks(CODEX_FEATURES, "sideChat")).toBe(false);
  });
  it("treats Codex agents and missing schemas as supporting everything", () => {
    expect(agentFeaturesOf(undefined)).toEqual(CODEX_FEATURES);
    expect(agentFeaturesOf({ native: { schema: null } })).toEqual(CODEX_FEATURES);
    const codex = agentFeaturesOf({ native: { schema: { protocol: "codex-app-server", capabilities: {} } } });
    expect(codex.runtime).toBe("codex");
    expect(lacks(codex, "goals")).toBe(false);
  });

  it("hides only features the Claude adapter reports as false (null = unknown)", () => {
    const f = agentFeaturesOf(claude({ goals: false, review: false, memoryMode: null, fork: true }));
    expect(f.runtime).toBe("claude");
    expect(lacks(f, "goals")).toBe(true);
    expect(lacks(f, "review")).toBe(true);
    expect(lacks(f, "memoryMode")).toBe(false);
    expect(lacks(f, "fork")).toBe(false);
    expect(lacks(f, "turnSteer")).toBe(false); // absent = unknown
  });

  it("an adapter without features.json is Claude with unknown features", () => {
    const f = agentFeaturesOf(claude(null));
    expect(f).toEqual({ runtime: "claude", map: null });
    expect(lacks(f, "goals")).toBe(false);
  });

  it("limits Claude images to 5 MB, Codex to 8 MB", () => {
    expect(maxImageBytes(agentFeaturesOf(claude(null)))).toBe(CLAUDE_MAX_IMAGE_BYTES);
    expect(maxImageBytes(CODEX_FEATURES)).toBe(MAX_IMAGE_BYTES);
  });

  it("turns a busy steer into a queue send when the agent can't steer", () => {
    const noSteer = agentFeaturesOf(claude({ turnSteer: false }));
    expect(strategyFor(steerAction("steer", noSteer), true)).toBe("queue");
    expect(strategyFor(steerAction("steer", CODEX_FEATURES), true)).toBe("auto");
    expect(strategyFor(steerAction("interruptSend", noSteer), true)).toBe("interrupt");
    expect(strategyFor(steerAction("steer", noSteer), false)).toBe("auto");
  });
});

describe("unsupported errors", () => {
  const rpc = { code: -32601, message: "goals are not supported", data: { unsupported: true, runtime: "claude", feature: "goals", method: "thread/goal/set" } };

  it("recognises -32601 with data.unsupported only", () => {
    expect(unsupportedFeatureOf("native_-32601", rpc)).toBe("goals");
    expect(unsupportedFeatureOf("native_-32601", { ...rpc, data: { unsupported: true, method: "review/start" } })).toBe("review/start");
    expect(unsupportedFeatureOf("native_-32601", { code: -32601, message: "no such method" })).toBeNull();
    expect(unsupportedFeatureOf("native_-32602", { code: -32602, data: { feature: "input:skill" } })).toBeNull();
    expect(unsupportedFeatureOf("session_offline", null)).toBeNull();
  });

  it("survives Electron's IPC error wrapping", () => {
    const wrapped = `Error invoking remote method 'cutex-desktop:invoke': Error: ${unsupportedMessage("memoryMode")}`;
    expect(parseUnsupported(wrapped)).toBe("memoryMode");
    expect(parseUnsupported("native_-32601: something")).toBeNull();
  });

  it("describeError gives the friendly notice and flags it", () => {
    const notice = (f: string) => `n/a: ${f}`;
    expect(describeError(new Error(unsupportedMessage("review")), notice)).toEqual({ text: "n/a: review", unsupported: true });
    expect(describeError(new Error("boom"), notice)).toEqual({ text: "boom", unsupported: false });
  });
});

describe("slash commands on a Claude agent", () => {
  const agent = agentFeaturesOf(claude({ goals: false, review: false, backgroundTerminals: false, fork: false, memoryMode: false }));
  const features = new Set(["session-fork"]);

  it("marks the commands of unsupported features", () => {
    const off = SLASH_COMMANDS.filter((c) => slashUnavailable(c, features, agent) === "agentUnsupported").map((c) => c.id);
    expect(off.sort()).toEqual(["fork", "goal", "memories", "ps", "review", "stop"]);
    // A Codex agent keeps them; a cutex gap still wins over the agent check.
    expect(SLASH_COMMANDS.filter((c) => slashUnavailable(c, features, CODEX_FEATURES)).map((c) => c.id)).toEqual(["side"]);
    expect(slashUnavailable(SLASH_COMMANDS.find((c) => c.id === "fork")!, new Set(), agent)).toBe("forkGap");
  });

  it("refuses them with the agent notice instead of running", async () => {
    const review = vi.fn();
    const notify = vi.fn();
    const ctx = { online: true, hasGoal: false, planActive: false, features, agent, notify, review } as unknown as SlashContext;
    await runSlash("review", "", ctx);
    expect(review).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("slash.notice.agentUnsupported", { name: "review" });
  });

  it("has the notice texts in both locales", () => {
    for (const key of ["slash.notice.agentUnsupported", "slash.unavailable.agentUnsupported", "unsupported.notice", "composer.tools.agentUnsupported"] as const) {
      expect(zhCN[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });
});

describe("tool rows", () => {
  it("names dynamic tool calls namespace.tool", () => {
    expect(toolDetail({ type: "dynamicToolCall", id: "d", namespace: "claude", tool: "WebFetch" })).toBe("claude.WebFetch");
    expect(toolDetail({ type: "dynamicToolCall", id: "d", namespace: null, tool: "lookup" })).toBe("lookup");
    expect(toolDetail({ type: "mcpToolCall", id: "m", server: "cutex", tool: "send" })).toBe("cutex.send");
  });

  it("expands to command output, file diffs or dynamic tool text", () => {
    expect(toolOutput({ type: "commandExecution", id: "c", aggregatedOutput: "ok" })).toBe("ok");
    expect(toolOutput({ type: "fileChange", id: "f", changes: [{ path: "a.ts", diff: "@@ -1 +1 @@\n-a\n+b" }] })).toBe("--- a.ts\n@@ -1 +1 @@\n-a\n+b");
    expect(toolOutput({ type: "fileChange", id: "f", changes: [{ path: "a.ts", kind: "add" }] })).toBeNull();
    expect(toolOutput({ type: "dynamicToolCall", id: "d", contentItems: [{ type: "inputText", text: "page" }, { type: "inputImage", imageUrl: "x" }] })).toBe("page");
  });
});
