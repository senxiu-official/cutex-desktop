// lib/statusItems.ts: placement helpers of the `conversation.status` slot (the shell's view of it).
import { describe, expect, it } from "vitest";
import { CODEX_FEATURES, type AgentFeatures } from "../src/renderer/src/lib/agentFeatures";
import { capsuleToggle, inBar, inCapsule, placedStatusItems, shownOn, toggleFoldedId } from "../src/renderer/src/lib/statusItems";
import { itemSurfaces, legacyHome, resolvePlacement, type SurfaceProviders } from "../src/renderer/src/lib/statusSurfaces";
import type { StatusItem, StatusPlace } from "../src/renderer/src/modules/slots";

const surface = (s: "bar" | "capsule") => ({ id: `x.${s}`, surface: s, intents: s === "bar" ? ["view", "edit"] : ["view"] }) as never;
const ALL_ON: SurfaceProviders = {
  bar: { surface: "bar", available: true, moduleId: "shell", item: surface("bar") },
  capsule: { surface: "capsule", available: true, moduleId: "status-capsule", item: surface("capsule") },
};
const resolve = (i: StatusItem, place: StatusPlace) => {
  const supported = itemSurfaces(i);
  return { supported, resolved: resolvePlacement(place, supported, ALL_ON) };
};

const item = (id: string, extra: Partial<StatusItem> = {}): StatusItem =>
  ({ id: id as StatusItem["id"], titleKey: "status-capsule.title", defaultPlace: "capsule", useStatus: () => null, Body: () => null, ...extra }) as StatusItem;

describe("statusItems", () => {
  it("bar / capsule membership and where requests open", () => {
    expect((["bar", "capsule", "both", "off"] as StatusPlace[]).map((p) => [inBar(p), inCapsule(p)])).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [false, false],
    ]);
    // v1.1 `home` (now derived from the effective placement, everything on): as before.
    const home = (p: StatusPlace) => legacyHome(resolvePlacement(p, ["bar", "capsule"], ALL_ON));
    expect(home("capsule")).toBe("capsule");
    expect(home("both")).toBe("bar");
    expect(home("off")).toBe("bar");
    expect(home("bar")).toBe("bar");
  });

  it("the … menu toggles capsule membership and keeps the bar side", () => {
    expect(capsuleToggle("off")).toBe("capsule");
    expect(capsuleToggle("capsule")).toBe("off");
    expect(capsuleToggle("bar")).toBe("both");
    expect(capsuleToggle("both")).toBe("bar");
  });

  it("placed items: available ones in slot order, the agent's lacking features left out", () => {
    const entries = [
      { item: item("goal.status", { agentFeature: "goals", defaultPlace: "bar" }), moduleId: "goal", mode: "show" },
      { item: item("plan.status"), moduleId: "plan", mode: "show" },
      { item: item("background-terminals.status", { agentFeature: "backgroundTerminals" }), moduleId: "background-terminals", mode: "show" },
      { item: item("x.notice"), moduleId: "x", mode: "notice" },
    ];
    const placeOf = (i: StatusItem) => (i.id === "plan.status" ? "off" : i.defaultPlace);
    const codex = placedStatusItems(entries, placeOf, CODEX_FEATURES, resolve);
    expect(codex.map((p) => `${p.item.id}:${p.place}`)).toEqual(["goal.status:bar", "plan.status:off", "background-terminals.status:capsule"]);
    expect(codex.some((p) => shownOn(p, "capsule"))).toBe(true);
    const claude: AgentFeatures = { runtime: "claude", map: { goals: false, backgroundTerminals: false } };
    const forClaude = placedStatusItems(entries, placeOf, claude, resolve);
    expect(forClaude.map((p) => p.item.id)).toEqual(["plan.status"]);
    expect(forClaude.some((p) => shownOn(p, "capsule"))).toBe(false);
    // No agent (Settings): every available item.
    expect(placedStatusItems(entries, placeOf, null, resolve)).toHaveLength(3);
  });

  it("folded sections are item ids", () => {
    expect(toggleFoldedId([], "plan.status")).toEqual(["plan.status"]);
    expect(toggleFoldedId(["plan.status", "goal.status"], "plan.status")).toEqual(["goal.status"]);
  });
});
