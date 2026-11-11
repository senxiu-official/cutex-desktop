// useHostServices (lib/serviceLinkView): another host's list is its `byHost` slice; a host with no slice yet, or a
// state without `byHost` at all, reads as null (no list), never a crash.
import { describe, expect, it, vi } from "vitest";

let state: Record<string, unknown> = {};
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("../src/renderer/src/lib/convShelves", () => ({ parseConvKey: () => null }));
vi.mock("../src/renderer/src/lib/serviceLink", () => ({ agentServices: () => [], openFromHeader: () => "unavailable", servicePanes: () => [], shelfOfConversation: () => null }));
vi.mock("../src/renderer/src/lib/servicesPopover", () => ({ serviceWhere: () => null }));
vi.mock("../src/renderer/src/lib/sideLayoutStore", () => ({ liveConversation: () => null, useConvShelfVersion: () => 0, useSide: () => null }));
const { useHostServices } = await import("../src/renderer/src/lib/serviceLinkView");

describe("useHostServices", () => {
  const own = [{ slug: "a" }], other = [{ slug: "b" }];
  it("the focus host's own list; another host's slice", () => {
    state = { hosts: { active: "local" }, services: own, byHost: { "ssh-x": { services: other } } };
    expect(useHostServices("local")).toBe(own);
    expect(useHostServices("ssh-x")).toBe(other);
    expect(useHostServices(null)).toBeNull();
  });
  it("a host without a slice, or no byHost at all: null", () => {
    state = { hosts: { active: "local" }, services: own, byHost: {} };
    expect(useHostServices("ssh-other")).toBeNull();
    state = { hosts: { active: "local" }, services: own };
    expect(useHostServices("ssh-other")).toBeNull();
  });
});
