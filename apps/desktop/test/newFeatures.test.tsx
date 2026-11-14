// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ state: { features: new Set<string>(), hosts: { active: "old", hosts: [{ id: "old", label: "Old host" }] }, openSettings: vi.fn() } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: (s: typeof fx.state) => unknown) => select(fx.state), { getState: () => fx.state }) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({ Button: (props: object) => h("button", props), Section: ({ title, children }: { title: string; children: React.ReactNode }) => h("section", null, h("h2", null, title), children) }));
const { NEW_FEATURES, supportsFeature } = await import("../src/renderer/src/modules/onboarding/features");
const { NewFeaturesPage } = await import("../src/renderer/src/modules/onboarding/NewFeaturesPage");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { fx.state.features = new Set(); vi.clearAllTimers(); vi.useRealTimers(); });
describe("new feature capability coverage", () => {
  it("requires every fork capability, and treats Director capabilities independently", () => {
    const fork = NEW_FEATURES.find((v) => v.id === "fork")!;
    expect(supportsFeature(fork, new Set(["session-fork", "session-fork-profile"]))).toBe(false);
    expect(supportsFeature(fork, new Set(fork.capabilities))).toBe(true);
    const address = new Set(["director-address"]);
    expect(supportsFeature(NEW_FEATURES.find((v) => v.id === "director")!, address)).toBe(true);
    for (const id of ["directorNotices", "handover", "startReview"]) expect(supportsFeature(NEW_FEATURES.find((v) => v.id === id)!, address)).toBe(false);
  });
  it("keeps client features available and HTML dependent on the existing file capability", () => {
    for (const id of ["roster", "shelves", "tray", "widgets", "flow", "confirm"]) expect(supportsFeature(NEW_FEATURES.find((v) => v.id === id)!, new Set())).toBe(true);
    expect(NEW_FEATURES.find((v) => v.id === "html")!.capabilities).toEqual(["workspace-fs"]);
  });
  it("marks legacy-host features and never offers unavailable settings; follows host capability changes", () => {
    vi.useFakeTimers();
    const node = document.createElement("div"); const root = createRoot(node);
    act(() => root.render(h(NewFeaturesPage)));
    const storage = () => node.querySelector('[data-new-feature="storage"]')!;
    expect(storage().getAttribute("data-supported")).toBe("false");
    expect(storage().textContent).toContain("onboarding.features.needs");
    expect(storage().querySelector("button")).toBeNull();
    fx.state.features = new Set(["host-storage"]);
    act(() => root.render(h(NewFeaturesPage)));
    expect(storage().getAttribute("data-supported")).toBe("true");
    act(() => (storage().querySelector("button") as HTMLButtonElement).click());
    expect(fx.state.openSettings).toHaveBeenCalledWith("storage");
    fx.state.features = new Set(); act(() => root.render(h(NewFeaturesPage)));
    expect(storage().querySelector("button")).toBeNull();
    act(() => root.unmount());
  });
});
