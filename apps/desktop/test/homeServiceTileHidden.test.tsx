// @vitest-environment jsdom
// Service tiles while the window is hidden (modules/home/hooks useServiceTile; widget idle study 2026-11-09): no
// refresh while `document.hidden` (minimised, in the tray), one read when the window is back in view, and none
// when the entry is still fresh.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ tileReads: 0, imageReads: 0 }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/modules/app", () => ({
  services: {
    daemonFor: () => ({
      serviceTile: () => {
        fx.tileReads++;
        return Promise.resolve({ tile: { title: "第 12 章", image: "/cover.jpg", refreshSeconds: 60 }, fetchedAt: null, error: null, source: "service" });
      },
      serviceTileImage: () => {
        fx.imageReads++;
        return Promise.resolve({ dataUrl: "data:image/png;base64,TILE" });
      },
    }),
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { SERVICE_TILES_FEATURE } from "../src/shared/home";
import { useApp } from "../src/renderer/src/store";
import { useServiceTile } from "../src/renderer/src/modules/home/hooks";

let hidden = false;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let slugSeq = 0;

function setHidden(next: boolean): void {
  hidden = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function Probe({ slug }: { slug: string }) {
  const { answer } = useServiceTile("local", slug, true);
  return h("span", { "data-title": answer?.tile?.title ?? "" });
}

async function mount(): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // A slug of its own per test: the tile cache is module-wide.
  const slug = `book-${++slugSeq}`;
  await act(async () => root!.render(h(Probe, { slug })));
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  hidden = false;
  fx.tileReads = 0;
  fx.imageReads = 0;
  useApp.setState({ hosts: null, daemon: { kind: "connected" } as never, features: new Set([SERVICE_TILES_FEATURE]), featuresKnown: true });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe("useServiceTile while the window is hidden", () => {
  it("reads nothing while hidden, then exactly once when the window is back in view", async () => {
    hidden = true;
    await mount();
    await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
    await flush();
    expect(fx.tileReads).toBe(0);
    expect(fx.imageReads).toBe(0);

    await act(async () => setHidden(false));
    await flush();
    expect(fx.tileReads).toBe(1);
    expect(fx.imageReads).toBe(1);
    expect(host!.querySelector("span")!.getAttribute("data-title")).toBe("第 12 章");

    // A timer tick right after: the entry is fresh (refreshSeconds 60), no second read.
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();
    expect(fx.tileReads).toBe(1);
  });

  it("stops refreshing when the window is hidden after the first read, and reads a stale entry once on return", async () => {
    await mount();
    await flush();
    expect(fx.tileReads).toBe(1);

    await act(async () => setHidden(true));
    await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
    await flush();
    expect(fx.tileReads).toBe(1);

    await act(async () => setHidden(false));
    await flush();
    expect(fx.tileReads).toBe(2);
    // Another visibility event while the read is fresh: nothing.
    await act(async () => setHidden(false));
    await flush();
    expect(fx.tileReads).toBe(2);
  });

  it("a fresh entry is not read again when the window comes back", async () => {
    await mount();
    await flush();
    await act(async () => setHidden(true));
    await act(async () => { vi.advanceTimersByTime(20_000); });
    await act(async () => setHidden(false));
    await flush();
    expect(fx.tileReads).toBe(1);
  });
});
