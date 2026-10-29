// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MenuEntry } from "../src/renderer/src/lib/contextMenu";

const fx = vi.hoisted(() => ({
  menus: [] as MenuEntry[], copied: vi.fn(), reveal: vi.fn(), fileMenu: vi.fn(() => []),
  workspace: { hostId: "local", api: {}, scope: { kind: "session", id: "s" }, revision: 0, git: null, error: null },
  state: { selectedId: "s", hosts: { active: "local", hosts: [{ id: "local", kind: "local", label: "This machine" }, { id: "remote", kind: "ssh", label: "Remote host" }] } },
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: { revealPath: fx.reveal }, apiFor: () => ({ revealPath: fx.reveal }), bridge: { platform: "win32", shell: { filePath: fx.reveal }, on: () => () => {} }, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key, useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => vars ? `${key} ${JSON.stringify(vars)}` : key }) }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state }),
  selectedSidebar: () => ({}), sidebarOf: () => ({}), selectedFeatures: () => new Set(["fs-file-read"]), featuresOf: () => new Set(["fs-file-read"]), agentHost: () => fx.workspace.hostId,
}));
vi.mock("../src/renderer/src/lib/workspaceView", () => ({ useSelectedWorkspace: () => fx.workspace }));
vi.mock("../src/renderer/src/lib/workspace", () => ({ HOST_FILE_READ_FEATURE: "fs-file-read", rootFor: () => "/workspace" }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ openMenuFrom: (_el: unknown, entries: MenuEntry[]) => { fx.menus = entries; }, contextMenu: (entries: () => MenuEntry[]) => () => { fx.menus = entries(); } }));
vi.mock("../src/renderer/src/lib/menus", () => ({ fileMenu: fx.fileMenu }));
vi.mock("../src/renderer/src/lib/sideOpen", () => ({ openFolder: vi.fn(), openHostFolder: vi.fn(), revealHostInTree: vi.fn(), revealInTree: vi.fn() }));
vi.mock("../src/renderer/src/modules/workspace/FileView", () => ({ FileView: () => h("div", { "data-file-view": "" }) }));
import { useFileMenu } from "../src/renderer/src/modules/workspace/shared";
import { PreviewBody } from "../src/renderer/src/modules/workspace/Preview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  fx.workspace.hostId = "local"; fx.state.hosts.hosts[0]!.kind = "local";
  fx.menus = []; fx.fileMenu.mockClear(); fx.copied.mockReset(); fx.reveal.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: fx.copied } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(() => root.render(h(PreviewBody, { instance: { id: "p", state: { path: "src/main.ts", host: false, source: false, line: null } }, setState: vi.fn(), close: vi.fn() } as never)));
const actions = () => fx.menus.flatMap((entry) => entry && typeof entry === "object" && "onSelect" in entry ? [entry] : []);

it("offers local file-manager reveal from the preview header with the absolute path", async () => {
  render(); act(() => host.querySelector<HTMLButtonElement>('[aria-label="workspace.fx.more"]')!.click());
  const reveal = actions().find((entry) => /reveal(?:Path|Explorer|Finder|FileManager)/.test(entry.label));
  expect(reveal).toBeDefined(); await act(async () => reveal!.onSelect());
  expect(fx.reveal).toHaveBeenCalledWith("local", "/workspace/src/main.ts", "reveal");
});

it("never reveals remote files locally and labels the copied path with its host", async () => {
  fx.workspace.hostId = "remote"; render();
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="workspace.fx.more"]')!.click());
  expect(actions().some((entry) => /reveal(?:Path|Explorer|Finder|FileManager)/.test(entry.label))).toBe(false);
  const copy = actions().find((entry) => /copy/i.test(entry.label) && entry.label.includes("Remote host"));
  expect(copy).toBeDefined(); await act(async () => copy!.onSelect());
  expect(fx.copied).toHaveBeenCalledWith("/workspace/src/main.ts"); expect(fx.reveal).not.toHaveBeenCalled();
});

it("uses host metadata rather than assuming the local id names a local daemon", () => {
  fx.state.hosts.hosts[0]!.kind = "ssh"; render();
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="workspace.fx.more"]')!.click());
  expect(actions().some((entry) => /reveal(?:Path|Explorer|Finder|FileManager)/.test(entry.label))).toBe(false);
});

it("passes the workspace host explicitly into the changed-files shared menu", () => {
  fx.workspace.hostId = "remote";
  function Probe() { const menu = useFileMenu({ kind: "session", id: "s" }); return h("button", { onContextMenu: menu("src/main.ts", { changed: true }) }, "file"); }
  act(() => root.render(h(Probe)));
  act(() => host.querySelector("button")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
  expect(fx.fileMenu).toHaveBeenCalledWith("src/main.ts", "/workspace", expect.any(Function), { changed: true, hostId: "remote" });
});
