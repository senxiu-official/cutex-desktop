// @vitest-environment jsdom
// Multi-window P6 (docs/desktop-modules.md §24.17): the 多窗口 setting (Settings → 通用 → 窗口, default off) replaced the
// local flag, and is main-owned since 2026-10-27 (desktop-prefs.json; main side: multiWindowPrefMain.test.ts). The
// renderer follows ShellState (lib/multiWindowPref), hands its old value (P6 pref / old flag, read once by lib/prefs) to
// main at start, the window menu items follow the setting (lib/menus), and desks start when it is on — at start or when
// switched on later (lib/deskSync followDesksSetting); off never deletes the remembered desks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeEntries, type MenuAction } from "../src/renderer/src/lib/contextMenu";

const desk = vi.hoisted(() => ({ ticket: vi.fn(async () => null), focus: vi.fn(async () => {}), close: vi.fn(async () => {}) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), onEvent: () => () => {}, cleanIpcMessage: (m: string) => m, bridge: { on: () => () => {}, window: { desk } } }));

import { useApp } from "../src/renderer/src/store";
import { agentMenu } from "../src/renderer/src/lib/menus";
import { getUiPrefs } from "../src/renderer/src/lib/prefs";
import { desksEnabled } from "../src/renderer/src/lib/deskWindows";
import { followDesksSetting } from "../src/renderer/src/lib/deskSync";
import { DESKS_STORAGE_KEY } from "../src/renderer/src/lib/deskStore";
import { adoptShellState, DESKS_FLAG_KEY, migrateMultiWindow, multiWindowOn, setMultiWindow, startMultiWindowPref, takeLegacyDesksFlag } from "../src/renderer/src/lib/multiWindowPref";
import type { ShellState } from "../src/shared/ipc";

const t = (key: string) => key;
const session = { cutexSessionId: "a", displayName: "A", lifecycle: "active", runtime: { activeTurnId: null } } as never;
const storage = (entries: Record<string, string>) => {
  const map = new Map(Object.entries(entries));
  return { getItem: (k: string) => map.get(k) ?? null, removeItem: (k: string) => void map.delete(k), map };
};
const hook = () => (window as unknown as { __cutexDesks?: unknown }).__cutexDesks;

/** Main's answer (any ShellState) with the setting on / off. */
const state = (multiWindow: boolean) => ({ prefs: { closeBehavior: "tray", locale: null, updateCheckMinutes: 10, notifyOff: { desktop: false, sound: false, bigAlert: false }, ...(multiWindow ? { multiWindow } : {}) }, trayAvailable: true }) as ShellState;
const setOn = (value: boolean) => adoptShellState(state(value));

beforeEach(() => setOn(false));
afterEach(() => {
  delete (window as unknown as { __cutexDesks?: unknown }).__cutexDesks;
  localStorage.clear();
});

describe("the 多窗口 setting (lib/multiWindowPref)", () => {
  it("defaults to off (nothing heard from main yet)", () => {
    expect(multiWindowOn()).toBe(false);
    expect("multiWindow" in getUiPrefs()).toBe(false);
    expect(migrateMultiWindow(undefined, storage({}))).toBe(false);
  });

  it("the old value: a stored P6 pref wins over the old flag", () => {
    expect(migrateMultiWindow(undefined, storage({ [DESKS_FLAG_KEY]: "1" }))).toBe(true);
    expect(migrateMultiWindow(undefined, storage({ [DESKS_FLAG_KEY]: "0" }))).toBe(false);
    expect(migrateMultiWindow(false, storage({ [DESKS_FLAG_KEY]: "1" }))).toBe(false);
    expect(migrateMultiWindow(true, storage({}))).toBe(true);
    expect(migrateMultiWindow("1", storage({}))).toBe(false);
  });

  it("takeLegacyDesksFlag drops the old key once", () => {
    const s = storage({ [DESKS_FLAG_KEY]: "1" });
    expect(takeLegacyDesksFlag(s)).toBe(true);
    expect(s.map.has(DESKS_FLAG_KEY)).toBe(false);
    expect(takeLegacyDesksFlag(s)).toBe(false);
  });

  it("prefs load: the old flag is read once for main and removed; it never turns desks on by itself", async () => {
    localStorage.setItem(DESKS_FLAG_KEY, "1");
    vi.resetModules();
    const prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.legacyMultiWindow()).toBe(true);
    expect(localStorage.getItem(DESKS_FLAG_KEY)).toBeNull();
    expect(desksEnabled()).toBe(false);
    vi.resetModules();
    expect((await import("../src/renderer/src/lib/prefs")).legacyMultiWindow()).toBe(false);
  });

  it("prefs load: the stored P6 pref is read once for main and dropped from the renderer's storage", async () => {
    localStorage.setItem("cutex-desktop.ui", JSON.stringify({ multiWindow: true, sendKeys: "enter" }));
    vi.resetModules();
    const prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.legacyMultiWindow()).toBe(true);
    const stored = JSON.parse(localStorage.getItem("cutex-desktop.ui")!);
    expect("multiWindow" in stored).toBe(false);
    expect(stored.sendKeys).toBe("enter");
    vi.resetModules();
    expect((await import("../src/renderer/src/lib/prefs")).legacyMultiWindow()).toBe(false);
  });

  it("prefs load: nothing stored → the old value is off", async () => {
    vi.resetModules();
    expect((await import("../src/renderer/src/lib/prefs")).legacyMultiWindow()).toBe(false);
  });

  it("start: the old value goes to main (on or off) and the renderer follows main's answer, not the old value", async () => {
    const migrate = vi.fn(async (v: boolean) => state(v));
    await startMultiWindowPref({ state: async () => state(false), migrateMultiWindow: migrate }, true);
    expect(migrate).toHaveBeenCalledWith(true);
    expect(multiWindowOn()).toBe(true);
    // Main already used its one-time migration: it answers off, the renderer stays off.
    await startMultiWindowPref({ state: async () => state(false), migrateMultiWindow: async () => state(false) }, true);
    expect(multiWindowOn()).toBe(false);
    const off = vi.fn(async () => state(true));
    await startMultiWindowPref({ state: async () => state(true), migrateMultiWindow: off }, false);
    expect(off).toHaveBeenCalledWith(false);
    expect(multiWindowOn()).toBe(true);
  });

  it("start without a shell or with main failing: stays off", async () => {
    await startMultiWindowPref(undefined, true);
    expect(multiWindowOn()).toBe(false);
    await startMultiWindowPref({ state: async () => state(true), migrateMultiWindow: async () => Promise.reject(new Error("bad")) }, true);
    expect(multiWindowOn()).toBe(false);
  });

  it("the Settings switch goes through main and follows its answer", async () => {
    const shell = { setMultiWindow: vi.fn(async (v: boolean) => state(v)) };
    await setMultiWindow(shell, true);
    expect(shell.setMultiWindow).toHaveBeenCalledWith(true);
    expect(desksEnabled()).toBe(true);
    // Main refusing (throws): the renderer keeps what main last said.
    await expect(setMultiWindow({ setMultiWindow: async () => Promise.reject(new Error("bad value")) }, false)).rejects.toThrow();
    expect(desksEnabled()).toBe(true);
    await setMultiWindow(shell, false);
    expect(desksEnabled()).toBe(false);
  });

  it("desksEnabled follows ShellState; the old flag set by hand later does nothing", () => {
    expect(desksEnabled()).toBe(false);
    setOn(true);
    expect(desksEnabled()).toBe(true);
    setOn(false);
    localStorage.setItem(DESKS_FLAG_KEY, "1");
    expect(desksEnabled()).toBe(false);
  });
});

describe("window menu items follow the setting (lib/menus)", () => {
  const labels = () => normalizeEntries(agentMenu(session, t as never, "local")).map((e) => (e === "separator" ? "|" : (e as MenuAction).label));
  beforeEach(() => {
    const resource = { cutexSessionId: "a", displayName: "A", lifecycle: "active", revision: 1 };
    useApp.setState({ features: new Set(), sidebar: { active: [resource], hostRows: {} } as never });
  });

  it("off: no 在新窗口打开 / 在主窗口打开; on: they are there", () => {
    expect(labels()).not.toContain("desk.openInNew");
    setOn(true);
    expect(labels()).toContain("desk.openInNew");
    setOn(false);
    expect(labels().some((l) => l.startsWith("desk."))).toBe(false);
  });
});

describe("desks follow the setting (lib/deskSync followDesksSetting)", () => {
  it("off at start: desks never start and the remembered ones are not reopened, but stay stored", () => {
    const remembered = JSON.stringify([{ deskId: "d000000000001", hostId: "local", sessionId: "a" }]);
    localStorage.setItem(DESKS_STORAGE_KEY, remembered);
    useApp.setState({ sidebar: { active: [], hostRows: {} } as never });
    const stop = followDesksSetting();
    expect(hook()).toBeUndefined();
    expect(desk.ticket).not.toHaveBeenCalled();
    expect(localStorage.getItem(DESKS_STORAGE_KEY)).toBe(remembered);
    stop();
  });

  it("switched on later: desks start then; switched off again: the open desks keep running until closed", () => {
    const stop = followDesksSetting();
    expect(hook()).toBeUndefined();
    setOn(true);
    expect(hook()).toBeDefined();
    setOn(false);
    expect(hook()).toBeDefined();
    stop();
  });

  it("on at start: desks start at once", () => {
    setOn(true);
    const stop = followDesksSetting();
    expect(hook()).toBeDefined();
    stop();
    expect(multiWindowOn()).toBe(true);
  });
});
