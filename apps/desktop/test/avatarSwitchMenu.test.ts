// @vitest-environment jsdom
// 默认头像 = 仅重要智能体: the agent menu's 显示头像 / 隐藏头像 (owner 2026-10-18) — which agents get it,
// the capability gate, and what it writes through cutex/session/metadata/update.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionAvatar, SessionResource } from "@cutex-desktop/protocol";
import { normalizeEntries, type MenuAction, type MenuEntry } from "../src/renderer/src/lib/contextMenu";
import { themedEmoji } from "../src/renderer/src/lib/avatarThemes";
import { packOf, resetPortraitPacksForTest } from "../src/renderer/src/lib/portraitPacks";
import { parsePackManifest } from "../src/shared/portraitPacks";

const entries = ["claude", "kimi"].flatMap((model) => [1, 2].map((v) => ({ theme: "beach", model, avatarPath: `avatars/beach/${model}-v${v}.webp`, previewPath: `previews/beach/${model}-v${v}.webp` })));
const PACK = packOf("p", parsePackManifest({ schemaVersion: 1, entries })!, "bundled", (path) => `/packs/p/${path}`);

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, onEvent: () => () => {} }));

const t = ((key: string) => key) as never;
const sessionAction = vi.fn(async () => ({}));

function session(id: string, avatar: SessionAvatar | null = null, lifecycle = "active", claude = false): SessionResource {
  return { cutexSessionId: id, displayName: id, lifecycle, revision: 3, avatar, runtime: { status: "offline", activeTurnId: null, ...(claude ? { claudeRuntime: {} } : {}) } } as unknown as SessionResource;
}

async function seed(opts: { portraits?: string[]; features?: string[]; mode?: "emoji" | "letter" | "important"; pinned?: string[]; director?: string; sessions: SessionResource[] }) {
  const { useApp } = await import("../src/renderer/src/store");
  const prefs = await import("../src/renderer/src/lib/prefs");
  prefs.setUiPref("agentAvatarDefault", opts.mode ?? "important");
  const { setAppAvatarStyle } = await import("../src/renderer/src/lib/avatarStyle");
  setAppAvatarStyle(opts.portraits?.length ? { kind: "portrait", portraitThemes: opts.portraits } : opts.mode === "letter" ? { kind: "letter" } : { kind: "emoji", emojiThemes: null });
  useApp.setState({
    features: new Set(opts.features ?? ["session-metadata"]),
    pinned: new Set(opts.pinned ?? []),
    sidebar: {
      active: opts.sessions,
      retired: [],
      hostRows: {},
      projects: opts.director ? { schema: "x", projects: [{ project_id: "p", director_cutex_session_id: opts.director }] } : null,
    } as never,
    sessionAction: sessionAction as never,
  });
}

const actions = (entries: MenuEntry[]) => normalizeEntries(entries).filter((e): e is MenuAction => e !== "separator");
const labels = (entries: MenuEntry[]) => actions(entries).map((e) => e.label);
const SWITCH = ["menu.showAvatar", "menu.hideAvatar"];
const switchOf = (entries: MenuEntry[]) => labels(entries).filter((l) => SWITCH.includes(l));

describe("agent menu: 显示头像 / 隐藏头像", () => {
  beforeEach(() => sessionAction.mockClear());

  it("resetting an own picture requires the explicit submenu confirmation", async () => {
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const own = session("own", { kind: "icon", value: "desktop-picture:mine" });
    await seed({ sessions: [own], mode: "emoji" });
    const reset = actions(agentMenu(own, t, "local")).find((entry) => entry.label === "avatarStyle.reset")!;
    expect(reset).toBeTruthy();
    reset.onSelect?.();
    expect(sessionAction).not.toHaveBeenCalled();
    expect(Array.isArray(reset.submenu)).toBe(true);
    const confirm = (reset.submenu as MenuAction[])[0]!;
    confirm.onSelect?.();
    await vi.waitFor(() => expect(sessionAction).toHaveBeenCalledOnce());
    expect((sessionAction.mock.calls[0] as unknown[])[2]).toMatchObject({ avatar: { kind: "emoji" } });
  });

  it("a confirmed style reset preserves an own circle colour where supported", async () => {
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const own = session("tinted-reset", { kind: "emoji", value: "🦄", color: "#AABBCC" });
    await seed({ sessions: [own], mode: "emoji", features: ["session-metadata", "agent-avatar-color"] });
    const reset = actions(agentMenu(own, t, "local")).find((entry) => entry.label === "avatarStyle.reset")!;
    (reset.submenu as MenuAction[])[0]!.onSelect?.();
    await vi.waitFor(() => expect(sessionAction).toHaveBeenCalledOnce());
    expect((sessionAction.mock.calls[0] as unknown[])[2]).toMatchObject({ avatar: { kind: "emoji", color: "#aabbcc" } });
  });

  it("a dot agent → 显示头像; an emoji / icon avatar → 隐藏头像", async () => {
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const plain = session("plain");
    const fox = session("fox", { kind: "emoji", value: "🦊" });
    const tinted = session("tinted", { kind: "color", value: "#40c057" });
    await seed({ sessions: [plain, fox, tinted] });
    expect(switchOf(agentMenu(plain, t, "local"))).toEqual(["menu.showAvatar"]);
    expect(switchOf(agentMenu(tinted, t, "local"))).toEqual(["menu.showAvatar"]);
    expect(switchOf(agentMenu(fox, t, "local"))).toEqual(["menu.hideAvatar"]);
  });

  it("nothing for Directors, pinned agents, pictures, archived agents, other modes or older cutex", async () => {
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const dir = session("dir");
    const pin = session("pin", { kind: "emoji", value: "🦊" });
    const pic = session("pic", { kind: "icon", value: "desktop-picture:01234567-89ab-cdef-0123-456789abcdef" });
    const old = session("old", null, "retired");
    const plain = session("plain");
    await seed({ sessions: [dir, pin, pic, plain], director: "dir", pinned: ["pin"] });
    expect(switchOf(agentMenu(dir, t, "local"))).toEqual([]);
    expect(switchOf(agentMenu(pin, t, "local"))).toEqual([]);
    expect(switchOf(agentMenu(pic, t, "local"))).toEqual([]);
    expect(switchOf(agentMenu(old, t, "local"))).toEqual([]);
    await seed({ sessions: [plain], mode: "emoji" });
    expect(switchOf(agentMenu(plain, t, "local"))).toEqual([]);
    await seed({ sessions: [plain], mode: "letter" });
    expect(switchOf(agentMenu(plain, t, "local"))).toEqual([]);
    await seed({ sessions: [plain], features: [] });
    expect(switchOf(agentMenu(plain, t, "local"))).toEqual([]);
    // 编辑信息 stays either way.
    expect(labels(agentMenu(plain, t, "local"))).toContain("menu.editInfo");
  });

  it("显示头像 writes the theme default emoji; 隐藏头像 clears it", async () => {
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const plain = session("plain");
    const fox = session("fox", { kind: "emoji", value: "🦊" });
    await seed({ sessions: [plain, fox] });
    actions(agentMenu(plain, t, "local")).find((e) => e.label === "menu.showAvatar")!.onSelect();
    await vi.waitFor(() => expect(sessionAction).toHaveBeenCalledTimes(1));
    // Not in a loaded Profile list → every theme (the whole set), exactly what Avatar draws for it.
    expect(sessionAction).toHaveBeenLastCalledWith("plain", "cutex/session/metadata/update", { avatar: { kind: "emoji", value: themedEmoji("plain").glyph }, expectedRevision: 3 }, "local");
    actions(agentMenu(fox, t, "local")).find((e) => e.label === "menu.hideAvatar")!.onSelect();
    await vi.waitFor(() => expect(sessionAction).toHaveBeenCalledTimes(2));
    expect(sessionAction).toHaveBeenLastCalledWith("fox", "cutex/session/metadata/update", { avatar: null, expectedRevision: 3 }, "local");
  });

  it("显示头像 keeps an own colour on the emoji where the host combines (agent-avatar-color)", async () => {
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const tinted = session("tinted", { kind: "color", value: "#40c057" });
    await seed({ sessions: [tinted], features: ["session-metadata", "agent-avatar-color"] });
    actions(agentMenu(tinted, t, "local")).find((e) => e.label === "menu.showAvatar")!.onSelect();
    await vi.waitFor(() => expect(sessionAction).toHaveBeenCalledTimes(1));
    expect(sessionAction).toHaveBeenLastCalledWith("tinted", "cutex/session/metadata/update", { avatar: { kind: "emoji", value: themedEmoji("tinted").glyph, color: "#40c057" }, expectedRevision: 3 }, "local");
  });

  it("拟人头像 enabled: 显示头像 writes a picture of the agent's family, not an emoji; 隐藏头像 clears it", async () => {
    resetPortraitPacksForTest([PACK]);
    try {
      const { agentMenu } = await import("../src/renderer/src/lib/menus");
      const claude = session("claude-agent", null, "active", true);
      await seed({ sessions: [claude], portraits: ["p/beach"] });
      actions(agentMenu(claude, t, "local")).find((e) => e.label === "menu.showAvatar")!.onSelect();
      await vi.waitFor(() => expect(sessionAction).toHaveBeenCalledTimes(1));
      const written = (sessionAction.mock.calls[0] as unknown[])[2] as { avatar: SessionAvatar };
      expect(written.avatar.kind).toBe("icon");
      expect(written.avatar.value).toMatch(/^portrait:p\/beach\/claude-v[12]$/);
      // A worn 拟人头像 offers 隐藏头像 (back to the dot).
      const wearing = session("claude-agent", written.avatar, "active", true);
      await seed({ sessions: [wearing], portraits: ["p/beach"] });
      expect(switchOf(agentMenu(wearing, t, "local"))).toEqual(["menu.hideAvatar"]);
      actions(agentMenu(wearing, t, "local")).find((e) => e.label === "menu.hideAvatar")!.onSelect();
      await vi.waitFor(() => expect(sessionAction).toHaveBeenCalledTimes(2));
      expect(sessionAction).toHaveBeenLastCalledWith("claude-agent", "cutex/session/metadata/update", { avatar: null, expectedRevision: 3 }, "local");
    } finally {
      resetPortraitPacksForTest();
    }
  });

  it("拟人头像 enabled but no picture for the family (unknown family): the theme emoji, never another family's face", async () => {
    resetPortraitPacksForTest([PACK]);
    try {
      const { agentMenu } = await import("../src/renderer/src/lib/menus");
      const plain = session("plain"); // no model facts → family "other": it waits, borrowing no other family's face
      await seed({ sessions: [plain], portraits: ["p/beach"] });
      actions(agentMenu(plain, t, "local")).find((e) => e.label === "menu.showAvatar")!.onSelect();
      await vi.waitFor(() => expect(sessionAction).toHaveBeenCalledTimes(1));
      expect(sessionAction).toHaveBeenLastCalledWith("plain", "cutex/session/metadata/update", { avatar: { kind: "emoji", value: themedEmoji("plain").glyph }, expectedRevision: 3 }, "local");
    } finally {
      resetPortraitPacksForTest();
    }
  });
});
