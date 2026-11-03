// @vitest-environment jsdom
// The owner's badge on an agent is drawn as the avatar's mark (owner 2026-10-27): the project mark's place, box and
// font rules; on a Director it replaces the project's text (project colour kept); never on a minor tile, a cut-out
// portrait or an avatar under PROJECT_MARK_MIN_AVATAR. Lists drop their name chip where the avatar carries it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avatarCarriesMark, avatarMark, PROJECT_MARK_MIN_AVATAR, projectMarkFont, projectMarkHeight } from "../src/renderer/src/lib/projectMark";
import { badgeColor } from "../src/renderer/src/lib/sessionBadge";

const fx = vi.hoisted(() => ({
  look: {
    color: "#3366cc", family: "openai", themes: null, isDirector: false, isOperator: false, pinned: false,
    project: null as null | { hostId: string; id: string; mark: string; color: string },
    badge: null as null | { text: string; tint?: "blue" | "green" | "amber" | "pink" | "violet" },
  },
  minor: false,
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/agentLook", () => ({ useAgentLook: (seed: string | undefined) => (seed ? fx.look : null), useMinorDot: () => fx.minor, useProjectStyleWorn: () => new Set() }));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/portraitPacks", () => ({ portraitFor: () => null, portraitRefOf: () => null, usePortraitImage: () => null, usePortraitPacks: () => ({ index: {} }) }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
import { Avatar } from "../src/renderer/src/components/Avatar";
import { setUiPref } from "../src/renderer/src/lib/prefs";

describe("avatarMark", () => {
  it("the badge wins over the project's text, keeping the project colour; else the badge's own tint", () => {
    expect(avatarMark({ text: "CD", color: "red" }, { text: "主管", color: "blue" })).toEqual({ text: "主管", color: "red" });
    expect(avatarMark(null, { text: "HELP", color: badgeColor("pink") })).toEqual({ text: "HELP", color: "magenta" });
    expect(avatarMark({ text: "CD", color: "red" }, null)).toEqual({ text: "CD", color: "red" });
    expect(avatarMark({ text: "CD", color: "red" }, { text: "  ", color: "blue" })).toEqual({ text: "CD", color: "red" });
    expect(avatarMark(null, null)).toBeNull();
  });
  it("keeps the project mark's four columns", () => {
    expect(avatarMark(null, { text: "ABCDE", color: "blue" })!.text).toBe("ABCD");
    expect(avatarMark(null, { text: "副总裁", color: "blue" })!.text).toBe("副总");
  });
  it("carried from the project mark's minimum size", () => {
    expect(avatarCarriesMark(PROJECT_MARK_MIN_AVATAR - 1)).toBe(false);
    expect(avatarCarriesMark(PROJECT_MARK_MIN_AVATAR)).toBe(true);
    expect(badgeColor(undefined)).toBe("blue");
    expect(badgeColor("violet")).toBe("#8b5cf6");
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  fx.look.isDirector = false; fx.look.project = null; fx.look.badge = null; fx.minor = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => setUiPref("agentAvatarDefault", "letter"));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const draw = (props: Record<string, unknown> = {}) => act(() => root.render(h(Avatar, { name: "Agent", seed: "s", size: 32, ...props } as never)));
const chip = () => host.querySelector<HTMLElement>("[data-project-mark]");

describe("Avatar: the owner's badge as the mark", () => {
  it("draws the badge exactly as a project mark of the same text would be drawn (place, box, font)", () => {
    for (const [size, text] of [[24, "A"], [32, "挂件"], [40, "ABCD"], [32, "CT副"]] as const) {
      fx.look.isDirector = false; fx.look.project = null; fx.look.badge = { text, tint: "green" };
      draw({ size });
      const badge = chip()!;
      const asBadge = { left: badge.style.left, bottom: badge.style.bottom, height: badge.style.height, font: badge.style.fontSize, family: badge.style.fontFamily, pad: badge.style.padding, text: badge.textContent };
      fx.look.isDirector = true; fx.look.project = { hostId: "local", id: "p", mark: text, color: "green" }; fx.look.badge = null;
      draw({ size });
      const project = chip()!;
      expect({ left: project.style.left, bottom: project.style.bottom, height: project.style.height, font: project.style.fontSize, family: project.style.fontFamily, pad: project.style.padding, text: project.textContent }).toEqual(asBadge);
      expect(badge.style.height).toBe(`${projectMarkHeight(size)}px`);
      expect(badge.style.fontSize).toBe(`${projectMarkFont(projectMarkHeight(size), text).size}px`);
    }
  });
  it("a Director's own badge replaces the project's text on its mark, in the project colour", () => {
    fx.look.isDirector = true; fx.look.project = { hostId: "local", id: "p", mark: "CD", color: "red" }; fx.look.badge = { text: "主管", tint: "blue" };
    draw();
    expect(host.querySelectorAll("[data-project-mark]")).toHaveLength(1);
    expect(chip()!.textContent).toBe("主管");
    expect(chip()!.style.background).toContain("rgb(250, 82, 82)"); // projectColor("red")
  });
  it("an opaque pill in the project colour with black / white ink: no glass, no blur, nothing per theme", () => {
    for (const [color, ink] of [["red", "rgb(0, 0, 0)"], ["magenta", "rgb(255, 255, 255)"], ["#3fa7a3", "rgb(0, 0, 0)"]] as const) {
      fx.look.isDirector = true; fx.look.project = { hostId: "local", id: "p", mark: "WvLn", color }; fx.look.badge = null;
      draw();
      const c = chip()!;
      expect(c.style.backgroundColor || c.style.background).not.toMatch(/gradient|color-mix|transparent/);
      expect(c.style.color).toBe(ink);
      expect(c.style.backdropFilter).toBe("");
      expect(c.getAttribute("style")).not.toMatch(/light-dark|backdrop/);
    }
  });
  it("box sizes are unchanged (no layout shift): place, height, padding per avatar size", () => {
    fx.look.isDirector = true; fx.look.project = { hostId: "local", id: "p", mark: "ctxH", color: "cyan" }; fx.look.badge = null;
    const box = () => { const c = chip()!.style; return [c.left, c.bottom, c.height, c.minWidth, c.padding, c.fontSize, c.borderRadius]; };
    draw({ size: 28 }); expect(box()).toEqual(["-3px", "-2px", "12px", "12px", "0px 4px", "8.5px", "3px"]);
    draw({ size: 32 }); expect(box()).toEqual(["-3px", "-2px", "13px", "13px", "0px 4px", "9px", "3px"]);
    draw({ size: 40 }); expect(box()).toEqual(["-3px", "-2px", "13px", "13px", "0px 4px", "9px", "3px"]);
    draw({ size: 48 }); expect(box()).toEqual(["-3px", "-2px", "14px", "14px", "0px 4px", "9.5px", "3px"]);
    draw({ size: 28, status: { presence: "online" } }); expect(box()).toEqual(["-5px", "-2px", "12px", "12px", "0px 1px", "8.5px", "3px"]);
  });
  it("crowded rules apply with a presence dot (the same as a project mark)", () => {
    fx.look.badge = { text: "ABCD" };
    draw({ size: 28, status: { presence: "online" } });
    expect(chip()!.style.left).toBe("-5px");
    expect(chip()!.style.padding).toBe("0px 1px");
  });
  it("not on small avatars, a minor tile or a cut-out portrait", () => {
    fx.look.badge = { text: "HELP" };
    draw({ size: 20 }); expect(chip()).toBeNull();
    fx.minor = true; draw({ size: 32 }); expect(chip()).toBeNull();
    fx.minor = false; draw({ size: 96, picture: "data:image/png;base64,AA==", cutout: true }); expect(chip()).toBeNull();
    draw({ size: 32 }); expect(chip()!.textContent).toBe("HELP");
  });
});
