// Pane kinds (docs/desktop-modules.md §24.2–§24.4): the contract-1.17 slot `pane.kind` plus the kinds
// the shell derives — one per `side.component` (same id), one per `main.page` without an Aside
// (`page:<id>`) — and the shell's own `core.conversation` (drawn by components/PaneHost). The tool
// engine (lib/sideLayout, lib/sideServices) places every non-conversation kind: a contributed `pane.kind`
// item and a page kind are adapted into a side component for it (`sideItemOf`; pages open in a Shelf,
// 2026-10-21 — or over the conversation column with 页面打开位置 = 占用会话, lib/pageOpen). Kept out of components/*.tsx
// (Fast Refresh). Shell code: names no feature.
import type { ReactNode } from "react";
import { AppWindow } from "lucide-react";
import { appModules } from "../modules/app";
import type { MessageKey } from "../i18n";
import type { AppSlotEntry, Icon, PageItem, PaneKindBinding, PaneKindItem, SideBinding, SideBodyProps, SideComponentItem, SideTabProps } from "../modules/slots";
import type { ItemId, Json, PageParams } from "../modules/types";
import { CONVERSATION_KIND, DEFAULT_MIN_SIZE, pageKind } from "./paneLayout";
import { pageContent } from "./pageContent";
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
const contextual = new WeakSet<SideComponentItem>();

/** Unbound pages have a default view in each context; kept Shelf slots can open it directly. */
export function isContextualPane(item: SideComponentItem): boolean { return contextual.has(item); }

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
  if (item.binding === "none") contextual.add(side);
  toSide.set(item, side);
  return side;
}

// ── main.page → `page:<id>` ──────────────────────────────────────────────────────────────────────

/** What a page kind borrows from the sidebar entry that opens the page (its icon and name), when there is one. */
export interface PageLook {
  icon: Icon;
  titleKey: MessageKey;
}

/** The `nav.primary` entry of a page (its target, or one of its activePages): the page's icon and name. Null: none. */
export function pageLookOf(page: string, nav: readonly AppSlotEntry<"nav.primary">[]): PageLook | null {
  const hit = nav.find((e) => "page" in e.item.target && e.item.target.page === page) ?? nav.find((e) => e.item.activePages?.includes(page as ItemId));
  return hit ? { icon: hit.item.icon, titleKey: hit.item.titleKey } : null;
}

const fromPage = new WeakMap<PageItem, { look: PageLook | null; moduleId: string | null; kind: PaneKindItem }>();

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

/** A page's title as one line: its breadcrumb (useTitle) joined, e.g. 「项目 › profileCedar-agent」. */
export const pageTitleText = (crumbs: readonly { text: string }[], fallback: string): string => crumbs.map((c) => c.text).filter(Boolean).join(" › ") || fallback;

/**
 * The pane kind a page derives (single, bound to nothing = the focus host, params = state, in memory only).
 * Pages with an Aside derive none. Since 2026-10-21 (§24.4) it opens as its own pane in the focused
 * conversation's Shelf (`look`: the icon and name of the sidebar entry that opens it) — or, with 页面打开位置 =
 * 占用会话, over the conversation column with its own page header (components/PageHeader).
 */
export function paneKindOfPage(item: PageItem, look: PageLook | null = null, moduleId: string | null = null): PaneKindItem | null {
  if (item.Aside) return null;
  const cached = fromPage.get(item);
  if (cached && cached.look?.icon === look?.icon && cached.look?.titleKey === look?.titleKey && cached.moduleId === moduleId) return cached.kind;
  function usePageTitle({ instance }: SideTabProps<PageParams>) {
    const crumbs = item.useTitle(instance.state);
    const title = pageTitleText(crumbs, item.id);
    return { title, tooltip: title, ...(look ? { icon: look.icon } : {}) };
  }
  function PageBody({ instance }: SideBodyProps<PageParams>): ReactNode {
    // The page fills its pane and scrolls inside it (pages draw <main className="flex min-w-0 flex-1">).
    return (
      <div data-page-pane={item.id} className="flex h-full min-h-0 w-full min-w-0">
        {pageContent({ item, moduleId, params: instance.state })}
      </div>
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PageParams (flat strings) is JSON, the type says Readonly<Record<…>>
  const kind: PaneKindItem<any, any> = {
    id: pageKind(item.id) as ItemId,
    ...(item.requires ? { requires: item.requires } : {}),
    titleKey: look?.titleKey ?? "pane.page",
    icon: look?.icon ?? AppWindow,
    instances: "single",
    binding: "none",
    parseParams: parsePageParams,
    init: (params) => params,
    persist: false,
    useTitle: usePageTitle,
    Body: PageBody,
    minSize: { w: DEFAULT_MIN_SIZE.w, h: 240 },
    tile: true,
    dock: null,
    popOut: false,
  };
  fromPage.set(item, { look, moduleId, kind });
  return kind;
}

/** The page kinds of these slot snapshots, as the tool engine's components (lib/sideComponents: pages open in a Shelf). */
export function pageSideItems(pages: readonly AppSlotEntry<"main.page">[], nav: readonly AppSlotEntry<"nav.primary">[]): { item: SideComponentItem; moduleId: string }[] {
  const out: { item: SideComponentItem; moduleId: string }[] = [];
  for (const e of pages) {
    if (e.mode !== "show") continue;
    const kind = paneKindOfPage(e.item, pageLookOf(e.item.id, nav), e.moduleId);
    if (kind) out.push({ item: sideItemOf(kind), moduleId: e.moduleId });
  }
  return out;
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
  nav?: readonly AppSlotEntry<"nav.primary">[];
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
    const item = paneKindOfPage(e.item, pageLookOf(e.item.id, input.nav ?? []), e.moduleId);
    if (item) add({ id: item.id, source: "page", moduleId: e.moduleId, instances: "single", binding: "none", item });
  }
  return out;
}

/** The pane kinds available now (outside React: services.panes). */
export function paneKindsNow(): PaneKindEntry[] {
  const host = appModules();
  return derivePaneKinds({ panes: host.snapshot("pane.kind"), side: host.snapshot("side.component"), status: host.snapshot("conversation.status"), pages: host.snapshot("main.page"), nav: host.snapshot("nav.primary") });
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
