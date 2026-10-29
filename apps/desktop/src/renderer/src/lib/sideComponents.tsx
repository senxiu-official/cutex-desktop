// The tool area's component registry (docs/desktop-modules.md §18, §24): `side.component` items, the
// contract-1.17 `pane.kind` items and the pages' `page:<id>` kinds (adapted by lib/paneKinds `sideItemOf`), plus one
// shell-derived component per `conversation.status` category (`status:<item id>`, §18.9), and the
// view context (selected agent, host, workspace) that decides which instances are visible. Kept out
// of components/*.tsx (Fast Refresh): the derived Bodies live here with the adapter that makes them.
import { useMemo } from "react";
import { useShelfPeer } from "./shelfSourceContext";
import { ListChecks } from "lucide-react";
import { useI18n } from "../i18n";
import { appModules } from "../modules/app";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, SideBodyProps, SideComponentItem, SideTabProps, StatusItem } from "../modules/slots";
import type { ItemId } from "../modules/types";
import { agentHost, selectedSidebar, sidebarOf, useApp } from "../store";
import { getUiPrefs } from "./prefs";
import { agentFeaturesFor } from "./agentFeaturesView";
import { lacks } from "./agentFeatures";
import { SINGLETON_KEY, placeSpec, type PlaceSpec, type SideViewContext } from "./sideLayout";
import { STATUS_COMPONENT_PREFIX } from "./sideKinds";
import { pageSideItems, sideItemOf } from "./paneKinds";
import { scopeFor, scopeKey } from "./workspace";

export interface SideComponentEntry {
  item: SideComponentItem;
  /** The contributing module (error attribution, ItemBoundary). */
  moduleId: string;
}

export type SideRegistry = ReadonlyMap<ItemId, SideComponentEntry>;

// ── Status categories as components (§18.9) ─────────────────────────────────────────────────────

const derived = new WeakMap<StatusItem, SideComponentItem>();

/** The derived component of a status category; null when it opted out (`side: false`). */
export function statusComponent(item: StatusItem): SideComponentItem | null {
  if (item.side === false) return null;
  const cached = derived.get(item);
  if (cached) return cached;
  const side = item.side ?? {};
  function useStatusTab({ sessionId }: SideTabProps<null>) {
    const { t } = useI18n();
    const status = sessionId ? item.useStatus(sessionId) : null;
    return { title: t(item.titleKey), tooltip: status?.line.title };
  }
  function StatusBody({ sessionId }: SideBodyProps<null>) {
    const { t } = useI18n();
    const status = sessionId ? item.useStatus(sessionId) : null;
    if (!sessionId || !status) return <div className="px-3 py-4 text-xs text-subtle">{t("side.statusNone")}</div>;
    const Body = item.Body;
    return (
      <div className="h-full overflow-y-auto px-2 py-1 text-ui/[inherit]">
        <Body sessionId={sessionId} data={status.data} />
      </div>
    );
  }
  function StatusActions({ sessionId }: SideBodyProps<null>) {
    const status = sessionId ? item.useStatus(sessionId) : null;
    const Meta = item.Meta;
    if (!sessionId || !status || !Meta) return null;
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-subtle tabular-nums">
        <Meta sessionId={sessionId} data={status.data} />
      </span>
    );
  }
  const component: SideComponentItem = {
    id: `${STATUS_COMPONENT_PREFIX}${item.id}` as ItemId,
    ...(item.agentFeature ? { agentFeature: item.agentFeature } : {}),
    ...(item.requires ? { requires: item.requires } : {}),
    titleKey: item.titleKey,
    icon: item.icon ?? ListChecks,
    instances: "singleton",
    defaultBinding: "follow",
    placement: { home: side.home ?? "workspace", order: side.order ?? 600, ...(side.prefer ? { prefer: side.prefer } : {}), ...(side.otherwise ? { otherwise: side.otherwise } : {}), ...(side.share ? { share: side.share } : {}) },
    parseParams: () => ({}),
    init: () => null,
    // no restore: the state is always null (a restore returning null would drop the tab)
    useTab: useStatusTab,
    Body: StatusBody,
    Actions: StatusActions,
    launcher: { order: side.order ?? 600, params: () => ({}) },
  };
  derived.set(item, component);
  return component;
}

// ── Registry ────────────────────────────────────────────────────────────────────────────────────

let cache: { side: unknown; status: unknown; panes: unknown; pages: unknown; nav: unknown; value: SideRegistry } | null = null;

type Pages = readonly AppSlotEntry<"main.page">[];
type Nav = readonly AppSlotEntry<"nav.primary">[];

function build(side: readonly AppSlotEntry<"side.component">[], status: readonly AppSlotEntry<"conversation.status">[], panes: readonly AppSlotEntry<"pane.kind">[], pages: Pages = [], nav: Nav = []): SideRegistry {
  if (cache && cache.side === side && cache.status === status && cache.panes === panes && cache.pages === pages && cache.nav === nav) return cache.value;
  const map = new Map<ItemId, SideComponentEntry>();
  for (const entry of side) if (entry.mode === "show") map.set(entry.item.id, { item: entry.item, moduleId: entry.moduleId });
  // v1.17 (§24.3): a contributed pane kind opens in the tool area like a side component.
  for (const entry of panes) if (entry.mode === "show" && !map.has(entry.item.id)) map.set(entry.item.id, { item: sideItemOf(entry.item), moduleId: entry.moduleId });
  for (const entry of status) {
    if (entry.mode !== "show") continue;
    const component = statusComponent(entry.item);
    if (component && !map.has(component.id)) map.set(component.id, { item: component, moduleId: entry.moduleId });
  }
  // 2026-10-21 (§24.4): a page (`page:<id>`, no Aside) opens as its own pane in a Shelf.
  for (const entry of pageSideItems(pages, nav)) if (!map.has(entry.item.id)) map.set(entry.item.id, entry);
  cache = { side, status, panes, pages, nav, value: map };
  return map;
}

/** The available components now (outside React: services). */
export function sideRegistry(): SideRegistry {
  const host = appModules();
  return build(host.snapshot("side.component"), host.snapshot("conversation.status"), host.snapshot("pane.kind"), host.snapshot("main.page"), host.snapshot("nav.primary"));
}

export function useSideRegistry(): SideRegistry {
  const side = useSlot("side.component");
  const status = useSlot("conversation.status");
  const panes = useSlot("pane.kind");
  const pages = useSlot("main.page");
  const nav = useSlot("nav.primary");
  return build(side, status, panes, pages, nav);
}

/** A component's placement with defaults; unknown kinds → null. */
export function specFrom(registry: SideRegistry, kind: ItemId): PlaceSpec | null {
  const entry = registry.get(kind);
  if (!entry) return null;
  // 会话两侧 → 组件默认位置: the owner's page group replaces the declared home (and its prefer list).
  const home = getUiPrefs().sideHomes[kind];
  return placeSpec(home && home !== entry.item.placement.home ? { ...entry.item.placement, home, prefer: undefined } : entry.item.placement);
}

export function dedupeKeyOf(item: SideComponentItem, params: unknown): string | null {
  if (item.instances === "singleton") return SINGLETON_KEY;
  if (!item.dedupeKey) return null;
  try {
    return item.dedupeKey(params as never);
  } catch {
    return null;
  }
}

// ── View context (§18.5) ────────────────────────────────────────────────────────────────────────

type AppState = ReturnType<typeof useApp.getState>;

function workspaceKeyOf(state: AppState, sessionId: string | null, hostId?: string): string | null {
  const scope = scopeFor(hostId === undefined ? selectedSidebar(state) : sidebarOf(state, hostId), sessionId);
  return scope ? scopeKey(scope) : null;
}

/** scopeKey of the workspace agent `sessionId` of host `hostId` is in (null: none). */
export function workspaceKeyFor(state: AppState, hostId: string, sessionId: string): string | null {
  return workspaceKeyOf(state, sessionId, hostId);
}

function contextFor(registry: SideRegistry, hostId: string, sessionId: string | null, workspaceKey: string | null): SideViewContext {
  return {
    hostId,
    sessionId,
    workspaceKey,
    available: (kind) => registry.has(kind),
    lacks: (kind, session) => {
      const feature = registry.get(kind)?.item.agentFeature;
      return !!feature && !!session && lacks(agentFeaturesFor(session), feature);
    },
  };
}

/** The view context now (outside React). */
export function sideViewNow(): SideViewContext {
  const s = useApp.getState();
  return contextFor(sideRegistry(), agentHost(s), s.selectedId, workspaceKeyOf(s, s.selectedId));
}

/**
 * The view context of another conversation (two live workspaces, §24.13: the other workspace's Shelf sees its
 * own conversation — a follow-bound tool there binds to it, not to the focused one). Outside React.
 */
export function sideViewFor(hostId: string, sessionId: string): SideViewContext {
  return contextFor(sideRegistry(), hostId, sessionId, workspaceKeyOf(useApp.getState(), sessionId, hostId));
}

/**
 * The view context of the Shelf being drawn: the focused conversation's, or — inside the other workspace's
 * Shelf / its instances (lib/shelfSourceContext) — that conversation's.
 */
export function useSideView(): SideViewContext {
  const registry = useSideRegistry();
  const peer = useShelfPeer();
  // The open agent's host (multi-host P1: it may not be the focus host).
  const selectedHost = useApp(agentHost);
  const selectedId = useApp((s) => s.selectedId);
  const hostId = peer ? peer.hostId : selectedHost;
  const sessionId = peer ? peer.sessionId : selectedId;
  const workspaceKey = useApp((s) => (peer ? workspaceKeyOf(s, peer.sessionId, peer.hostId) : workspaceKeyOf(s, s.selectedId)));
  // `sidebar` changes carry agent feature updates (lacks reads them on demand).
  const sidebar = useApp((s) => (peer ? sidebarOf(s, peer.hostId) : selectedSidebar(s)));
  return useMemo(() => contextFor(registry, hostId, sessionId, workspaceKey), [registry, hostId, sessionId, workspaceKey, sidebar]); // eslint-disable-line react-hooks/exhaustive-deps
}
