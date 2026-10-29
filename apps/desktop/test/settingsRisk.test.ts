import { describe, expect, it, vi } from "vitest";
import { addedSettingsTargets, confirmSettingsRisk, SettingsRiskGate, settingsRiskFingerprint, widenedListenTargets } from "../src/renderer/src/lib/settingsRisk";

describe("settings approval scope", () => {
  it("invalidates an old approval across A→B→A and explicit cancellation", () => {
    const gate = new SettingsRiskGate(); gate.update("A");
    const valid = gate.capture(); gate.update("B"); gate.update("A");
    expect(valid()).toBe(false);
    const next = gate.capture(); gate.invalidate(); expect(next()).toBe(false);
  });
  it("requires exact target typing and fails closed on cancel or intervening input changes", async () => {
    expect(await confirmSettingsRisk("Host A", async () => null, () => true)).toBe("cancelled");
    expect(await confirmSettingsRisk("Host A", async () => " Host A ", () => true)).toBe("mismatch");
    expect(await confirmSettingsRisk("Host A", async () => "Host A", () => true)).toBe("confirmed");
    const gate = new SettingsRiskGate(); const valid = gate.capture();
    expect(await confirmSettingsRisk("A", async () => { gate.invalidate(); return "A"; }, valid)).toBe("changed");
    const prompt = vi.fn(); expect(await confirmSettingsRisk("A", prompt, () => false)).toBe("changed"); expect(prompt).not.toHaveBeenCalled();
  });
  it("compares semantic object state without depending on JSON member order", () => {
    expect(settingsRiskFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(settingsRiskFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });
});

describe("network widening", () => {
  it("does not confirm loopback additions, removals, reordering, or narrower addresses covered by a wildcard", () => {
    expect(widenedListenTargets(["0.0.0.0", "[::]"], ["10.0.0.3", "[fd7a::2]", "127.0.0.2"])).toEqual([]);
    expect(widenedListenTargets(["127.0.0.1", "tailscale"], ["127.0.0.1"])).toEqual([]);
  });
  it("confirms new networks and ports, using the actual default port rather than assuming the live port", () => {
    expect(widenedListenTargets(["127.0.0.1"], ["127.0.0.1", "tailscale", "0.0.0.0"])).toEqual(["tailscale", "0.0.0.0"]);
    expect(widenedListenTargets(["0.0.0.0"], ["10.0.0.3:24270"], 24370)).toEqual(["10.0.0.3:24270"]);
    expect(widenedListenTargets(["0.0.0.0"], ["10.0.0.3:24370"], 24370)).toEqual([]);
    expect(widenedListenTargets(["[::]:24370"], ["[fd7a::2]:24371"])).toEqual(["[fd7a::2]:24371"]);
  });
  it("only treats newly allowed CORS origins as widening", () => {
    expect(addedSettingsTargets(["https://a.example", "https://b.example"], ["https://b.example"])).toEqual([]);
    expect(addedSettingsTargets([], ["https://a.example"])).toEqual(["https://a.example"]);
  });
});
