// @vitest-environment jsdom
// 服务 page (2026-11-16 audit): when the first list read failed, the page stayed on 「…」 forever — the store
// swallowed the error. The store now keeps the last list and records the issue; the page retries transient ones
// with the shared backoff and always offers 重新加载.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// `pending`: a reply the test settles itself, handed out without the spy (a spy-held rejected promise was
// reported as an unhandled rejection even though the store caught it).
const env = vi.hoisted(() => ({ services: vi.fn(), pending: null as Promise<unknown> | null }));
const read = (...a: unknown[]) => env.pending ?? env.services(...a);
vi.mock("../src/renderer/src/bridge", () => ({
  api: { services: (...a: unknown[]) => read(...a) },
  apiFor: () => ({ services: (...a: unknown[]) => read(...a) }),
  bridge: { on: () => () => {}, api: {}, apiFor: () => ({}) },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useApp } = await import("../src/renderer/src/store");
const { useIssueRetry } = await import("../src/renderer/src/lib/useIssueRetry");
type ReadIssue = import("../src/renderer/src/lib/transientError").ReadIssue;

beforeEach(() => { env.services.mockReset(); env.pending = null; });
afterEach(() => vi.useRealTimers());

it("refreshServices records, per host, why the list read failed, keeps the last list, and clears it once a read works", async () => {
  useApp.setState({ hosts: null, features: new Set(["services"]), services: null, servicesIssues: {} } as never);
  env.services.mockRejectedValueOnce(new Error("heavy_read_capacity_exceeded: heavy-read wait queue is full; retry shortly"));
  await useApp.getState().refreshServices();
  expect(useApp.getState().services).toBeNull();
  expect(useApp.getState().servicesIssues).toEqual({ local: expect.objectContaining({ code: "heavy_read_capacity_exceeded", retrying: true }) });
  env.services.mockResolvedValueOnce({ services: [] });
  await useApp.getState().refreshServices();
  expect(useApp.getState().services).toEqual([]);
  expect(useApp.getState().servicesIssues).toEqual({});
  env.services.mockRejectedValueOnce(new Error("owner_required: not the owner"));
  await useApp.getState().refreshServices();
  expect(useApp.getState().services).toEqual([]);
  expect(useApp.getState().servicesIssues.local).toMatchObject({ code: "owner_required", retrying: false });
});

it("another host's read fails and recovers on its own key; the focus host's list and issue are untouched", async () => {
  const slice = { epoch: "e1", daemon: { kind: "connected" }, features: new Set(["services"]), featuresKnown: true, sidebar: null, approvals: null, services: null, waiting: {} };
  useApp.setState({ hosts: null, features: new Set(["services"]), services: [], servicesIssues: {}, byHost: { "host-b": slice } } as never);
  env.services.mockRejectedValueOnce(new Error("git_status_busy: busy"));
  await useApp.getState().refreshServices("host-b");
  expect(Object.keys(useApp.getState().servicesIssues)).toEqual(["host-b"]);
  expect(useApp.getState().services).toEqual([]);
  env.services.mockResolvedValueOnce({ services: [{ slug: "web" }] });
  await useApp.getState().refreshServices("host-b");
  expect(useApp.getState().servicesIssues).toEqual({});
  expect((useApp.getState().byHost["host-b"] as unknown as { services: unknown }).services).toEqual([{ slug: "web" }]);
  expect(useApp.getState().services).toEqual([]);
});

it("useIssueRetry reloads after 1, 2, 5 s while transient, never for others, and stops on unmount", async () => {
  vi.useFakeTimers();
  const node = document.createElement("div");
  const root = createRoot(node);
  const reload = vi.fn();
  let reloadNow = () => {};
  function Probe({ issue }: { issue: ReadIssue | null }) {
    reloadNow = useIssueRetry(issue, reload);
    return null;
  }
  const busy = (): ReadIssue => ({ code: "git_status_busy", detail: "busy", retrying: true });
  act(() => root.render(h(Probe, { issue: busy() })));
  await vi.advanceTimersByTimeAsync(999);
  expect(reload).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(reload).toHaveBeenCalledTimes(1);
  act(() => root.render(h(Probe, { issue: busy() })));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(reload).toHaveBeenCalledTimes(2);
  act(() => root.render(h(Probe, { issue: busy() })));
  await vi.advanceTimersByTimeAsync(4_999);
  expect(reload).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(reload).toHaveBeenCalledTimes(3);
  // Not retrying: waits for 重新加载.
  act(() => root.render(h(Probe, { issue: { code: "forbidden", detail: "x", retrying: false } })));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).toHaveBeenCalledTimes(3);
  reloadNow();
  expect(reload).toHaveBeenCalledTimes(4);
  // Unmounted while a retry is pending: nothing more.
  act(() => root.render(h(Probe, { issue: busy() })));
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).toHaveBeenCalledTimes(4);
});

// Cross-review 2026-11-16 (gate-notice-review repro): a reply of a replaced connection cleared the current
// connection's issue (cancelling its retry) or overwrote it. List and issue now share one liveness check.
it.each(["old-success", "old-error"])("%s of a replaced followed-host connection leaves the list and issues alone", async (outcome) => {
  const slice = { epoch: "old", daemon: { kind: "connected" }, features: new Set(["services"]), featuresKnown: true, sidebar: null, approvals: null, services: [], waiting: {} };
  useApp.setState({ hosts: null, features: new Set(["services"]), services: [], servicesIssues: {}, byHost: { "host-b": slice } } as never);
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  env.pending = pending;
  const oldRead = useApp.getState().refreshServices("host-b");
  const currentIssues = outcome === "old-success" ? { "host-b": { code: "git_status_busy", detail: "current connection busy", retrying: true } } : {};
  useApp.setState({ byHost: { "host-b": { ...slice, epoch: "new", services: [{ slug: "fresh" }] } }, servicesIssues: currentIssues } as never);
  if (outcome === "old-success") resolve({ services: [{ slug: "old" }] });
  else reject(new Error("owner_required: stale old connection"));
  await oldRead;
  expect(useApp.getState().byHost["host-b"]!.services).toEqual([{ slug: "fresh" }]);
  expect(useApp.getState().servicesIssues).toEqual(currentIssues);
});

it.each(["old-success", "old-error"])("%s of a read from a host that is no longer the focus host leaves the list and issues alone", async (outcome) => {
  const hosts = (active: string) => ({ active, scope: { kind: "host", id: active }, hosts: [], groups: [] });
  useApp.setState({ hosts: hosts("local"), features: new Set(["services"]), services: [{ slug: "mine" }], servicesIssues: {}, byHost: {} } as never);
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  env.pending = pending;
  const oldRead = useApp.getState().refreshServices();
  // The focus moves to another host meanwhile; that one has its own list and a current issue.
  const currentIssues = { local: { code: "git_status_busy", detail: "local busy now", retrying: true } };
  useApp.setState({ hosts: hosts("host-x"), services: [{ slug: "x" }], servicesIssues: currentIssues } as never);
  if (outcome === "old-success") resolve({ services: [{ slug: "old" }] });
  else reject(new Error("owner_required: stale"));
  await oldRead;
  expect(useApp.getState().services).toEqual([{ slug: "x" }]);
  expect(useApp.getState().servicesIssues).toEqual(currentIssues);
});

