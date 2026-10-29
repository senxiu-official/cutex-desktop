// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import type { AvatarStyle } from "../src/renderer/src/lib/avatarStyle";
import { BUNDLED_PORTRAIT_PACKS, indexPacks, packOf, poolFor, portraitAvatarOf, seedHash } from "../src/renderer/src/lib/portraitPacks";
import { parsePackManifest } from "../src/shared/portraitPacks";
import { DEFAULT_PORTRAIT_THEMES } from "../src/shared/portraitDefaults";

const fixture = vi.hoisted(() => ({ entries: new Map<string, any>(), style: { kind: "portrait", portraitThemes: ["p/beach"] } as any, index: null as any,
  overrides: new Map<string, any>(), listeners: new Set<() => void>(), mode: "emoji", known: true, action: vi.fn(), refresh: vi.fn() }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  return { useApp: create(() => ({ sidebar: null, byHost: {}, features: new Set(["session-metadata"]), sessionAction: fixture.action, refreshHostSidebar: fixture.refresh })),
    featuresOf: (state: any) => state.features,
    sidebarOf: (_state: unknown, host: string) => ({ active: [...fixture.entries.values()].filter(entry => entry.hostId === host).map(entry => entry.session), retired: [] }) };
});
vi.mock("../src/renderer/src/lib/agentLook", () => ({ agentIndex: () => fixture.entries,
  sessionProfileName: (session: any) => session.profileName,
  lookOf: (entry: any) => ({ family: entry.family ?? "claude" }) }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ getUiPrefs: () => ({ portraitPacks: [], agentAvatarDefault: fixture.mode }), avatarThemesOverride: () => null,
  subscribeUiPrefs: () => () => {} }));
vi.mock("../src/renderer/src/lib/profileLooks", () => ({ profileLooksKnown: () => fixture.known,
  profileLookOf: (_host: string, name: string) => name ? { id: name } : null, onProfileLooksNoted: () => () => {} }));
vi.mock("../src/renderer/src/lib/portraitPacks", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/renderer/src/lib/portraitPacks")>();
  return { ...actual, portraitIndexNow: () => fixture.index, loadPortraitPacks: async () => {}, subscribePortraitPacks: () => () => {} };
});
vi.mock("../src/renderer/src/lib/avatarStyle", () => ({
  effectiveAvatarStyle: (host: string, profile: string | null) => fixture.overrides.get(`${host}/${profile}`) ?? fixture.style,
  subscribeAvatarStyles: (callback: () => void) => { fixture.listeners.add(callback); return () => fixture.listeners.delete(callback); },
}));

import { useApp } from "../src/renderer/src/store";
import { leaveFirstAvatarToCreator, loadSaved, planStyleSaves, resetPortraitSaveForTest, saveCandidatesNow, saveKey, startPortraitSave, YOUNG_MS, type SaveCandidate } from "../src/renderer/src/lib/portraitSave";

const emptyIndex = indexPacks([]);
const beach = indexPacks([packOf("p", parsePackManifest({ schemaVersion: 1, entries: [1, 2, 3].map(v => ({ theme: "beach", model: "claude", avatarPath: `avatars/beach/claude-v${v}.webp` })) })!, "bundled", path => path)]);
const portrait: AvatarStyle = { kind: "portrait", portraitThemes: ["p/beach"] };
const emoji: AvatarStyle = { kind: "emoji", emojiThemes: ["sea"] };
const now = 1_800_000_000_000;
const candidate = (seed: string, fields: Partial<SaveCandidate> = {}): SaveCandidate => ({ seed, hostId: "A", projectId: "project", profileId: "profile", family: "claude",
  avatar: null, active: true, minor: false, writable: true, revision: 7, createdAt: now - YOUNG_MS, ...fields });

function seed(seedId: string, fields: Record<string, unknown> = {}) {
  const session = { cutexSessionId: seedId, profileName: "profile", lifecycle: "active", avatar: null as SessionAvatar | null, revision: 7, createdAt: new Date(now - YOUNG_MS).toISOString(), ...fields };
  fixture.entries.set(seedId, { hostId: "A", row: { projectId: "project" }, pinned: false, isDirector: false, session });
  return session;
}
function style(value: AvatarStyle) { fixture.style = value; for (const listener of fixture.listeners) listener(); }
let stop: (() => void) | null;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); localStorage.clear(); resetPortraitSaveForTest();
  fixture.entries.clear(); fixture.overrides.clear(); fixture.listeners.clear(); fixture.mode = "emoji"; fixture.known = true; fixture.style = portrait; fixture.index = beach;
  fixture.action.mockReset(); fixture.refresh.mockReset(); fixture.refresh.mockResolvedValue(undefined);
  fixture.action.mockImplementation(async (id: string, _method: string, params: { avatar: SessionAvatar | null }) => {
    fixture.entries.get(id).session.avatar = params.avatar; return {};
  });
  useApp.setState({ features: new Set(["session-metadata"]), sidebar: {} } as never);
  stop = null;
});
afterEach(() => { stop?.(); vi.useRealTimers(); });

describe("first-seen fixed avatar style", () => {
  it("plans portraits with deterministic project uniqueness", () => {
    const planned = planStyleSaves(beach, [candidate("b"), candidate("a")], new Set(), () => portrait, now);
    expect(planned.map(item => item.seed)).toEqual(["a", "b"]);
    expect(planned.every(item => item.avatar.kind === "icon")).toBe(true);
    expect(new Set(planned.map(item => item.avatar.value)).size).toBe(2);
    expect(planStyleSaves(beach, [candidate("a"), candidate("b")], new Set(), () => portrait, now)).toEqual(planned);
  });
  it("never stores the emoji / letter default: an agent without an avatar keeps drawing its fallback", () => {
    expect(planStyleSaves(beach, [candidate("a"), candidate("b")], new Set(), () => emoji, now)).toEqual([]);
    expect(planStyleSaves(emptyIndex, [candidate("a")], new Set(), () => ({ kind: "emoji", emojiThemes: null }), now)).toEqual([]);
    expect(planStyleSaves(beach, [candidate("a")], new Set(), () => ({ kind: "letter" }), now)).toEqual([]);
    // No pictures for its family: nothing either.
    expect(planStyleSaves(emptyIndex, [candidate("a")], new Set(), () => portrait, now)).toEqual([]);
  });
  it("preserves all first-seen eligibility gates and never overwrites any own avatar", () => {
    const blocked = [candidate("inactive", { active: false }), candidate("minor", { minor: true }), candidate("read-only", { writable: false }),
      candidate("unknown-family", { family: null }), candidate("young", { createdAt: now - YOUNG_MS + 1 }), candidate("done"),
      ...["emoji", "icon", "color"].map(kind => candidate(`own-${kind}`, { avatar: { kind, value: "own" } as SessionAvatar }))];
    expect(planStyleSaves(beach, blocked, new Set([saveKey(candidate("done"))]), () => portrait, now)).toEqual([]);
    expect(planStyleSaves(beach, [candidate("letter")], new Set(), () => ({ kind: "letter" }), now)).toEqual([]);
  });
  it("resolves Profile overrides using exact host/Profile ids while unknown Profile lists block saving", () => {
    seed("one"); fixture.overrides.set("A/profile", { kind: "letter" });
    expect(saveCandidatesNow()[0]!.profileId).toBe("profile");
    expect(planStyleSaves(beach, saveCandidatesNow(), new Set(), undefined, now)).toEqual([]);
    fixture.overrides.clear(); fixture.known = false;
    expect(planStyleSaves(beach, saveCandidatesNow(), new Set(), undefined, now)).toEqual([]);
    fixture.known = true; expect(planStyleSaves(beach, saveCandidatesNow(), new Set(), undefined, now)).toHaveLength(1);
  });
  it("stores a portrait through the existing revision-fenced metadata API and never dynamically follows style changes", async () => {
    const session = seed("one"); stop = startPortraitSave();
    await vi.advanceTimersByTimeAsync(1600);
    expect(fixture.action).toHaveBeenCalledExactlyOnceWith("one", "cutex/session/metadata/update", { avatar: session.avatar, expectedRevision: 7 }, "A");
    const stored = session.avatar; expect(stored).toMatchObject({ kind: "icon" }); expect(loadSaved().has(saveKey(candidate("one")))).toBe(true);
    style({ kind: "letter" }); await vi.advanceTimersByTimeAsync(2000);
    expect(session.avatar).toEqual(stored); expect(fixture.action).toHaveBeenCalledTimes(1);
  });
  it("leaves young agents and creator-owned first writes alone, then stores eligible portraits at 60 seconds", async () => {
    seed("young", { createdAt: new Date(now).toISOString() }); seed("creator"); leaveFirstAvatarToCreator("A", "creator");
    stop = startPortraitSave(); await vi.advanceTimersByTimeAsync(2000); expect(fixture.action).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(YOUNG_MS + 2000);
    expect(fixture.action).toHaveBeenCalledTimes(1); expect(fixture.action.mock.calls[0]![0]).toBe("young");
  });
  it("rechecks style eligibility between writes and does not remember deferred agents as completed", async () => {
    seed("a"); seed("b"); let complete!: () => void;
    fixture.action.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    stop = startPortraitSave(); await vi.advanceTimersByTimeAsync(1600); expect(fixture.action).toHaveBeenCalledTimes(1);
    style({ kind: "letter" }); complete(); await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.action).toHaveBeenCalledTimes(1); expect(loadSaved().has(saveKey(candidate("b")))).toBe(false);
    style(portrait); await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.action).toHaveBeenCalledTimes(2); expect(fixture.action.mock.calls[1]![0]).toBe("b");
  });
  it("stopping during a write prevents the rest of the queued writes", async () => {
    seed("a"); seed("b"); let complete!: () => void;
    fixture.action.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    stop = startPortraitSave(); await vi.advanceTimersByTimeAsync(1600); stop(); stop = null;
    complete(); await vi.advanceTimersByTimeAsync(5000);
    expect(fixture.action).toHaveBeenCalledTimes(1); expect(loadSaved().has(saveKey(candidate("b")))).toBe(false);
  });
  it("retries moved revisions while avatar stays unset", async () => {
    seed("one"); fixture.action.mockRejectedValueOnce(new Error("revision_conflict"));
    fixture.refresh.mockImplementationOnce(async () => { fixture.entries.get("one").session.revision = 8; });
    stop = startPortraitSave(); await vi.advanceTimersByTimeAsync(5000);
    expect(fixture.action).toHaveBeenCalledTimes(2); expect(fixture.action.mock.calls[1]![2]).toMatchObject({ expectedRevision: 8 });
  });
  it("never retries over an own avatar set during a revision conflict", async () => {
    const session = seed("one"); fixture.action.mockRejectedValueOnce(new Error("revision_conflict"));
    fixture.refresh.mockImplementationOnce(async () => {
      fixture.entries.get("one").session.avatar = { kind: "emoji", value: "🦊" };
      fixture.entries.get("one").session.revision = 8;
    });
    stop = startPortraitSave(); await vi.advanceTimersByTimeAsync(5000);
    expect(fixture.action).toHaveBeenCalledTimes(1); expect(session.avatar).toEqual({ kind: "emoji", value: "🦊" });
  });
  it("rechecks active/minor/host capability gates before each queued write", async () => {
    seed("a"); seed("b"); let complete!: () => void;
    fixture.action.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    stop = startPortraitSave(); await vi.advanceTimersByTimeAsync(1600);
    fixture.entries.get("b").session.lifecycle = "archived";
    complete(); await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.action).toHaveBeenCalledTimes(1); expect(loadSaved().has(saveKey(candidate("b")))).toBe(false);
  });
  it("an emoji-style agent pinned and unpinned again stores nothing and goes back to its dot", async () => {
    const session = seed("one"); fixture.mode = "important"; fixture.style = emoji; stop = startPortraitSave();
    fixture.entries.get("one").pinned = true;
    useApp.setState({ pinned: new Set(["one"]) });
    await vi.advanceTimersByTimeAsync(1600);
    fixture.entries.get("one").pinned = false;
    useApp.setState({ pinned: new Set() });
    await vi.advanceTimersByTimeAsync(1600);
    expect(fixture.action).not.toHaveBeenCalled(); expect(session.avatar).toBeNull();
    expect(saveCandidatesNow()[0]!.minor).toBe(true);
  });
  it("saves a newly pinned important agent even when no sidebar snapshot changes", async () => {
    seed("one"); fixture.mode = "important"; stop = startPortraitSave();
    await vi.advanceTimersByTimeAsync(1600); expect(fixture.action).not.toHaveBeenCalled();
    fixture.entries.get("one").pinned = true;
    useApp.setState({ pinned: new Set(["one"]) });
    await vi.advanceTimersByTimeAsync(1600); expect(fixture.action).toHaveBeenCalledTimes(1);
  });
});

// Use the actual shipping catalog, rather than a tiny synthetic pool: these IDs
// deliberately collide under the standalone FNV rule for its 120 Claude faces.
const kitIndex = indexPacks(BUNDLED_PORTRAIT_PACKS);
const kitStyle: AvatarStyle = { kind: "portrait", portraitThemes: [...DEFAULT_PORTRAIT_THEMES] };
const claudePool = poolFor(kitIndex, DEFAULT_PORTRAIT_THEMES, "claude");
function collisionIds(count: number): string[] {
  const ids: string[] = [];
  for (let n = 0; n < 1_000_000 && ids.length < count; n++) {
    const id = `v2-collision-${String(n).padStart(6, "0")}`;
    if (seedHash(id) % 120 === 0) ids.push(id);
  }
  if (ids.length !== count) throw new Error("Could not construct FNV collision fixture");
  return ids;
}
const colliding = collisionIds(122);
const kitPlan = (agents: readonly SaveCandidate[], done: ReadonlySet<string> = new Set()) => planStyleSaves(kitIndex, agents, done, () => kitStyle, now);
function persistPlan(agents: readonly SaveCandidate[]): SaveCandidate[] {
  const picks = new Map(kitPlan(agents).map(save => [saveKey(save), save.avatar]));
  return agents.map(agent => ({ ...agent, avatar: agent.avatar ?? picks.get(saveKey(agent)) ?? null }));
}

describe("v2 shipping-kit project assignments", () => {
  it("gives ten deliberately colliding Claude members distinct faces from the real 120-face pool", () => {
    expect(claudePool).toHaveLength(120);
    const agents = colliding.slice(0, 10).map(id => candidate(id));
    expect(agents.every(agent => seedHash(agent.seed) % claudePool.length === 0)).toBe(true);
    const planned = kitPlan(agents);
    expect(planned).toHaveLength(10);
    expect(new Set(planned.map(save => save.avatar.value)).size).toBe(10);
    const installed = new Set(claudePool.map(picture => portraitAvatarOf(picture).value));
    expect(planned.every(save => installed.has(save.avatar.value))).toBe(true);
    expect(kitPlan([...agents].reverse())).toEqual(planned);
  });

  it("preserves saved picks when a colliding member joins or leaves and when the done set is empty", () => {
    const saved = persistPlan(colliding.slice(0, 10).map(id => candidate(id)));
    const before = new Map(saved.map(agent => [saveKey(agent), structuredClone(agent.avatar)]));
    const joined = candidate(colliding[10]!);
    const changes = kitPlan([joined, ...saved].reverse());
    expect(changes.map(save => save.seed)).toEqual([joined.seed]);
    expect([...before.values()].some(avatar => avatar?.value === changes[0]!.avatar.value)).toBe(false);
    const withJoin = persistPlan([...saved, joined]);
    const survivors = withJoin.filter(agent => agent.seed !== saved[3]!.seed);
    expect(kitPlan(survivors, new Set())).toEqual([]);
    for (const survivor of survivors.filter(agent => before.has(saveKey(agent)))) {
      expect(survivor.avatar).toEqual(before.get(saveKey(survivor)));
    }
    const secondJoin = candidate(colliding[11]!);
    const next = kitPlan([secondJoin, ...survivors]);
    expect(next.map(save => save.seed)).toEqual([secondJoin.seed]);
    expect(new Set([...survivors.map(agent => agent.avatar!.value), next[0]!.avatar.value]).size).toBe(survivors.length + 1);
  });

  it("persists the shared plan through startPortraitSave and keeps survivors unchanged across joins, leaves and restart", async () => {
    fixture.index = kitIndex; fixture.style = kitStyle;
    for (const id of colliding.slice(0, 10).reverse()) seed(id);
    const expected = new Map(kitPlan(saveCandidatesNow()).map(save => [save.seed, save.avatar]));
    stop = startPortraitSave();
    await vi.advanceTimersByTimeAsync(1600);
    expect(fixture.action).toHaveBeenCalledTimes(10);
    for (const [id, avatar] of expected) expect(fixture.entries.get(id).session.avatar).toEqual(avatar);
    expect(new Set([...fixture.entries.values()].map(entry => entry.session.avatar.value)).size).toBe(10);

    const newSession = seed(colliding[10]!);
    useApp.setState({ sidebar: {} } as never);
    await vi.advanceTimersByTimeAsync(1600);
    expect(fixture.action).toHaveBeenCalledTimes(11);
    expect([...expected.values()].some(avatar => avatar.value === newSession.avatar!.value)).toBe(false);
    fixture.entries.delete(colliding[3]!);
    useApp.setState({ sidebar: {} } as never);
    await vi.advanceTimersByTimeAsync(1600);
    expect(fixture.action).toHaveBeenCalledTimes(11);
    for (const [id, avatar] of expected) {
      if (fixture.entries.has(id)) expect(fixture.entries.get(id).session.avatar).toEqual(avatar);
    }

    const persisted = new Map([...fixture.entries].map(([id, entry]) => [id, structuredClone(entry.session.avatar)]));
    stop(); stop = null;
    localStorage.removeItem("cutex-desktop.portraitSaved");
    resetPortraitSaveForTest();
    expect(loadSaved().size).toBe(0);
    expect(kitPlan(saveCandidatesNow(), new Set())).toEqual([]);
    stop = startPortraitSave();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.action).toHaveBeenCalledTimes(11);
    for (const [id, avatar] of persisted) expect(fixture.entries.get(id).session.avatar).toEqual(avatar);
  });

  it("replans the second queued write when an owner claims its planned project slot during the first write", async () => {
    fixture.index = kitIndex; fixture.style = kitStyle;
    const first = seed(colliding[0]!), second = seed(colliding[1]!);
    const owner = seed("owner-choice", { avatar: { kind: "emoji", value: "🦊" } });
    const initial = kitPlan(saveCandidatesNow());
    expect(initial.map(save => save.seed)).toEqual([colliding[0], colliding[1]]);
    const claimed = structuredClone(initial[1]!.avatar);
    let complete!: () => void;
    fixture.action.mockImplementationOnce((id: string, _method: string, params: { avatar: SessionAvatar }) => new Promise<void>(resolve => {
      complete = () => { fixture.entries.get(id).session.avatar = params.avatar; resolve(); };
    }));
    stop = startPortraitSave();
    await vi.advanceTimersByTimeAsync(1600);
    expect(fixture.action).toHaveBeenCalledTimes(1);
    owner.avatar = claimed;
    complete();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.action).toHaveBeenCalledTimes(2);
    expect(first.avatar).toEqual(initial[0]!.avatar);
    expect(owner.avatar).toEqual(claimed);
    expect(second.avatar).toEqual(portraitAvatarOf(claudePool[2]!));
    expect(second.avatar!.value).not.toBe(claimed.value);
    expect(new Set([first.avatar!.value, second.avatar!.value, owner.avatar!.value]).size).toBe(3);
    expect(fixture.action.mock.calls[1]![0]).toBe(colliding[1]);
    expect(fixture.action.mock.calls.some(call => call[0] === "owner-choice")).toBe(false);
  });

  it("exhausts all 120 family faces before reuse and never rewrites the 120 stored picks", () => {
    expect(claudePool).toHaveLength(120);
    const agents = colliding.slice(0, 120).map(id => candidate(id));
    const first = kitPlan(agents);
    expect(first).toHaveLength(120);
    expect(new Set(first.map(save => save.avatar.value)).size).toBe(120);
    const saved = persistPlan(agents);
    const before = saved.map(agent => agent.avatar!.value);
    const overflow = candidate(colliding[120]!);
    const changes = kitPlan([...saved, overflow]);
    expect(changes.map(save => save.seed)).toEqual([overflow.seed]);
    expect(changes[0]!.avatar).toEqual(portraitAvatarOf(claudePool[seedHash(overflow.seed) % 120]!));
    expect(saved.map(agent => agent.avatar!.value)).toEqual(before);
    expect(kitPlan(persistPlan([...saved, overflow]))).toEqual([]);
  });

  it("preserves explicit portraits, duplicate owner choices, emoji, icons, colors and fixed-empty/inherit intent", () => {
    const selected = portraitAvatarOf(claudePool[0]!);
    const owned = [
      candidate("owner-portrait", { avatar: selected }),
      candidate("owner-duplicate", { avatar: selected }),
      candidate("owner-emoji", { avatar: { kind: "emoji", value: "🦊" } }),
      candidate("owner-icon", { avatar: { kind: "icon", value: "star" } }),
      candidate("owner-color", { avatar: { kind: "color", value: "#123456" } }),
      candidate("owner-letter", { avatarMode: "fixed", avatar: null }),
      candidate("owner-inherit", { avatarMode: "inherit", avatar: null }),
    ];
    const before = structuredClone(owned);
    const newMember = candidate(colliding[0]!);
    const changes = kitPlan([...owned, newMember]);
    expect(changes.map(save => save.seed)).toEqual([newMember.seed]);
    expect(changes[0]!.avatar.value).not.toBe(selected.value);
    expect(owned).toEqual(before);
    expect(kitPlan(owned)).toEqual([]);
  });

  it("uses each standalone agent's plain hash even when its id collides with another standalone or stored choice", () => {
    expect(claudePool).toHaveLength(120);
    const independent = colliding.slice(0, 10).map(id => candidate(id, { projectId: null }));
    const plain = portraitAvatarOf(claudePool[0]!);
    const stored = candidate("standalone-owner", { projectId: null, avatar: plain });
    const planned = kitPlan([stored, ...independent]);
    expect(planned).toHaveLength(10);
    for (const save of planned) expect(save.avatar).toEqual(portraitAvatarOf(claudePool[seedHash(save.seed) % 120]!));
    expect(new Set(planned.map(save => save.avatar.value)).size).toBe(1);
    expect(kitPlan([independent[0]!])[0]!.avatar).toEqual(planned.find(save => save.seed === independent[0]!.seed)!.avatar);
  });

  it("allocates to an older colliding member before a lexically earlier newer member", () => {
    const newer = candidate(colliding[0]!, { createdAt: now - YOUNG_MS });
    const older = candidate(colliding[1]!, { createdAt: now - YOUNG_MS - 1000 });
    expect(newer.seed.localeCompare(older.seed)).toBeLessThan(0);
    const planned = kitPlan([newer, older]);
    expect(planned.map(save => save.seed)).toEqual([older.seed, newer.seed]);
    expect(planned[0]!.avatar).toEqual(portraitAvatarOf(claudePool[0]!));
    expect(planned[1]!.avatar.value).not.toBe(planned[0]!.avatar.value);
  });

  it("sorts unknown creation times as zero and uses host as the final deterministic tie-break", () => {
    const known = candidate(colliding[0]!, { createdAt: now - YOUNG_MS });
    const unknownB = candidate(colliding[1]!, { createdAt: null, hostId: "B" });
    const unknownA = candidate(colliding[1]!, { createdAt: null, hostId: "A" });
    expect(kitPlan([known, unknownB, unknownA]).map(save => [save.seed, save.hostId])).toEqual([
      [unknownA.seed, "A"], [unknownB.seed, "B"], [known.seed, "A"],
    ]);
  });
});
