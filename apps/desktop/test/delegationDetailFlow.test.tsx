// @vitest-environment jsdom
import { act, createElement as h, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskDetail, AskSummary } from "../src/shared/ipc";
import type { HostsState } from "../src/shared/hosts";

const daemon = vi.hoisted(() => ({
  asks: vi.fn<(filter: Record<string, unknown>) => Promise<AskSummary[] | null>>(),
  ask: vi.fn<(id: string) => Promise<AskDetail | null>>(),
  listeners: new Map<string, (event: any) => void>(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: daemon, apiFor: () => daemon,
  bridge: { on: (name: string, callback: (event: any) => void) => {
    daemon.listeners.set(name, callback); return () => daemon.listeners.delete(name);
  } },
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }), translate: (key: string) => key }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (selector: (s: unknown) => unknown) => selector({}), featuresOf: () => new Set() }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({
  useAgentNames: () => (id: string) => id,
  useAgentProfile: () => null,
  useDelegationContext: () => () => ({}),
}));
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ useModelName: () => (id: string) => id, rawIdTitle: () => "" }));
vi.mock("../src/renderer/src/lib/delegationMenu", () => ({ delegationMenu: () => [] }));
vi.mock("../src/renderer/src/components/Parties", () => ({ Who: () => null }));
vi.mock("../src/renderer/src/components/PeerParty", () => ({ PeerParty: () => null }));
vi.mock("../src/renderer/src/components/DelegationParts", () => ({ DelegationHops: () => null, DelegationTag: () => null, DelegationStatusMark: () => null }));
vi.mock("../src/renderer/src/components/DelegationCard", () => ({ DelegationDetailBody: ({ brief }: { brief: string | null }) => h("p", { "data-brief": true }, brief) }));

import { DetailBody } from "../src/renderer/src/modules/delegations/DetailView";
import { ASKS_FEATURE } from "../src/renderer/src/lib/delegations";
import * as store from "../src/renderer/src/lib/delegationStore";
import { focusHostId, hostKey } from "../src/renderer/src/lib/hostKeys";

const host = focusHostId();
const summary = (askId: string, revision = 1): AskSummary => ({ askId, revision, title: askId,
  requester: { kind: "agent", cutexSessionId: "lead" }, target: "worker", execution: "answered", review: "awaitingAcceptance", closed: null,
  attempts: 1, createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z",
});
const detail = (askId: string, revision = 1, text = "current brief"): AskDetail => ({ ...summary(askId, revision),
  targetCutexSessionId: "worker", attempts: [], body: { text },
}) as unknown as AskDetail;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let root: Root;
let container: HTMLDivElement;
let stop: () => void;
let state: ReturnType<store.AppHandle["getState"]>;
let subscriber: Parameters<store.AppHandle["subscribe"]>[0];
const hosts = (epoch: string, kind = "connected") => ({ hosts: [{ id: host, conn: { epoch, daemon: { kind } } }] }) as HostsState;
const connected = () => daemon.listeners.get("daemonState")!({ hostId: host, state: { kind: "connected" } });
const renderDetail = async (askId = "visible") => {
  const props = { hostId: host, instance: { state: { askId } } } as ComponentProps<typeof DetailBody>;
  await act(async () => root.render(h(DetailBody, props)));
};

// Same one-click demand as DelegationList: expanded state does not call load again on reconnect.
function ClosedBucket() {
  const [expanded, setExpanded] = useState(false);
  const loading = store.useDelegations(s => s.closedLoading);
  const ids = store.useDelegations(s => s.closedIds);
  return h("div", {}, h("button", { onClick: () => {
    if (!expanded) void store.loadClosedDelegations();
    setExpanded(!expanded);
  } }, "closed"), expanded && h("p", {}, loading ? "loading" : ids?.join(",") ?? "unloaded"));
}

beforeEach(async () => {
  vi.useFakeTimers();
  daemon.asks.mockReset().mockResolvedValue([]);
  daemon.ask.mockReset().mockResolvedValue(null);
  state = { features: new Set([ASKS_FEATURE]), selectedId: null, selectedHost: null, byHost: {}, notify() {} };
  stop = store.startDelegationSync({ getState: () => state, subscribe: fn => { subscriber = fn; return () => {}; } });
  await vi.advanceTimersByTimeAsync(0);
  store.useDelegations.getState().reset();
  daemon.asks.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  stop(); container.remove(); vi.useRealTimers();
});

describe("existing delegation view request flows", () => {
  it.each(["404", "error"])("the mounted DetailView gets new detail after reconnect without rerunning its effect; old result=%s", async outcome => {
    const old = deferred<AskDetail | null>();
    const fresh = deferred<AskDetail | null>();
    daemon.ask.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await renderDetail();
    expect(container.textContent).toContain("delegations.loading");
    await act(async () => connected());
    expect(daemon.ask).toHaveBeenCalledTimes(2); // old request need not settle to reissue
    await act(async () => {
      if (outcome === "404") old.resolve(null); else old.reject(new Error("disconnected"));
      fresh.resolve(detail("visible"));
    });
    expect(container.textContent).toContain("current brief");
    expect(container.textContent).not.toContain("delegations.detail.gone");
    expect(daemon.ask).toHaveBeenCalledTimes(2);
  });

  it("the mounted DetailView follows an epoch change before daemonState, with identical host/id/revision", async () => {
    state = { ...state, hosts: hosts("one") };
    const old = deferred<AskDetail | null>();
    daemon.ask.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail("visible"));
    await renderDetail();
    await act(async () => {
      const prev = state;
      state = { ...state, hosts: hosts("two") };
      subscriber(state, prev);
    });
    expect(container.textContent).toContain("current brief");
    await act(async () => old.resolve(null));
    expect(container.textContent).not.toContain("delegations.detail.gone");
    expect(daemon.ask).toHaveBeenCalledTimes(2);
  });

  it("keeps the mounted detail's original promise pending when the new epoch is still connecting before daemonState", async () => {
    state = { ...state, hosts: hosts("one") };
    const old = deferred<AskDetail | null>();
    daemon.ask.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail("visible"));
    // Remembered readiness belongs to epoch one; the new snapshot must override it immediately.
    await act(async () => daemon.listeners.get("daemonState")!({ hostId: host, epoch: "one", state: { kind: "connected" } }));
    await renderDetail();
    await act(async () => {
      const prev = state;
      state = { ...state, hosts: hosts("two", "connecting") };
      subscriber(state, prev);
      old.reject(new Error("old connection ended"));
    });
    expect(daemon.ask).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("delegations.loading");
    expect(container.textContent).not.toContain("delegations.detail.gone");
    // A connected notification can itself arrive before the snapshot catches up.
    await act(async () => daemon.listeners.get("daemonState")!({ hostId: host, epoch: "two", state: { kind: "connected" } }));
    expect(daemon.ask).toHaveBeenCalledTimes(1);
    await act(async () => {
      const prev = state;
      state = { ...state, hosts: hosts("two", "connected") };
      subscriber(state, prev); // same-epoch readiness change must wake the original request
    });
    expect(daemon.ask).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("current brief");
    expect(container.textContent).not.toContain("delegations.detail.gone");
  });

  it("new-epoch concurrent detail callers share one promise and one read", async () => {
    state = { ...state, hosts: hosts("new") }; // generation() must retire the previous epoch first
    const read = deferred<AskDetail | null>();
    daemon.ask.mockReturnValueOnce(read.promise);
    const a = store.loadDelegationDetail(host, "visible");
    const b = store.loadDelegationDetail(host, "visible");
    expect(a).toBe(b);
    expect(daemon.ask).toHaveBeenCalledTimes(1);
    read.resolve(detail("visible"));
    await Promise.all([a, b]);
    expect(store.useDelegations.getState().details[hostKey(host, "visible")]?.revision).toBe(1);
  });

  it("concurrent callers join an obsolete detail's continuation and its late response cannot overwrite the new read", async () => {
    state = { ...state, hosts: hosts("one") };
    const old = deferred<AskDetail | null>();
    const fresh = deferred<AskDetail | null>();
    daemon.ask.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const original = store.loadDelegationDetail(host, "visible");
    state = { ...state, hosts: hosts("two") };
    const a = store.loadDelegationDetail(host, "visible");
    const b = store.loadDelegationDetail(host, "visible");
    expect(a).toBe(original);
    expect(b).toBe(original);
    await act(async () => {});
    expect(daemon.ask).toHaveBeenCalledTimes(2);
    fresh.resolve(detail("visible", 2, "new connection"));
    await original;
    old.resolve(detail("visible", 1, "stale connection"));
    await act(async () => {});
    expect(store.useDelegations.getState().details[hostKey(host, "visible")]?.body?.text).toBe("new connection");
  });

  it("the mounted detail stays pending while disconnected and resumes only after connected", async () => {
    const old = deferred<AskDetail | null>();
    daemon.ask.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail("visible"));
    await renderDetail();
    await act(async () => daemon.listeners.get("daemonState")!({ hostId: host, state: { kind: "disconnected" } }));
    await act(async () => old.resolve(null));
    expect(daemon.ask).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("delegations.loading");
    await act(async () => connected());
    expect(container.textContent).toContain("current brief");
  });

  it("an already expanded closed bucket retries its original request on reconnect without another click", async () => {
    const old = deferred<AskSummary[] | null>();
    daemon.asks.mockImplementation(f => f.state === "closed" ? old.promise : Promise.resolve([]));
    await act(async () => root.render(h(ClosedBucket)));
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("loading");
    daemon.asks.mockImplementation(async f => f.state === "closed" ? [{ ...summary("ended"), closed: "completed" }] : []);
    await act(async () => connected());
    expect(container.textContent).toContain("ended");
    expect(container.textContent).not.toContain("unloaded");
    await act(async () => old.reject(new Error("old transport")));
    expect(container.textContent).toContain("ended");
    expect(daemon.asks.mock.calls.filter(([f]) => f.state === "closed")).toHaveLength(2);
  });

  it("a previously loaded closed bucket refreshes after reconnect without another click", async () => {
    daemon.asks.mockImplementation(async f => f.state === "closed" ? [summary("before")] : []);
    await act(async () => root.render(h(ClosedBucket)));
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("before");
    daemon.asks.mockImplementation(async f => f.state === "closed" ? [summary("after")] : []);
    await act(async () => connected());
    expect(container.textContent).toContain("after");
  });

  it("an expanded loaded bucket reloads on epoch change before daemonState", async () => {
    state = { ...state, hosts: hosts("one") };
    daemon.asks.mockImplementation(async f => f.state === "closed" ? [summary("before")] : []);
    await act(async () => root.render(h(ClosedBucket)));
    await act(async () => container.querySelector("button")!.click());
    daemon.asks.mockImplementation(async f => f.state === "closed" ? [summary("after")] : []);
    await act(async () => {
      const prev = state;
      state = { ...state, hosts: hosts("two") };
      subscriber(state, prev);
    });
    expect(container.textContent).toContain("after");
    expect(daemon.asks.mock.calls.filter(([f]) => f.state === "closed")).toHaveLength(2);
  });

  it("a batch-close list invalidates cached detail revisions; only the mounted view fetches fresh detail", async () => {
    const original = Array.from({ length: 250 }, (_, i) => summary(i === 0 ? "visible" : `hidden-${i}`));
    const details = Object.fromEntries(original.map(d => [hostKey(host, d.askId), detail(d.askId, 1, "old brief")]));
    store.useDelegations.setState({ byKey: store.mergeHostRows({}, host, original), details });
    await renderDetail();
    expect(container.textContent).toContain("old brief");
    expect(daemon.ask).not.toHaveBeenCalled();
    daemon.asks.mockImplementation(async f => f.state === "closed" ? original.map(d => ({ ...d, revision: 2, closed: "completed" })) : []);
    daemon.ask.mockResolvedValue(detail("visible", 2, "fresh closed brief"));
    await act(async () => { await store.refreshOpenDelegations(); });
    expect(container.textContent).toContain("fresh closed brief");
    expect(daemon.ask).toHaveBeenCalledExactlyOnceWith("visible");
    expect(daemon.asks.mock.calls.filter(([f]) => f.state === "closed")).toHaveLength(1);
    expect(Object.keys(store.useDelegations.getState().details)).toEqual([hostKey(host, "visible")]);
  });
});
