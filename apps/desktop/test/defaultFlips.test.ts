// Default flips (modules/defaultFlips.ts): browser on by default since 2026-10-15 for fresh
// installs, while an install that already saved module choices keeps it off.
import { describe, expect, it } from "vitest";
import { DEFAULT_FLIPS, pinFlippedDefaults, pinnedBundledFallbacks } from "../src/renderer/src/modules/defaultFlips";
import { createModuleHost } from "../src/renderer/src/modules/host";
import { MODULES_PREFS_KEY } from "../src/renderer/src/modules/types";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
const MARKER = DEFAULT_FLIPS.find((f) => f.id === "browser")!.marker;
const prefs = (enabled: Record<string, boolean>) => JSON.stringify({ v: 1, enabled, place: { "a:b": "c" } });

it("pins bundled fallback eligibility once, after migrating the previous Baidu default", () => {
  const fresh = memoryStorage();
  pinFlippedDefaults(fresh);
  expect([...pinnedBundledFallbacks(fresh)]).toEqual([]);
  fresh.setItem(MODULES_PREFS_KEY, prefs({ nci: true, "baidu-pan": true }));
  expect([...pinnedBundledFallbacks(fresh)]).toEqual([]);

  const old = memoryStorage({ [MARKER]: "1", [MODULES_PREFS_KEY]: prefs({ nci: true }) });
  pinFlippedDefaults(old);
  const migrated = old.getItem(MODULES_PREFS_KEY);
  expect([...pinnedBundledFallbacks(old)]).toEqual(["nci", "baidu-pan"]);
  expect(old.getItem(MODULES_PREFS_KEY)).toBe(migrated);

  const disabled = memoryStorage({ [MARKER]: "1", [MODULES_PREFS_KEY]: prefs({ nci: false, "baidu-pan": false }) });
  pinFlippedDefaults(disabled);
  expect([...pinnedBundledFallbacks(disabled)]).toEqual([]);
});

describe("pinFlippedDefaults", () => {
  it("fresh install (no module record): nothing pinned, the marker is set", () => {
    const s = memoryStorage();
    expect(pinFlippedDefaults(s)).toEqual([]);
    expect(s.data.get(MODULES_PREFS_KEY)).toBeUndefined();
    expect(s.data.get(MARKER)).toBe("1");
  });

  it("existing install without a browser entry: pinned off, other entries and placement kept", () => {
    const s = memoryStorage({ [MODULES_PREFS_KEY]: prefs({ nci: true }) });
    // The status capsule (status-capsule flip) keeps its old default on there too.
    expect(pinFlippedDefaults(s)).toEqual(["browser", "status-capsule"]);
    expect(JSON.parse(s.data.get(MODULES_PREFS_KEY)!)).toEqual({ v: 1, enabled: { nci: true, browser: false, "status-capsule": true }, place: { "a:b": "c" } });
  });

  it("an existing explicit choice is kept (on stays on)", () => {
    const s = memoryStorage({ [MODULES_PREFS_KEY]: prefs({ browser: true, "status-capsule": false }) });
    expect(pinFlippedDefaults(s)).toEqual([]);
    expect(JSON.parse(s.data.get(MODULES_PREFS_KEY)!).enabled).toEqual({ browser: true, "status-capsule": false });
  });

  it("runs once: after the marker a later change is never overwritten", () => {
    const s = memoryStorage({ [MODULES_PREFS_KEY]: prefs({}) });
    pinFlippedDefaults(s);
    s.data.set(MODULES_PREFS_KEY, prefs({}));
    expect(pinFlippedDefaults(s)).toEqual([]);
    expect(JSON.parse(s.data.get(MODULES_PREFS_KEY)!).enabled).toEqual({});
  });

  it("a malformed record is left alone", () => {
    const s = memoryStorage({ [MODULES_PREFS_KEY]: "{oops" });
    expect(pinFlippedDefaults(s)).toEqual([]);
    expect(s.data.get(MODULES_PREFS_KEY)).toBe("{oops");
  });

  it("with the module host: fresh → browser on; pinned existing install → off and stays off after saves", async () => {
    const browser = { id: "browser", titleKey: "x", contributes: {} } as const;
    const other = { id: "other", titleKey: "y", defaultEnabled: false, contributes: {} } as const;
    const make = (storage: ReturnType<typeof memoryStorage>) =>
      createModuleHost({ modules: [browser, other] as never, slots: {} as never, host: { id: "local", kind: "local", features: null }, storage, services: () => ({}), log: () => {} });
    const fresh = memoryStorage();
    pinFlippedDefaults(fresh);
    expect(make(fresh).isEnabled("browser")).toBe(true);

    const existing = memoryStorage({ [MODULES_PREFS_KEY]: prefs({}) });
    pinFlippedDefaults(existing);
    const host = make(existing);
    expect(host.isEnabled("browser")).toBe(false);
    await host.setEnabled("other", true);
    await host.idle();
    expect(JSON.parse(existing.data.get(MODULES_PREFS_KEY)!).enabled).toMatchObject({ browser: false, other: true });
    expect(make(existing).isEnabled("browser")).toBe(false);
  });
});

describe("Baidu Netdisk's default changes on new installs", () => {
  const baidu = { id: "baidu-pan", titleKey: "x", defaultEnabled: false, contributes: {} } as const;
  const make = (storage: ReturnType<typeof memoryStorage>) =>
    createModuleHost({ modules: [baidu] as never, slots: {} as never, host: { id: "local", kind: "local", features: null }, storage, services: () => ({}), log: () => {} });

  it("a fresh install starts off and a second launch keeps it off", () => {
    const storage = memoryStorage();
    pinFlippedDefaults(storage);
    expect(make(storage).isEnabled("baidu-pan")).toBe(false);
    pinFlippedDefaults(storage);
    expect(make(storage).isEnabled("baidu-pan")).toBe(false);
  });

  it("inherits the old enabled default even if the old install never saved module prefs", async () => {
    const storage = memoryStorage({ [MARKER]: "1" });
    expect(pinFlippedDefaults(storage)).toEqual(["baidu-pan", "status-capsule"]);
    const host = make(storage);
    expect(host.isEnabled("baidu-pan")).toBe(true);
    await host.setEnabled("baidu-pan", false);
    pinFlippedDefaults(storage);
    expect(make(storage).isEnabled("baidu-pan")).toBe(false);
  });

  it.each([true, false])("keeps a saved Baidu switch (%s), other choices and placement", (on) => {
    const original = prefs({ "baidu-pan": on, nci: true, whatsapp: true, "claude-science": true, "status-capsule": true });
    const storage = memoryStorage({ [MARKER]: "1", [MODULES_PREFS_KEY]: original });
    expect(pinFlippedDefaults(storage)).toEqual([]);
    expect(storage.data.get(MODULES_PREFS_KEY)).toBe(original);
    expect(make(storage).isEnabled("baidu-pan")).toBe(on);
  });
});

describe("the old status capsule is off on new installs (owner 2026-11-27)", () => {
  const capsule = { id: "status-capsule", titleKey: "x", defaultEnabled: false, contributes: {} } as const;
  const make = (storage: ReturnType<typeof memoryStorage>) =>
    createModuleHost({ modules: [capsule] as never, slots: {} as never, host: { id: "local", kind: "local", features: null }, storage, services: () => ({}), log: () => {} });

  it("a fresh install starts off and stays off", () => {
    const storage = memoryStorage();
    expect(pinFlippedDefaults(storage)).not.toContain("status-capsule");
    expect(make(storage).isEnabled("status-capsule")).toBe(false);
    pinFlippedDefaults(storage);
    expect(make(storage).isEnabled("status-capsule")).toBe(false);
  });

  it("an existing install (startup marker, or saved choices only) keeps it on, as an explicit choice", () => {
    for (const seed of [{ [MARKER]: "1" }, { [MODULES_PREFS_KEY]: prefs({ nci: true }) }]) {
      const storage = memoryStorage(seed);
      expect(pinFlippedDefaults(storage)).toContain("status-capsule");
      expect(JSON.parse(storage.data.get(MODULES_PREFS_KEY)!).enabled["status-capsule"]).toBe(true);
      expect(make(storage).isEnabled("status-capsule")).toBe(true);
    }
  });

  it.each([true, false])("an explicit choice (%s) stays, other keys (position, size) untouched", (on) => {
    const geometry = JSON.stringify({ corner: "br", scale: 1.2 });
    const storage = memoryStorage({ [MARKER]: "1", [MODULES_PREFS_KEY]: prefs({ "status-capsule": on }), "cutex-desktop.capsule": geometry });
    expect(pinFlippedDefaults(storage)).not.toContain("status-capsule");
    expect(make(storage).isEnabled("status-capsule")).toBe(on);
    expect(storage.data.get("cutex-desktop.capsule")).toBe(geometry);
  });
});
