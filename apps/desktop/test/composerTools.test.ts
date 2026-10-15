import { describe, expect, it } from "vitest";
import type { McpServerStatus } from "@cutex-desktop/protocol/codex/v2";
import { appendToken, mcpState, mcpSummary, skillsSummary, sortSkills } from "../src/renderer/src/lib/composerTools";

const server = (patch: Partial<McpServerStatus>): McpServerStatus => ({
  name: "s",
  runtimeStatus: null,
  pluginId: null,
  httpOrigin: null,
  serverInfo: null,
  serverCapabilities: null,
  tools: {},
  toolsError: null,
  resources: [],
  resourceTemplates: [],
  authStatus: "unsupported",
  ...patch,
});

describe("appendToken", () => {
  it("separates from the draft with one space only when needed", () => {
    expect(appendToken("", "@")).toBe("@");
    expect(appendToken("look at", "@")).toBe("look at @");
    expect(appendToken("look at ", "$pdf ")).toBe("look at $pdf ");
    expect(appendToken("line\n", "@")).toBe("line\n@");
  });
});

describe("skills", () => {
  it("sorts enabled first, then by name, and summarizes enabled / total", () => {
    const skills = [
      { name: "xlsx", enabled: false },
      { name: "pdf", enabled: true },
      { name: "creator", enabled: true },
    ];
    expect(sortSkills(skills).map((s) => s.name)).toEqual(["creator", "pdf", "xlsx"]);
    expect(skillsSummary(skills)).toBe("2/3");
    expect(skillsSummary(null)).toBeNull();
  });
});

describe("mcpState", () => {
  it("uses the runtime status when the native has one", () => {
    expect(mcpState(server({ runtimeStatus: "connected", tools: { a: undefined, b: undefined } }))).toEqual({ key: "connected", tone: "ok", tools: 2 });
    expect(mcpState(server({ runtimeStatus: "failed" })).tone).toBe("error");
    expect(mcpState(server({ runtimeStatus: "authenticationRequired" })).key).toBe("auth");
    expect(mcpState(server({ runtimeStatus: "disabled" })).key).toBe("disabled");
  });

  it("falls back to the tool catalog / error when there is no thread runtime", () => {
    expect(mcpState(server({ toolsError: "spawn failed" })).key).toBe("failed");
    expect(mcpState(server({ authStatus: "notLoggedIn" })).key).toBe("auth");
    expect(mcpState(server({ tools: { a: undefined } })).key).toBe("tools");
    expect(mcpState(server({})).key).toBe("unknown");
  });

  it("summarizes ok / total with the worst tone", () => {
    expect(mcpSummary(null)).toBeNull();
    expect(mcpSummary([server({ runtimeStatus: "connected" }), server({ runtimeStatus: "failed" })])).toEqual({ text: "1/2", tone: "error" });
    expect(mcpSummary([server({ runtimeStatus: "connected" })])).toEqual({ text: "1/1", tone: "ok" });
    expect(mcpSummary([])).toEqual({ text: "0/0", tone: "muted" });
  });
});
