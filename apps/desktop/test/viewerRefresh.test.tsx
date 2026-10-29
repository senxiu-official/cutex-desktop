// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { completedViewerPaths, viewerPath, ViewerRefresh } from "../src/renderer/src/lib/viewerRefresh";

const fx = vi.hoisted(() => ({ enabled: true, listeners: new Set<(event: any) => void>(), read: vi.fn(), hostRead: vi.fn(), cwd: "/repo/sub" }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: (_: string, fn: (e: any) => void) => { fx.listeners.add(fn); return () => fx.listeners.delete(fn); } } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((fn: (state: unknown) => unknown) => fn({}), { getState: () => ({}) }), sidebarOf: () => ({ active: [{ cutexSessionId: "agent", cwd: fx.cwd }], retired: [], projects: { projects: [] } }) }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ viewerAutoRefresh: fx.enabled }) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/workspaceView", () => ({ workspaceError: String }));
vi.mock("../src/renderer/src/components/Markdown", () => ({ Markdown: ({ text }: { text: string }) => h("pre", null, text) }));
vi.mock("../src/renderer/src/components/SideImage", () => ({ SideImage: () => null }));
vi.mock("../src/renderer/src/components/DocumentPreview", () => ({ DocumentPreview: () => null }));
vi.mock("../src/renderer/src/components/FilePageFrame", () => ({ FilePageFrame: () => h("input", { defaultValue: "original", "data-form": "" }) }));
import { FileView } from "../src/renderer/src/modules/workspace/FileView";

let node: HTMLDivElement; let root: Root;
const scope = { kind: "session", id: "agent" } as const;
const api = { fsFile: fx.read, hostFile: fx.hostRead } as any;
function event(path = "a.txt", extra: Record<string, unknown> = {}, hostId = "remote", method = "item/completed") {
  const payload = { hostId, sessionId: "agent", envelope: { native: { kind: "notification", message: { method, params: { turnId: "turn", item: { type: "fileChange", status: "completed", changes: [{ path, kind: { type: "update", move_path: null } }], ...extra } } } } } };
  for (const fn of fx.listeners) fn(payload);
}
async function render(props = {}) { await act(async () => root.render(h(FileView, { api, hostId: "remote", scope, path: "a.txt", host: false, ...props }))); }
async function tick(ms = 400) { await act(async () => vi.advanceTimersByTime(ms)); }
beforeEach(() => {
  vi.useFakeTimers(); fx.enabled = true; fx.cwd = "/repo/sub"; fx.listeners.clear(); fx.read.mockReset().mockImplementation(async () => ({ path: "a.txt", content: `read ${fx.read.mock.calls.length}`, encoding: "utf8", mime: "text/plain", size: 8, truncated: false })); fx.hostRead.mockReset().mockImplementation(fx.read);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); });

it("matches cwd-relative, absolute, normalized drive and UNC paths without conflating POSIX case", () => {
  expect(viewerPath("../a.txt", "/repo/sub")).toBe("/repo/a.txt");
  expect(viewerPath("a.txt", "/")).toBe("/a.txt");
  expect(viewerPath("C:\\Repo\\sub\\..\\A.txt", null)).toBe("c:/repo/a.txt");
  expect(viewerPath("\\\\?\\UNC\\Server\\Share\\A.txt", null)).toBe("//server/share/a.txt");
  expect(viewerPath("/Repo/a.txt", null)).not.toBe(viewerPath("/repo/a.txt", null));
  expect(viewerPath("a.txt", null)).toBeNull();
  expect(viewerPath("C:a.txt", "/repo")).toBeNull();
  expect(completedViewerPaths({ type: "fileChange", status: "completed", changes: [{ path: "a.txt", kind: { type: "update", movePath: "../b.txt" } }] }, "/repo/sub")).toEqual(["/repo/sub/a.txt", "/repo/b.txt"]);
});
it("coalesces 100 patch completions into one read and ignores other hosts, paths, failed/running items and shell commands", async () => {
  await render(); expect(fx.read).toHaveBeenCalledTimes(1);
  await act(async () => { for (let i = 0; i < 100; i++) event("./a.txt", { id: String(i) }); });
  await tick(399); expect(fx.read).toHaveBeenCalledTimes(1);
  await tick(1); expect(fx.read).toHaveBeenCalledTimes(2); expect(node.textContent).toContain("read 2");
  await act(async () => { event("a.txt", {}, "other"); event("b.txt"); event("a.txt", { status: "failed" }); event("a.txt", { status: "inProgress" }); event("a.txt", { type: "commandExecution" }); event("a.txt", {}, "remote", "item/started"); event("a.txt", { id: "99" }); });
  await tick(); expect(fx.read).toHaveBeenCalledTimes(2);
});
it("defers hidden-tab reads until shown, including a hide during debounce", async () => {
  await render(); await act(async () => event()); await render({ visible: false }); await tick(); expect(fx.read).toHaveBeenCalledTimes(1);
  await act(async () => { event(); event(); }); await tick(1000); expect(fx.read).toHaveBeenCalledTimes(1);
  await render({ visible: true }); await tick(); expect(fx.read).toHaveBeenCalledTimes(2);
});
it("honors the preference and cancels scheduled work when disabled", async () => {
  await render(); await act(async () => event()); fx.enabled = false; await render(); await tick(); expect(fx.read).toHaveBeenCalledTimes(1); expect(fx.listeners.size).toBe(0);
  fx.enabled = true; await render(); await act(async () => event()); await tick(); expect(fx.read).toHaveBeenCalledTimes(2);
});
it("reads an absolute host file only after an exact path match on that host", async () => {
  await render({ host: true, path: "/repo/a.txt" }); expect(fx.hostRead).toHaveBeenCalledTimes(1);
  await act(async () => event("a.txt")); await tick(); expect(fx.hostRead).toHaveBeenCalledTimes(1);
  await act(async () => event("../a.txt")); await tick(); expect(fx.hostRead).toHaveBeenCalledTimes(2);
});
it("preserves HTML form input until the owner explicitly reloads", async () => {
  await render({ path: "form.html" }); const input = node.querySelector("input")!; input.value = "unsaved";
  await act(async () => event("form.html")); await tick(); expect(node.querySelector("input")).toBe(input); expect(input.value).toBe("unsaved"); expect(node.textContent).toContain("workspace.changedOnDisk");
  await act(async () => (node.querySelector("[data-file-changed] button") as HTMLButtonElement).click()); expect(node.querySelector("input")).not.toBe(input); expect(node.querySelector("input")!.value).toBe("original"); expect(node.querySelector("[data-file-changed]")).toBeNull();
});
it("does not flush a pending edit after disposal or while dirty", () => {
  const reload = vi.fn(), changed = vi.fn(); const controller = new ViewerRefresh(reload, changed);
  controller.invalidate(); controller.setView(true, true); vi.advanceTimersByTime(400); expect(reload).not.toHaveBeenCalled(); expect(changed).toHaveBeenCalledWith(true);
  controller.setView(true, false); controller.dispose(); vi.advanceTimersByTime(400); expect(reload).not.toHaveBeenCalled();
});
