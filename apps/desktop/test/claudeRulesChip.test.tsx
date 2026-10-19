// @vitest-environment jsdom
// Claude agents: the composer's 「规则」 chip beside the permission chip (components/ClaudeRulesChip).
// The permission menu lists only the modes; tools / always-allow rules / Claude Code sources moved here.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { claudeRulesChipShown, claudeToolsOff } from "../src/renderer/src/lib/claudePermissionModes";

const fx = vi.hoisted(() => ({
  features: new Set<string>(),
  allow: [] as string[],
  reads: 0,
}));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  featuresOf: () => fx.features,
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({}), setState: () => {}, subscribe: () => () => {} }),
  // The agent's host's api (panes step 2: lib/conversationScope convApi → hostApi).
  hostApi: () => ({
    claudePermissionRules: async (id: string) => {
      fx.reads++;
      return { cutexSessionId: id, workspace: "/w", revision: 1, updatedAt: null, allow: fx.allow, supported: true };
    },
  }),
}));
vi.mock("../src/renderer/src/components/ClaudeCodeSourcesNote", () => ({ ClaudeCodeSourcesNote: () => h("div", { "data-testid": "claude-code-sources" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { ClaudeRulesChip } = await import("../src/renderer/src/components/ClaudeRulesChip");

type Props = { write?: boolean | null; exec?: boolean | null; rulesFeature?: boolean; iconOnly?: boolean };
async function mount(p: Props) {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  await act(async () => root.render(h(ClaudeRulesChip, { hostId: "local", sessionId: "s1", write: p.write ?? null, exec: p.exec ?? null, rulesFeature: p.rulesFeature ?? false, iconOnly: p.iconOnly })));
  return { div, unmount: () => act(() => root.unmount()) };
}
const button = (div: HTMLElement) => div.querySelector("button");

describe("claude rules chip helpers", () => {
  it("lists the turned-off tools in display order", () => {
    expect(claudeToolsOff({ write: null, exec: null })).toEqual([]);
    expect(claudeToolsOff({ write: true, exec: false })).toEqual(["exec"]);
    expect(claudeToolsOff({ write: false, exec: false })).toEqual(["write", "exec"]);
  });

  it("shows the chip only for Claude agents with something to show", () => {
    const none = { claude: true, rulesFeature: false, toolsOff: [], sourcesFeature: false };
    expect(claudeRulesChipShown(none)).toBe(false);
    expect(claudeRulesChipShown({ ...none, rulesFeature: true })).toBe(true);
    expect(claudeRulesChipShown({ ...none, toolsOff: ["write"] })).toBe(true);
    expect(claudeRulesChipShown({ ...none, sourcesFeature: true })).toBe(true);
    expect(claudeRulesChipShown({ claude: false, rulesFeature: true, toolsOff: ["write"], sourcesFeature: true })).toBe(false);
  });
});

describe("ClaudeRulesChip", () => {
  it("renders nothing on a host without rules / sources and with every tool on", async () => {
    fx.features = new Set();
    const { div, unmount } = await mount({ write: true, exec: true });
    expect(div.innerHTML).toBe("");
    unmount();
  });

  it("labels 规则 with the rule count, icon-only when narrow", async () => {
    fx.allow = ["Bash(git status:*)", "Edit(src/**)", "Read"];
    const { div, unmount } = await mount({ rulesFeature: true });
    const chip = div.querySelector("[data-testid=claude-rules-chip]")!;
    expect(chip.textContent).toBe("composer.claude.rulesChip3");
    expect(button(div)!.title).toContain("composer.claude.rulesChipCount(3)");
    expect(div.querySelector("[data-testid=claude-rules-tools-off]")).toBeNull();
    unmount();
    const narrow = await mount({ rulesFeature: true, iconOnly: true });
    expect(narrow.div.querySelector("[data-testid=claude-rules-chip]")!.textContent).toBe("");
    expect(narrow.div.querySelector("svg")).not.toBeNull();
    narrow.unmount();
  });

  it("no count without rules", async () => {
    fx.allow = [];
    const { div, unmount } = await mount({ rulesFeature: true });
    expect(div.querySelector("[data-testid=claude-rules-chip]")!.textContent).toBe("composer.claude.rulesChip");
    unmount();
  });

  it("a turned-off tool: warn dot, and the tooltip names it", async () => {
    fx.features = new Set();
    const { div, unmount } = await mount({ write: false, exec: true });
    expect(div.querySelector("[data-testid=claude-rules-tools-off]")).not.toBeNull();
    expect(button(div)!.title).toContain("composer.claude.toolsOff(composer.claude.toolWrite)");
    unmount();
  });

  it("opens 「Claude 权限规则」: tools, then the rules list, then the sources note", async () => {
    fx.features = new Set(["claude-code-sources"]);
    fx.allow = ["Bash(git status:*)"];
    const { div, unmount } = await mount({ rulesFeature: true });
    await act(async () => button(div)!.click());
    const panel = div.querySelector("[data-testid=claude-rules-panel]")!;
    expect(panel.textContent).toContain("composer.claude.rulesPanelTitle");
    const order = ["claude-tools-note", "claude-allow-rules", "claude-code-sources"].map((id) => panel.querySelector(`[data-testid=${id}]`));
    expect(order.every(Boolean)).toBe(true);
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[0]!.textContent).toContain("composer.claude.toolsOn");
    expect(panel.textContent).toContain("Bash(git status:*)");
    unmount();
  });
});

it("the Claude permission menu lists only the modes (no footer)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/renderer/src/components/Composer.tsx"), "utf8");
  const start = src.indexOf("<Menu<ClaudeMode>");
  const end = src.indexOf("/>", src.indexOf("onSelect=", start));
  expect(start).toBeGreaterThan(0);
  expect(src.slice(start, end)).not.toContain("footer=");
  expect(src).not.toContain("ClaudePermissionFooter");
});
