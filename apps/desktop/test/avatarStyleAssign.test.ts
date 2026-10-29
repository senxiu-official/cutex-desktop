// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import type { AvatarStyle } from "../src/renderer/src/lib/avatarStyle";
import { AVATAR_THEME_IDS, themedEmoji, themesEmoji } from "../src/renderer/src/lib/avatarThemes";
import { indexPacks, packOf } from "../src/renderer/src/lib/portraitPacks";
import { parsePackManifest } from "../src/shared/portraitPacks";

const fixture = vi.hoisted(() => ({ entries: new Map<string, any>(), styles: new Map<string, any>(), action: vi.fn(), refresh: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: { getState: () => ({ sessionAction: fixture.action, refreshHostSidebar: fixture.refresh }) },
  featuresOf: () => new Set(),
  sidebarOf: (_state: unknown, host: string) => ({ active: [...fixture.entries.values()].filter(entry => entry.hostId === host).map(entry => entry.session), retired: [] }),
}));
vi.mock("../src/renderer/src/lib/agentLook", () => ({ agentIndex: () => fixture.entries, sessionProfileName: (session: any) => session.profileName,
  lookOf: (entry: any) => ({ family: entry.family ?? "claude" }) }));
vi.mock("../src/renderer/src/lib/profileLooks", () => ({ profileLookOf: (_host: string, name: string) => name ? { id: name } : null }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ avatarThemesOverride: () => null, getUiPrefs: () => ({ portraitPacks: [] }) }));
vi.mock("../src/renderer/src/lib/avatarStyle", () => ({ effectiveAvatarStyle: (host: string, profile: string | null) => fixture.styles.get(`${host}/${profile}`) ?? { kind: "letter" } }));

import { newAgentStyleAvatar, pickStyleAvatar, planStyleChanges, shownStyleAvatar, type StyleAgent } from "../src/renderer/src/lib/avatarStyleAssign";
import { applyPortraitChanges, undoPortraitChanges } from "../src/renderer/src/lib/portraitAssign";

const emoji: AvatarStyle = { kind: "emoji", emojiThemes: ["sea"] };
const letter: AvatarStyle = { kind: "letter" };
const portrait: AvatarStyle = { kind: "portrait", portraitThemes: ["p/beach"] };
const pack = packOf("p", parsePackManifest({ schemaVersion: 1, entries: [1, 2].map(version => ({ theme: "beach", model: "claude", avatarPath: `avatars/beach/claude-v${version}.webp` })) })!, "bundled", path => path);
const index = indexPacks([pack]);
const agent = (seed: string, avatar: SessionAvatar | null = null, hostId = "A", projectId: string | null = "project"): StyleAgent => ({ seed, hostId, projectId, profileId: "profile", family: "claude", avatar });

beforeEach(async () => {
  await undoPortraitChanges(); fixture.entries.clear(); fixture.styles.clear(); fixture.action.mockReset(); fixture.refresh.mockReset();
  fixture.refresh.mockResolvedValue(undefined);
  fixture.action.mockImplementation(async (seed: string, _method: string, params: { avatar: SessionAvatar | null }, host: string) => {
    const entry = fixture.entries.get(seed);
    if (entry?.hostId === host) entry.session.avatar = params.avatar;
    return {};
  });
});

describe("fixed style picks", () => {
  it("starts with the existing themed seed pick and avoids project emoji while choices remain", () => {
    const first = themedEmoji("one", ["sea"]).glyph;
    expect(pickStyleAvatar(emoji, index, "claude", "one")).toEqual({ kind: "emoji", value: first });
    expect(pickStyleAvatar(emoji, index, "claude", "one", new Set([first]))?.value).not.toBe(first);
    expect(pickStyleAvatar(emoji, index, "claude", "one", new Set(themesEmoji(["sea"]).map(item => item.glyph)))?.value).toBe(first);
  });
  it.each([["claude", "animals"], ["openai", "gems"], ["deepseek", "sea"]] as const)("uses %s family defaults for inherited emoji themes", (family, theme) => {
    expect(pickStyleAvatar({ kind: "emoji", emojiThemes: null }, index, family, "id")).toEqual({ kind: "emoji", value: themedEmoji("id", [theme]).glyph });
  });
  it("uses the whole emoji set for other families, keeps portraits, and stores nothing for letter", () => {
    expect(pickStyleAvatar({ kind: "emoji", emojiThemes: null }, index, "gemini", "id")?.value).toBe(themedEmoji("id", AVATAR_THEME_IDS).glyph);
    expect(pickStyleAvatar(portrait, index, "claude", "id")?.value).toMatch(/^portrait:p\/beach\/claude-v[12]$/);
    expect(pickStyleAvatar(letter, index, "claude", "id")).toBeNull();
  });
  it("creation and explicit reset resolve the exact host/Profile and skip other project wearers", () => {
    fixture.styles.set("A/profile", emoji); fixture.styles.set("B/profile", letter);
    const first = themedEmoji("id", ["sea"]).glyph;
    fixture.entries.set("other", { hostId: "A", row: { projectId: "project" }, session: { avatar: { kind: "emoji", value: first } } });
    const selected = newAgentStyleAvatar("id", "A", "project", "claude", "profile");
    expect(selected?.value).not.toBe(first); expect(newAgentStyleAvatar("id", "B", "project", "claude", "profile")).toBeNull();
    fixture.entries.set("id", { hostId: "A", row: { projectId: "project" }, session: { profileName: "profile", avatar: null } });
    expect(shownStyleAvatar("id", "A")).toEqual(selected); expect(shownStyleAvatar("id", "B")).toBeNull();
  });
});

describe("explicit style batches", () => {
  it("plans stable distinct choices in seed order and preserves uploaded/director/icon/color avatars", () => {
    const protectedAvatars: SessionAvatar[] = [{ kind: "icon", value: "picture:custom" }, { kind: "icon", value: "director:crown" }, { kind: "icon", value: "star" }, { kind: "color", value: "#123456" }];
    const agents = [agent("two"), agent("one", { kind: "emoji", value: "🐢" }), ...protectedAvatars.map((avatar, i) => agent(`custom-${i}`, avatar))];
    const changes = planStyleChanges(index, agents, () => emoji);
    expect(changes.map(change => change.seed)).toEqual(["one", "two"]);
    expect(new Set(changes.map(change => change.after?.value)).size).toBe(2);
    expect(planStyleChanges(index, [...agents].reverse(), () => emoji)).toEqual(changes);
  });
  it("rerolls both stored portraits and emoji, selecting alternatives even when the project pool is exhausted", () => {
    const portraitOne = { kind: "icon", value: "portrait:p/beach/claude-v1" } as const;
    const portraitTwo = { kind: "icon", value: "portrait:p/beach/claude-v2" } as const;
    const changes = planStyleChanges(index, [agent("one", portraitOne), agent("two", portraitTwo)], () => portrait, "reassign", "nonce");
    expect(changes).toHaveLength(2); expect(changes.every(change => change.after?.value !== change.before?.value)).toBe(true);
    const old = pickStyleAvatar(emoji, index, "claude", "one")!;
    const rerolled = planStyleChanges(index, [agent("one", old)], () => emoji, "reassign", "nonce");
    expect(rerolled[0]!.after?.value).not.toBe(old.value);
  });
  it("letter clears only style-owned avatars and unavailable portrait themes preserve stored values", () => {
    const before = { kind: "emoji", value: "🐢" } as const;
    expect(planStyleChanges(index, [agent("one", before), agent("two")], () => letter)).toEqual([{ seed: "one", hostId: "A", before, after: null }]);
    expect(planStyleChanges(index, [agent("one", before)], () => ({ kind: "portrait", portraitThemes: ["gone/theme"] }))).toEqual([]);
  });
  it("non-target agents reserve worn emoji, scoped by host and project", () => {
    const worn = pickStyleAvatar(emoji, index, "claude", "one")!;
    const agents = [agent("one"), agent("other", worn)];
    const changes = planStyleChanges(index, agents, item => item.seed === "one" ? emoji : null);
    expect(changes[0]!.after?.value).not.toBe(worn.value);
    expect(planStyleChanges(index, [agent("one"), agent("other", worn, "B")], item => item.seed === "one" ? emoji : null)[0]!.after).toEqual(worn);
  });
  it("nullable style changes share the existing successful-only undo and do not overwrite a later own avatar", async () => {
    const before = { kind: "emoji", value: "🐢" } as const;
    fixture.entries.set("one", { hostId: "A", session: { avatar: before } });
    expect(await applyPortraitChanges("replace", [{ seed: "one", hostId: "A", before, after: null }])).toEqual({ written: 1, failed: 0 });
    expect(await undoPortraitChanges()).toEqual({ written: 1, failed: 0 });
    expect(fixture.entries.get("one").session.avatar).toEqual(before);
    await applyPortraitChanges("replace", [{ seed: "one", hostId: "A", before, after: null }]);
    fixture.entries.get("one").session.avatar = { kind: "icon", value: "owner-picked" };
    expect(await undoPortraitChanges()).toEqual({ written: 0, failed: 1 });
    expect(fixture.entries.get("one").session.avatar.value).toBe("owner-picked");
  });
  it("keeps only successful batch writes in the undo after a partial failure", async () => {
    const before = { kind: "emoji", value: "🐢" } as const;
    fixture.entries.set("one", { hostId: "A", session: { avatar: before } });
    fixture.entries.set("failed", { hostId: "A", session: { avatar: before } });
    fixture.action.mockImplementation(async (seed: string, _method: string, params: { avatar: SessionAvatar | null }) => {
      if (seed === "failed") throw new Error("permission_denied");
      fixture.entries.get(seed).session.avatar = params.avatar; return {};
    });
    expect(await applyPortraitChanges("replace", ["one", "failed"].map(seed => ({ seed, hostId: "A", before, after: null })))).toEqual({ written: 1, failed: 1 });
    expect(await undoPortraitChanges()).toEqual({ written: 1, failed: 0 });
    expect(fixture.entries.get("one").session.avatar).toEqual(before);
    expect(fixture.entries.get("failed").session.avatar).toEqual(before);
  });
  it("preserves valid own colors on emoji and portrait replacements or rerolls, and letter clears them", () => {
    const before = { kind: "emoji", value: "🧪", color: "#AbC123" } as const;
    for (const style of [emoji, portrait]) for (const kind of ["replace", "reassign"] as const) {
      const changes = planStyleChanges(index, [agent("one", before)], () => style, kind);
      expect(changes[0]!.after).toMatchObject({ color: "#abc123" });
    }
    const storedPortrait = { kind: "icon", value: "portrait:p/beach/claude-v1", color: "#AbC123" } as const;
    expect(planStyleChanges(index, [agent("one", storedPortrait)], () => emoji)[0]!.after).toMatchObject({ color: "#abc123" });
    expect(planStyleChanges(index, [agent("one", { ...before, color: "invalid" })], () => emoji)[0]!.after).not.toHaveProperty("color");
    expect(planStyleChanges(index, [agent("one", before)], () => letter)[0]!.after).toBeNull();
  });
});

 it("batch plans skip inherit even when it has stale avatar data, and pin an explicit letter reset", () => {
   const followed = { ...agent("follow", { kind: "emoji", value: "x" }), avatarMode: "inherit" as const };
   const legacy = { ...agent("letter", null), avatarMode: null };
   expect(planStyleChanges(index, [followed, legacy], () => letter)).toEqual([{ seed: "letter", hostId: legacy.hostId, before: null, after: null, beforeMode: null, afterMode: "fixed" }]);
 });

 it("old hosts can undo a batch plan carrying the newer mode bookkeeping", async () => {
   const before = { kind: "emoji", value: "old" } as const;
   fixture.entries.set("legacy-mode", { hostId: "A", session: { avatar: before, revision: 4 } });
   expect(await applyPortraitChanges("replace", [{ seed: "legacy-mode", hostId: "A", before, after: null, beforeMode: null, afterMode: "fixed" }])).toEqual({ written: 1, failed: 0 });
   expect(await undoPortraitChanges()).toEqual({ written: 1, failed: 0 });
   expect(fixture.entries.get("legacy-mode").session.avatar).toEqual(before);
   expect(fixture.action.mock.calls.every(call => !("avatarMode" in call[2]))).toBe(true);
 });
