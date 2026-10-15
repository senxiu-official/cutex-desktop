// Default flips (modules/defaultFlips.ts): browser on by default since 2026-10-15 for fresh
// installs, while an install that already saved module choices keeps it off.
import { describe, expect, it } from "vitest";
import { DEFAULT_FLIPS, pinFlippedDefaults } from "../src/renderer/src/modules/defaultFlips";
import { createModuleHost } from "../src/renderer/src/modules/host";
import { MODULES_PREFS_KEY } from "../src/renderer/src/modules/types";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
const MARKER = DEFAULT_FLIPS.find((f) => f.id === "browser")!.marker;
const prefs = (enabled: Record<string, boolean>) => JSON.stringify({ v: 1, enabled, place: { "a:b": "c" } });

describe("pinFlippedDefaults", () => {
  it("fresh install (no module record): nothing pinned, the marker is set", () => {
    const s = memoryStorage();
    expect(pinFlippedDefaults(s)).toEqual([]);
    expect(s.data.get(MODULES_PREFS_KEY)).toBeUndefined();
    expect(s.data.get(MARKER)).toBe("1");
  });

  it("existing install without a browser entry: pinned off, other entries and placement kept", () => {
    const s = memoryStorage({ [MODULES_PREFS_KEY]: prefs({ nci: true }) });
    expect(pinFlippedDefaults(s)).toEqual(["browser"]);
    expect(JSON.parse(s.data.get(MODULES_PREFS_KEY)!)).toEqual({ v: 1, enabled: { nci: true, browser: false }, place: { "a:b": "c" } });
  });

  it("an existing explicit choice is kept (on stays on)", () => {
    const s = memoryStorage({ [MODULES_PREFS_KEY]: prefs({ browser: true }) });
    expect(pinFlippedDefaults(s)).toEqual([]);
    expect(JSON.parse(s.data.get(MODULES_PREFS_KEY)!).enabled).toEqual({ browser: true });
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
