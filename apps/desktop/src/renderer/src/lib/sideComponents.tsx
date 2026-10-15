// The right side's component registry (docs/desktop-modules.md §18): `side.component` items plus one
// shell-derived component per `conversation.status` category (`status:<item id>`, §18.9), and the
// view context (selected agent, host, workspace) that decides which instances are visible. Kept out
// of components/*.tsx (Fast Refresh): the derived Bodies live here with the adapter that makes them.
import { useMemo } from "react";
import { ListChecks } from "lucide-react";
import { useI18n } from "../i18n";
import { appModules } from "../modules/app";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, SideBodyProps, SideComponentItem, SideTabProps, StatusItem } from "../modules/slots";
import type { ItemId } from "../modules/types";
import { agentHost, selectedSidebar, useApp } from "../store";
import { getUiPrefs } from "./prefs";
import { agentFeaturesFor } from "./agentFeaturesView";
import { lacks } from "./agentFeatures";
import { SINGLETON_KEY, placeSpec, type PlaceSpec, type SideViewContext } from "./sideLayout";
import { STATUS_COMPONENT_PREFIX } from "./sideKinds";
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
      <div className="h-full overflow-y-auto px-2 py-1 text-[13px]">
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

let cache: { side: unknown; status: unknown; value: SideRegistry } | null = null;

function build(side: readonly AppSlotEntry<"side.component">[], status: readonly AppSlotEntry<"conversation.status">[]): SideRegistry {
  if (cache && cache.side === side && cache.status === status) return cache.value;
  const map = new Map<ItemId, SideComponentEntry>();
  for (const entry of side) if (entry.mode === "show") map.set(entry.item.id, { item: entry.item, moduleId: entry.moduleId });
  for (const entry of status) {
    if (entry.mode !== "show") continue;
    const component = statusComponent(entry.item);
    if (component && !map.has(component.id)) map.set(component.id, { item: component, moduleId: entry.moduleId });
  }
  cache = { side, status, value: map };
  return map;
}

/** The available components now (outside React: services). */
export function sideRegistry(): SideRegistry {
  const host = appModules();
  return build(host.snapshot("side.component"), host.snapshot("conversation.status"));
}

export function useSideRegistry(): SideRegistry {
  const side = useSlot("side.component");
  const status = useSlot("conversation.status");
  return build(side, status);
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

function workspaceKeyOf(state: AppState, sessionId: string | null): string | null {
  const scope = scopeFor(selectedSidebar(state), sessionId);
  return scope ? scopeKey(scope) : null;
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

export function useSideView(): SideViewContext {
  const registry = useSideRegistry();
  // The open agent's host (multi-host P1: it may not be the focus host).
  const hostId = useApp(agentHost);
  const sessionId = useApp((s) => s.selectedId);
  const workspaceKey = useApp((s) => workspaceKeyOf(s, s.selectedId));
  // `sidebar` changes carry agent feature updates (lacks reads them on demand).
  const sidebar = useApp(selectedSidebar);
  return useMemo(() => contextFor(registry, hostId, sessionId, workspaceKey), [registry, hostId, sessionId, workspaceKey, sidebar]); // eslint-disable-line react-hooks/exhaustive-deps
}
