// @vitest-environment jsdom
// Cross-review 2026-11-16 (gate-notice-review repros): changes while a folder read is in backoff join the scheduled
// retry instead of reading now, and a rejection after unmount schedules nothing.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/lib/workspaceView", () => ({ workspaceError: (e: unknown) => String(e) }));
import { useListings } from "../src/renderer/src/modules/workspace/explorer/useListings";
import { DirVersions } from "../src/renderer/src/lib/workspaceRefresh";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const scope = { kind: "session" as const, id: "test" };
let root: Root, node: HTMLDivElement;
let mounted = false;
beforeEach(() => { vi.useFakeTimers(); node = document.createElement("div"); document.body.append(node); root = createRoot(node); mounted = true; });
afterEach(() => { if (mounted) act(() => root.unmount()); node.remove(); vi.clearAllTimers(); vi.useRealTimers(); });
function Probe({ api, dirs }: { api: any; dirs: DirVersions }) { useListings(api, scope, dirs, [""]); return null; }
it("file change notifications cannot bypass a pending fsDir backoff", async () => {
  const dirs = new DirVersions();
  const api = { fsDir: vi.fn().mockRejectedValue(new Error("heavy_read_capacity_exceeded: busy")) };
  await act(async () => root.render(h(Probe, { api, dirs })));
  expect(api.fsDir).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 4; ++i) await act(async () => dirs.invalidate({ all: true }));
  expect(api.fsDir).toHaveBeenCalledTimes(1);
});
it("a late rejection cannot schedule a retry after unmount", async () => {
  let reject!: (error: unknown) => void;
  const api = { fsDir: vi.fn(() => new Promise((_, no) => { reject = no; })) };
  await act(async () => root.render(h(Probe, { api, dirs: new DirVersions() })));
  act(() => root.unmount()); mounted = false;
  await act(async () => reject(new Error("heavy_read_capacity_exceeded: busy")));
  expect(vi.getTimerCount()).toBe(0);
});
