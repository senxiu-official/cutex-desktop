// @vitest-environment jsdom
// Owner 2026-11-01 (sidebar screenshot: Wren a portrait, Pipit / Moth / review-insert-sol look-alike P / M / R tiles): an agent
// without its own avatar shows a two-letter tile with no colour fill — only the provider frame — and an agent's avatar is the
// same in every place and state (rule A): big or small row, running or idle, header, messages, strips. Real lib/agentLook.
import { act, createElement as h, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";

vi.mock("../src/renderer/src/i18n", async (original) => ({
  ...(await original<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
// The enabled themes always have a picture to offer: before rule A a big row / the header drew it for a minor agent.
vi.mock("../src/renderer/src/lib/portraitPacks", () => ({
  usePortraitPacks: () => ({ index: null }), portraitRefOf: () => null,
  portraitFor: (_index: unknown, avatar: unknown, seed: unknown, _family: unknown, themes: readonly string[]) => (!avatar && seed && themes.length ? { picture: "p" } : null),
  usePortraitImage: (picture: string | undefined) => (picture ? "data:image/png;base64,cG9ydHJhaXQ=" : null),
}));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  return { useApp: create(() => ({ sidebar: null, byHost: {}, hosts: { active: "local" }, pinned: new Set<string>() })), featuresOf: () => new Set(), pinnedOn: () => new Set() };
});

import { useApp } from "../src/renderer/src/store";
import { Avatar } from "../src/renderer/src/components/Avatar";
import { StatusAvatar } from "../src/renderer/src/components/AgentStatus";
import { setAppAvatarStyle } from "../src/renderer/src/lib/avatarStyle";
import { setUiPref } from "../src/renderer/src/lib/prefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (id: string, name: string, day: number, over: Partial<SessionResource> = {}): SessionResource =>
  ({ cutexSessionId: id, displayName: name, profile: "omega", configuredProfile: "omega", launchedProfile: "omega", runtime: { backend: "codex", status: "online" },
    runtimeDefaults: null, native: { threadId: null, schema: null }, avatar: null, createdAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`, ...over }) as SessionResource;
const FOX = { kind: "emoji", value: "🦊" } as const;
const AGENTS = [session("pipit", "Pipit", 1), session("moth", "Moth", 2), session("sol", "review-insert-sol", 3), session("opus", "review-insert-opus", 4),
  session("wren", "Wren", 5), session("lead", "ui-lead", 6, { avatar: FOX }), session("pixel", "Pixel", 7)];

let host: HTMLDivElement;
let root: Root;
const q = (sel: string) => host.querySelector<HTMLElement>(sel);
beforeEach(() => {
  setUiPref("agentAvatarDefault", "important");
  setAppAvatarStyle({ kind: "portrait", portraitThemes: ["p/beach"] });
  useApp.setState({ sidebar: { active: AGENTS, retired: [], projects: null, hostRows: {} }, byHost: {}, hosts: { active: "local" }, pinned: new Set() } as never);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

type Surface = (seed: string, name: string, avatar?: SessionResource["avatar"]) => ReactElement;
// The places an agent is drawn: sidebar small / big rows (StatusAvatar 16 / 20 / 38), the Rail / tray (20 running),
// the conversation header (28), messages / peers (16, plain Avatar), the dock (32 running).
const SURFACES: [string, Surface][] = [
  ["small row idle", (seed, name, avatar) => h(StatusAvatar, { name, seed, avatar, size: 20, signal: "idle" })],
  ["small row 16", (seed, name, avatar) => h(StatusAvatar, { name, seed, avatar, size: 16, signal: "idle" })],
  ["big row running", (seed, name, avatar) => h(StatusAvatar, { name, seed, avatar, size: 38, signal: "running", running: true })],
  ["tray running", (seed, name, avatar) => h(StatusAvatar, { name, seed, avatar, size: 20, signal: "running" })],
  ["header", (seed, name, avatar) => h(Avatar, { name, seed, avatar, size: 28 })],
  ["message", (seed, name, avatar) => h(Avatar, { name, seed, avatar, size: 16 })],
  ["dock", (seed, name, avatar) => h(Avatar, { name, seed, avatar, size: 32, status: { running: true } })],
];
const draw = (el: ReactElement) => act(() => root.render(el));

describe("rule A: the same avatar everywhere", () => {
  it.each(SURFACES)("an agent without its own avatar is its tile — %s", (_, el) => {
    draw(el("pipit", "Pipit"));
    expect(q("[data-avatar]")!.dataset.avatar).toBe("dot");
    expect(q("[data-minor-tile]")!.textContent).toBe("Pi");
    expect(q("[data-avatar] img")).toBeNull();
  });

  it.each(SURFACES)("an agent with its own avatar shows it — %s", (_, el) => {
    draw(el("lead", "ui-lead", FOX));
    expect(q("[data-avatar]")!.dataset.avatar).toBe("emoji");
    expect(q("[data-minor-tile]")).toBeNull();
  });

  it("pinned agents keep their default avatar everywhere (never a tile in some places)", () => {
    useApp.setState({ pinned: new Set(["wren"]) } as never);
    for (const [, el] of SURFACES) {
      draw(el("wren", "Wren"));
      expect(q("[data-avatar]")!.dataset.avatar).toBe("picture");
    }
  });

  it("the caller's initial does not change an agent's letters (a header without the row = the row with it)", () => {
    draw(h(Avatar, { name: "Pipit", seed: "pipit", size: 28, initial: "P" }));
    expect(q("[data-minor-tile]")!.textContent).toBe("Pi");
  });

  it("the owner's sidebar gets distinct letters; a clash in the list goes to the newer agent", () => {
    const letters = AGENTS.filter((a) => !a.avatar).map((a) => {
      draw(h(Avatar, { name: a.displayName, seed: a.cutexSessionId, size: 20 }));
      return q("[data-minor-tile]")!.textContent;
    });
    expect(letters).toEqual(["Pi", "Mo", "RS", "RO", "Wr", "Px"]);
  });
});

describe("the letter tile has no fill", () => {
  it.each([16, 20, 28, 40])("a neutral surface and ink; the model shows only in its frame (%i px)", (size) => {
    draw(h(Avatar, { name: "Moth", seed: "moth", size, color: "#e64980" }));
    const tile = q("[data-minor-tile]")!;
    expect(tile.style.background).toBe("var(--surface)");
    expect(tile.getAttribute("style")).not.toContain("e64980");
    expect(tile.style.boxShadow).toMatch(/^inset 0 0 0 1px color-mix\(in oklab, var\(--prov-\w+\) 85%, transparent\)$/);
    expect(tile.className).not.toContain("rounded-full");
    expect(tile.textContent).toBe("Mo");
  });

  it("默认头像 = 字母: an agent without its own avatar draws the same tile (no Profile-colour circle)", () => {
    setAppAvatarStyle({ kind: "letter" });
    setUiPref("agentAvatarDefault", "letter");
    draw(h(Avatar, { name: "Wren", seed: "wren", size: 28, color: "#e64980" }));
    expect(q("[data-avatar]")!.dataset.avatar).toBe("letter");
    expect(q("[data-minor-tile]")!.style.background).toBe("var(--surface)");
    expect(q("[data-minor-tile]")!.textContent).toBe("Wr");
  });

  it("people (no seed) keep the round letter on their colour", () => {
    draw(h(Avatar, { name: "sam", size: 28, color: "#868e96", initial: "S" }));
    const face = q("[data-avatar='letter']")!;
    expect(face.className).toContain("rounded-full");
    expect(face.textContent).toBe("S");
    expect(q("[data-minor-tile]")).toBeNull();
  });
});

describe("idle ↔ busy box", () => {
  it.each([16, 20, 28, 40])("the tile keeps its slot and size; running only lights its edge (%i px)", (size) => {
    draw(h(StatusAvatar, { name: "Pipit", seed: "pipit", size, signal: "idle" }));
    const box = () => ({ slot: q("[data-avatar]")!.style.width, tile: q("[data-minor-tile]")!.style.width, cls: q("[data-minor-tile]")!.className, edge: q("[data-minor-tile]")!.style.boxShadow });
    const idle = box();
    draw(h(StatusAvatar, { name: "Pipit", seed: "pipit", size, signal: "running" }));
    expect(box()).toEqual(idle);
    expect(idle.slot).toBe(`${size}px`);
    expect(q("[data-minor-tile] .agent-ring-tile")).not.toBeNull();
    expect(host.querySelector(".agent-ring")).toBeNull();
  });
});
