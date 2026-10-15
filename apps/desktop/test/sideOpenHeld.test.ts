// services.side.openHeld / releaseHold (contract v1.10, docs/desktop-modules.md §18.14): a background
// card created and held mounted in one atomic call — mounted from its first render with the column
// closed, refusals change nothing, no reveal / focus / selection change, holds keyed per scope, and the
// caller's locator drops only its own pre-hold (timeout / cancel / relay generation change).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideComponentItem, SideHoldLocator } from "../src/renderer/src/modules/slots";

type Host = { id: string; conn: { epoch: string | null } };
const env = vi.hoisted(() => ({
  app: null as unknown as Record<string, unknown> & { hosts: { active: string; scope: { kind: string; id: string }; hosts: Host[]; groups: unknown[] }; selectedId: string | null },
  prefs: { sideKeepHidden: 4, sideKeepMounted: 2, sidePreview: "replace", peekTarget: "auto" } as Record<string, unknown>,
  registry: new Map<string, { moduleId: string; item: Partial<SideComponentItem> }>(),
}));

vi.mock("../src/renderer/src/store", () => ({
  useApp: { getState: () => env.app },
  agentHost: (s: { selectedHost?: string | null; hosts: { active: string } }) => s.selectedHost ?? s.hosts.active,
  selectedSidebar: (s: { sidebar: unknown }) => s.sidebar,
  sidebarOf: (s: { sidebar: unknown; hosts: { active: string } }, hostId: string) => (hostId === s.hosts.active ? s.sidebar : null),
}));
vi.mock("../src/renderer/src/lib/prefs", () => ({ getUiPrefs: () => env.prefs }));
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ modules: [{ id: "probe", contributes: { "side.component": [{ id: "probe.tab" }, { id: "probe.plain" }] } }], statuses: () => new Map() }),
}));
vi.mock("../src/renderer/src/lib/sideComponents", async () => {
  const { placeSpec } = await import("../src/renderer/src/lib/sideLayout");
  return {
    sideRegistry: () => env.registry,
    specFrom: (registry: typeof env.registry, kind: string) => {
      const e = registry.get(kind);
      return e ? placeSpec(e.item.placement!) : null;
    },
    dedupeKeyOf: (item: Partial<SideComponentItem>, params: unknown) => (item.dedupeKey ? item.dedupeKey(params as never) : null),
    sideViewNow: () => ({ hostId: env.app.hosts.active, sessionId: env.app.selectedId, workspaceKey: null, available: (k: string) => env.registry.has(k) }),
  };
});

const { sideOpenHeld, sideReleaseHold, sideOpen } = await import("../src/renderer/src/lib/sideServices");
const { useSide } = await import("../src/renderer/src/lib/sideLayoutStore");
const { emptyLayout } = await import("../src/renderer/src/lib/sideLayout");
const keep = await import("../src/renderer/src/lib/sideKeep");
const { holdKey, mountPlan, pruneHolds, setSideHold, useSideKeep, resetSideHolds, admitHold, holdScopeCheck, releaseTicket } = keep;

const item = (keepAlive: "hidden" | "unmount", extra: Partial<SideComponentItem> = {}): Partial<SideComponentItem> => ({
  instances: "multi",
  defaultBinding: "agent",
  placement: { home: "browser" },
  keepAlive,
  parseParams: (p) => p,
  init: (p) => p,
  ...extra,
});

const BG = { kind: "agent" as const, hostId: "local", sessionId: "s-bg" };

function reset(scope = "local") {
  env.app = {
    hosts: { active: scope, scope: { kind: "host", id: scope }, hosts: [{ id: "local", conn: { epoch: "e1" } }, { id: "ssh-a", conn: { epoch: "a1" } }], groups: [] },
    selectedId: "s-sel",
    selectedHost: null,
    sidebar: { active: [{ cutexSessionId: "s-sel" }, { cutexSessionId: "s-bg" }], retired: [], hostRows: {} },
    byHost: {},
    view: { kind: "conversation" },
  };
  useSide.setState({ scope: `host:${scope}`, layout: emptyLayout(), mode: null, revealed: {}, tabInfo: {}, flash: null, focusedCard: null });
}

/** The instance layer's mount plan for the loaded scope, nothing on screen (column closed). */
function mountedNow(): string[] {
  const { scope, layout } = useSide.getState();
  const held = new Set(Object.values(useSideKeep.getState().holds).filter((h) => h.scope === scope && layout.instances[h.id]).map((h) => h.id));
  return mountPlan({ onScreen: [], kept: [], keepable: () => false, held, modeKept: [], keepHidden: 4 }).mounted;
}

beforeEach(() => {
  env.registry = new Map([
    ["probe.tab", { moduleId: "probe", item: item("hidden") }],
    ["probe.plain", { moduleId: "probe", item: item("unmount") }],
  ]);
  env.prefs.sideKeepMounted = 2;
  resetSideHolds();
  reset();
});

describe("openHeld: background card, held from its first render", () => {
  it("with the column closed, a new card for a non-selected agent is in mountPlan.mounted", () => {
    const r = sideOpenHeld("probe.tab", { url: "about:blank" }, { binding: BG });
    expect(r).toMatchObject({ status: "opened", reused: false });
    if (r.status !== "opened") return;
    const { scope, layout } = useSide.getState();
    expect(layout.instances[r.instanceId]?.binding).toEqual(BG);
    // The hold exists before any render: the Body's first render reads held = true.
    expect(useSideKeep.getState().holds[holdKey(scope!, r.instanceId)]).toMatchObject({ scope, id: r.instanceId, epoch: "e1", ticket: { created: true } });
    expect(mountedNow()).toEqual([r.instanceId]);
    expect(r.hold).toMatchObject({ scope: "host:local", instanceId: r.instanceId });
  });

  it("does not reveal, focus, switch page or change the selected agent", () => {
    const before = useSide.getState();
    const r = sideOpenHeld("probe.tab", {}, { binding: BG });
    expect(r.status).toBe("opened");
    const after = useSide.getState();
    expect(after.layout.open).toBe(false);
    expect(after.layout.activePage).toBe(before.layout.activePage);
    expect(after.revealed).toEqual({});
    expect(after.flash).toBeNull();
    expect(after.mode).toBeNull();
    expect(after.focusedCard).toBeNull();
    expect(after.scope).toBe(before.scope);
    expect(env.app.selectedId).toBe("s-sel");
    expect(env.app.hosts.active).toBe("local");
  });

  it("does not open a closed column or switch away from the page the selected agent is on", () => {
    sideOpen("probe.plain", {}, { binding: { kind: "agent", hostId: "local", sessionId: "s-sel" } });
    const before = useSide.getState().layout;
    expect(before.open).toBe(true);
    const r = sideOpenHeld("probe.tab", {}, { binding: BG });
    expect(r.status).toBe("opened");
    const after = useSide.getState().layout;
    expect(after.open).toBe(true);
    expect(after.activePage).toBe(before.activePage);
  });

  it("reusing an instance (same dedupe key) holds it without a ticket of its own when already held", () => {
    env.registry.set("probe.tab", { moduleId: "probe", item: item("hidden", { dedupeKey: (p: { k?: string }) => p.k ?? "" }) });
    const a = sideOpenHeld("probe.tab", { k: "x" }, { binding: BG });
    const b = sideOpenHeld("probe.tab", { k: "x" }, { binding: BG });
    expect(a.status === "opened" && b.status === "opened").toBe(true);
    if (a.status !== "opened" || b.status !== "opened") return;
    expect(b.instanceId).toBe(a.instanceId);
    expect(b.reused).toBe(true);
    expect(Object.keys(useSideKeep.getState().holds)).toHaveLength(1);
    // The second locator owns nothing: it cannot drop the first open's pre-hold.
    expect(sideReleaseHold(b.hold, { discard: true })).toBe(false);
    expect(useSide.getState().layout.instances[a.instanceId]).toBeDefined();
    expect(sideReleaseHold(a.hold)).toBe(true);
  });
});

describe("openHeld: atomic refusals (no layout change, no hold)", () => {
  function refusedWith(expected: unknown, run: () => unknown) {
    const layout = useSide.getState().layout;
    const holds = useSideKeep.getState().holds;
    expect(run()).toEqual(expected);
    expect(useSide.getState().layout).toBe(layout);
    expect(useSideKeep.getState().holds).toBe(holds);
  }

  it("full cap → hold-limit, the layout untouched", () => {
    env.prefs.sideKeepMounted = 1;
    const first = sideOpenHeld("probe.tab", {}, { binding: BG });
    expect(first.status).toBe("opened");
    refusedWith({ status: "unavailable", reason: "hold-limit" }, () => sideOpenHeld("probe.tab", {}, { binding: BG }));
    expect(Object.keys(useSide.getState().layout.instances)).toHaveLength(1);
  });

  it("a hold the Body took itself counts against the same cap", () => {
    env.prefs.sideKeepMounted = 1;
    const opened = sideOpen("probe.tab", {}, { binding: BG });
    if (opened.status !== "opened") throw new Error("open");
    expect(setSideHold("host:local", opened.instanceId, useSide.getState().layout.instances[opened.instanceId]!, "hidden", true)).toBe(true);
    refusedWith({ status: "unavailable", reason: "hold-limit" }, () => sideOpenHeld("probe.tab", {}, { binding: BG }));
  });

  it("not keepAlive hidden → not-holdable", () => {
    refusedWith({ status: "unavailable", reason: "not-holdable" }, () => sideOpenHeld("probe.plain", {}, { binding: BG }));
  });

  it("module stopped / not registered → module-off", () => {
    env.registry.delete("probe.tab");
    refusedWith({ status: "unavailable", reason: "module-off" }, () => sideOpenHeld("probe.tab", {}, { binding: BG }));
  });

  it("unknown host or unknown agent → scope-invalid; a host outside the loaded scope → scope-unsupported", () => {
    refusedWith({ status: "unavailable", reason: "scope-invalid" }, () => sideOpenHeld("probe.tab", {}, { binding: { kind: "host", hostId: "ssh-gone" } }));
    refusedWith({ status: "unavailable", reason: "scope-invalid" }, () => sideOpenHeld("probe.tab", {}, { binding: { ...BG, sessionId: "s-deleted" } }));
    refusedWith({ status: "unavailable", reason: "scope-unsupported" }, () => sideOpenHeld("probe.tab", {}, { binding: { kind: "host", hostId: "ssh-a" } }));
  });

  it("host offline → host-offline; another epoch than the caller's request → stale; a stale view scope → stale", () => {
    env.app.hosts.hosts[0]!.conn.epoch = null;
    refusedWith({ status: "unavailable", reason: "host-offline" }, () => sideOpenHeld("probe.tab", {}, { binding: BG }));
    env.app.hosts.hosts[0]!.conn.epoch = "e2";
    refusedWith({ status: "stale" }, () => sideOpenHeld("probe.tab", {}, { binding: BG, hostEpoch: "e1" }));
    expect(sideOpenHeld("probe.tab", {}, { binding: BG, hostEpoch: "e2" }).status).toBe("opened");
    env.app.hosts.active = "ssh-a";
    refusedWith({ status: "stale" }, () => sideOpenHeld("probe.tab", {}, { binding: BG }));
  });
});

describe("holds per scope and the caller's release", () => {
  it("the same instance id in the old and the new scope are two holds; a locator drops only its own", () => {
    const a = sideOpenHeld("probe.tab", {}, { binding: { kind: "host", hostId: "local" } });
    reset("ssh-a");
    const b = sideOpenHeld("probe.tab", {}, { binding: { kind: "host", hostId: "ssh-a" } });
    if (a.status !== "opened" || b.status !== "opened") throw new Error("open");
    expect(b.instanceId).toBe(a.instanceId);
    expect(Object.keys(useSideKeep.getState().holds).sort()).toEqual([holdKey("host:local", a.instanceId), holdKey("host:ssh-a", b.instanceId)].sort());
    // A locator re-aimed at the other scope (same id, wrong token) drops nothing.
    expect(sideReleaseHold({ ...a.hold, scope: "host:ssh-a" })).toBe(false);
    expect(sideReleaseHold(a.hold)).toBe(true);
    expect(Object.keys(useSideKeep.getState().holds)).toEqual([holdKey("host:ssh-a", b.instanceId)]);
  });

  it("pending-open timeout / cancel: releaseHold(discard) drops the hold and the never-rendered card; nothing leaks", () => {
    const r = sideOpenHeld("probe.tab", {}, { binding: BG });
    if (r.status !== "opened") throw new Error("open");
    expect(sideReleaseHold(r.hold, { discard: true })).toBe(true);
    expect(useSideKeep.getState().holds).toEqual({});
    expect(useSide.getState().layout.instances).toEqual({});
    expect(useSide.getState().layout.pages).toEqual([]);
    expect(useSide.getState().layout.open).toBe(false);
    expect(mountedNow()).toEqual([]);
    // Idempotent: a second release (or a late relay generation change) does nothing.
    expect(sideReleaseHold(r.hold, { discard: true })).toBe(false);
  });

  it("without discard the card stays (unheld, unmounted); a forged token drops nothing", () => {
    const r = sideOpenHeld("probe.tab", {}, { binding: BG });
    if (r.status !== "opened") throw new Error("open");
    const forged: SideHoldLocator = { ...r.hold, token: "0".repeat(32) };
    expect(sideReleaseHold(forged, { discard: true })).toBe(false);
    expect(sideReleaseHold({ ...r.hold, token: "" })).toBe(false);
    expect(Object.keys(useSideKeep.getState().holds)).toHaveLength(1);
    expect(sideReleaseHold(r.hold)).toBe(true);
    expect(useSide.getState().layout.instances[r.instanceId]).toBeDefined();
    expect(mountedNow()).toEqual([]);
  });

  it("once the Body released (or the shell revoked) the pre-hold, the locator is dead; a Body re-hold keeps the ticket", () => {
    const r = sideOpenHeld("probe.tab", {}, { binding: BG });
    if (r.status !== "opened") throw new Error("open");
    const inst = useSide.getState().layout.instances[r.instanceId]!;
    // keepMounted(true) on the pre-held instance: idempotent, the ticket stays.
    expect(setSideHold("host:local", r.instanceId, inst, "hidden", true)).toBe(true);
    expect(useSideKeep.getState().holds[holdKey("host:local", r.instanceId)]?.ticket).toBeDefined();
    // keepMounted(false), then a fresh keepMounted(true): the Body's own hold; the caller cannot drop it.
    setSideHold("host:local", r.instanceId, inst, "hidden", false);
    setSideHold("host:local", r.instanceId, inst, "hidden", true);
    expect(sideReleaseHold(r.hold, { discard: true })).toBe(false);
    expect(useSide.getState().layout.instances[r.instanceId]).toBeDefined();
    expect(Object.keys(useSideKeep.getState().holds)).toHaveLength(1);
  });

  it("module stop and a host generation change drop the pre-hold (shell prune); the locator is then a no-op", () => {
    const r = sideOpenHeld("probe.tab", {}, { binding: BG });
    if (r.status !== "opened") throw new Error("open");
    const input = (over: Partial<Parameters<typeof pruneHolds>[1]>) => ({
      scope: "host:local",
      instances: useSide.getState().layout.instances,
      keeps: () => true,
      hostKnown: () => true,
      epochOf: () => "e1",
      ...over,
    });
    const holds = useSideKeep.getState().holds;
    expect(pruneHolds(holds, input({}))).toBe(holds);
    expect(pruneHolds(holds, input({ keeps: () => false }))).toEqual({});
    expect(pruneHolds(holds, input({ epochOf: () => "e2" }))).toEqual({});
    expect(pruneHolds(holds, input({ hostKnown: () => false }))).toEqual({});
    // A disconnect alone keeps it (same rule as v1.9).
    expect(pruneHolds(holds, input({ epochOf: () => null }))).toBe(holds);
    useSideKeep.setState({ holds: pruneHolds(holds, input({ epochOf: () => "e2" })) });
    expect(sideReleaseHold(r.hold, { discard: true })).toBe(false);
  });
});

describe("pure rules", () => {
  it("admitHold: keepAlive hidden only, the shared cap, an already-held instance always admitted", () => {
    expect(admitHold({}, "host:local", null, "unmount", 4)).toBe("not-holdable");
    expect(admitHold({}, "host:local", null, undefined, 4)).toBe("not-holdable");
    expect(admitHold({}, "host:local", null, "hidden", 4)).toBe("ok");
    const holds = { [holdKey("host:local", "i1")]: { scope: "host:local", id: "i1", inst: {} as never, epoch: "e1", dirty: false } };
    expect(admitHold(holds, "host:local", null, "hidden", 1)).toBe("hold-limit");
    expect(admitHold(holds, "host:local", "i1", "hidden", 1)).toBe("ok");
    expect(admitHold(holds, "host:ssh-a", "i1", "hidden", 1)).toBe("hold-limit");
  });

  it("holdScopeCheck order", () => {
    const ok = { known: true, inScope: true, agentKnown: null, epoch: "e1" } as const;
    expect(holdScopeCheck(ok)).toBe("ok");
    expect(holdScopeCheck({ ...ok, known: false, inScope: false })).toBe("scope-invalid");
    expect(holdScopeCheck({ ...ok, inScope: false })).toBe("scope-unsupported");
    expect(holdScopeCheck({ ...ok, agentKnown: false })).toBe("scope-invalid");
    expect(holdScopeCheck({ ...ok, agentKnown: true })).toBe("ok");
    expect(holdScopeCheck({ ...ok, epoch: null })).toBe("host-offline");
    expect(holdScopeCheck({ ...ok, expectEpoch: "e0" })).toBe("stale");
  });

  it("releaseTicket: only the matching ticket; discard closes only a card that open created", () => {
    const h = (created: boolean) => ({ [holdKey("s", "i")]: { scope: "s", id: "i", inst: {} as never, epoch: null, dirty: false, ticket: { token: "t", created } } });
    expect(releaseTicket(h(true), { scope: "s", instanceId: "i", token: "t" }, true)).toMatchObject({ holds: {}, released: true, close: true });
    expect(releaseTicket(h(false), { scope: "s", instanceId: "i", token: "t" }, true)).toMatchObject({ released: true, close: false });
    expect(releaseTicket(h(true), { scope: "s", instanceId: "i", token: "t" }, false)).toMatchObject({ released: true, close: false });
    const held = h(true);
    expect(releaseTicket(held, { scope: "s", instanceId: "i", token: "x" }, true)).toEqual({ holds: held, released: false, close: false });
    expect(releaseTicket(held, { scope: "s2", instanceId: "i", token: "t" }, true).released).toBe(false);
  });
});

describe("an agent's held card on another connected host (multi-host scope)", () => {
  it("stays mounted while another agent is viewed, shows only when its own agent is viewed, and survives prune", async () => {
    const { instanceVisible } = await import("../src/renderer/src/lib/sideLayout");
    env.app.hosts.scope = { kind: "all", id: "" };
    const binding = { kind: "agent" as const, hostId: "ssh-a", sessionId: "r-agent" };
    const r = sideOpenHeld("probe.tab", {}, { binding, hostEpoch: "a1" });
    if (r.status !== "opened") throw new Error(`open: ${JSON.stringify(r)}`);
    const { scope, layout } = useSide.getState();
    expect(mountedNow()).toEqual([r.instanceId]);
    const ctx = (hostId: string, sessionId: string) => ({ hostId, sessionId, workspaceKey: null, available: () => true });
    expect(instanceVisible(layout, r.instanceId, ctx("local", "s-sel"))).toBe(false);
    expect(instanceVisible(layout, r.instanceId, ctx("ssh-a", "r-agent"))).toBe(true);
    const holds = useSideKeep.getState().holds;
    expect(pruneHolds(holds, { scope, instances: layout.instances, keeps: () => true, hostKnown: () => true, epochOf: (id) => (id === "ssh-a" ? "a1" : "e1") })).toBe(holds);
  });
});
