// @vitest-environment jsdom
// Design 040 §3.1: components/Avatar draws an agent's status itself (running ring, corner badge, presence) and
// pictures follow 头像底色 (none = nothing behind, 按模型 = the provider colour), all round with the provider outline.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
const look = { color: "#3366cc", themes: ["all"], family: "gemini", isDirector: false, pinned: false, avatarMode: null as "inherit" | "fixed" | null, fixedLetter: false };
let minorDot = false;
vi.mock("../src/renderer/src/lib/agentLook", () => ({ useAgentLook: (seed: string | null | undefined) => (seed ? look : null), useMinorDot: () => minorDot, useProjectStyleWorn: () => new Set() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { Avatar } from "../src/renderer/src/components/Avatar";
import { StatusAvatar } from "../src/renderer/src/components/AgentStatus";
import { setAppAvatarStyle } from "../src/renderer/src/lib/avatarStyle";
import { setUiPref } from "../src/renderer/src/lib/prefs";
import type { AvatarStatus } from "../src/renderer/src/lib/avatarStatus";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setAppAvatarStyle({ kind: "emoji", emojiThemes: null });
  minorDot = false;
  look.avatarMode = null;
  look.fixedLetter = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => setUiPref("avatarTint", "none"));
});

const PIC = "data:image/png;base64,AA==";
const draw = (props: Record<string, unknown>) => act(() => root.render(h(Avatar, { name: "Eva", seed: "s1", size: 38, ...props } as never)));
const q = (sel: string) => host.querySelector<HTMLElement>(sel);

describe("Avatar status", () => {
  it("no status: just the round face, no wrapper", () => {
    draw({});
    expect(host.firstElementChild?.getAttribute("data-avatar")).toBeTruthy();
    expect(host.firstElementChild?.className).toContain("rounded-full");
    expect(q("[data-avatar-status]")).toBeNull();
  });

  it("running: the ring; a badge with its text, cut by --avatar-cut", () => {
    draw({ status: { running: true, badge: { tone: "attention", text: "3" } } satisfies AvatarStatus });
    expect(q("[data-avatar-status]")?.hasAttribute("data-avatar-running")).toBe(true);
    expect(q(".agent-ring")).not.toBeNull();
    const badge = q("[data-avatar-badge='attention']")!;
    expect(badge.textContent).toBe("3");
    expect(badge.style.height).toBe("18px");
    expect(badge.style.background).toBe("var(--attention)");
    expect(badge.style.boxShadow).toContain("var(--avatar-cut, var(--bg))");
  });

  it("a 20 px row avatar shows the count (14 px badge), like the bigger ones (owner 2026-10-23)", () => {
    draw({ size: 20, status: { badge: { tone: "attention", text: "3" } } });
    const badge = q("[data-avatar-badge='attention']")!;
    expect(badge.textContent).toBe("3");
    expect(badge.style.height).toBe("14px");
  });

  it("a 16 px avatar's badge is a dot (no text)", () => {
    draw({ size: 16, status: { badge: { tone: "accent", text: "2" } } });
    const badge = q("[data-avatar-badge='accent']")!;
    expect(badge.textContent).toBe("");
    expect(badge.style.height).toBe("7px");
  });

  it("presence: offline grey, unknown hollow dot with its title, online green dot", () => {
    draw({ status: { presence: "offline" } });
    expect(q("[data-avatar-status]")?.className).toContain("grayscale");
    draw({ status: { presence: "unknown" } });
    expect(q("[data-status-unknown]")?.title).toBe("status.unknown");
    expect(q("[data-avatar-dot='unknown']")).not.toBeNull();
    draw({ status: { presence: "online" } });
    expect(q("[data-avatar-dot='online']")?.style.background).toBe("var(--ok)");
  });

  it("a minor agent is a rounded tile with two letters (never a round dot); running lights the tile's edge", () => {
    minorDot = true;
    draw({ size: 20 });
    const tile = q("[data-avatar='dot'] [data-minor-tile]")!;
    expect(tile.textContent).toBe("Ev");
    expect(tile.style.width).toBe("18px");
    expect(tile.style.borderRadius).toBe("5px");
    expect(tile.className).not.toContain("rounded-full");
    expect(q("[data-minor-tile] .agent-ring-tile")).toBeNull();
    draw({ size: 20, status: { running: true } });
    expect(q("[data-minor-tile] .agent-ring-tile")).not.toBeNull();
    // Only the tile's edge: no round ring around the 20 px slot.
    expect(host.querySelectorAll(".agent-ring").length).toBe(0);
    draw({ size: 16, initial: "Mk" });
    expect(q("[data-minor-tile]")!.style.width).toBe("14px");
    // Two letters down to the 16 px slot (owner 2026-11-01), at the 8 px floor.
    expect(q("[data-minor-tile]")!.textContent).toBe("Mk");
    expect(q("[data-minor-tile]")!.style.fontSize).toBe("8px");
  });
});

describe("an agent without an avatar (owner 2026-10-25; rule A 2026-11-01)", () => {
  // Sidebar row, the Ctrl+B rail / tray, the conversation header, @ chip, delegation / queue chips.
  const SURFACES = [{ size: 20 }, { size: 20, status: { running: true } }, { size: 38 }, { size: 28 }, { size: 16 }] as const;
  const emojiSrc = () => q("[data-avatar='emoji'] img")?.getAttribute("src") ?? null;

  it("draws the same fallback everywhere — the tile on every surface when it is minor, else its own default emoji; never a picture", () => {
    for (const minor of [true, false]) {
      minorDot = minor;
      for (const surface of SURFACES) {
        draw({ avatar: null, ...surface });
        expect(q("[data-avatar]")?.dataset.avatar).toBe(minor ? "dot" : "emoji");
        expect(q("[data-avatar] img[src^='data:image/png']")).toBeNull();
      }
    }
    // Its default emoji comes from its own seed, not from another agent.
    minorDot = false;
    draw({ avatar: null, seed: "s1" });
    const mine = emojiSrc();
    draw({ avatar: { kind: "emoji", value: "🦊" }, seed: "s2", name: "Fox" });
    expect(emojiSrc()).not.toBe(mine);
    draw({ avatar: null, seed: "s1" });
    expect(emojiSrc()).toBe(mine);
  });

  it("an agent with its own avatar draws that one on every surface", () => {
    minorDot = false;
    draw({ avatar: { kind: "emoji", value: "🦊" }, size: 38 });
    const fox = emojiSrc();
    for (const surface of SURFACES) {
      draw({ avatar: { kind: "emoji", value: "🦊" }, ...surface });
      expect(emojiSrc()).toBe(fox);
    }
    draw({ picture: PIC, size: 20 });
    expect(q("[data-avatar='picture'] img")?.getAttribute("src")).toBe(PIC);
  });
});

describe("Avatar pictures and 头像底色", () => {
  it("the box is reserved before a picture loads and is the same one as the letter / emoji stand-in (owner 2026-10-27: no jitter in the 需要你 strip)", () => {
    draw({ picture: PIC, size: 16 });
    const face = q("[data-avatar='picture']")!;
    expect(face.style.width).toBe("16px");
    expect(face.style.height).toBe("16px");
    const img = face.querySelector("img")!;
    expect(img.getAttribute("width")).toBe("16");
    expect(img.getAttribute("height")).toBe("16");
    expect(img.className).toContain("h-full");
    expect(img.className).toContain("w-full");
    expect(img.className).toContain("object-cover");
    draw({ picture: null, seed: "s1", size: 16 });
    const glyph = q("[data-avatar]")!;
    expect(glyph.style.width).toBe("16px");
    expect(glyph.style.height).toBe("16px");
    draw({ seed: null, size: 16 });
    expect(q("[data-avatar='letter']")!.style.width).toBe("16px");
  });

  it("default: no colour behind a picture, the provider outline", () => {
    draw({ picture: PIC });
    const face = q("[data-avatar='picture']")!;
    expect(face.style.background).toBe("transparent");
    expect(face.hasAttribute("data-avatar-tint")).toBe(false);
    expect(face.querySelector<HTMLElement>("[data-avatar-edge]")!.style.boxShadow).toContain("var(--prov-gemini)");
  });

  it("按模型: the provider colour behind it and as its ring", () => {
    act(() => setUiPref("avatarTint", "provider"));
    draw({ picture: PIC });
    const face = q("[data-avatar='picture']")!;
    expect(face.getAttribute("data-avatar-tint")).toBe("gemini");
    expect(face.style.background).toContain("var(--prov-gemini) 16%");
    // The same single outline as 无: the backdrop is all 按模型 adds (no double ring).
    const edges = face.querySelectorAll<HTMLElement>("[data-avatar-edge]");
    expect(edges).toHaveLength(1);
    act(() => setUiPref("avatarTint", "none"));
    draw({ picture: PIC });
    expect(q("[data-avatar='picture'] [data-avatar-edge]")!.style.boxShadow).toBe(edges[0]!.style.boxShadow);
  });

  it("按模型 leaves emoji / letter avatars on their Profile colour", () => {
    act(() => setUiPref("avatarTint", "provider"));
    draw({ seed: null });
    const face = q("[data-avatar='letter']")!;
    expect(face.hasAttribute("data-avatar-tint")).toBe(false);
  });
});

describe("StatusAvatar maps a sidebar signal", () => {
  const status = (signal: string, extra: Record<string, unknown> = {}) => {
    act(() => root.render(h(StatusAvatar, { name: "Eva", seed: "s1", size: 38, signal, ...extra } as never)));
    return q("[data-avatar-status]");
  };
  it("running → ring; offline → grey; unknown → hollow dot; idle → plain", () => {
    expect(status("running")?.hasAttribute("data-avatar-running")).toBe(true);
    expect(status("offline")?.getAttribute("data-avatar-presence")).toBe("offline");
    expect(status("unknown")?.hasAttribute("data-status-unknown")).toBe(true);
    expect(status("idle")).toBeNull();
    expect(status("needsYou", { running: true, badge: { tone: "attention", text: "?" } })?.textContent).toBe("?");
  });
});

 describe("session follow intent", () => {
   const mode = (avatarMode: "inherit" | "fixed", avatar: unknown = null) => { look.avatarMode = avatarMode; look.fixedLetter = avatarMode === "fixed" && !avatar; };
   it("inherit ignores a stale stored avatar and follows current emoji/letter style without writes", () => {
     mode("inherit", { kind: "emoji", value: "OLD" });
     act(() => setAppAvatarStyle({ kind: "emoji", emojiThemes: ["sea"] }));
     draw({ avatar: { kind: "emoji", value: "OLD" }, picture: PIC });
     expect(q("[data-avatar='picture']")).toBeNull();
     expect(q("[data-avatar='emoji']")).not.toBeNull();
     expect(host.textContent).not.toContain("OLD");
     act(() => setAppAvatarStyle({ kind: "letter" }));
     draw({ avatar: { kind: "emoji", value: "OLD" } });
     expect(q("[data-avatar='letter']")).not.toBeNull();
   });
   it("fixed empty remains a letter while the app style changes", () => {
     mode("fixed");
     act(() => setAppAvatarStyle({ kind: "emoji", emojiThemes: ["animals"] }));
     draw({ avatar: null });
     expect(q("[data-avatar='letter']")).not.toBeNull();
     act(() => setAppAvatarStyle({ kind: "emoji", emojiThemes: ["sea"] }));
     draw({ avatar: null });
     expect(q("[data-avatar='letter']")).not.toBeNull();
   });
 });
