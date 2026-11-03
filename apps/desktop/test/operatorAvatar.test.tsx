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

// Owner 2026-11-01: the Operator's O chip is deleted — no marker on its avatar in any form or size.
it("draws no Operator marker on letters, emoji, pictures, cut-outs, minor tiles or framed avatars", () => {
  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset.theme = theme;
    for (const props of [{}, { avatar: { kind: "emoji", value: "🐱" } }, { picture: "data:image/png;base64,AA==" }, { picture: "data:image/png;base64,AA==", cutout: true }]) {
      draw(props);
      expect(mark()).toBeNull();
      expect(host.querySelector("[aria-label='sidebar.operator']")).toBeNull();
      // 副主管也戴 (default on) is a separate setting and stays: the maid companion over the face; a cut-out wears none.
      expect(host.querySelector("[data-avatar-headwear]")?.getAttribute("data-avatar-headwear") ?? null).toBe("cutout" in props ? null : "operator-maid");
    }
  }
  delete document.documentElement.dataset.theme;
  fx.minor = true;
  for (const size of [16, 20, 24, 28]) {
    draw({ size, initial: "甲", status: { running: true } });
    expect(host.querySelector("[data-minor-tile]")!.textContent).toBe("甲");
    expect(mark()).toBeNull();
  }
});

it("leaves Director marks, headwear, status badges and presence as they were", () => {
  fx.look.isDirector = true; fx.look.project = { hostId: "local", id: "p", mark: "甲", color: "blue" };
  act(() => setUiPref("directorHeadwear", "maid"));
  draw({ size: 40, status: { running: true, badge: { tone: "attention", text: "2" }, presence: "online" } });
  expect(host.querySelector("[data-avatar-headwear]")).not.toBeNull();
  expect(host.querySelector("[data-project-mark]")!.textContent).toBe("甲");
  expect(host.querySelector("[data-avatar-badge]")!.textContent).toBe("2");
  expect(host.querySelector("[data-avatar-dot='online']")).not.toBeNull();
  expect(mark()).toBeNull();
});
