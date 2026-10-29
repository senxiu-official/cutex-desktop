// 拟人头像包 (docs/design/040 §3.2): the generator's manifest format, ids within cutex's 64 chars, the shipped test
// pack, and what an agent shows when a pack is replaced in place (shrinks, a stem renamed, a family emptied, the pack
// removed) — never a broken picture, a stand-in by the agent's hash instead, written only by 「重新分配」.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { familyOfModel, packFromFiles, parsePackManifest, portraitAvatarOf, portraitRefOf, safePackPath } from "../src/shared/portraitPacks";
import {
  BUNDLED_PORTRAIT_PACKS,
  fallenBack,
  familyMismatched,
  indexPacks,
  mergePacks,
  packOf,
  pickForNewAgent,
  pickPortrait,
  planReassign,
  planReplaceAll,
  poolFor,
  portraitFor,
  resolvePortrait,
  seedHash,
  type AgentForPortrait,
  type PortraitPack,
} from "../src/renderer/src/lib/portraitPacks";

const MODELS = ["claude", "gpt", "deepseek", "kimi", "glm", "gemini"];

/** A pack like the generator writes: themes × 6 models × `variants`. */
function manifest(themes: string[], variants = 4, models = MODELS) {
  return {
    schemaVersion: 1,
    entries: themes.flatMap((theme) =>
      models.flatMap((model) =>
        Array.from({ length: variants }, (_, i) => ({ id: `${theme}:${model}:v${i + 1}`, theme, themeName: theme.toUpperCase(), model, variant: i + 1, avatarPath: `avatars/${theme}/${model}-v${i + 1}.png`, previewPath: `previews/${theme}/${model}-v${i + 1}.png` })),
      ),
    ),
  };
}

const pack = (id: string, json: unknown): PortraitPack => packOf(id, parsePackManifest(json)!, "bundled", (p) => `/${id}/${p}`);

describe("manifest format", () => {
  it("reads the generator's entries: themes in order, family by model (gpt → openai)", () => {
    const data = parsePackManifest(manifest(["lolita", "office"], 1))!;
    expect(data.themes.map((t) => [t.id, t.name, t.entries.length])).toEqual([["lolita", "LOLITA", 6], ["office", "OFFICE", 6]]);
    expect(data.themes[0]!.entries.map((e) => e.family)).toEqual(["claude", "openai", "deepseek", "kimi", "glm", "gemini"]);
    expect(data.themes[0]!.entries[1]).toMatchObject({ stem: "gpt-v1", model: "gpt", avatarPath: "avatars/lolita/gpt-v1.png", previewPath: "previews/lolita/gpt-v1.png" });
  });

  it("drops unsafe paths, bad theme ids and duplicate stems; refuses other schema versions", () => {
    const bad = { schemaVersion: 1, entries: [
      { theme: "a", model: "claude", avatarPath: "../x/claude-v1.png" },
      { theme: "a", model: "claude", avatarPath: "/abs/claude-v1.png" },
      { theme: "a", model: "claude", avatarPath: "avatars\\a\\claude-v1.png" },
      { theme: "a", model: "claude", avatarPath: "avatars/a/claude-v1.svg" },
      { theme: "Bad Theme", model: "claude", avatarPath: "avatars/b/claude-v1.png" },
      { theme: "a", model: "claude", avatarPath: "avatars/a/claude-v1.png", previewPath: "../p.png" },
      { theme: "a", model: "claude", avatarPath: "avatars/a/claude-v1.png" },
    ] };
    const data = parsePackManifest(bad)!;
    expect(data.themes).toHaveLength(1);
    expect(data.themes[0]!.entries).toEqual([{ stem: "claude-v1", model: "claude", family: "claude", avatarPath: "avatars/a/claude-v1.png", previewPath: null }]);
    expect(parsePackManifest({ schemaVersion: 2, entries: [] })).toBeNull();
    expect(safePackPath("avatars/./x.png")).toBeNull();
    expect(safePackPath("avatars//x.png")).toBeNull();
  });

  it("a folder without manifest: avatars/<theme>/<file>, previews when present", () => {
    const data = packFromFiles(["avatars/beach/kimi-v2.png", "avatars/beach/kimi-v1.png", "previews/beach/kimi-v1.png", "other/x.png"]);
    expect(data.themes[0]!.entries.map((e) => [e.stem, e.previewPath])).toEqual([["kimi-v1", "previews/beach/kimi-v1.png"], ["kimi-v2", null]]);
  });

  it("families", () => {
    expect(["claude", "gpt", "codex", "gemini", "deepseek", "kimi", "moonshot", "kimi-k2", "k3.1-pro", "k2.5", "glm", "zhipu", "llama"].map(familyOfModel)).toEqual([
      "claude", "openai", "openai", "gemini", "deepseek", "kimi", "kimi", "kimi", "kimi", "kimi", "glm", "glm", "other",
    ]);
  });

  it("stored ids fit cutex's 64 chars and round-trip", () => {
    const longest = { pack: "a".repeat(20), theme: "b".repeat(20), stem: "deepseek-v123" };
    const avatar = portraitAvatarOf(longest);
    expect(avatar.value.length).toBe(64);
    expect(portraitRefOf(avatar)).toEqual(longest);
    expect(portraitAvatarOf({ pack: "overnight-test-v1", theme: "french-aristocracy", stem: "deepseek-v4" }).value.length).toBeLessThanOrEqual(64);
    expect(portraitRefOf({ kind: "icon", value: "portrait:a/b/c/d" })).toBeNull();
    expect(portraitRefOf({ kind: "emoji", value: "portrait:a/b/c" })).toBeNull();
  });
});

describe("the shipped owner pack", () => {
  it("kit-20261029: 20 themes × 6 characters × 6, each with its preview, every file in public/ (WebP)", () => {
    expect(BUNDLED_PORTRAIT_PACKS.some(x => x.id === "overnight-test-v1")).toBe(false);
    const p = BUNDLED_PORTRAIT_PACKS.find((x) => x.id === "kit-20261029")!;
    expect(p).toBeTruthy();
    expect(p.themes).toHaveLength(20);
    const pictures = p.themes.flatMap((t) => t.pictures);
    expect(pictures).toHaveLength(720);
    expect(pictures.every((x) => x.full && x.preview)).toBe(true);
    const publicDir = join(__dirname, "../src/renderer/public");
    for (const x of pictures) for (const url of [x.full!, x.preview!]) {
      expect(url).toMatch(/^\/avatars\/portraits\/kit-20261029\/(avatars|previews)\/[a-z-]+\/[a-z]+\/0[1-6]\.webp$/);
      expect(existsSync(join(publicDir, url)), url).toBe(true);
    }
    expect(new Set(pictures.map((x) => x.family))).toEqual(new Set(["claude", "openai", "deepseek", "kimi", "glm", "gemini"]));
    expect(p.themes.find((t) => t.id === "cloud-woven-silks")!.name).toBe("云想华裳");
  });
});

describe("picking", () => {
  const v1 = pack("p", manifest(["lolita", "office"]));
  const index = indexPacks([v1]);

  it("hash start is stable; used pictures are skipped; all used → the hash's own", () => {
    expect(seedHash("agent-1")).toBe(seedHash("agent-1"));
    const pool = index.pools.get("p/lolita/claude")!;
    const first = pickPortrait(pool, "agent-1")!;
    const second = pickPortrait(pool, "agent-1", new Set([first.key]))!;
    expect(second.key).not.toBe(first.key);
    expect(pickPortrait(pool, "agent-1", new Set(pool.map((x) => x.key)))!.key).toBe(first.key);
    expect(pickPortrait([], "x")).toBeNull();
  });

  it("the enabled themes pool in pack / theme order, whatever order they were ticked", () => {
    const ab = poolFor(index, ["p/office", "p/lolita"], "glm").map((p) => p.key);
    expect(ab).toEqual(poolFor(index, ["p/lolita", "p/office"], "glm").map((p) => p.key));
    expect(ab).toHaveLength(8);
    expect(ab[0]).toBe("p/lolita/glm-v1");
    expect(poolFor(index, ["p/lolita"], null)).toEqual([]);
  });

  it("an agent without an avatar wears the enabled themes' pick for its family; none enabled / own avatar = none", () => {
    expect(portraitFor(index, null, "s1", "openai", ["p/office"])!.picture).toMatchObject({ theme: "office", family: "openai" });
    expect(portraitFor(index, null, "s1", "kimi", ["p/office", "p/lolita"])!.picture.family).toBe("kimi");
    expect(portraitFor(index, null, "s1", "openai", [])).toBeNull();
    expect(portraitFor(index, null, "s1", "openai", ["gone/x"])).toBeNull();
    expect(portraitFor(index, { kind: "emoji", value: "🦊" }, "s1", "openai", ["p/office"])).toBeNull();
    expect(portraitFor(index, null, "s1", "other", ["p/office"])).toBeNull();
    expect(portraitFor(index, null, "s1", null, ["p/office"])).toBeNull();
  });

  it("a portrait is never another family's face (owner 2026-10-28): unknown family or a family the pack lacks picks nothing", () => {
    expect(poolFor(index, ["p/office"], "other")).toEqual([]);
    const noKimi = indexPacks([pack("nk", manifest(["office"], 4, MODELS.filter((m) => m !== "kimi")))]);
    expect(poolFor(noKimi, ["nk/office"], "kimi")).toEqual([]);
    expect(poolFor(noKimi, ["nk/gone"], "kimi")).toEqual([]);
    expect(pickForNewAgent(index, ["p/office"], "other", "s1", new Set())).toBeNull();
  });

  it("a new agent skips pictures already worn in its project", () => {
    const pool = index.pools.get("p/office/claude")!;
    const used = new Set(pool.slice(0, 3).map((x) => x.key));
    const avatar = pickForNewAgent(index, ["p/office"], "claude", "seed", used)!;
    expect(used.has(`p/office/${portraitRefOf(avatar)!.stem}`)).toBe(false);
    expect(portraitRefOf(avatar)!.stem).toMatch(/^claude-v/);
  });

  it("before its avatar is stored, a new agent is drawn with the very picture it gets stored (nothing switches)", () => {
    const pool = index.pools.get("p/office/claude")!;
    for (const seed of ["a", "b", "seed", "cutex.0f3e", "member-7"]) {
      // A teammate already wears the hash's own pick: the plain draw-time pick would differ from the stored one.
      const hashPick = pickPortrait(pool, seed)!;
      const worn = new Set([hashPick.key]);
      const stored = pickForNewAgent(index, ["p/office"], "claude", seed, worn)!;
      const drawn = portraitFor(index, null, seed, "claude", ["p/office"], worn)!.picture;
      expect(portraitAvatarOf(drawn)).toEqual(stored);
      expect(drawn.key).not.toBe(hashPick.key);
      // …and once stored, it resolves to itself.
      expect(portraitFor(index, stored, seed, "claude", ["p/office"])!.picture.key).toBe(drawn.key);
    }
  });
});

describe("a pack replaced in place (040 §3.2)", () => {
  const v1 = pack("p", manifest(["lolita", "office"]));
  const stored = (stem: string, theme = "lolita") => portraitAvatarOf({ pack: "p", theme, stem });

  it("same stems keep their pictures", () => {
    const r = resolvePortrait(indexPacks([v1]), portraitRefOf(stored("glm-v3"))!, "s")!;
    expect(r).toMatchObject({ fallback: false, picture: { key: "p/lolita/glm-v3" } });
  });

  it("the pack shrinks (v3 / v4 gone): a stand-in of the same theme and family, by hash", () => {
    const v2 = indexPacks([pack("p", manifest(["lolita", "office"], 2))]);
    const r = resolvePortrait(v2, portraitRefOf(stored("glm-v4"))!, "agent-9")!;
    expect(r.fallback).toBe(true);
    expect(r.picture).toMatchObject({ pack: "p", theme: "lolita", family: "glm" });
    expect(resolvePortrait(v2, portraitRefOf(stored("glm-v4"))!, "agent-9")!.picture.key).toBe(r.picture.key);
  });

  it("a stem renamed: the stored one is gone, the stand-in keeps the family", () => {
    const renamed = { schemaVersion: 1, entries: manifest(["lolita"]).entries.map((e) => ({ ...e, avatarPath: e.avatarPath.replace("-v", "_r") })) };
    const r = resolvePortrait(indexPacks([pack("p", renamed)]), portraitRefOf(stored("kimi-v1"))!, "a")!;
    expect(r).toMatchObject({ fallback: true, picture: { family: "kimi", theme: "lolita" } });
  });

  it("a family emptied in the theme: the same pack's other theme", () => {
    const noGlm = manifest(["lolita"], 4, MODELS.filter((m) => m !== "glm"));
    const r = resolvePortrait(indexPacks([pack("p", { schemaVersion: 1, entries: [...noGlm.entries, ...manifest(["office"]).entries] })]), portraitRefOf(stored("glm-v1"))!, "a")!;
    expect(r).toMatchObject({ fallback: true, picture: { pack: "p", theme: "office", family: "glm" } });
  });

  it("the pack removed: another pack's family; nothing fits: null (the default avatar)", () => {
    const other = indexPacks([pack("q", manifest(["beach"], 1))]);
    expect(resolvePortrait(other, portraitRefOf(stored("deepseek-v2"))!, "a")).toMatchObject({ fallback: true, picture: { pack: "q", family: "deepseek" } });
    expect(resolvePortrait(indexPacks([]), portraitRefOf(stored("deepseek-v2"))!, "a")).toBeNull();
  });

  it("an owner's pack with a shipped id replaces it", () => {
    const mine = { ...pack("p", manifest(["lolita"], 1)), source: "user" as const };
    const merged = mergePacks([v1, pack("z", manifest(["x"], 1))], [mine, { ...pack("m", manifest(["y"], 1)), source: "user" }]);
    expect(merged.map((p) => [p.id, p.source])).toEqual([["p", "user"], ["z", "bundled"], ["m", "user"]]);
  });

  it("重新分配 writes stand-ins only for agents whose picture is gone, unworn ones first in a project; others untouched", () => {
    const v2 = indexPacks([pack("p", manifest(["lolita"], 2))]);
    const agents: AgentForPortrait[] = [
      { seed: "a", hostId: "h", projectId: "x", family: "claude", avatar: stored("claude-v3") },
      { seed: "b", hostId: "h", projectId: "x", family: "claude", avatar: stored("claude-v4") },
      { seed: "c", hostId: "h", projectId: "x", family: "claude", avatar: stored("claude-v1") },
      { seed: "d", hostId: "h", projectId: "x", family: "openai", avatar: { kind: "emoji", value: "🦊" } },
    ];
    expect(fallenBack(v2, agents).map((a) => a.seed)).toEqual(["a", "b"]);
    const plan = planReassign(v2, agents);
    expect(plan.map((c) => c.seed)).toEqual(["a", "b"]);
    // c wears v1; a gets the only unworn one; b (the pool used up) the hash's own.
    expect(portraitRefOf(plan[0]!.after)!.stem).toBe("claude-v2");
    expect(["claude-v1", "claude-v2"]).toContain(portraitRefOf(plan[1]!.after)!.stem);
    expect(plan[0]!.before).toEqual(stored("claude-v3"));
  });
});

describe("都换成勾选的主题", () => {
  const index = indexPacks([pack("p", manifest(["lolita", "office"]))]);
  it("changes agents without an avatar or with a pack picture; never emoji / colour / uploaded / Director avatars", () => {
    const agents: AgentForPortrait[] = [
      { seed: "a", hostId: "h", projectId: "x", family: "claude", avatar: null },
      { seed: "b", hostId: "h", projectId: "x", family: "claude", avatar: portraitAvatarOf({ pack: "p", theme: "lolita", stem: "claude-v1" }) },
      { seed: "c", hostId: "h", projectId: "x", family: "claude", avatar: { kind: "emoji", value: "🦊" } },
      { seed: "d", hostId: "h", projectId: "x", family: "claude", avatar: { kind: "icon", value: "desktop-picture:00000000-0000-0000-0000-000000000000" } },
      { seed: "e", hostId: "h", projectId: "x", family: "claude", avatar: { kind: "icon", value: "director:bundled/x" } },
      { seed: "f", hostId: "h", projectId: "x", family: "other", avatar: null },
    ];
    const plan = planReplaceAll(index, agents, ["p/office"]);
    // f (an unknown family) waits: never another family's face.
    expect(plan.map((c) => c.seed)).toEqual(["a", "b"]);
    expect(plan.every((c) => portraitRefOf(c.after)!.theme === "office")).toBe(true);
    expect(new Set(plan.map((c) => c.after.value)).size).toBe(2);
  });
});

describe("错配修复 (owner 2026-10-28)", () => {
  const index = indexPacks([pack("p", manifest(["lolita", "office"]))]);
  const stored = (stem: string, theme = "lolita") => portraitAvatarOf({ pack: "p", theme, stem });

  it("finds only agents whose stored face is another family's; unknown family never counts", () => {
    const agents: AgentForPortrait[] = [
      { seed: "gpt", hostId: "h", projectId: "x", family: "openai", avatar: stored("glm-v2") },
      { seed: "glm", hostId: "h", projectId: "x", family: "glm", avatar: stored("glm-v1") },
      { seed: "unknown", hostId: "h", projectId: "x", family: "other", avatar: stored("claude-v1") },
      { seed: "noref", hostId: "h", projectId: "x", family: "openai", avatar: { kind: "emoji", value: "🦊" } },
    ];
    expect(familyMismatched(index, agents).map((a) => a.seed)).toEqual(["gpt"]);
  });

  it("重新分配 re-picks a mismatched agent's own family, skipping worn keys; nothing fits = left alone", () => {
    const agents: AgentForPortrait[] = [
      { seed: "a", hostId: "h", projectId: "x", family: "openai", avatar: stored("glm-v1") },
      { seed: "b", hostId: "h", projectId: "x", family: "openai", avatar: stored("gpt-v1") },
    ];
    const plan = planReassign(index, agents);
    expect(plan.map((c) => c.seed)).toEqual(["a"]);
    expect(portraitRefOf(plan[0]!.after)).toMatchObject({ pack: "p", theme: "lolita" });
    expect(portraitRefOf(plan[0]!.after)!.stem).toMatch(/^gpt-v[234]$/);
    // its family's pool empty → left alone, never another family's face
    const noGpt = indexPacks([pack("q", manifest(["lolita"], 4, MODELS.filter((m) => m !== "gpt")))]);
    expect(planReassign(noGpt, [{ seed: "a", hostId: "h", projectId: "x", family: "openai", avatar: stored("glm-v1") }])).toEqual([]);
  });
});
