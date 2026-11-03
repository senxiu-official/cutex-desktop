// @vitest-environment jsdom
// Owner 2026-11-01: idle avatars wear the busy frame — every round face (picture, pack portrait, emoji, letter) is
// clipped to its circle with a 1 px outline in the agent's provider colour; busy only adds the ring outside it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (original) => ({
  ...(await original<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
const look: Record<string, unknown> = {};
let minor = false;
vi.mock("../src/renderer/src/lib/agentLook", () => ({
  useAgentLook: (seed: string | null | undefined) => (seed ? look : null), useMinorDot: () => minor, useProjectStyleWorn: () => new Set(),
}));
const PACK = "data:image/png;base64,cG9ydHJhaXQ=";
let pack: string | null = null;
vi.mock("../src/renderer/src/lib/portraitPacks", () => ({
  usePortraitPacks: () => ({ index: null }), portraitRefOf: () => null,
  portraitFor: () => (pack ? { picture: "p" } : null), usePortraitImage: () => pack,
}));

import { Avatar } from "../src/renderer/src/components/Avatar";
import { setAppAvatarStyle } from "../src/renderer/src/lib/avatarStyle";
import { providerTint } from "../src/renderer/src/lib/avatarThemes";
import { setUiPref } from "../src/renderer/src/lib/prefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const PIC = "data:image/png;base64,cGljdHVyZQ==";
const SIZES = [16, 20, 28, 32, 40, 72];
let host: HTMLDivElement;
let root: Root;
const draw = (props: Record<string, unknown> = {}) => act(() => root.render(h(Avatar, { name: "Aria", seed: "agent", size: 28, ...props } as never)));
const face = () => host.querySelector<HTMLElement>("[data-avatar]")!;
const edgeOf = (el: Element) => el.querySelector<HTMLElement>("[data-avatar-edge]")?.style.boxShadow ?? null;
beforeEach(() => {
  for (const k of Object.keys(look)) delete look[k];
  Object.assign(look, { color: "#3366cc", family: "claude", tint: "claude", themes: ["all"], isDirector: false, isOperator: false, pinned: false, project: null });
  minor = false;
  pack = null;
  setAppAvatarStyle({ kind: "emoji", emojiThemes: null });
  setUiPref("avatarTint", "none");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); setUiPref("avatarTint", "none"); });

describe("idle avatar frame", () => {
  const kinds: [string, () => void, Record<string, unknown>][] = [
    ["picture", () => {}, { picture: PIC }],
    ["picture", () => { pack = PACK; }, {}],
    ["emoji", () => {}, {}],
  ];
  it.each(kinds)("an idle %s face is clipped to the circle with one provider outline", (kind, setup, props) => {
    setup();
    draw(props);
    const el = face();
    expect(el.dataset.avatar).toBe(kind);
    expect(el.classList.contains("overflow-hidden")).toBe(true);
    expect(el.classList.contains("rounded-full")).toBe(true);
    expect(el.dataset.avatarFrame).toBe("claude");
    expect(el.querySelectorAll("[data-avatar-edge]")).toHaveLength(1);
    expect(edgeOf(el)).toMatch(/^inset 0 0 0 1px color-mix\(in oklab, var\(--prov-claude\) \d+%, transparent\)$/);
    expect(host.querySelector(".agent-ring")).toBeNull();
  });

  it.each(["claude", "openai", "gemini", "deepseek", "kimi", "glm", "qwen", "other"])("outline colour: --prov-%s", (tint) => {
    look.tint = tint;
    draw();
    expect(face().dataset.avatarFrame).toBe(tint);
    expect(edgeOf(face())).toContain(`var(--prov-${tint})`);
  });

  it("falls back to the family when a look has no tint, and to a neutral hairline for an unknown sender", () => {
    delete look.tint;
    look.family = "glm";
    draw();
    expect(edgeOf(face())).toContain("var(--prov-glm)");
    draw({ seed: null });
    expect(face().dataset.avatarFrame).toBeUndefined();
    expect(edgeOf(face())).toContain("var(--fg)");
  });

  it("is softer under 24 px (a hairline in 16–20 px rows)", () => {
    draw({ size: 20 });
    const small = edgeOf(face())!;
    draw({ size: 28 });
    const large = edgeOf(face())!;
    const pct = (s: string) => Number(/(\d+)%/.exec(s)![1]);
    expect(pct(small)).toBeLessThan(pct(large));
  });

  it.each(SIZES)("idle and busy share the same face box and frame at %ipx", (size) => {
    pack = PACK;
    draw({ size });
    const idle = face();
    const idleBox = { cls: idle.className, w: idle.style.width, h: idle.style.height, edge: edgeOf(idle) };
    draw({ size, status: { running: true } });
    const busy = face();
    expect(host.querySelector(".agent-ring")).not.toBeNull();
    expect({ cls: busy.className, w: busy.style.width, h: busy.style.height, edge: edgeOf(busy) }).toEqual(idleBox);
    expect(idleBox.w).toBe(`${size}px`);
    expect(idleBox.h).toBe(`${size}px`);
    // The ring is drawn outside the face, not as part of it.
    expect(busy.contains(host.querySelector(".agent-ring"))).toBe(false);
    draw({ size, status: { running: false, presence: "online" } });
    expect(face().className).toBe(idleBox.cls);
    expect(edgeOf(face())).toBe(idleBox.edge);
  });

  it("头像底色: 按模型 only adds the backdrop behind a picture — same single outline as 无; emoji / letters unchanged", () => {
    draw({ picture: PIC });
    const none = edgeOf(face());
    expect(face().style.background).toBe("transparent");
    act(() => setUiPref("avatarTint", "provider"));
    draw({ picture: PIC });
    expect(face().style.background).toContain("var(--prov-claude) 16%");
    expect(face().dataset.avatarTint).toBe("claude");
    expect(face().querySelectorAll("[data-avatar-edge]")).toHaveLength(1);
    expect(edgeOf(face())).toBe(none);
    draw();
    expect(face().dataset.avatar).toBe("emoji");
    expect(face().dataset.avatarTint).toBeUndefined();
    expect(edgeOf(face())).toBe(none);
  });

  it("an agent's letter face is the square tile with the (stronger) outline; a person's letter stays round", () => {
    setAppAvatarStyle({ kind: "letter" });
    draw({ size: 28 });
    expect(face().dataset.avatar).toBe("letter");
    const tile = host.querySelector<HTMLElement>("[data-minor-tile]")!;
    expect(tile.classList.contains("rounded-full")).toBe(false);
    expect(tile.dataset.avatarFrame).toBe("claude");
    expect(tile.style.boxShadow).toBe("inset 0 0 0 1px color-mix(in oklab, var(--prov-claude) 85%, transparent)");
    draw({ size: 28, seed: null });
    expect(face().classList.contains("rounded-full")).toBe(true);
    expect(face().querySelectorAll("[data-avatar-edge]")).toHaveLength(1);
  });

  it("the minor tile keeps its square shape and gets the outline; cut-outs stay unframed", () => {
    minor = true;
    draw({ size: 20 });
    const tile = host.querySelector<HTMLElement>("[data-minor-tile]")!;
    expect(tile.classList.contains("rounded-full")).toBe(false);
    expect(tile.style.boxShadow).toContain("var(--prov-claude)");
    minor = false;
    draw({ cutout: true, size: 96, picture: PIC });
    expect(host.querySelector("[data-avatar='cutout']")).not.toBeNull();
    expect(host.querySelector("[data-avatar-edge]")).toBeNull();
  });
});

describe("providerTint", () => {
  it.each([
    [{ cliKind: "claude" }, "claude"],
    [{ model: "gpt-5.5" }, "openai"],
    [{ model: "gpt-5.3-codex" }, "openai"],
    [{ model: "gemini-3-pro" }, "gemini"],
    [{ model: "deepseek-ai/deepseek-v4" }, "deepseek"],
    [{ model: "kimi-k3" }, "kimi"],
    [{ model: "glm-5" }, "glm"],
    [{ model: "qwen3-coder-plus" }, "qwen"],
    [{ model: "dashscope/qwq-32b" }, "qwen"],
    [{ model: "mistral-large" }, "other"],
    [{}, "other"],
  ] as const)("%o → %s", (p, tint) => {
    expect(providerTint(p)).toBe(tint);
  });
});
