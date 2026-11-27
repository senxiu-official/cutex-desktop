// @vitest-environment jsdom
// Cross-review 2026-11-16 (gate-notice-review repro): a transient refresh failure keeps the last artifacts list and
// still shows the issue line with 重新加载.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ read: vi.fn(), epoch: 0 }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { daemonFor: () => ({ artifactStoreList: env.read }) } }));
vi.mock("../src/renderer/src/modules/artifacts/store", () => ({ useEpoch: () => env.epoch, invalidateArtifact: vi.fn(), loadContent: vi.fn() }));
vi.mock("../src/renderer/src/modules/artifacts/View", () => ({ ViewBody: () => null }));
vi.mock("../src/renderer/src/modules/artifacts/ViewActions", () => ({ ViewActions: () => null }));
vi.mock("../src/renderer/src/modules/artifacts/actions", () => ({ artifactMenu: vi.fn(), openDelegation: vi.fn(), openVersion: vi.fn(), refusalText: vi.fn(), toggleStar: vi.fn() }));
vi.mock("../src/renderer/src/lib/time", () => ({ useClock: () => 1, formatAbsolute: () => "", formatWhen: () => "" }));
vi.mock("../src/renderer/src/lib/fileThumbnails", () => ({ useThumbnail: () => null }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ agentHost: () => "local", useApp: (sel: (s: unknown) => unknown) => sel({ hosts: { active: "local" } }), featuresOf: () => new Set() }));
import { LibraryBody } from "../src/renderer/src/modules/artifacts/Library";
import { DEFAULT_LIBRARY } from "../src/renderer/src/modules/artifacts/model";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it("a transient refresh error keeps the last library and still exposes reload", async () => {
  vi.useFakeTimers();
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  const props = { instance: { id: "library", state: DEFAULT_LIBRARY }, hostId: "local", sessionId: "session", visible: true, setState: () => {}, open: vi.fn() } as any;
  try {
    env.read.mockResolvedValueOnce({ items: [], scope: { project: "p" }, nextCursor: null }).mockRejectedValue(new Error("heavy_read_capacity_exceeded: busy"));
    await act(async () => root.render(h(LibraryBody, props)));
    expect(node.textContent).toContain("artifacts.empty");
    env.epoch++;
    await act(async () => root.render(h(LibraryBody, props)));
    expect(env.read).toHaveBeenCalledTimes(2);
    expect(node.textContent).toContain("artifacts.empty");
    expect(node.querySelector("[data-read-issue] button")?.textContent).toBe("readIssue.reload");
  } finally {
    act(() => root.unmount()); node.remove(); vi.clearAllTimers(); vi.useRealTimers();
  }
});
