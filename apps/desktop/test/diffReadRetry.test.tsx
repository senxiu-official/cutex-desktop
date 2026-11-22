// @vitest-environment jsdom
// The diff card's git diff read (owner 2026-11-16 audit, same pattern as the 文件 panel): a busy host retries by
// itself behind a plain line, anything else waits for 重新加载; the raw code goes in the tooltip.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ gitDiff: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({ ...(await importOriginal<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({}), setState: () => {}, subscribe: () => () => {} }),
  selectedFeatures: () => new Set(["workspace-fs"]),
  sidebarOf: () => null,
}));
vi.mock("../src/renderer/src/lib/useViewerRefresh", () => ({ useViewerRefresh: () => ({ revision: 0 }) }));
vi.mock("../src/renderer/src/components/UnifiedDiff", () => ({ UnifiedDiff: ({ text }: { text: string }) => h("pre", { "data-diff": "" }, text) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DiffBody } = await import("../src/renderer/src/modules/diff/DiffView");
const { WorkspaceContext, NO_DIR_VERSIONS } = await import("../src/renderer/src/lib/workspaceView");

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  fx.gitDiff.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const ctx = { hostId: "local", api: { gitDiff: (...a: unknown[]) => fx.gitDiff(...a) } as never, scope: { kind: "session" as const, id: "eva" }, revision: 0, git: null, gitIssue: null, reloadGit: () => {}, dirs: NO_DIR_VERSIONS };
const render = () => act(async () => root.render(h(WorkspaceContext.Provider, { value: ctx }, h(DiffBody, { instance: { id: "d1", state: { source: "git", path: "src/main.ts" } }, visible: true, setState: () => {}, close: () => {} } as never))));
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => {}); };
const line = () => host.querySelector<HTMLElement>("[data-read-issue]");

it("a busy diff read retries by itself, then shows the diff", async () => {
  fx.gitDiff.mockRejectedValueOnce(new Error("heavy_read_capacity_exceeded: heavy-read wait queue is full; retry shortly")).mockResolvedValue({ diff: "+hello" });
  await render();
  await settle();
  expect(line()!.getAttribute("data-read-issue")).toBe("retrying");
  expect(line()!.textContent).toContain("diff.retrying");
  expect(line()!.title).toContain("heavy_read_capacity_exceeded");
  await act(async () => new Promise((r) => setTimeout(r, 1_100)));
  await settle();
  expect(fx.gitDiff).toHaveBeenCalledTimes(2);
  expect(line()).toBeNull();
  expect(host.querySelector("[data-diff]")!.textContent).toBe("+hello");
});

it("a diff read that will not recover by itself waits for 重新加载", async () => {
  fx.gitDiff.mockRejectedValueOnce(new Error("git_failed: fatal: bad revision")).mockResolvedValue({ diff: "+fixed" });
  await render();
  await settle();
  expect(line()!.getAttribute("data-read-issue")).toBe("failed");
  expect(line()!.textContent).toContain("diff.failed");
  expect(host.textContent).not.toContain("fatal: bad revision");
  await act(async () => new Promise((r) => setTimeout(r, 1_100)));
  expect(fx.gitDiff).toHaveBeenCalledTimes(1);
  await act(async () => line()!.querySelector("button")!.click());
  await settle();
  expect(fx.gitDiff).toHaveBeenCalledTimes(2);
  expect(host.querySelector("[data-diff]")!.textContent).toBe("+fixed");
});
