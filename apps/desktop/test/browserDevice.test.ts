import { describe, expect, it, vi } from "vitest";
import { loadBrowserDeviceId } from "../src/main/browser/device";
const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
describe("userData-scoped non-secret browser device id", () => {
  it("persists only version and crypto-random id, then reuses it for every host", () => { let raw: string | undefined; const store = { read: () => raw, create: (value: string) => { raw = value; return true; } }, uuid = vi.fn(() => id); expect(loadBrowserDeviceId("unused", store, uuid)).toBe(id); expect(JSON.parse(raw!)).toEqual({ version: 1, deviceId: id }); expect(loadBrowserDeviceId("unused", store, uuid)).toBe(id); expect(uuid).toHaveBeenCalledTimes(1); });
  it("concurrent creator uses winner without overwrite", () => { let raw: string | undefined; const store = { read: () => raw, create: () => { raw = JSON.stringify({ version: 1, deviceId: other }); return false; } }; expect(loadBrowserDeviceId("unused", store, () => id)).toBe(other); });
  it.each(["bad", "{}", JSON.stringify({ version: 2, deviceId: id }), JSON.stringify({ version: 1, deviceId: "invalid" }), JSON.stringify({ version: 1, deviceId: id, connectionKey: "NEVER" }), "x".repeat(1025)])("corruption or a secret-bearing record fails closed", raw => { const create = vi.fn(); expect(() => loadBrowserDeviceId("unused", { read: () => raw, create }, () => id)).toThrow(); expect(create).not.toHaveBeenCalled(); });
  it("lost creation race never silently assigns a different identity", () => { expect(() => loadBrowserDeviceId("unused", { read: () => undefined, create: () => false }, () => id)).toThrow(); });
});
