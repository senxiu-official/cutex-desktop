import { expect, it, vi } from "vitest";
import { TerminalRowsStore } from "../src/renderer/src/lib/terminalRowsStore";
import type { BackgroundTerminal } from "../src/shared/ipc";

const row: BackgroundTerminal = { itemId: "bash", processId: "task-1", command: "bash final-a.sh", cwd: "/work", osPid: null, cpuPercent: null, rssKb: null };
it("publishes the chip's result to an already mounted empty Shelf, coalescing reads and retaining exact host/agent/thread scopes", async () => {
  const cache = new TerminalRowsStore();
  const chip = vi.fn(), shelf = vi.fn();
  const stopChip = cache.subscribe("host-a/agent-a/thread-a/1", chip);
  const stopShelf = cache.subscribe("host-a/agent-a/thread-a/1", shelf);
  const empty = vi.fn(async () => []);
  await cache.read("host-a/agent-a/thread-a/1", "before-task", empty);
  expect(cache.get("host-a/agent-a/thread-a/1")).toEqual([]);
  const fetch = vi.fn(async () => [row]);
  await Promise.all([cache.read("host-a/agent-a/thread-a/1", "task-started", fetch), cache.read("host-a/agent-a/thread-a/1", "task-started", fetch)]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(cache.get("host-a/agent-a/thread-a/1")).toEqual([row]);
  expect(chip).toHaveBeenCalledTimes(2);
  expect(shelf).toHaveBeenCalledTimes(2);
  expect(cache.get("host-b/agent-a/thread-a/1")).toEqual([]);
  expect(cache.get("host-a/agent-b/thread-a/1")).toEqual([]);
  stopChip(); stopShelf();
});

it("does not let an earlier empty response overwrite a newly observed task; terminate invalidates a fresh cached list", async () => {
  const cache = new TerminalRowsStore();
  let resolve!: (value: BackgroundTerminal[]) => void;
  const pending = cache.read("k", "before", () => new Promise(r => { resolve = r; }));
  await cache.read("k", "started", async () => [row]);
  resolve([]);
  expect(await pending).toBeNull();
  expect(cache.get("k")).toEqual([row]);
  cache.invalidate("k");
  await cache.read("k", "started", async () => []);
  expect(cache.get("k")).toEqual([]);
});
