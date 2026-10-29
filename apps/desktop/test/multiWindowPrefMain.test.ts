// 多窗口 is main-owned (docs/desktop-modules.md §24.17): stored in desktop-prefs.json (main/shell.ts), carried in
// ShellState, changed by the validated setter, and the renderer's old value is adopted at most once — in the first
// run that stores it — so it cannot be replayed later (shared/shell.ts multiWindowChange). Main refuses desk tickets
// while it is off (main/deskWindows.ts); open desks keep working.
import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({ file: "{}", writes: [] as string[] }));
vi.mock("electron", () => ({
  app: { on: () => {}, getPath: () => "/nonexistent-cutex-test", getLocale: () => "en" },
  BrowserWindow: class {},
  dialog: {},
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createEmpty: () => ({}), createFromBuffer: () => ({}) },
  Notification: { isSupported: () => false },
  powerMonitor: { on: () => {} },
  safeStorage: { isEncryptionAvailable: () => false },
  Tray: class {},
}));
vi.mock("node:fs", async (original) => ({ ...(await original<object>()), readFileSync: () => disk.file }));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<object>()),
  writeFile: async (_file: string, body: string) => void disk.writes.push(body),
  rename: async () => {},
}));

const { DesktopShell } = await import("../src/main/shell");
const { DeskRegistry, DESK_NAME_PREFIX } = await import("../src/main/deskWindows");
const { DEFAULT_PREFS, multiWindowChange, openMultiWindowMigration, parsePrefs } = await import("../src/shared/shell");

const shell = () => new DesktopShell(() => null, () => {}, () => {});
/** What the last save wrote, once the serialized writes ran. */
async function saved(): Promise<Record<string, unknown>> {
  await new Promise((r) => setTimeout(r, 0));
  return JSON.parse(disk.writes.at(-1) ?? "{}");
}
/** Next app start: main loads what it saved. */
async function restart() {
  disk.file = JSON.stringify(await saved());
  return shell();
}

beforeEach(() => {
  disk.file = "{}";
  disk.writes = [];
});

describe("prefs parsing", () => {
  it("default off; only true is kept, as is the migration marker", () => {
    expect(DEFAULT_PREFS.multiWindow).toBeUndefined();
    expect(parsePrefs({}).multiWindow).toBeUndefined();
    expect(parsePrefs({ multiWindow: "1" }).multiWindow).toBeUndefined();
    expect(parsePrefs({ multiWindow: 1 }).multiWindow).toBeUndefined();
    expect(parsePrefs({ multiWindow: true, multiWindowMigrated: true })).toMatchObject({ multiWindow: true, multiWindowMigrated: true });
    expect(parsePrefs({ multiWindowMigrated: "yes" }).multiWindowMigrated).toBeUndefined();
  });

  it("multiWindowChange: set always applies and closes the migration; migrate only while open", () => {
    const base = parsePrefs({});
    expect(multiWindowChange(base, false, { kind: "migrate", value: true })).toEqual({ prefs: base, migrationOpen: false, changed: false });
    const migrated = multiWindowChange(base, true, { kind: "migrate", value: true });
    expect(migrated).toMatchObject({ migrationOpen: false, changed: true, prefs: { multiWindow: true, multiWindowMigrated: true } });
    const set = multiWindowChange(migrated.prefs, true, { kind: "set", value: false });
    expect(set.migrationOpen).toBe(false);
    expect(set.prefs.multiWindow).toBeUndefined();
    expect(openMultiWindowMigration(set.prefs).migrationOpen).toBe(false);
    expect(openMultiWindowMigration(base)).toEqual({ prefs: { ...base, multiWindowMigrated: true }, migrationOpen: true });
  });
});

describe("main/shell.ts DesktopShell", () => {
  it("ShellState carries the setting; the setter stores it", async () => {
    disk.file = JSON.stringify({ multiWindowMigrated: true });
    const s = shell();
    expect(s.multiWindow).toBe(false);
    expect(s.state().prefs.multiWindow).toBeUndefined();
    expect(s.setMultiWindow("set", true).prefs.multiWindow).toBe(true);
    expect(s.multiWindow).toBe(true);
    expect((await saved()).multiWindow).toBe(true);
    expect(s.setMultiWindow("set", false).prefs.multiWindow).toBeUndefined();
    expect(s.multiWindow).toBe(false);
    expect((await saved()).multiWindow).toBeUndefined();
  });

  it("the setter refuses anything but a boolean (set and migrate alike)", () => {
    const s = shell();
    for (const bad of ["1", 1, null, undefined, {}, ["true"]]) {
      expect(() => s.setMultiWindow("set", bad)).toThrow("bad value");
      expect(() => s.setMultiWindow("migrate", bad)).toThrow("bad value");
    }
    expect(s.multiWindow).toBe(false);
    // A refused value did not use up the migration either.
    expect(s.setMultiWindow("migrate", true).prefs.multiWindow).toBe(true);
  });

  it("first run: the marker is stored at load, the old value is adopted once, a replay is ignored", async () => {
    const s = shell();
    expect((await saved()).multiWindowMigrated).toBe(true);
    expect(s.setMultiWindow("migrate", true).prefs.multiWindow).toBe(true);
    s.setMultiWindow("set", false);
    // Replayed in the same run: ignored.
    expect(s.setMultiWindow("migrate", true).prefs.multiWindow).toBeUndefined();
    expect(s.multiWindow).toBe(false);
    // And in the next run.
    const next = await restart();
    expect(next.setMultiWindow("migrate", true).prefs.multiWindow).toBeUndefined();
    expect(next.multiWindow).toBe(false);
  });

  it("first run with the old value off: the migration is used up all the same", async () => {
    const s = shell();
    expect(s.setMultiWindow("migrate", false).prefs.multiWindow).toBeUndefined();
    expect(s.setMultiWindow("migrate", true).prefs.multiWindow).toBeUndefined();
  });

  it("the renderer never migrating in its first run: the next run is closed anyway", async () => {
    shell();
    const next = await restart();
    expect(next.setMultiWindow("migrate", true).prefs.multiWindow).toBeUndefined();
  });

  it("an explicit owner switch before the migration closes it", () => {
    const s = shell();
    s.setMultiWindow("set", false);
    expect(s.setMultiWindow("migrate", true).prefs.multiWindow).toBeUndefined();
  });

  it("a stored setting survives restarts (on stays on, no migration needed)", async () => {
    disk.file = JSON.stringify({ multiWindow: true, multiWindowMigrated: true });
    const s = shell();
    expect(s.multiWindow).toBe(true);
    expect(s.state().prefs.multiWindow).toBe(true);
    expect(disk.writes).toEqual([]);
  });
});

describe("main/deskWindows.ts refuses tickets while 多窗口 is off", () => {
  const MAIN = 7;
  function registry(on: { value: boolean }) {
    let n = 0;
    return new DeskRegistry<{ name: string }>(() => 1_000, (bytes) => (n++).toString(16).padStart(bytes * 2, "0"), () => on.value);
  }

  it("off: no ticket, also not for a remembered desk id", () => {
    const reg = registry({ value: false });
    expect(reg.issue(MAIN)).toBeNull();
    expect(reg.issue(MAIN, "d0123456789ab")).toBeNull();
    expect(reg.admit({ url: "about:blank", frameName: `${DESK_NAME_PREFIX}${"0".repeat(32)}`, openerId: MAIN })).toBeNull();
  });

  it("a ticket issued while on is not admitted after switching off", () => {
    const on = { value: true };
    const reg = registry(on);
    const ticket = reg.issue(MAIN)!;
    on.value = false;
    expect(reg.admit({ url: "about:blank", frameName: ticket.name, openerId: MAIN })).toBeNull();
    on.value = true;
    expect(reg.admit({ url: "about:blank", frameName: ticket.name, openerId: MAIN })).toBe(ticket.deskId);
  });

  it("switching off keeps the open desks working (window controls, frame hosts); no new ones", () => {
    const on = { value: true };
    const reg = registry(on);
    const ticket = reg.issue(MAIN)!;
    reg.admit({ url: "about:blank", frameName: ticket.name, openerId: MAIN });
    const entry = reg.register(ticket.name, MAIN, { name: "desk" }, 42)!;
    on.value = false;
    expect(reg.resolve(MAIN, entry.deskId)).toBe(entry);
    expect(reg.frameHostOf(MAIN, MAIN)).toBe(MAIN);
    expect(reg.frameHostOf(42, MAIN)).toBe(42);
    expect(reg.issue(MAIN)).toBeNull();
    expect(reg.remove(entry.deskId)).toBe(entry);
  });

  it("main wires the gate to the setting (DeskShell → desktopShell.multiWindow)", async () => {
    const { readFileSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
    const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
    const deskShell = readFileSync(new URL("../src/main/deskShell.ts", import.meta.url), "utf8");
    expect(index).toMatch(/new DeskShell\(\{[\s\S]*?enabled: \(\) => desktopShell\.multiWindow,/);
    expect(deskShell).toContain("new DeskRegistry<BrowserWindow>(undefined, undefined, () => deps.enabled())");
  });
});
