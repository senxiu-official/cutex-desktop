// @vitest-environment jsdom
// 拟人头像 saved for agents the desktop did not create (owner 2026-10-23, board legacy-save-portrait: save):
// what gets planned, what never does, once per agent, distinct within a project, and the write itself.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionAvatar, SessionResource } from "@cutex-desktop/protocol";
import { packOf, resetPortraitPacksForTest } from "../src/renderer/src/lib/portraitPacks";
import { parsePackManifest } from "../src/shared/portraitPacks";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, onEvent: () => () => {} }));

const entries = ["claude", "kimi"].flatMap((model) => [1, 2].map((v) => ({ theme: "beach", model, avatarPath: `avatars/beach/${model}-v${v}.webp`, previewPath: `previews/beach/${model}-v${v}.webp` })));
const PACK = packOf("p", parsePackManifest({ schemaVersion: 1, entries })!, "bundled", (path) => `/packs/p/${path}`);
const ENABLED = ["p/beach"];
const portrait = (stem: string): SessionAvatar => ({ kind: "icon", value: `portrait:p/beach/${stem}` });

const sessionAction = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({}));

function session(id: string, avatar: SessionAvatar | null = null, lifecycle = "active", createdAt: string | null = null): SessionResource {
  return { cutexSessionId: id, displayName: id, lifecycle, revision: 7, avatar, createdAt, runtime: { status: "offline", activeTurnId: null, claudeRuntime: {} } } as unknown as SessionResource;
}

async function seed(opts: { sessions: SessionResource[]; portraits?: string[]; mode?: "emoji" | "letter" | "important"; features?: string[]; projectOf?: Record<string, string>; pinned?: string[] }) {
  const { useApp } = await import("../src/renderer/src/store");
  const prefs = await import("../src/renderer/src/lib/prefs");
  const looks = await import("../src/renderer/src/lib/profileLooks");
  prefs.setUiPref("agentAvatarDefault", opts.mode ?? "emoji");
  prefs.setUiPref("portraitPacks", opts.portraits ?? ENABLED);
  // The host's Profile list is known (empty): each agent's family comes from the session (Claude here).
  looks.noteProfileLooks("local", []);
  const hostRows = Object.fromEntries(Object.entries(opts.projectOf ?? {}).map(([id, projectId]) => [id, { projectId }]));
  useApp.setState({
    features: new Set(opts.features ?? ["session-metadata"]),
    pinned: new Set(opts.pinned ?? []),
    sidebar: { active: opts.sessions.filter((s) => s.lifecycle === "active"), retired: opts.sessions.filter((s) => s.lifecycle !== "active"), hostRows, projects: null } as never,
    sessionAction: sessionAction as never,
    refreshHostSidebar: (async () => {}) as never,
  });
}

const STORE_CONFLICT = "event_persistence_unavailable: cutex session store revision conflict: expected 264720, current 264721; reload before retrying";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function planNow() {
  const { planPortraitSaves, saveCandidatesNow } = await import("../src/renderer/src/lib/portraitSave");
  const { getUiPrefs } = await import("../src/renderer/src/lib/prefs");
  const { portraitIndexNow } = await import("../src/renderer/src/lib/portraitPacks");
  return planPortraitSaves(portraitIndexNow(), getUiPrefs().portraitPacks, saveCandidatesNow(), new Set());
}

describe("portraitSave", () => {
  // The store / prefs / portraitSave graph imported once up front: imported first inside the first test, it ran past
  // the test timeout under a full parallel run.
  beforeAll(async () => {
    await Promise.all([import("../src/renderer/src/store"), import("../src/renderer/src/lib/prefs"), import("../src/renderer/src/lib/profileLooks"), import("../src/renderer/src/lib/portraitSave")]);
  });
  beforeEach(async () => {
    localStorage.clear();
    (await import("../src/renderer/src/lib/portraitSave")).resetPortraitSaveForTest();
    sessionAction.mockReset();
    sessionAction.mockResolvedValue({});
    resetPortraitPacksForTest([PACK]);
  });
  afterEach(() => resetPortraitPacksForTest());

  it("an agent with no avatar gets a portrait of its family", async () => {
    await seed({ sessions: [session("quick")] });
    const saves = await planNow();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ seed: "quick", hostId: "local", revision: 7 });
    expect(saves[0]!.avatar.value).toMatch(/^portrait:p\/beach\/claude-v[12]$/);
  });

  it("never overwrites a stored avatar: emoji, initials, colour, icon, picture, portrait", async () => {
    await seed({
      sessions: [
        session("emoji", { kind: "emoji", value: "🦊" }),
        session("letter", { kind: "initials", value: "AB" } as unknown as SessionAvatar),
        session("color", { kind: "color", value: "#40c057" }),
        session("icon", { kind: "icon", value: "bot" }),
        session("pic", { kind: "icon", value: "desktop-picture:01234567-89ab-cdef-0123-456789abcdef" }),
        session("worn", portrait("claude-v1")),
      ],
    });
    expect(await planNow()).toEqual([]);
  });

  it("nothing when portraits are off, for archived agents, dots (仅重要), or hosts without session-metadata", async () => {
    await seed({ sessions: [session("a")], portraits: [] });
    expect(await planNow()).toEqual([]);
    await seed({ sessions: [session("old", null, "retired")] });
    expect(await planNow()).toEqual([]);
    await seed({ sessions: [session("dot")], mode: "important" });
    expect(await planNow()).toEqual([]);
    // 仅重要: a pinned agent is drawn as an avatar, so it is saved.
    await seed({ sessions: [session("dot")], mode: "important", pinned: ["dot"] });
    expect((await planNow()).map((s) => s.seed)).toEqual(["dot"]);
    await seed({ sessions: [session("a")], features: [] });
    expect(await planNow()).toEqual([]);
  });

  it("distinct within a project: skips pictures worn there and ones picked in the same pass", async () => {
    await seed({ sessions: [session("worn", portrait("claude-v1")), session("new")], projectOf: { worn: "p1", new: "p1" } });
    expect((await planNow()).map((s) => s.avatar.value)).toEqual(["portrait:p/beach/claude-v2"]);
    await seed({ sessions: [session("worn", portrait("claude-v2")), session("new")], projectOf: { worn: "p1", new: "p1" } });
    expect((await planNow()).map((s) => s.avatar.value)).toEqual(["portrait:p/beach/claude-v1"]);
    await seed({ sessions: [session("x1"), session("x2")], projectOf: { x1: "p1", x2: "p1" } });
    const both = (await planNow()).map((s) => s.avatar.value);
    expect(both).toHaveLength(2);
    expect(new Set(both).size).toBe(2);
    // Another project may wear the same picture.
    await seed({ sessions: [session("worn", portrait("claude-v1")), session("other")], projectOf: { worn: "p1", other: "p2" } });
    const other = await planNow();
    expect(other).toHaveLength(1);
  });

  it("once per agent: a written or refused agent is remembered (also by a fresh start); a conflict is retried up to 3 times", async () => {
    const { planPortraitSaves, runPortraitSaves, loadSaved, saveCandidatesNow } = await import("../src/renderer/src/lib/portraitSave");
    const { portraitIndexNow } = await import("../src/renderer/src/lib/portraitPacks");
    await seed({ sessions: [session("ok"), session("old-host"), session("busy")] });
    const plan = (done: ReadonlySet<string>) => planPortraitSaves(portraitIndexNow(), ENABLED, saveCandidatesNow(), done);
    const done = loadSaved();
    const conflicts = new Map<string, number>();
    const write = vi.fn(async (s: { seed: string }) => {
      if (s.seed === "old-host") throw new Error("unsupported: cutex/session/metadata/update");
      if (s.seed === "busy") throw new Error("revision_conflict: expected revision 7, found 8");
    });
    expect(await runPortraitSaves(plan(done), done, write, conflicts)).toBe(1);
    // ok + old-host are done; busy stays for the next pass.
    expect(plan(done).map((s) => s.seed)).toEqual(["busy"]);
    expect(plan(loadSaved()).map((s) => s.seed)).toEqual(["busy"]);
    await runPortraitSaves(plan(done), done, write, conflicts);
    await runPortraitSaves(plan(done), done, write, conflicts);
    expect(plan(done)).toEqual([]);
    expect(write).toHaveBeenCalledTimes(5);
  });

  it("the runner writes the avatar field only, fenced by the revision, and only once", async () => {
    vi.useFakeTimers();
    const { startPortraitSave } = await import("../src/renderer/src/lib/portraitSave");
    await seed({ sessions: [session("quick"), session("fox", { kind: "emoji", value: "🦊" })] });
    const stop = startPortraitSave();
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(sessionAction).toHaveBeenCalledTimes(1);
      const [seedId, method, params, hostId] = sessionAction.mock.calls[0]!;
      expect([seedId, method, hostId]).toEqual(["quick", "cutex/session/metadata/update", "local"]);
      expect(Object.keys(params as object).sort()).toEqual(["avatar", "expectedRevision"]);
      expect(params).toMatchObject({ expectedRevision: 7, avatar: { kind: "icon" } });
      // The sidebar changes again (same agent still without an avatar in this snapshot): no second write.
      await seed({ sessions: [session("quick"), session("fox", { kind: "emoji", value: "🦊" })] });
      await vi.advanceTimersByTimeAsync(2000);
      expect(sessionAction).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("a just-created agent is left to its creator: nothing until it is a minute old", async () => {
    const { YOUNG_MS } = await import("../src/renderer/src/lib/portraitSave");
    await seed({ sessions: [session("maid", null, "active", ago(2_000)), session("old", null, "active", ago(YOUNG_MS + 1_000))] });
    expect((await planNow()).map((s) => s.seed)).toEqual(["old"]);
  });

  it("the 新建 page's claim: the runner never writes the first avatar of an agent the page created", async () => {
    vi.useFakeTimers();
    const { startPortraitSave, leaveFirstAvatarToCreator, YOUNG_MS } = await import("../src/renderer/src/lib/portraitSave");
    // The create flow claims Maid the moment cutex returns its id, before its own avatar write.
    leaveFirstAvatarToCreator("local", "maid");
    await seed({ sessions: [session("maid", null, "active", new Date().toISOString())] });
    const stop = startPortraitSave();
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(sessionAction).not.toHaveBeenCalled();
      // Old enough, and still without an avatar (the page's write failed for good): still the page's to set.
      await vi.advanceTimersByTimeAsync(YOUNG_MS + 2000);
      expect(sessionAction).not.toHaveBeenCalled();
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("an agent another device created is saved once it is old enough (the runner looks again by itself)", async () => {
    vi.useFakeTimers();
    const { startPortraitSave, YOUNG_MS } = await import("../src/renderer/src/lib/portraitSave");
    await seed({ sessions: [session("fresh", null, "active", new Date().toISOString())] });
    const stop = startPortraitSave();
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(sessionAction).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(YOUNG_MS + 2000);
      expect(sessionAction).toHaveBeenCalledTimes(1);
      expect(sessionAction.mock.calls[0]![0]).toBe("fresh");
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("a lost store CAS is retried at once (re-read, avatar still unset); never remembered as done while it lasts", async () => {
    vi.useFakeTimers();
    const { startPortraitSave, runPortraitSaves, saveKey } = await import("../src/renderer/src/lib/portraitSave");
    await seed({ sessions: [session("quick")] });
    sessionAction.mockRejectedValueOnce(new Error(STORE_CONFLICT));
    const stop = startPortraitSave();
    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(sessionAction).toHaveBeenCalledTimes(2);
      expect(sessionAction.mock.calls[1]![2]).toMatchObject({ expectedRevision: 7 });
    } finally {
      stop();
      vi.useRealTimers();
    }
    // Exhausted retries: like a revision conflict, left for the next pass (not remembered).
    const done = new Set<string>();
    await runPortraitSaves([{ seed: "q", hostId: "local", revision: 1, avatar: { kind: "icon", value: "portrait:p/beach/claude-v1" } }], done, async () => {
      throw new Error(STORE_CONFLICT);
    });
    expect(done.has(saveKey({ hostId: "local", seed: "q" }))).toBe(false);
  });
});

 it("first-seen never assigns inherited or explicit fixed-empty sessions", async () => {
   resetPortraitPacksForTest([PACK]);
   await seed({ sessions: [{ ...session("follow"), avatarMode: "inherit" }, { ...session("letter"), avatarMode: "fixed" }, session("legacy")] });
   expect((await planNow()).map(save => save.seed)).toEqual(["legacy"]);
 });
