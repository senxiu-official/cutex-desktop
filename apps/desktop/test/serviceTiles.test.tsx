// @vitest-environment jsdom
// Perf audit 2026-11-24 #4 (renderer half): service cards take static tiles from the list, ask for the others only
// near the viewport, and at most TILE_READS_PER_HOST at a time per host.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ServiceView } from "../src/shared/ipc";

const reads: { hostId: string; slug: string }[] = [];
let answer: (slug: string) => Promise<unknown> = async () => null;
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  apiFor: (hostId: string) => ({ serviceTile: (slug: string) => { reads.push({ hostId, slug }); return answer(slug); } }),
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "zh-CN" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ServiceCards } = await import("../src/renderer/src/modules/services/ServiceCards");
const { listedTile, queuedTileRead, TILE_READS_PER_HOST } = await import("../src/renderer/src/modules/services/serviceTiles");
type Row = import("../src/renderer/src/modules/services/ServiceCards").ServiceCardRow;

const service = (slug: string, extra: Record<string, unknown> = {}): ServiceView => ({
  slug, displayName: slug, host: "h", port: 1, path: null, ownerCutexSessionId: null, projectId: null, runtime: "managed", lifetime: "persistent", purpose: null,
  groupName: null, starred: false, sortOrder: 0, archived: false, createdAt: "2026-11-24T00:00:00Z", lastSeenAt: null, health: "reachable", url: "", localUrl: "", ...extra,
} as ServiceView);
const row = (item: ServiceView, hostId = "h1"): Row => ({ hostId, key: `${hostId}/${item.slug}`, item });
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); }); };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  reads.length = 0; answer = async () => null;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const draw = (rows: Row[]) => act(() => root.render(h(ServiceCards, {
  rows, ownerName: () => "owner", hostName: () => "HOST", stale: () => false, tileEnabled: () => true,
  organizable: () => true, menu: () => [], refresh: async () => {}, error: () => {},
})));
const title = (slug: string) => host.querySelector(`[data-service-card="h1/${slug}"] .truncate.text-sm`)?.textContent;

it("reads the tile from the list when the route would answer the static template; a worker without one has none", () => {
  expect(listedTile(service("a", { tile: { title: "Static", badge: "OK" } }))).toEqual({ tile: { title: "Static", badge: "OK" } });
  expect(listedTile(service("b", { tile: { title: "Static" }, tilePath: "/tile.json" }))).toBeUndefined();
  expect(listedTile(service("c"))).toBeUndefined();
  expect(listedTile(service("d", { tilePath: "/t.json" }))).toBeUndefined();
  expect(listedTile(service("w", { runtime: "worker", port: null }))).toEqual({ tile: null });
  expect(listedTile(service("w2", { runtime: "worker", port: null, tile: { title: "Job" } }))).toEqual({ tile: { title: "Job" } });
  // Sanitised as the route's answer is (shared/home readServiceTile).
  expect(listedTile(service("x", { tile: { title: "T", image: "https://example.com/x.png" } }))!.tile).toEqual({ title: "T" });
});

it("cards with a listed tile show it without a request; the others ask the tile route", async () => {
  answer = async (slug) => ({ tile: { title: `Live ${slug}` }, fetchedAt: null, error: null, source: "service" });
  draw([row(service("static", { tile: { title: "From list" } })), row(service("live")), row(service("job", { runtime: "worker", port: null }))]);
  await flush();
  expect(reads.map((r) => r.slug)).toEqual(["live"]);
  expect(title("static")).toBe("From list");
  expect(title("live")).toBe("Live live");
  expect(title("job")).toBe("job");
});

it("asks only for cards near the viewport", async () => {
  const observed: { el: Element; callback: IntersectionObserverCallback }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(el: Element) { observed.push({ el, callback: this.callback }); }
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  });
  draw(["a", "b", "c"].map((slug) => row(service(slug))));
  await flush();
  expect(reads).toEqual([]); expect(observed).toHaveLength(3);
  const b = observed.find((o) => o.el.getAttribute("data-service-card") === "h1/b")!;
  act(() => b.callback([{ isIntersecting: true, target: b.el } as IntersectionObserverEntry], {} as IntersectionObserver));
  await flush();
  expect(reads.map((r) => r.slug)).toEqual(["b"]);
});

it(`bounds tile requests to ${TILE_READS_PER_HOST} per host, others wait; another host has its own slots`, async () => {
  const gates = new Map<string, ReturnType<typeof deferred<unknown>>>();
  answer = (slug) => { const gate = deferred<unknown>(); gates.set(slug, gate); return gate.promise; };
  const slugs = Array.from({ length: 10 }, (_, i) => `s${i}`);
  draw([...slugs.map((slug) => row(service(slug))), row(service("other"), "h2")]);
  await flush();
  expect(reads.filter((r) => r.hostId === "h1")).toHaveLength(TILE_READS_PER_HOST);
  expect(reads.filter((r) => r.hostId === "h2")).toHaveLength(1);
  gates.get("s0")!.resolve(null); await flush();
  expect(reads.filter((r) => r.hostId === "h1")).toHaveLength(TILE_READS_PER_HOST + 1);
  for (const slug of slugs) { gates.get(slug)?.resolve(null); await flush(); }
  for (const slug of slugs) { gates.get(slug)?.resolve(null); await flush(); }
  expect(reads.filter((r) => r.hostId === "h1").map((r) => r.slug)).toEqual(slugs);
});

it("a card gone before its turn gives the slot to the next without asking", async () => {
  const first = Array.from({ length: TILE_READS_PER_HOST }, () => deferred<string>());
  const running = first.map((gate) => queuedTileRead("q", () => true, () => gate.promise));
  const skipped = vi.fn(async () => "never");
  let wanted = true;
  const late = queuedTileRead("q", () => wanted, skipped);
  const next = queuedTileRead("q", () => true, async () => "next");
  wanted = false;
  first[0]!.resolve("done");
  expect(await late).toBeUndefined(); expect(skipped).not.toHaveBeenCalled();
  expect(await next).toBe("next");
  for (const gate of first) gate.resolve("done");
  expect(await Promise.all(running)).toEqual(Array(TILE_READS_PER_HOST).fill("done"));
});
