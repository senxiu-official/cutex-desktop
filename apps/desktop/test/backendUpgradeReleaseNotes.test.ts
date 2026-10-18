// 主机后端更新: what the installed release brought — cutex's own `installed.notes` (upgrade-installed-notes),
// else notes of an offered release kept by this desktop (modules/backend-upgrade/releaseNotes.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { installedReleaseNotes, MAX_RELEASES, rememberReleaseNotes, savedReleaseNotes } from "../src/renderer/src/modules/backend-upgrade/releaseNotes";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});

const offered = (release: string, notes?: Record<string, string>) => ({ available: { release, sequence: 1, tag: release, manifestSha256: "x", class: "reload-safe" as const, mode: "reload" as const, ...(notes ? { notes } : {}) } });

describe("release notes cache", () => {
  beforeEach(() => store.clear());

  it("remembers the offered release's notes and returns them after install", () => {
    rememberReleaseNotes(offered("r241", { en: "Faster", "zh-CN": "更快" }));
    expect(savedReleaseNotes("r241")?.notes).toEqual({ en: "Faster", "zh-CN": "更快" });
    expect(savedReleaseNotes("r240")).toBeNull();
    expect(savedReleaseNotes(null)).toBeNull();
  });

  it("ignores statuses without notes and keeps at most MAX_RELEASES, newest seen", () => {
    rememberReleaseNotes(offered("r1"));
    rememberReleaseNotes({ available: null });
    expect(savedReleaseNotes("r1")).toBeNull();
    for (let i = 0; i < MAX_RELEASES + 5; i++) rememberReleaseNotes(offered(`r${100 + i}`, { en: `n${i}` }), 1000 + i);
    expect(savedReleaseNotes("r100")).toBeNull();
    expect(savedReleaseNotes(`r${100 + MAX_RELEASES + 4}`)?.notes.en).toBe(`n${MAX_RELEASES + 4}`);
  });

  it("survives unreadable storage", () => {
    store.set("cutex-desktop.backend-upgrade.releaseNotes", "{not json");
    expect(savedReleaseNotes("r241")).toBeNull();
    rememberReleaseNotes(offered("r241", { en: "x" }));
    expect(savedReleaseNotes("r241")?.notes.en).toBe("x");
  });
});

describe("installed release notes", () => {
  beforeEach(() => store.clear());
  const installed = (notes?: Record<string, string> | null, publishedAt?: string | null) => ({ release: "r241", sequence: 241, ...(notes !== undefined ? { notes } : {}), ...(publishedAt !== undefined ? { publishedAt } : {}) });

  it("prefers cutex's installed.notes when the host has upgrade-installed-notes", () => {
    rememberReleaseNotes(offered("r241", { en: "cached" }));
    expect(installedReleaseNotes(installed({ en: "own", "zh-CN": "自带" }, "2026-10-20T03:00:00Z"), true)).toEqual({ notes: { en: "own", "zh-CN": "自带" }, publishedAt: "2026-10-20T03:00:00Z", source: "cutex" });
  });

  it("falls back to the cache on an older cutex or when cutex does not know them", () => {
    rememberReleaseNotes(offered("r241", { en: "cached" }));
    // Older cutex: fields ignored even if present.
    expect(installedReleaseNotes(installed({ en: "own" }), false)).toMatchObject({ notes: { en: "cached" }, source: "cache" });
    // Capability, but no manifest (null) or empty notes.
    expect(installedReleaseNotes(installed(null, null), true)).toMatchObject({ notes: { en: "cached" }, source: "cache" });
    expect(installedReleaseNotes(installed({}), true)).toMatchObject({ source: "cache" });
    store.clear();
    expect(installedReleaseNotes(installed(null), true)).toBeNull();
    expect(installedReleaseNotes(null, true)).toBeNull();
  });
});
