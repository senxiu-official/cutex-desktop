// Protecting work in transient preview tabs, VS Code style (lead 2026-10-12, contract v1.11, docs
// §18.2): SideBodyProps.keep() promotes a preview to a kept tab, and a plain open does not replace a
// transient tab whose component's closeConfirm warns — it is kept, the new item opens beside it.
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

const { sideOpen } = await import("../src/renderer/src/lib/sideServices");
const { useSide } = await import("../src/renderer/src/lib/sideLayoutStore");
const { emptyLayout, locate } = await import("../src/renderer/src/lib/sideLayout");
const { keepTab } = await import("../src/renderer/src/lib/sideBody");

const busy = new Set<string>();
const preview = (): Partial<SideComponentItem> => ({
  instances: "multi",
  defaultBinding: "agent",
  placement: { home: "workspace" },
  transient: true,
  parseParams: (p) => p,
  dedupeKey: (p: { path?: string }) => p.path ?? "",
  init: (p) => p,
  closeConfirm: (inst) => (busy.has((inst.state as { path: string }).path) ? "unsaved edits" : null),
});
const SEL = { kind: "agent" as const, hostId: "local", sessionId: "s-sel" };

beforeEach(() => {
  busy.clear();
  env.prefs.sidePreview = "replace";
  env.registry = new Map([["probe.preview", { moduleId: "probe", item: preview() }]]);
  env.app = {
    hosts: { active: "local", scope: { kind: "host", id: "local" }, hosts: [{ id: "local", conn: { epoch: "e1" } }], groups: [] },
    selectedId: "s-sel",
    selectedHost: null,
    sidebar: { active: [{ cutexSessionId: "s-sel" }], retired: [], hostRows: {} },
    byHost: {},
    view: { kind: "conversation" },
  };
  useSide.setState({ scope: "host:local", layout: emptyLayout(), mode: null, revealed: {}, tabInfo: {}, flash: null, focusedCard: null });
});

const openPath = (path: string) => {
  const r = sideOpen("probe.preview", { path }, { binding: SEL });
  if (r.status !== "opened") throw new Error(r.status);
  return r.instanceId;
};
const tabsOf = (id: string) => locate(useSide.getState().layout, id)!.card.tabs;

describe("replace guard (v1.11): a transient tab with work is not replaced", () => {
  it("without a warning, a plain open replaces the transient preview (unchanged)", () => {
    const a = openPath("a.md");
    const b = openPath("b.md");
    expect(useSide.getState().layout.instances[a]).toBeUndefined();
    expect(tabsOf(b)).toEqual([b]);
  });

  it("with a closeConfirm warning, it is promoted to kept and the new item opens as its own transient tab", () => {
    const a = openPath("a.md");
    busy.add("a.md");
    const b = openPath("b.md");
    const { instances } = useSide.getState().layout;
    expect(instances[a]).toMatchObject({ pinned: true, state: { path: "a.md" } });
    expect(instances[b]).toMatchObject({ pinned: false });
    expect(tabsOf(b)).toEqual([a, b]);
    // b is now the preview: the next plain open replaces b, not a
    const c = openPath("c.md");
    expect(useSide.getState().layout.instances[b]).toBeUndefined();
    expect(tabsOf(c)).toEqual([a, c]);
  });
});

describe("SideBodyProps.keep (v1.11)", () => {
  it("promotes transient → kept, idempotent; the next open no longer replaces it", () => {
    const a = openPath("a.md");
    keepTab(a);
    const once = useSide.getState().layout;
    expect(once.instances[a]!.pinned).toBe(true);
    keepTab(a);
    expect(useSide.getState().layout).toBe(once);
    const b = openPath("b.md");
    expect(tabsOf(b)).toEqual([a, b]);
  });

  it("a held instance of another scope: no-op", () => {
    const a = openPath("a.md");
    const before = useSide.getState().layout;
    keepTab(a, "host:other");
    expect(useSide.getState().layout).toBe(before);
  });
});
