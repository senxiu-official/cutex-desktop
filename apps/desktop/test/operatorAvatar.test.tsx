// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  look: { color: "#3366cc", family: "openai", themes: null, isDirector: false, isOperator: undefined as boolean | undefined, project: null as null | { hostId: string; id: string; mark: string; color: string }, pinned: false },
  minor: false,
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/agentLook", () => ({ useAgentLook: (seed: string | undefined) => seed ? fx.look : null, useMinorDot: () => fx.minor, useProjectStyleWorn: () => new Set() }));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/portraitPacks", () => ({ portraitFor: () => null, portraitRefOf: () => null, usePortraitImage: () => null, usePortraitPacks: () => ({ index: {} }) }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
import { Avatar } from "../src/renderer/src/components/Avatar";
import { setUiPref } from "../src/renderer/src/lib/prefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  fx.look.isOperator = true; fx.look.isDirector = false; fx.look.project = null; fx.minor = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => setUiPref("agentAvatarDefault", "letter"));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const draw = (props: Record<string, unknown> = {}) => act(() => root.render(h(Avatar, { name: "Operator agent", seed: "s", size: 28, ...props } as never)));
const mark = () => host.querySelector<HTMLElement>("[data-operator-mark]");

it("hides the role when an older host has no projection or the avatar has no agent seed", () => {
  fx.look.isOperator = undefined; draw(); expect(mark()).toBeNull();
  fx.look.isOperator = true; draw({ seed: undefined }); expect(mark()).toBeNull();
});

it("keeps a light top-left O role badge on letters, emoji, pictures and cut-out portraits", () => {
  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset.theme = theme;
    for (const props of [{}, { avatar: { kind: "emoji", value: "🐱" } }, { picture: "data:image/png;base64,AA==" }, { picture: "data:image/png;base64,AA==", cutout: true }]) {
      draw(props);
      expect(mark()!.textContent).toBe("O");
      expect(mark()!.getAttribute("aria-label")).toBe("sidebar.operator");
      expect(mark()!.style.left).toBe("-2px"); expect(mark()!.style.top).toBe("-2px");
      expect(mark()!.style.color).toBe("var(--fg)");
      expect(mark()!.style.background).toContain("var(--surface)");
      // 副主管也戴 (default on): the maid companion over the face; a cut-out portrait wears none.
      expect(host.querySelector("[data-avatar-headwear]")?.getAttribute("data-avatar-headwear") ?? null).toBe("cutout" in props ? null : "operator-maid");
    }
  }
  delete document.documentElement.dataset.theme;
});

it("scales the badge down without replacing the minor 甲 tile or its running edge", () => {
  fx.minor = true;
  for (const size of [16, 20, 24, 28]) {
    draw({ size, minor: true, initial: "甲", status: { running: true } });
    expect(host.querySelector("[data-minor-tile]")!.textContent).toBe("甲");
    expect(host.querySelector(".agent-ring-tile")).not.toBeNull();
    expect(parseFloat(mark()!.style.width)).toBeLessThan(size);
    expect(mark()!.style.width).toBe(size < 24 ? "9px" : "12px");
    expect(host.querySelectorAll("[data-operator-mark]")).toHaveLength(1);
  }
});

it("coexists with Director project marks, headwear, status badges and presence in separate corners", () => {
  fx.look.isDirector = true; fx.look.project = { hostId: "local", id: "p", mark: "甲", color: "blue" };
  act(() => setUiPref("directorHeadwear", "maid"));
  draw({ size: 40, status: { running: true, badge: { tone: "attention", text: "2" }, presence: "online" } });
  expect(host.querySelector("[data-avatar-headwear]")).not.toBeNull();
  expect(host.querySelector("[data-project-mark]")!.textContent).toBe("甲");
  expect(host.querySelector("[data-avatar-badge]")!.textContent).toBe("2");
  expect(host.querySelector("[data-avatar-dot='online']")).not.toBeNull();
  expect(host.querySelectorAll("[data-operator-mark]")).toHaveLength(1);
  expect(mark()!.closest("[data-avatar-status]")).not.toBeNull();
});

it("drops only the Operator badge when the role is removed", () => {
  draw({ status: { badge: { tone: "accent", text: "1" } } }); expect(mark()).not.toBeNull();
  fx.look.isOperator = false;
  draw({ status: { badge: { tone: "accent", text: "1" } } });
  expect(mark()).toBeNull(); expect(host.querySelector("[data-avatar-badge]")!.textContent).toBe("1");
});
