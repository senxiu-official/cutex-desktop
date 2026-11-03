// @vitest-environment jsdom
// 拟人头像包 in components/Avatar (040 §3.2): a stored pack picture shows (or its stand-in when the pack lost it), an
// agent without an avatar wears the chosen theme's pick, 不用 = today's look, an emoji avatar is never replaced.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "zh-CN" }),
}));
const worn = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
vi.mock("../src/renderer/src/lib/agentLook", () => ({
  useAgentLook: (seed: string | null | undefined) => (seed ? { color: "#3366cc", themes: ["all"], family: "kimi", isDirector: false, pinned: false } : null),
  useMinorDot: () => false,
  useProjectStyleWorn: () => worn.keys,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { Avatar } from "../src/renderer/src/components/Avatar";
import { setAppAvatarStyle } from "../src/renderer/src/lib/avatarStyle";
import { indexPacks, packOf, pickForNewAgent, resetPortraitPacksForTest } from "../src/renderer/src/lib/portraitPacks";
import { parsePackManifest, portraitAvatarOf } from "../src/shared/portraitPacks";

const entries = ["claude", "kimi"].flatMap((model) => [1, 2].map((v) => ({ theme: "beach", model, avatarPath: `avatars/beach/${model}-v${v}.webp`, previewPath: `previews/beach/${model}-v${v}.webp` })));
const PACK = packOf("p", parsePackManifest({ schemaVersion: 1, entries })!, "bundled", (path) => `/packs/p/${path}`);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetPortraitPacksForTest([PACK]);
  setAppAvatarStyle({ kind: "emoji", emojiThemes: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => setAppAvatarStyle({ kind: "emoji", emojiThemes: null }));
  resetPortraitPacksForTest();
});

const draw = (props: Record<string, unknown>) => act(() => root.render(h(Avatar, { name: "Eva", seed: "agent-1", size: 40, ...props } as never)));
const img = () => host.querySelector("img")?.getAttribute("src") ?? null;

describe("Avatar with 拟人头像包", () => {
  it("不用 (default): an agent without an avatar keeps today's look", () => {
    draw({});
    expect(host.querySelector("[data-avatar]")?.getAttribute("data-avatar")).not.toBe("picture");
  });

  it("a theme enabled: an agent without an avatar wears its family's pick (full picture at 40 px, preview at 20 px)", () => {
    act(() => setAppAvatarStyle({ kind: "portrait", portraitThemes: ["p/beach"] }));
    draw({});
    expect(img()).toMatch(/^\/packs\/p\/avatars\/beach\/kimi-v[12]\.webp$/);
    expect(host.querySelector("img")?.classList.contains("object-contain")).toBe(true);
    // Idle pack portraits wear the circle frame too (owner 2026-11-01, test/avatarIdleFrame).
    expect(host.querySelector("[data-avatar]")?.classList.contains("overflow-hidden")).toBe(true);
    draw({ size: 20 });
    expect(img()).toMatch(/^\/packs\/p\/previews\/beach\/kimi-v[12]\.webp$/);
  });

  it("a stored picture shows as itself; a gone one shows a stand-in of its family, never a broken path", () => {
    draw({ avatar: portraitAvatarOf({ pack: "p", theme: "beach", stem: "claude-v2" }) });
    expect(img()).toBe("/packs/p/avatars/beach/claude-v2.webp");
    draw({ avatar: portraitAvatarOf({ pack: "p", theme: "beach", stem: "claude-v9" }) });
    expect(img()).toMatch(/^\/packs\/p\/avatars\/beach\/claude-v[12]\.webp$/);
    // Nothing installed fits: the default (emoji / letter), not a picture.
    draw({ avatar: portraitAvatarOf({ pack: "gone", theme: "x", stem: "glm-v1" }) });
    expect(host.querySelector("[data-avatar]")?.getAttribute("data-avatar")).not.toBe("picture");
  });

  it("a new agent: drawn before its avatar is stored with the very picture it gets (a teammate wears the hash pick) — no switch", () => {
    act(() => setAppAvatarStyle({ kind: "portrait", portraitThemes: ["p/beach"] }));
    draw({});
    const hashPick = img()!;
    // A project member stores that picture: the new agent's pick skips it, drawn and stored alike.
    worn.keys = new Set([`p/beach/${hashPick.split("/").pop()!.replace(".webp", "")}`]);
    draw({});
    const before = img();
    expect(before).not.toBe(hashPick);
    const stored = pickForNewAgent(indexPacks([PACK]), ["p/beach"], "kimi", "agent-1", worn.keys);
    draw({ avatar: stored });
    expect(img()).toBe(before);
    worn.keys = new Set();
  });

  it("an emoji avatar stays an emoji whatever theme is chosen", () => {
    act(() => setAppAvatarStyle({ kind: "portrait", portraitThemes: ["p/beach"] }));
    draw({ avatar: { kind: "emoji", value: "🦊" } });
    expect(host.querySelector("[data-avatar]")?.getAttribute("data-avatar")).toBe("emoji");
  });
});
