// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveCandidate } from "../src/renderer/src/lib/portraitSave";

const fixture = vi.hoisted(() => ({ candidates: [] as SaveCandidate[], done: new Set<string>(), index: null as any,
  prefs: {} as any, style: { kind: "portrait", portraitThemes: ["p/beach"] } as any,
  styles: new Set<() => void>(), profiles: new Set<() => void>(), packs: new Set<() => void>(), preferences: new Set<() => void>(), saved: new Set<() => void>() }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  return { useApp: create(() => ({ sidebar: {}, byHost: {}, hosts: {}, features: new Set(["session-metadata"]), pinned: new Set() })),
    featuresOf: () => new Set(["session-metadata"]), sidebarOf: () => null };
});
vi.mock("../src/renderer/src/lib/agentLook", () => ({ agentIndex: () => new Map(), lookOf: () => ({}), sessionProfileName: () => null }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ getUiPrefs: () => fixture.prefs, avatarThemesOverride: () => null,
  subscribeUiPrefs: (callback: () => void) => { fixture.preferences.add(callback); return () => fixture.preferences.delete(callback); } }));
vi.mock("../src/renderer/src/lib/profileLooks", () => ({ profileLookOf: () => null, profileLooksKnown: () => true, onProfileLooksNoted: () => () => {},
  subscribeProfileLooks: (callback: () => void) => { fixture.profiles.add(callback); return () => fixture.profiles.delete(callback); } }));
vi.mock("../src/renderer/src/lib/avatarStyle", () => ({ effectiveAvatarStyle: () => fixture.style,
  subscribeAvatarStyles: (callback: () => void) => { fixture.styles.add(callback); return () => fixture.styles.delete(callback); } }));
vi.mock("../src/renderer/src/lib/portraitPacks", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/renderer/src/lib/portraitPacks")>();
  return { ...actual, portraitIndexNow: () => fixture.index,
    subscribePortraitPacks: (callback: () => void) => { fixture.packs.add(callback); return () => fixture.packs.delete(callback); } };
});
vi.mock("../src/renderer/src/lib/portraitSave", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/renderer/src/lib/portraitSave")>();
  return { ...actual, planStyleSaves: vi.fn(actual.planStyleSaves), saveCandidatesNow: vi.fn(() => fixture.candidates),
    styleSaveDoneSnapshot: () => fixture.done,
    subscribeStyleSaveChanges: (callback: () => void) => { fixture.saved.add(callback); return () => fixture.saved.delete(callback); } };
});

import { useApp } from "../src/renderer/src/store";
import { useStyleAssignmentPreview } from "../src/renderer/src/lib/avatarStylePreview";
import { planStyleSaves, saveCandidatesNow, saveKey, YOUNG_MS } from "../src/renderer/src/lib/portraitSave";
import { indexPacks, packOf } from "../src/renderer/src/lib/portraitPacks";
import { parsePackManifest } from "../src/shared/portraitPacks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const now = 1_800_000_000_000;
const beachPack = () => packOf("p", parsePackManifest({ schemaVersion: 1, entries: [1, 2, 3].map(v => ({ theme: "beach", model: "claude", avatarPath: `avatars/beach/claude-v${v}.webp` })) })!, "bundled", path => path);
let root: Root, element: HTMLDivElement;
const candidate = (seed: string, fields: Partial<SaveCandidate> = {}): SaveCandidate => ({ seed, hostId: "A", projectId: "project", profileId: "profile", family: "claude", avatar: null,
  active: true, minor: false, writable: true, revision: 1, createdAt: now - YOUNG_MS, ...fields });
function Preview({ seed }: { seed: string }) { const avatar = useStyleAssignmentPreview(seed); return h("span", { "data-seed": seed, "data-avatar": JSON.stringify(avatar) }); }
function render() { act(() => root.render(h("div", {}, fixture.candidates.map(item => h(Preview, { key: item.seed, seed: item.seed }))))); }
function avatar(seed: string) { return JSON.parse(element.querySelector<HTMLElement>(`[data-seed="${seed}"]`)!.dataset.avatar!); }
const emit = (listeners: Set<() => void>) => act(() => { for (const listener of listeners) listener(); });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); fixture.candidates = []; fixture.done = new Set(); fixture.index = indexPacks([beachPack()]);
  fixture.prefs = { agentAvatarDefault: "emoji", portraitPacks: ["p/beach"] }; fixture.style = { kind: "portrait", portraitThemes: ["p/beach"] };
  for (const listeners of [fixture.styles, fixture.profiles, fixture.packs, fixture.preferences, fixture.saved]) listeners.clear();
  useApp.setState({ sidebar: {}, byHost: {}, hosts: {}, features: new Set(["session-metadata"]), pinned: new Set() } as never);
  vi.mocked(planStyleSaves).mockClear(); vi.mocked(saveCandidatesNow).mockClear();
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); vi.useRealTimers(); });

describe("shared prospective first-seen assignments", () => {
  it("previews the exact same per-project plan and stays stable as its prefix is saved", () => {
    fixture.candidates = [candidate("a"), candidate("b"), candidate("c")]; render();
    const expected = planStyleSaves(fixture.index, fixture.candidates, fixture.done, undefined, now);
    for (const save of expected) expect(avatar(save.seed)).toEqual(save.avatar);
    const original = avatar("b"); fixture.candidates[0]!.avatar = expected[0]!.avatar;
    act(() => { useApp.setState({ sidebar: {} } as never); });
    expect(avatar("a")).toBeNull(); expect(avatar("b")).toEqual(original);
  });
  it("builds one shared plan per snapshot rather than scanning for every Avatar", () => {
    fixture.candidates = Array.from({ length: 100 }, (_, i) => candidate(`agent-${i}`)); render();
    // First subscribe also closes the render→subscribe gap, at most one extra build.
    expect(vi.mocked(planStyleSaves).mock.calls.length).toBeLessThanOrEqual(2);
    const calls = vi.mocked(planStyleSaves).mock.calls.length;
    render(); expect(vi.mocked(planStyleSaves).mock.calls.length).toBe(calls);
    act(() => { useApp.setState({ sidebar: {} } as never); });
    expect(vi.mocked(planStyleSaves).mock.calls.length).toBe(calls + 1);
  });
  it("invalidates styles, profile knowledge, packs, preferences and handled-agent state", () => {
    fixture.candidates = [candidate("one", { family: null })]; render(); expect(avatar("one")).toBeNull();
    fixture.candidates[0]!.family = "claude"; emit(fixture.profiles); expect(avatar("one")).toMatchObject({ kind: "icon" });
    fixture.style = { kind: "letter" }; emit(fixture.styles); expect(avatar("one")).toBeNull();
    // The emoji default is drawn, never planned / stored.
    fixture.style = { kind: "emoji", emojiThemes: ["sea"] }; emit(fixture.styles); expect(avatar("one")).toBeNull();
    fixture.style = { kind: "portrait", portraitThemes: ["p/beach"] }; fixture.index = indexPacks([]); emit(fixture.styles); expect(avatar("one")).toBeNull();
    fixture.index = indexPacks([beachPack()]); emit(fixture.packs); expect(avatar("one")).toMatchObject({ kind: "icon" });
    fixture.candidates[0]!.minor = true; fixture.prefs = { ...fixture.prefs, agentAvatarDefault: "important" }; emit(fixture.preferences); expect(avatar("one")).toBeNull();
    fixture.candidates[0]!.minor = false; emit(fixture.preferences); expect(avatar("one")).not.toBeNull();
    fixture.done.add(saveKey(fixture.candidates[0]!)); emit(fixture.saved); expect(avatar("one")).toBeNull();
  });
  it("leaves creator-age, archived, minor, own-avatar and unsupported agents to regular rendering", () => {
    fixture.candidates = [candidate("young", { createdAt: now }), candidate("archived", { active: false }), candidate("minor", { minor: true }),
      candidate("own", { avatar: { kind: "emoji", value: "🐢" } }), candidate("unsupported", { writable: false })];
    render(); for (const item of fixture.candidates) expect(avatar(item.seed)).toBeNull();
    act(() => { vi.advanceTimersByTime(YOUNG_MS); }); expect(avatar("young")).toMatchObject({ kind: "icon" });
    expect(avatar("archived")).toBeNull(); expect(avatar("minor")).toBeNull();
  });
  it("shares source subscriptions and removes its age timer when the last Avatar unmounts", () => {
    fixture.candidates = [candidate("one", { createdAt: now }), candidate("two", { createdAt: now })]; render();
    expect(fixture.styles.size).toBe(1); expect(fixture.profiles.size).toBe(1); expect(vi.getTimerCount()).toBe(1);
    act(() => root.render(h("div")));
    expect(fixture.styles.size).toBe(0); expect(fixture.profiles.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    fixture.style = { kind: "letter" }; render(); expect(avatar("one")).toBeNull();
  });
});
