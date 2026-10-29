// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ open: vi.fn(), help: vi.fn(), reload: vi.fn(), replay: vi.fn(), ui: vi.fn(), tray: vi.fn(), sizes: vi.fn() }));
vi.mock("../src/renderer/src/dev/mockModules", () => ({ MODULE_MOCKS: [] }));
vi.mock("../src/renderer/src/lib/onboarding", () => ({ openOnboarding: calls.open }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ openSettings: calls.help }) } }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ setUiPref: calls.ui, uiPrefDefault: (key: string) => key === "portraitPacks" ? [] : key === "perfMode" ? "save" : key === "sidebarLayout" ? "roster" : "important" }));
vi.mock("../src/renderer/src/lib/trayPrefs", () => ({ setTrayPrefs: calls.tray, DEFAULT_TRAY_PREFS: { persistent: true, edge: "bottom", allowThreeColumns: false } }));
vi.mock("../src/renderer/src/lib/appearance", () => ({ setAppearance: calls.sizes, DEFAULT_APPEARANCE: { zoom: 100 } }));
vi.mock("../src/renderer/src/lib/guides", () => ({
  GUIDES_KEY: "cutex-desktop.guides", GUIDES: [{ id: "onboarding" }, { id: "tip.tray" }, { id: "inline.profile.chatgpt" }],
  reloadGuideState: calls.reload, replayGuide: calls.replay,
}));
import { previewScenarioParams, startPreviewOnboarding } from "../src/renderer/src/dev/mockBridge";

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); delete document.documentElement.dataset.theme;
  history.replaceState({}, "", "/");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); history.replaceState({}, "", "/"); delete document.documentElement.dataset.theme; });

it("merges hash scenarios with existing query options, preferring hash on conflicts", () => {
  const q = previewScenarioParams({ search: "?onboarding=upgrade&theme=light&legacy", hash: "#onboarding=first&theme=dark&help" });
  expect(q.get("onboarding")).toBe("first"); expect(q.get("theme")).toBe("dark"); expect(q.has("legacy")).toBe(true); expect(q.has("help")).toBe(true);
});

it("accepts older location fixtures containing search without a hash", () => {
  const q = previewScenarioParams({ search: "?onboarding=upgrade" });
  expect(q.get("onboarding")).toBe("upgrade");
});

it.each(["first", "upgrade", "whatsnew", "ask"])("opens hash onboarding scenario %s", async (mode) => {
  history.replaceState({}, "", `/#onboarding=${mode}`);
  localStorage.setItem("cutex-desktop.guides", "previous");
  startPreviewOnboarding();
  const saved = JSON.parse(localStorage.getItem("cutex-desktop.onboarding")!);
  expect(saved.doneRevision).toBe(mode === "upgrade" || mode === "whatsnew" ? 2 : 0);
  if (mode === "ask") expect(localStorage.getItem("cutex-desktop.guides")).toBeNull();
  await vi.advanceTimersByTimeAsync(1500);
  expect(calls.open).toHaveBeenCalledWith(mode === "whatsnew" ? { kind: "whatsNew", version: "0.2.0" } : { kind: "intro", auto: mode === "ask" });
});

it("opens Help from a bare hash and marks guides seen for a clear preview", async () => {
  history.replaceState({}, "", "/#help"); startPreviewOnboarding();
  await vi.advanceTimersByTimeAsync(1500);
  expect(calls.help).toHaveBeenCalledWith("help"); expect(calls.reload).toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem("cutex-desktop.guides")!).seen).toContain("tip.tray");
});

it("replays the requested tip from a hash without opening onboarding", async () => {
  history.replaceState({}, "", "/#tip=tip.tray"); startPreviewOnboarding();
  await vi.advanceTimersByTimeAsync(2500);
  expect(calls.replay).toHaveBeenCalledWith("tip.tray"); expect(calls.open).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem("cutex-desktop.guides")!).seen).not.toContain("tip.tray");
});

it.each(["light", "dark"])("applies hash theme %s before opening the flow", (theme) => {
  history.replaceState({}, "", `/#onboarding=first&theme=${theme}`); startPreviewOnboarding();
  expect(document.documentElement.dataset.theme).toBe(theme); expect(localStorage.getItem("cutex-desktop.theme")).toBe(theme);
});

it("preserves query-only onboarding previews", async () => {
  history.replaceState({}, "", "/?onboarding=upgrade&theme=light"); startPreviewOnboarding();
  await vi.advanceTimersByTimeAsync(1500);
  expect(calls.open).toHaveBeenCalledWith({ kind: "intro", auto: false }); expect(document.documentElement.dataset.theme).toBe("light");
});

it("clears previous setup choices for a deterministic fresh preview", async () => {
  for (const key of ["ui", "tray", "appearance"]) localStorage.setItem(`cutex-desktop.${key}`, '{"old":true}');
  localStorage.setItem("cutex-desktop.theme", "dark");
  history.replaceState({}, "", "/#onboarding=first"); startPreviewOnboarding();
  await vi.advanceTimersByTimeAsync(1500);
  for (const key of ["ui", "tray", "appearance", "theme"]) expect(localStorage.getItem(`cutex-desktop.${key}`)).toBeNull();
  expect(calls.ui).toHaveBeenCalledWith("sidebarLayout", "roster"); expect(calls.sizes).toHaveBeenCalledWith({ zoom: 100 });
  expect(calls.tray).toHaveBeenCalledWith({ persistent: true, edge: "bottom", allowThreeColumns: false });
});

it("seeds real upgrader preferences and retains an explicit minimal portrait choice", async () => {
  history.replaceState({}, "", "/#onboarding=upgrade&theme=dark"); startPreviewOnboarding();
  await vi.advanceTimersByTimeAsync(1500);
  const ui = JSON.parse(localStorage.getItem("cutex-desktop.ui")!);
  expect(ui).toEqual({ perfMode: "smooth", sidebarLayout: "now-all", agentAvatarDefault: "letter", portraitPacks: [] });
  expect(calls.ui).toHaveBeenCalledWith("perfMode", "smooth"); expect(calls.ui).toHaveBeenCalledWith("sidebarLayout", "now-all");
  expect(JSON.parse(localStorage.getItem("cutex-desktop.tray")!).allowThreeColumns).toBe(true);
  expect(calls.sizes).toHaveBeenCalledWith({ zoom: 110 });
  expect(document.documentElement.dataset.theme).toBe("dark");
});
