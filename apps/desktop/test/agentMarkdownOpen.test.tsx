// @vitest-environment jsdom
// Markdown under an AgentMarkdownScope (a side chat, a note): clicking a file link, an absolute host path and the file
// menu all open against the scoped agent and host, not the selected one; the main timeline (no scope) is unchanged.
// Based on the review repro test/reviewAgentMarkdownClick.test.tsx (GPT review of c186fd545).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  isDir: vi.fn(async (..._args: unknown[]) => false),
  isHostDir: vi.fn(async (..._args: unknown[]) => false),
  open: vi.fn((..._args: unknown[]) => ({ status: "opened", instanceId: "i", where: "card", pageId: null, reused: false })),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: vi.fn() }, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/pathKind", () => ({ isWorkspaceDir: (...args: unknown[]) => fx.isDir(...(args as [])), isHostDir: (...args: unknown[]) => fx.isHostDir(...(args as [])) }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideOpen: (...args: unknown[]) => fx.open(...(args as [])), sideShowsHost: () => true }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { side: {}, refs: {} } }));
// The Preview card's file body: a Markdown file with a relative link (FileView renders Markdown files like this).
vi.mock("../src/renderer/src/modules/workspace/FileView", async () => {
  const { Markdown } = await import("../src/renderer/src/components/Markdown");
  return { FileView: ({ hostId, onFolder }: { hostId: string; onFolder(): void }) => h("div", { "data-file-host": hostId }, h(Markdown, { text: "[guide](docs/guide.md)" }), h("button", { "data-folder-fallback": "", onClick: onFolder }, "fallback")) };
});
vi.mock("../src/renderer/src/modules/react", async (original) => ({ ...(await original<object>()), useSlot: () => [], useModuleEnabled: () => false, useModulePref: (_m: string, _k: string, value: unknown) => [value, () => {}], useModuleStatuses: () => new Map() }));

import { useApp } from "../src/renderer/src/store";
import { AgentMarkdownScope } from "../src/renderer/src/components/AgentMarkdownScope";
import { Markdown } from "../src/renderer/src/components/Markdown";
import { fileMenu } from "../src/renderer/src/lib/menus";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = { kind: "agent", hostId: "remote", sessionId: "source-agent" };
const sidebar = (id: string, cwd: string) => ({ hostRows: {}, projects: null, active: [{ cutexSessionId: id, cwd, displayName: id }], retired: [] });
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  fx.isDir.mockClear(); fx.isHostDir.mockClear(); fx.open.mockClear();
  useApp.setState({
    hosts: null, selectedId: "selected-agent", selectedHost: "local", sidebar: sidebar("selected-agent", "/selected"),
    features: new Set(["workspace-fs", "fs-file-read"]),
    byHost: { remote: { epoch: "r1", daemon: { kind: "connected" }, features: new Set(["workspace-fs", "fs-file-read"]), featuresKnown: true, sidebar: sidebar("source-agent", "/source"), approvals: null, services: null, waiting: {} } },
  } as never);
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); });

const scoped = (text: string, sessionId: string | null = "source-agent") => h(AgentMarkdownScope, { paneId: "note:test", hostId: "remote", sessionId, children: h(Markdown, { text }) });
async function click(element: unknown) {
  await act(async () => root.render(element as never));
  const link = node.querySelector<HTMLElement>('a[role="link"]');
  expect(link).not.toBeNull();
  await act(async () => link!.click());
}
const binding = () => (fx.open.mock.calls.at(-1) as unknown as [string, unknown, { binding?: unknown }])[2].binding;

describe("file opens from a scoped Markdown", () => {
  it("a workspace link: the source agent's workspace and a card bound to it", async () => {
    await click(scoped("[readme](README.md)"));
    expect(fx.isDir.mock.calls[0]?.slice(1, 3)).toEqual(["remote", { kind: "session", id: "source-agent" }]);
    expect(binding()).toEqual(SOURCE);
    // The preview reads the source workspace, not the selected one.
    expect(fx.open.mock.calls.at(-1)?.[1]).toEqual({ path: "README.md", line: null, scope: { kind: "session", id: "source-agent" } });
  });

  it("an absolute path outside the workspace: the source host, bound to the source agent", async () => {
    await click(scoped("[log](/var/log/x.log)"));
    expect(fx.isHostDir.mock.calls[0]?.[1]).toBe("remote");
    expect(fx.open.mock.calls.at(-1)?.[1]).toMatchObject({ path: "/var/log/x.log", host: true });
    expect(binding()).toEqual(SOURCE);
  });

  it("a note without a source agent: the note's host", async () => {
    await click(scoped("[log](/var/log/x.log)", null));
    expect(fx.isHostDir.mock.calls[0]?.[1]).toBe("remote");
    expect(binding()).toEqual({ kind: "host", hostId: "remote" });
  });

  it("the file menu: preview targets the source agent; tree and diff (selected workspace only) are left out", async () => {
    const source = { hostId: "remote", sessionId: "source-agent" };
    const labels = (entries: unknown[]) => entries.filter((e): e is { label: string } => typeof e === "object" && !!e && "label" in e).map((e) => e.label);
    const entries = fileMenu("README.md", "/source", ((k: string) => k) as never, { hostId: "remote", source, changed: true });
    expect(labels(entries)).not.toContain("workspace.revealInTree");
    expect(labels(entries)).not.toContain("menu.showDiff");
    await act(async () => (entries.find((e) => typeof e === "object" && e && "label" in e && e.label === "menu.preview") as { onSelect(): void }).onSelect());
    expect(fx.isDir.mock.calls[0]?.slice(1, 3)).toEqual(["remote", { kind: "session", id: "source-agent" }]);
    expect(binding()).toEqual(SOURCE);
    // The selected agent as the source: the menu is the usual one.
    const own = fileMenu("README.md", "/selected", ((k: string) => k) as never, { hostId: "local", source: { hostId: "local", sessionId: "selected-agent" }, changed: true });
    expect(labels(own)).toEqual(expect.arrayContaining(["workspace.revealInTree", "menu.showDiff"]));
  });

  it("a folder of another agent: a notice, not the selected agent's tree", async () => {
    fx.isDir.mockResolvedValueOnce(true);
    await click(scoped("[src](src)"));
    expect(fx.open).not.toHaveBeenCalled();
  });

  it("a scope on the selected agent itself opens exactly like the timeline", async () => {
    await click(h(AgentMarkdownScope, { paneId: "note:own", hostId: "local", sessionId: "selected-agent", children: h(Markdown, { text: "[readme](README.md)" }) }));
    expect(binding()).toBeUndefined();
    expect(fx.open.mock.calls.at(-1)?.[1]).toEqual({ path: "README.md", line: null });
  });

  it("the main timeline (no scope) still opens against the selected agent with the default binding", async () => {
    await click(h(Markdown, { text: "[readme](README.md)" }));
    expect(fx.isDir.mock.calls[0]?.slice(1, 3)).toEqual(["local", { kind: "session", id: "selected-agent" }]);
    expect(binding()).toBeUndefined();
  });
});

const { PreviewBody } = await import("../src/renderer/src/modules/workspace/Preview");
const { WorkspaceContext, NO_DIR_VERSIONS } = await import("../src/renderer/src/lib/workspaceView");

describe("the Preview card of another agent's file (GPT re-review of 71db2641c)", () => {
  const workspace = { hostId: "local", api: {} as never, scope: { kind: "session" as const, id: "selected-agent" }, revision: 0, git: null, gitIssue: null, reloadGit: () => {}, dirs: NO_DIR_VERSIONS };
  const props = (hostId: string, sessionId: string, scope: string) => ({ instance: { id: "preview", state: { path: "docs/README.md", line: null, host: false, source: false, scope: { kind: "session", id: scope } } }, hostId, sessionId, visible: true, close: vi.fn(), setState: vi.fn() }) as never;
  const show = (p: unknown) => act(async () => root.render(h(WorkspaceContext.Provider, { value: workspace }, h(PreviewBody, p as never))));
  const button = (pick: (b: HTMLButtonElement) => boolean) => [...node.querySelectorAll<HTMLButtonElement>("button")].find(pick);

  it("reads the source host, and its breadcrumb folder never opens the selected agent's tree", async () => {
    await show(props("remote", "source-agent", "source-agent"));
    expect(node.querySelector("[data-file-host]")?.getAttribute("data-file-host")).toBe("remote");
    const crumb = button((b) => b.textContent === "docs");
    expect(crumb).toBeDefined();
    await act(async () => crumb!.click());
    expect(fx.open).not.toHaveBeenCalled();
  });

  it("leaves 在文件树中显示 out, and the folder fallback opens nothing", async () => {
    await show(props("remote", "source-agent", "source-agent"));
    expect(node.querySelector('[aria-label="workspace.revealInTree"]')).toBeNull();
    await act(async () => node.querySelector<HTMLButtonElement>("[data-folder-fallback]")!.click());
    expect(fx.open).not.toHaveBeenCalled();
  });

  it("a link inside a previewed Markdown file opens in the source agent's workspace", async () => {
    await show(props("remote", "source-agent", "source-agent"));
    await act(async () => node.querySelector<HTMLElement>('a[role="link"]')!.click());
    expect(fx.isDir.mock.calls[0]?.slice(1, 3)).toEqual(["remote", { kind: "session", id: "source-agent" }]);
    expect(binding()).toEqual(SOURCE);
  });

  it("the selected agent's own preview is unchanged: ◎, breadcrumb and links use the 文件 tree as before", async () => {
    await show(props("local", "selected-agent", "selected-agent"));
    expect(node.querySelector('[aria-label="workspace.revealInTree"]')).not.toBeNull();
    await act(async () => button((b) => b.textContent === "docs")!.click());
    expect(fx.open.mock.calls.at(-1)?.[1]).toEqual({ reveal: "docs" });
    expect(binding()).toBeUndefined();
    await act(async () => node.querySelector<HTMLElement>('a[role="link"]')!.click());
    expect(fx.isDir.mock.calls.at(-1)?.slice(1, 3)).toEqual(["local", { kind: "session", id: "selected-agent" }]);
    expect(binding()).toBeUndefined();
  });
});
