// Settings → 工具 helpers (lib/codexTools.ts): MCP args / secret-preserving edit diff, hook
// grouping and trust edits, SKILL.md paths.
import { describe, expect, it } from "vitest";
import type { HookMetadata } from "@cutex-desktop/protocol/codex/v2";
import {
  emptyMcpDraft,
  groupHooks,
  hookEnabledEdit,
  hookRevokeEdits,
  hookTrustEdits,
  mcpDraftErrors,
  mcpDraftFrom,
  mcpServerEdits,
  parseArgLines,
  quoteKey,
  REDACTED,
  setToolEnabled,
  skillMdPath,
  stripFrontMatter,
  toolEnabled,
} from "../src/renderer/src/lib/codexTools";

describe("MCP args", () => {
  it("takes one argument per line and never splits on spaces", () => {
    expect(parseArgLines('-y\n@scope/server\r\n\n  C:\\Program Files\\x\\server.js  \n--name "a b"')).toEqual(["-y", "@scope/server", "C:\\Program Files\\x\\server.js", '--name "a b"']);
    expect(parseArgLines("  \n")).toEqual([]);
  });
});

describe("mcpServerEdits", () => {
  const saved = {
    command: "node",
    args: ["server.js"],
    env: { GITHUB_TOKEN: REDACTED, LOG_LEVEL: REDACTED },
    cwd: "C:\\work",
    disabled_tools: ["delete_repository"],
  };

  it("untouched secrets are omitted; nothing changed = no edits", () => {
    expect(mcpServerEdits("gh", saved, mcpDraftFrom(saved))).toEqual([]);
  });

  it("writes only changed fields and changed secrets, clears removed keys", () => {
    const d = mcpDraftFrom(saved);
    d.args = "server.js\n--verbose";
    d.env = [
      { key: "GITHUB_TOKEN", value: "", existing: true, kept: true },
      // LOG_LEVEL removed, NEW added
      { key: "NEW", value: "1", existing: false, kept: false },
    ];
    d.cwd = "";
    const edits = mcpServerEdits("gh", saved, d);
    expect(edits).toEqual([
      { keyPath: 'mcp_servers."gh"', value: { args: ["server.js", "--verbose"], env: { NEW: "1" } }, mergeStrategy: "upsert" },
      { keyPath: 'mcp_servers."gh".cwd', value: null, mergeStrategy: "replace" },
      { keyPath: 'mcp_servers."gh".env."LOG_LEVEL"', value: null, mergeStrategy: "replace" },
    ]);
    expect(JSON.stringify(edits)).not.toContain(REDACTED);
  });

  it("a changed secret is written; removing every key drops the table", () => {
    const d = mcpDraftFrom(saved);
    d.env = [{ key: "GITHUB_TOKEN", value: "ghp_new", existing: true, kept: false }];
    expect(mcpServerEdits("gh", saved, d)[0]).toEqual({ keyPath: 'mcp_servers."gh"', value: { env: { GITHUB_TOKEN: "ghp_new" } }, mergeStrategy: "upsert" });
    d.env = [];
    expect(mcpServerEdits("gh", saved, d)).toEqual([{ keyPath: 'mcp_servers."gh".env', value: null, mergeStrategy: "replace" }]);
  });

  it("switching transport clears the other transport's fields", () => {
    const d = { ...mcpDraftFrom(saved), transport: "http" as const, url: "https://x/mcp" };
    const paths = mcpServerEdits("gh", saved, d).map((e) => e.keyPath);
    expect(paths).toEqual(['mcp_servers."gh"', 'mcp_servers."gh".command', 'mcp_servers."gh".args', 'mcp_servers."gh".env', 'mcp_servers."gh".cwd']);
  });

  it("new server: one upsert with every set field", () => {
    const d = { ...emptyMcpDraft(), command: "npx", args: "-y\n@playwright/mcp", env: [{ key: "A", value: "b", existing: false, kept: false }], startupTimeoutSec: 30 };
    expect(mcpServerEdits("pw", null, d)).toEqual([{ keyPath: 'mcp_servers."pw"', value: { command: "npx", args: ["-y", "@playwright/mcp"], env: { A: "b" }, startup_timeout_sec: 30 }, mergeStrategy: "upsert" }]);
  });

  it("never sends the placeholder", () => {
    const d = mcpDraftFrom(saved);
    d.env = [{ key: "GITHUB_TOKEN", value: REDACTED, existing: true, kept: false }];
    expect(mcpDraftErrors(d)).toContain("redacted");
    expect(JSON.stringify(mcpServerEdits("gh", saved, d))).not.toContain(REDACTED);
    d.env = [{ key: "OTHER", value: REDACTED, existing: false, kept: false }];
    expect(() => mcpServerEdits("gh", saved, d)).toThrow();
  });

  it("validates required fields and duplicate keys", () => {
    expect(mcpDraftErrors(emptyMcpDraft())).toEqual(["command"]);
    const d = { ...emptyMcpDraft(), command: "x", env: [{ key: "A", value: "1", existing: false, kept: false }, { key: "A", value: "2", existing: false, kept: false }] };
    expect(mcpDraftErrors(d)).toEqual(["duplicateKey"]);
  });
});

describe("per-tool switches", () => {
  it("off adds to disabled_tools; on removes it and extends an allow-list", () => {
    let d = { enabledTools: null as string[] | null, disabledTools: [] as string[] };
    d = setToolEnabled(d, "a", false);
    expect(d.disabledTools).toEqual(["a"]);
    expect(toolEnabled(d, "a")).toBe(false);
    d = setToolEnabled(d, "a", true);
    expect(d).toEqual({ enabledTools: null, disabledTools: [] });
    const allow = setToolEnabled({ enabledTools: ["x"], disabledTools: [] }, "y", true);
    expect(allow.enabledTools).toEqual(["x", "y"]);
    expect(toolEnabled({ enabledTools: ["x"], disabledTools: [] }, "y")).toBe(false);
  });
});

const hook = (p: Partial<HookMetadata> & { key: string }): HookMetadata =>
  ({ eventName: "preToolUse", matcher: null, timeoutSec: 60n, statusMessage: null, additionalContextLimit: null, sourcePath: "/x", source: "user", pluginId: null, displayOrder: 0n, enabled: true, isManaged: false, currentHash: "h", trustStatus: "untrusted", handlerType: "command", command: "x", async: false, ...p }) as HookMetadata;

describe("hooks", () => {
  it("groups by source: user, project, one group per plugin, managed", () => {
    const groups = groupHooks([
      {
        cwd: "/",
        warnings: [],
        errors: [],
        hooks: [
          hook({ key: "m", source: "mdm", isManaged: true }),
          hook({ key: "p2", source: "plugin", pluginId: "b@m" }),
          hook({ key: "u", source: "user" }),
          hook({ key: "p1", source: "plugin", pluginId: "a@m" }),
          hook({ key: "r", source: "project" }),
        ],
      },
      { cwd: "/other", warnings: [], errors: [], hooks: [hook({ key: "u", source: "user" })] },
    ]);
    expect(groups.map((g) => g.id)).toEqual(["user", "project", "plugin:a@m", "plugin:b@m", "managed"]);
    expect(groups[0]!.hooks).toHaveLength(1);
  });

  it("trust / revoke / enable edits target hooks.state.\"<key>\" like the TUI", () => {
    const key = 'demo@test:hooks/hooks.json:pre_tool_use:0:0';
    expect(hookTrustEdits([{ key, currentHash: "sha256:1" }])).toEqual([{ keyPath: `hooks.state."${key}".trusted_hash`, value: "sha256:1", mergeStrategy: "upsert" }]);
    expect(hookRevokeEdits([{ key }])).toEqual([{ keyPath: `hooks.state."${key}".trusted_hash`, value: null, mergeStrategy: "replace" }]);
    expect(hookEnabledEdit(key, false)).toEqual({ keyPath: `hooks.state."${key}".enabled`, value: false, mergeStrategy: "upsert" });
    expect(quoteKey('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe("skills", () => {
  it("SKILL.md path and front matter", () => {
    expect(skillMdPath("C:\\s\\pdf\\SKILL.md")).toBe("C:\\s\\pdf\\SKILL.md");
    expect(skillMdPath("/s/pdf/")).toBe("/s/pdf/SKILL.md");
    expect(stripFrontMatter("---\nname: pdf\ndescription: x\n---\n\n# PDF\nbody")).toBe("# PDF\nbody");
    expect(stripFrontMatter("# no front matter")).toBe("# no front matter");
  });
});
