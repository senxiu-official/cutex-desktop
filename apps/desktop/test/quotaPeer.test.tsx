// @vitest-environment jsdom
// Profile card quota from another host (owner 2026-11-06, display only): a same-account peer reading
// stands in when this host's is unusable, labelled with host + age, beside this host's own reason; a
// gauge past its reset is unknown (checked as time passes); the store's `quotas` stay this host's.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileItem, QuotaGauge } from "../src/shared/ipc";

const fx = vi.hoisted(() => ({
  peerGauges: [] as unknown[],
  detail: null as unknown,
  quotaCalls: [] as { host: string; profile: string }[],
  peers: [] as { hostId: string; hostName: string; profile: { name: string }; connected: boolean }[],
}));
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  apiFor: (host: string) => ({
    profileQuota: async (profile: string) => (fx.quotaCalls.push({ host, profile }), fx.peerGauges),
    profileQuotaDetail: async () => fx.detail,
  }),
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/lib/profileAccountLinks", () => ({ useProfileAccountLinks: () => ({ self: null, peers: fx.peers, targets: [], refresh: async () => {} }) }));

const { cardQuota, localQuotaReason, quotaAge, useCardQuota } = await import("../src/renderer/src/lib/quotaPeer");
const { nextQuotaReset, quotaGaugeNow, quotaPastReset, quotaUsable } = await import("../src/renderer/src/lib/quota");
const { useApp } = await import("../src/renderer/src/store");

const NOW = Date.UTC(2026, 10, 6, 5, 0, 0);
const S = NOW / 1000;
const win = (id: string, label: string, remaining: number | null, resetAt: number | null, extra: Partial<QuotaGauge> = {}): QuotaGauge =>
  ({ id, label: "Claude", kind: "window", remainingPercent: remaining, balance: null, resetAt, windowLabel: label, observedAt: S - 180, stale: false, ...extra });

describe("quota past reset (one helper)", () => {
  it("turns a window past its reset unknown and leaves balances and future windows alone", () => {
    const past = win("claude-0", "5h", 22, S - 1);
    expect(quotaPastReset(past, NOW)).toBe(true);
    expect(quotaGaugeNow(past, NOW)).toMatchObject({ remainingPercent: null, resetAt: null });
    const future = win("claude-1", "7d", 5, S + 4920);
    expect(quotaGaugeNow(future, NOW)).toBe(future);
    const balance: QuotaGauge = { id: "b", label: "¥", kind: "balance", remainingPercent: null, balance: "12", resetAt: S - 10, windowLabel: null, observedAt: S, stale: false };
    expect(quotaGaugeNow(balance, NOW)).toBe(balance);
    expect(nextQuotaReset([past, future], NOW)).toBe((S + 4920) * 1000);
  });

  it("a reading is usable only with a current, error-free, unexpired gauge", () => {
    expect(quotaUsable(undefined, NOW)).toBe(false);
    expect(quotaUsable([], NOW)).toBe(false);
    expect(quotaUsable([win("a", "5h", 50, S - 1)], NOW)).toBe(false);
    expect(quotaUsable([win("a", "5h", 50, S + 60, { stale: true })], NOW)).toBe(false);
    expect(quotaUsable([win("a", "5h", 50, S + 60, { error: "HTTP 401" })], NOW)).toBe(false);
    expect(quotaUsable([win("a", "5h", 50, S - 1), win("b", "7d", 5, S + 60)], NOW)).toBe(true);
  });
});

describe("card quota choice", () => {
  const peerOk = { hostId: "remote", hostName: "remote", gauges: [win("claude-0", "5h", 93, S + 15720), win("claude-1", "7d", 16, S + 4320)] };

  it("the local reading wins whenever usable, even when a peer's is newer", () => {
    const local = [win("claude-0", "5h", 40, S + 600, { observedAt: S - 3000 }), win("claude-1", "7d", 16, S + 4320)];
    const view = cardQuota(local, [{ ...peerOk, gauges: peerOk.gauges.map((g) => ({ ...g, observedAt: S })) }], NOW);
    expect(view.peer).toBeNull();
    expect(view.gauges?.[0]?.remainingPercent).toBe(40);
  });

  it("an unusable local reading shows the newest usable peer, with the local reason kept", () => {
    const local = [win("claude-0", "5h", 78, S - 60, { stale: true, observedAt: S - 7200 })];
    const older = { hostId: "hachimi", hostName: "hachimi", gauges: peerOk.gauges.map((g) => ({ ...g, observedAt: S - 3600 })) };
    const view = cardQuota(local, [older, peerOk], NOW, { kind: "expiredLogin" });
    expect(view.peer).toMatchObject({ hostId: "remote", hostName: "remote", observedAt: S - 180 });
    expect(view.gauges?.map((g) => g.remainingPercent)).toEqual([93, 16]);
    expect(view.localReason).toEqual({ kind: "expiredLogin" });
  });

  it("past-reset peer gauges are unknown too, and an unusable peer is never used", () => {
    const local = [win("claude-0", "5h", 78, S - 60)];
    const mixed = { ...peerOk, gauges: [win("claude-0", "5h", 30, S - 5), win("claude-1", "7d", 16, S + 4320)] };
    const view = cardQuota(local, [mixed], NOW);
    expect(view.gauges?.map((g) => g.remainingPercent)).toEqual([null, 16]);
    expect(view.localReason).toEqual({ kind: "pastReset" });
    const none = cardQuota(local, [{ ...peerOk, gauges: [win("claude-0", "5h", 30, S - 5)] }], NOW);
    expect(none.peer).toBeNull();
    expect(none.gauges?.[0]?.remainingPercent).toBeNull();
  });

  it("names the local reason: gauge errors, stale age, nothing read", () => {
    expect(localQuotaReason([win("a", "5h", null, null, { error: "HTTP 429", stale: true })], NOW, null)).toEqual({ kind: "error", text: "Claude 5h: HTTP 429" });
    expect(localQuotaReason([win("a", "5h", 70, S + 60, { stale: true, observedAt: S - 7200 })], NOW, null)).toEqual({ kind: "stale", observedAt: S - 7200 });
    expect(localQuotaReason([], NOW, null)).toEqual({ kind: "none" });
    expect([quotaAge(S - 20, NOW), quotaAge(S - 180, NOW), quotaAge(S - 7300, NOW), quotaAge(S - 200_000, NOW)]).toEqual(["<1m", "3m", "2h", "2d"]);
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const profile = { id: "p-eva", name: "Ceobe" } as ProfileItem;
let host: HTMLDivElement, root: Root, seen: ReturnType<typeof useCardQuota> | null;
function Probe() { seen = useCardQuota("eva", profile); return null; }
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

describe("useCardQuota", () => {
  beforeEach(() => {
    fx.quotaCalls.length = 0;
    fx.peers = [{ hostId: "remote", hostName: "remote", profile: { name: "Ceobe" }, connected: true }];
    fx.peerGauges = [win("claude-0", "5h", 93, S + 15720), win("claude-1", "7d", 16, S + 4320)];
    fx.detail = { source: "claude", gauges: [], nativeQuota: { credentialsExpired: true } };
    seen = null;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

  it("shows the peer reading without ever writing it into the store's quotas", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const local =[win("claude-0", "5h", 78, Math.floor(Date.now() / 1000) - 60, { stale: true })];
    useApp.setState({ selectedHost: "eva", quotas: { Ceobe: local } } as never);
    const before = structuredClone(useApp.getState().quotas);
    await act(async () => root.render(h(Probe)));
    await flush();
    expect(fx.quotaCalls).toEqual([{ host: "remote", profile: "Ceobe" }]);
    expect(seen?.peer?.hostName).toBe("remote");
    expect(seen?.gauges?.map((g) => g.remainingPercent)).toEqual([93, 16]);
    expect(seen?.localReason).toEqual({ kind: "expiredLogin" });
    // Auto-pick, the quota wall and the composer read store.quotas: still this host's own, unusable reading.
    expect(useApp.getState().quotas).toEqual(before);
    expect(quotaUsable(useApp.getState().quotas.Ceobe)).toBe(false);
  });

  it("a usable local reading loads no peer, and turns unknown when its reset passes", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
    useApp.setState({ selectedHost: "eva", quotas: { Ceobe: [win("claude-0", "5h", 22, S + 2), win("claude-1", "7d", 16, S + 4320)] } } as never);
    await act(async () => root.render(h(Probe)));
    expect(seen?.peer).toBeNull();
    expect(seen?.gauges?.[0]?.remainingPercent).toBe(22);
    expect(fx.quotaCalls).toEqual([]);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(seen?.gauges?.[0]).toMatchObject({ remainingPercent: null, resetAt: null });
    expect(seen?.gauges?.[1]?.remainingPercent).toBe(16);
  });
});
