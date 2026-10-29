// @vitest-environment jsdom
// The desktop background at startup (owner 2026-10-21; modules/home/backdrop, Parts DesktopBackdrop, hooks
// useCoverRead): the last resolved background is remembered on this device and drawn at once; with nothing
// remembered the neutral sky scene shows (never an unrelated launch-art portrait) until the home settings —
// and the cover — are known; a different answer cross-fades in (instant with reduced motion); a cover too big
// to remember is scaled down, else remembered without its image.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ coverReads: 0, cover: "data:image/png;base64,HOST" as string | null }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/modules/app", () => ({
  services: {
    daemonFor: () => ({
      homeCover: () => {
        fx.coverReads++;
        return Promise.resolve(fx.cover ? { dataUrl: fx.cover } : null);
      },
    }),
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  BACKDROP_CACHE_KEY,
  COVER_CACHE_MAX,
  backdropId,
  cachedBackdrop,
  cachedCoverFor,
  parseBackdrop,
  rememberBackdrop,
  resetBackdropCacheForTests,
  resolveBackdrop,
  sameBackdrop,
  shownBackdrop,
  type BackdropInput,
  type DeskBackdrop,
} from "../src/renderer/src/modules/home/backdrop";
import { DesktopBackdrop } from "../src/renderer/src/modules/home/Parts";
import { useCoverRead } from "../src/renderer/src/modules/home/hooks";

const COVER = "data:image/jpeg;base64,COVER";
const ready = { status: "ready" as const };
const hostEntry = (coverEtag: string | null) => ({ status: "ready" as const, source: "host" as const, coverEtag });
const base: BackdropInput = { hostId: "local", bootEntry: ready, entry: hostEntry("e1"), cover: COVER, artReady: true, artProvider: "codex" };

beforeEach(() => {
  localStorage.clear();
  resetBackdropCacheForTests();
  fx.coverReads = 0;
  fx.cover = "data:image/png;base64,HOST";
});

describe("resolveBackdrop: what the host's settings say (null = not known yet)", () => {
  it("the cover once read; the art when the host has no cover (or it turned out empty); the sky when there is no art", () => {
    expect(resolveBackdrop(base)).toEqual({ kind: "cover", hostId: "local", etag: "e1", dataUrl: COVER, exact: true });
    expect(resolveBackdrop({ ...base, entry: hostEntry(null), cover: undefined })).toEqual({ kind: "art", provider: "codex" });
    expect(resolveBackdrop({ ...base, cover: false })).toEqual({ kind: "art", provider: "codex" });
    expect(resolveBackdrop({ ...base, entry: hostEntry(null), artProvider: null })).toEqual({ kind: "scene" });
    // This device keeps the document (a host without `user-home`): no cover.
    expect(resolveBackdrop({ ...base, entry: { status: "ready", source: "local", coverEtag: "e1" } })).toEqual({ kind: "art", provider: "codex" });
  });

  it("unknown while anything it depends on is still loading — never the art as a stand-in", () => {
    expect(resolveBackdrop({ ...base, hostId: null })).toBeNull();
    expect(resolveBackdrop({ ...base, bootEntry: null })).toBeNull();
    expect(resolveBackdrop({ ...base, bootEntry: { status: "loading" } })).toBeNull();
    expect(resolveBackdrop({ ...base, entry: null })).toBeNull();
    expect(resolveBackdrop({ ...base, entry: { ...hostEntry("e1"), status: "loading" } })).toBeNull();
    expect(resolveBackdrop({ ...base, entry: { ...hostEntry("e1"), status: "error" } })).toBeNull();
    // The cover is named but not read yet.
    expect(resolveBackdrop({ ...base, cover: null })).toBeNull();
    expect(resolveBackdrop({ ...base, cover: undefined })).toBeNull();
    // No cover, but the imported art is not known yet (the portrait could still change).
    expect(resolveBackdrop({ ...base, entry: hostEntry(null), artReady: false })).toBeNull();
  });

  it("what is drawn: the known one, else the remembered one, else the neutral sky scene (not a portrait)", () => {
    const art: DeskBackdrop = { kind: "art", provider: "claude" };
    const cover: DeskBackdrop = { kind: "cover", hostId: "local", etag: "e1", dataUrl: COVER };
    expect(shownBackdrop(null, null)).toEqual({ kind: "scene" });
    expect(shownBackdrop(null, cover)).toBe(cover);
    expect(shownBackdrop(art, cover)).toBe(art);
    expect(sameBackdrop(cover, { ...cover, dataUrl: "data:image/jpeg;base64,SMALL" })).toBe(true);
    expect(sameBackdrop(cover, { ...cover, etag: "e2" })).toBe(false);
    expect(sameBackdrop(art, { kind: "art", provider: "codex" })).toBe(false);
    expect(backdropId(cover)).not.toBe(backdropId({ ...cover, dataUrl: null }));
  });
});

describe("the remembered background (this device)", () => {
  it("is written once known and read back on the next start; a malformed entry counts as none", async () => {
    expect(cachedBackdrop()).toBeNull();
    await rememberBackdrop({ kind: "cover", hostId: "local", etag: "e1", dataUrl: COVER, exact: true });
    resetBackdropCacheForTests(); // a new start
    expect(cachedBackdrop()).toEqual({ kind: "cover", hostId: "local", etag: "e1", dataUrl: COVER, exact: true });
    expect(cachedCoverFor("local", "e1")).toBe(COVER);
    expect(cachedCoverFor("local", "e2")).toBeNull();
    await rememberBackdrop({ kind: "art", provider: "kimi" });
    resetBackdropCacheForTests();
    expect(cachedBackdrop()).toEqual({ kind: "art", provider: "kimi" });
    for (const raw of ["{", "null", '{"kind":"art","provider":"nope"}', '{"kind":"cover","hostId":"x"}', '{"kind":"cover","hostId":"x","etag":"e","dataUrl":"javascript:1"}'])
      expect(parseBackdrop(raw), raw).toEqual(raw.includes("javascript") ? { kind: "cover", hostId: "x", etag: "e", dataUrl: null } : null);
  });

  it("a cover too big to keep is scaled down (not exact: the host's image is still read); else kept without the image", async () => {
    const big = `data:image/png;base64,${"A".repeat(COVER_CACHE_MAX + 10)}`;
    const shrink = vi.fn(async () => "data:image/jpeg;base64,SMALL");
    await rememberBackdrop({ kind: "cover", hostId: "local", etag: "e1", dataUrl: big, exact: true }, shrink);
    expect(shrink).toHaveBeenCalledOnce();
    resetBackdropCacheForTests();
    expect(cachedBackdrop()).toEqual({ kind: "cover", hostId: "local", etag: "e1", dataUrl: "data:image/jpeg;base64,SMALL" });
    expect(cachedCoverFor("local", "e1")).toBeNull();
    // Already remembered (same cover): nothing written again.
    await rememberBackdrop({ kind: "cover", hostId: "local", etag: "e1", dataUrl: big, exact: true }, shrink);
    expect(shrink).toHaveBeenCalledOnce();
    // Cannot scale it down: remembered without the image (the next start shows the sky, not a portrait).
    await rememberBackdrop({ kind: "cover", hostId: "local", etag: "e2", dataUrl: big, exact: true }, async () => null);
    resetBackdropCacheForTests();
    expect(cachedBackdrop()).toEqual({ kind: "cover", hostId: "local", etag: "e2", dataUrl: null });
    expect(localStorage.getItem(BACKDROP_CACHE_KEY)!.length).toBeLessThan(200);
  });
});

describe("rendered", () => {
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const layers = () => [...container.querySelectorAll<HTMLElement>("[data-home-backdrop-layer]")].map((l) => `${l.dataset.homeBackdropLayer}:${l.className.includes("home-backdrop-in") ? "fade" : "still"}:${l.querySelector("img")?.getAttribute("src") ?? "-"}`);

  it("draws the background at once (no fade at startup); a different one cross-fades in over the old, which goes once the fade ends", async () => {
    const remembered: DeskBackdrop = { kind: "cover", hostId: "local", etag: "e1", dataUrl: COVER };
    await act(async () => root.render(h(DesktopBackdrop, { backdrop: remembered })));
    expect(container.querySelector<HTMLElement>("[data-home-backdrop]")!.dataset.homeBackdrop).toBe("cover");
    expect(layers()).toEqual([`in:still:${COVER}`]);
    // The same background again (a new object): nothing changes.
    await act(async () => root.render(h(DesktopBackdrop, { backdrop: { ...remembered } })));
    expect(layers()).toEqual([`in:still:${COVER}`]);
    const next: DeskBackdrop = { kind: "cover", hostId: "local", etag: "e2", dataUrl: "data:image/jpeg;base64,NEW" };
    await act(async () => root.render(h(DesktopBackdrop, { backdrop: next })));
    expect(layers()).toEqual([`out:still:${COVER}`, "in:fade:data:image/jpeg;base64,NEW"]);
    const fading = container.querySelector('[data-home-backdrop-layer="in"]')!;
    // (jsdom: React may listen to the vendor-prefixed name.)
    await act(async () => {
      for (const type of ["animationend", "webkitAnimationEnd"]) fading.dispatchEvent(new Event(type, { bubbles: true }));
    });
    expect(layers()).toEqual(["in:still:data:image/jpeg;base64,NEW"]);
  });

  it("reduced motion: the new background replaces the old at once", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    await act(async () => root.render(h(DesktopBackdrop, { backdrop: { kind: "scene" } })));
    await act(async () => root.render(h(DesktopBackdrop, { backdrop: { kind: "cover", hostId: "local", etag: "e1", dataUrl: COVER } })));
    expect(layers()).toEqual([`in:still:${COVER}`]);
  });

  it("nothing known, nothing remembered: the sky scene alone — no portrait", async () => {
    await act(async () => root.render(h(DesktopBackdrop, { backdrop: shownBackdrop(null, cachedBackdrop()) })));
    expect(container.querySelector<HTMLElement>("[data-home-backdrop]")!.dataset.homeBackdrop).toBe("scene");
    expect(container.querySelector("img")).toBeNull();
  });

  it("a remembered cover that is the host's image as it is stands in for reading it; another etag is read", async () => {
    await rememberBackdrop({ kind: "cover", hostId: "local", etag: "e1", dataUrl: COVER, exact: true });
    resetBackdropCacheForTests();
    const seen: unknown[] = [];
    const Probe = ({ etag }: { etag: string }) => {
      seen.push(useCoverRead("local", etag));
      return null;
    };
    await act(async () => root.render(h(Probe, { etag: "e1" })));
    expect(seen.at(-1)).toBe(COVER);
    expect(fx.coverReads).toBe(0);
    await act(async () => root.render(h(Probe, { etag: "e2" })));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(fx.coverReads).toBe(1);
    expect(seen.at(-1)).toBe("data:image/png;base64,HOST");
    // The host has no image for an etag: `false` (known: none), not "still loading".
    fx.cover = null;
    await act(async () => root.render(h(Probe, { etag: "e3" })));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(seen.at(-1)).toBe(false);
  });
});
