// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (original) => ({
  ...(await original<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
const look = { color: "#3366cc", family: "claude", themes: ["all"], isDirector: true, isOperator: true, pinned: false, project: null };
let minor = false;
vi.mock("../src/renderer/src/lib/agentLook", () => ({
  useAgentLook: () => look, useMinorDot: () => minor, useProjectStyleWorn: () => new Set(),
}));
const PACK = "data:image/png;base64,cG9ydHJhaXQ=";
vi.mock("../src/renderer/src/lib/portraitPacks", () => ({
  usePortraitPacks: () => ({ index: null }), portraitRefOf: () => null,
  portraitFor: () => ({ picture: "horned-portrait" }), usePortraitImage: () => PACK,
}));

import { Avatar } from "../src/renderer/src/components/Avatar";
import { setUiPref } from "../src/renderer/src/lib/prefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const draw = (props: Record<string, unknown> = {}) => act(() => root.render(h(Avatar, { name: "Aria", seed: "agent", size: 40, ...props } as never)));
beforeEach(() => {
  minor = false;
  setUiPref("avatarTint", "none");
  setUiPref("directorHeadwear", "crown");
  setUiPref("seasonalHeadwear", false);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("busy portrait circular frame", () => {
  it.each([16, 20, 28, 32, 40, 72])("clips the portrait inside the ring at %ipx and leaves badges outside", (size) => {
    draw({ size, status: { running: true, presence: "online", badge: { tone: "attention", text: "3" } } });
    const face = host.querySelector<HTMLElement>("[data-avatar='picture']")!;
    expect(face.dataset.avatarFrame).toBe("claude");
    expect(face.classList.contains("overflow-hidden")).toBe(true);
    expect(face.classList.contains("rounded-full")).toBe(true);
    expect(face.style.width).toBe(`${size}px`);
    expect(face.querySelector("img")?.className).toContain("object-contain");
    expect(face.querySelector<HTMLElement>("[data-avatar-edge]")?.style.boxShadow).toContain("var(--prov-claude)");
    expect(host.querySelector("[data-operator-mark]")).toBeNull(); // owner 2026-11-01: no Operator chip
    for (const selector of [".agent-ring", "[data-avatar-badge]", "[data-avatar-dot]"]) {
      const mark = host.querySelector(selector)!;
      expect(mark).not.toBeNull();
      expect(face.contains(mark)).toBe(false);
    }
  });

  it("keeps one image and fixed dimensions through busy/idle changes; idle pack portraits wear the same frame (2026-11-01)", () => {
    draw();
    const face = host.querySelector<HTMLElement>("[data-avatar='picture']")!;
    const image = face.querySelector("img");
    expect(face.classList.contains("overflow-hidden")).toBe(true);
    expect(face.querySelector("[data-avatar-edge]")).not.toBeNull();
    draw({ status: { running: true } });
    const busy = host.querySelector<HTMLElement>("[data-avatar-running] [data-avatar='picture']")!;
    const busyImage = busy.querySelector("img");
    expect(busyImage?.getAttribute("src")).toBe(image?.getAttribute("src"));
    // Within an existing status frame, running changes do not replace the face or image.
    draw({ status: { presence: "online" } });
    expect(host.querySelector("[data-avatar='picture'] img")).toBe(busyImage);
    expect(host.querySelector(".agent-ring")).toBeNull();
    expect(host.querySelector("[data-avatar='picture']")?.classList.contains("overflow-hidden")).toBe(true);
  });

  it("uses the selected provider tint for the subtle border too", () => {
    setUiPref("avatarTint", "provider");
    draw({ status: { running: true } });
    const face = host.querySelector<HTMLElement>("[data-avatar='picture']")!;
    expect(face.dataset.avatarTint).toBe("claude");
    expect(face.querySelectorAll("[data-avatar-edge]")).toHaveLength(1);
    expect(face.querySelector<HTMLElement>("[data-avatar-edge]")?.style.boxShadow).toContain("var(--prov-claude)");
  });

  it("keeps role headwear separate from the portrait clip", () => {
    draw({ status: { running: true } });
    const face = host.querySelector("[data-avatar='picture']")!;
    const crown = host.querySelector("[data-headwear='crown']")!;
    expect(crown).not.toBeNull();
    expect(face.contains(crown)).toBe(false);
  });

  it("retains the minor tile edge rather than adding a circular ring", () => {
    minor = true;
    draw({ size: 20, status: { running: true } });
    expect(host.querySelector(".agent-ring-tile")).not.toBeNull();
    expect(host.querySelector(".agent-ring")).toBeNull();
    expect(host.querySelector("[data-minor-tile]")?.classList.contains("rounded-full")).toBe(false);
  });

  it("leaves large cutout agent tiles unframed because they draw no busy ring", () => {
    draw({ cutout: true, size: 96, status: { running: true } });
    expect(host.querySelector("[data-avatar='cutout']")).not.toBeNull();
    expect(host.querySelector(".agent-ring")).toBeNull();
    expect(host.querySelector("[data-avatar-frame]")).toBeNull();
  });
});
