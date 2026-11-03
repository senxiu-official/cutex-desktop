// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { observeDebug } from "../src/renderer/src/lib/debugObserver";
import type { DebugEntry } from "../src/shared/debug";
import { JSDOM } from "jsdom";
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  delete (window as unknown as Record<string, unknown>).__cutexDebugReact;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
it("cleans up after a desk's window/document has already been destroyed", () => {
  const desk = new JSDOM("<main>desk</main>", { url: "http://localhost/" });
  const observer = observeDebug(desk.window as unknown as Window, async () => {});
  desk.window.close();
  expect(() => observer.stop()).not.toThrow();
});
it("records LoAF script attribution, short visibility changes and React owners; releases all sampling when stopped", async () => {
  vi.useFakeTimers();
  const instances: { type: string; callback: (list: { getEntries(): unknown[] }) => void; disconnect: () => void }[] = [];
  class Observer {
    type = "";
    disconnect = vi.fn();
    constructor(readonly callback: (list: { getEntries(): unknown[] }) => void) { instances.push(this); }
    observe({ type }: { type: string }) { this.type = type; }
  }
  vi.stubGlobal("PerformanceObserver", Observer);
  document.body.innerHTML = '<main id="pane">History</main>';
  Object.assign(document.getElementById("pane")!, { __reactFiber$probe: { type: { name: "Conversation" } } });
  const received: DebugEntry[] = [], send = vi.fn(async (entries: DebugEntry[]) => { received.push(...entries); });
  const observer = observeDebug(window, send);
  expect(instances).toHaveLength(2);
  instances.find(i => i.type === "long-animation-frame")!.callback({ getEntries: () => [{ startTime: 10, duration: 85, scripts: [{ sourceURL: "app.js", sourceFunctionName: "paintPane", duration: 80, forcedStyleAndLayoutDuration: 12 }] }] });
  const pane = document.getElementById("pane")!;
  pane.style.opacity = "0"; pane.style.opacity = "1";
  await Promise.resolve();
  await observer.flush();
  expect(received.find(e => e.kind === "long-animation-frame")?.data).toMatchObject({ scripts: [{ sourceURL: "app.js", sourceFunctionName: "paintPane" }] });
  expect(received.find(e => e.kind === "visibility-change")?.data).toMatchObject({ components: ["Conversation"] });
  observer.stop(); send.mockClear();
  pane.style.opacity = "0";
  document.body.append(document.createElement("div"));
  await Promise.resolve(); await vi.advanceTimersByTimeAsync(2000);
  expect(send).not.toHaveBeenCalled();
  expect(instances.every(i => vi.mocked(i.disconnect).mock.calls.length === 1)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
