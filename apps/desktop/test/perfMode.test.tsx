// @vitest-environment jsdom
// Owner 2026-10-23: Settings → 通用 → 性能: 节省资源 (default: loops rest while the window is not in front, rarely used
// pages load on first open) / 流畅优先 (loops keep running, those pages preload after start when idle).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/modules/Outlet", async (importOriginal) => ({ ...(await importOriginal<object>()), SettingsSections: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getUiPrefs, setUiPref, uiPrefDefault } = await import("../src/renderer/src/lib/prefs");
const { loopPauseEnabled, setLoopPauseEnabled } = await import("../src/renderer/src/lib/loopPause");
const { installPerfMode, PRELOAD_AFTER_MS } = await import("../src/renderer/src/lib/perfMode");

let uninstall: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  setUiPref("perfMode", "save");
  setLoopPauseEnabled(true);
});
afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
});

describe("性能 pref (lib/prefs)", () => {
  it("defaults to 节省资源; anything stored but smooth reads as save", () => {
    expect(uiPrefDefault("perfMode")).toBe("save");
    localStorage.setItem("cutex-desktop.ui", JSON.stringify({ perfMode: "turbo" }));
    expect(getUiPrefs().perfMode).toBe("save");
  });
});

describe("installPerfMode (lib/perfMode)", () => {
  it("节省资源: loops pause when not in front, nothing preloads", () => {
    const preload = vi.fn(async () => undefined);
    uninstall = installPerfMode({ preload });
    expect(loopPauseEnabled()).toBe(true);
    vi.advanceTimersByTime(PRELOAD_AFTER_MS * 3);
    expect(preload).not.toHaveBeenCalled();
  });

  it("流畅优先: loops keep running, the pages preload once, PRELOAD_AFTER_MS after start", () => {
    setUiPref("perfMode", "smooth");
    const preload = vi.fn(async () => undefined);
    uninstall = installPerfMode({ preload });
    expect(loopPauseEnabled()).toBe(false);
    vi.advanceTimersByTime(PRELOAD_AFTER_MS - 1);
    expect(preload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(preload).toHaveBeenCalledTimes(1);
    // Off and on again: loops follow, the preload is not repeated.
    setUiPref("perfMode", "save");
    expect(loopPauseEnabled()).toBe(true);
    setUiPref("perfMode", "smooth");
    expect(loopPauseEnabled()).toBe(false);
    vi.advanceTimersByTime(PRELOAD_AFTER_MS * 3);
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it("switched on later: preloads right away once start is past; back to 节省资源 before it began cancels it", () => {
    const preload = vi.fn(async () => undefined);
    uninstall = installPerfMode({ preload });
    vi.advanceTimersByTime(1000);
    setUiPref("perfMode", "smooth");
    setUiPref("perfMode", "save");
    vi.advanceTimersByTime(PRELOAD_AFTER_MS * 3);
    expect(preload).not.toHaveBeenCalled();
    setUiPref("perfMode", "smooth");
    vi.advanceTimersByTime(0);
    expect(preload).toHaveBeenCalledTimes(1);
  });
});

describe("Settings → 通用 → 性能 (components/settings/AppSettings)", () => {
  let root: ReturnType<typeof createRoot>;
  let host: HTMLDivElement;
  let GeneralPage!: typeof import("../src/renderer/src/components/settings/AppSettings")["GeneralPage"];
  let I18nProvider!: typeof import("../src/renderer/src/i18n")["I18nProvider"];

  beforeAll(async () => {
    ({ GeneralPage } = await import("../src/renderer/src/components/settings/AppSettings"));
    ({ I18nProvider } = await import("../src/renderer/src/i18n"));
  }, 30_000);

  beforeEach(() => {
    vi.useRealTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("two choices (the test runs in English), 节省资源 selected by default; picking 流畅优先 stores it and swaps the hint", async () => {
    await act(async () => root.render(h(I18nProvider, null, h(GeneralPage))));
    const card = host.querySelector("#settings-performance")!;
    expect(card).not.toBeNull();
    const radios = [...card.querySelectorAll<HTMLButtonElement>("[role=radiogroup] button")];
    expect(radios.map((b) => b.textContent)).toEqual(["Save resources", "Smooth first"]);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    expect(card.textContent).toContain("load the first time you open them");
    await act(async () => radios[1]!.click());
    expect(getUiPrefs().perfMode).toBe("smooth");
    expect(card.textContent).toContain("load in the background after start");
  });
});
