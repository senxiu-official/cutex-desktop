// Pane kinds (docs/desktop-modules.md §24.2–§24.4): the contract-1.17 slot `pane.kind` plus the kinds
// the shell derives — one per `side.component` (same id), one per `main.page` without an Aside
// (`page:<id>`) — and the shell's own `core.conversation` (drawn by components/PaneHost). The tool
// engine (lib/sideLayout, lib/sideServices) places every non-conversation, non-page kind: a contributed
// `pane.kind` item is adapted into a side component for it (`sideItemOf`). Kept out of components/*.tsx
// (Fast Refresh). Shell code: names no feature.
import type { ReactNode } from "react";
import { AppWindow } from "lucide-react";
import { appModules } from "../modules/app";
import type { AppSlotEntry, PageItem, PaneKindBinding, PaneKindItem, SideBinding, SideBodyProps, SideComponentItem, SideTabProps } from "../modules/slots";
import type { ItemId, Json, PageParams } from "../modules/types";
import { CONVERSATION_KIND, DEFAULT_MIN_SIZE, pageKind } from "./paneLayout";
import { statusComponent } from "./sideComponents";

/** Where a kind comes from. */
export type PaneKindSource = "core" | "pane" | "side" | "page";

export interface PaneKindEntry {
  id: string;
  source: PaneKindSource;
  /** The contributing module (null: the shell's own). */
  moduleId: string | null;
  instances: "single" | "multi";
  binding: PaneKindBinding;
  /** The kind as a `pane.kind` item (null: `core.conversation`, which components/PaneHost draws). */
  item: PaneKindItem | null;
}

// ── side.component → pane kind ───────────────────────────────────────────────────────────────────

/** A side component's binding as a pane kind's (§24.4): agent / workspace / follow follow the focused conversation, host stays. */
export const bindingOfSide = (kind: SideBinding["kind"]): PaneKindBinding => (kind === "host" ? "host" : "follow");

const fromSide = new WeakMap<SideComponentItem, PaneKindItem>();

/** The pane kind a side component derives (same id, same Body / state rules). */
export function paneKindOfSide(item: SideComponentItem): PaneKindItem {
  const cached = fromSide.get(item);
  if (cached) return cached;
  const kind: PaneKindItem = {
    id: item.id,
    ...(item.requires ? { requires: item.requires } : {}),
    ...(item.agentFeature ? { agentFeature: item.agentFeature } : {}),
    titleKey: item.titleKey,
    icon: item.icon,
    instances: item.instances === "singleton" ? "single" : "multi",
    binding: bindingOfSide(item.defaultBinding),
    parseParams: item.parseParams,
    ...(item.dedupeKey ? { dedupeKey: item.dedupeKey } : {}),
    init: item.init,
    ...(item.restore ? { restore: item.restore } : {}),
    ...(item.stateVersion !== undefined ? { stateVersion: item.stateVersion } : {}),
    ...(item.persist !== undefined ? { persist: item.persist } : {}),
    useTitle: item.useTab,
    Body: item.Body,
    ...(item.Actions ? { Actions: item.Actions } : {}),
    minSize: { w: DEFAULT_MIN_SIZE.w, h: item.minHeight ?? DEFAULT_MIN_SIZE.h },
    tile: true,
    dock: null,
    popOut: false,
    ...(item.keepAlive ? { keepAlive: item.keepAlive } : {}),
    ...(item.onClose ? { onClose: item.onClose } : {}),
    ...(item.closeConfirm ? { closeConfirm: item.closeConfirm } : {}),
    ...(item.toRef ? { toRef: item.toRef } : {}),
    ...(item.fromRef ? { fromRef: item.fromRef } : {}),
    ...(item.launcher ? { launcher: item.launcher } : {}),
  };
  fromSide.set(item, kind);
  return kind;
}

// ── pane.kind → side component (the tool engine places contributed kinds) ──────────────────────────

const toSide = new WeakMap<PaneKindItem, SideComponentItem>();

/** A side component's default binding for a pane kind's: none → the host (the focus host at open). */
const sideBindingOf = (binding: PaneKindBinding): SideBinding["kind"] => (binding === "none" ? "host" : binding);

/** A contributed pane kind as the tool engine's component: its own column group, the right-most column otherwise. */
export function sideItemOf(item: PaneKindItem): SideComponentItem {
  const cached = toSide.get(item);
  if (cached) return cached;
  const side: SideComponentItem = {
    id: item.id,
    ...(item.requires ? { requires: item.requires } : {}),
    ...(item.agentFeature ? { agentFeature: item.agentFeature } : {}),
    titleKey: item.titleKey,
    icon: item.icon,
    instances: item.instances === "single" ? "singleton" : "multi",
    defaultBinding: sideBindingOf(item.binding),
    placement: { home: item.id },
    parseParams: item.parseParams,
    ...(item.dedupeKey ? { dedupeKey: item.dedupeKey } : {}),
    init: item.init,
    ...(item.restore ? { restore: item.restore } : {}),
    ...(item.stateVersion !== undefined ? { stateVersion: item.stateVersion } : {}),
    ...(item.persist !== undefined ? { persist: item.persist } : {}),
    ...(item.minSize ? { minHeight: item.minSize.h } : {}),
    ...(item.keepAlive ? { keepAlive: item.keepAlive } : {}),
    useTab: item.useTitle,
    Body: item.Body,
    ...(item.Actions ? { Actions: item.Actions } : {}),
    ...(item.onClose ? { onClose: item.onClose } : {}),
    ...(item.closeConfirm ? { closeConfirm: item.closeConfirm } : {}),
    ...(item.toRef ? { toRef: item.toRef } : {}),
    ...(item.fromRef ? { fromRef: item.fromRef } : {}),
    ...(item.launcher ? { launcher: item.launcher } : {}),
  };
  toSide.set(item, side);
  return side;
}

// ── main.page → `page:<id>` ──────────────────────────────────────────────────────────────────────

const fromPage = new WeakMap<PageItem, PaneKindItem>();

/** Page params are flat strings (PageParams): anything else is refused. */
function parsePageParams(raw: Json): PageParams | null {
  if (raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
}

/** The pane kind a page derives (single, bound to nothing, params = state, in memory only). Pages with an Aside derive none. */
export function paneKindOfPage(item: PageItem): PaneKindItem | null {
  if (item.Aside) return null;
  const cached = fromPage.get(item);
  if (cached) return cached;
  function usePageTitle({ instance }: SideTabProps<PageParams>) {
    const crumbs = item.useTitle(instance.state);
    return { title: crumbs[crumbs.length - 1]?.text ?? item.id };
  }
  function PageBody({ instance }: SideBodyProps<PageParams>): ReactNode {
    const Page = item.Page;
    return <Page params={instance.state} />;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PageParams (flat strings) is JSON, the type says Readonly<Record<…>>
  const kind: PaneKindItem<any, any> = {
    id: pageKind(item.id) as ItemId,
    ...(item.requires ? { requires: item.requires } : {}),
    titleKey: "pane.page",
    icon: AppWindow,
    instances: "single",
    binding: "none",
    parseParams: parsePageParams,
    init: (params) => params,
    persist: false,
    useTitle: usePageTitle,
    Body: PageBody,
    tile: true,
    dock: null,
    popOut: false,
  };
  fromPage.set(item, kind);
  return kind;
}

// ── The registry ─────────────────────────────────────────────────────────────────────────────────

/**
 * Every pane kind of these slot snapshots, in this order: core, contributed, derived from side
 * components (and the status categories' `status:<id>` components, §18.9), from pages.
 */
export function derivePaneKinds(input: {
  panes: readonly AppSlotEntry<"pane.kind">[];
  side: readonly AppSlotEntry<"side.component">[];
  status?: readonly AppSlotEntry<"conversation.status">[];
  pages: readonly AppSlotEntry<"main.page">[];
}): PaneKindEntry[] {
  const out: PaneKindEntry[] = [{ id: CONVERSATION_KIND, source: "core", moduleId: null, instances: "multi", binding: "agent", item: null }];
  const seen = new Set<string>([CONVERSATION_KIND]);
  const add = (entry: PaneKindEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    out.push(entry);
  };
  for (const e of input.panes) if (e.mode === "show") add({ id: e.item.id, source: "pane", moduleId: e.moduleId, instances: e.item.instances, binding: e.item.binding, item: e.item });
  for (const e of input.side) {
    if (e.mode !== "show") continue;
    const item = paneKindOfSide(e.item);
    add({ id: item.id, source: "side", moduleId: e.moduleId, instances: item.instances, binding: item.binding, item });
  }
  for (const e of input.status ?? []) {
    if (e.mode !== "show") continue;
    const side = statusComponent(e.item);
    if (!side) continue;
    const item = paneKindOfSide(side);
    add({ id: item.id, source: "side", moduleId: e.moduleId, instances: item.instances, binding: item.binding, item });
  }
  for (const e of input.pages) {
    if (e.mode !== "show") continue;
    const item = paneKindOfPage(e.item);
    if (item) add({ id: item.id, source: "page", moduleId: e.moduleId, instances: "single", binding: "none", item });
  }
  return out;
}

/** The pane kinds available now (outside React: services.panes). */
export function paneKindsNow(): PaneKindEntry[] {
  const host = appModules();
  return derivePaneKinds({ panes: host.snapshot("pane.kind"), side: host.snapshot("side.component"), status: host.snapshot("conversation.status"), pages: host.snapshot("main.page") });
}

/** A `main.page` id that is a full-window page (it has an Aside: 设置) — never opened in a pane. */
export function isFullWindowPage(page: string): boolean {
  try {
    return !!appModules()
      .snapshot("main.page")
      .find((e) => e.item.id === page)?.item.Aside;
  } catch {
    return false;
  }
}
