// React bindings of the module host (hooks only; docs/desktop-modules.md §8).
import { useCallback, useSyncExternalStore } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useApp } from "../store";
import { appModules } from "./app";
import type { AppSlotEntry, PageCrumb, SlotId, SlotItem } from "./slots";
import type { ItemId, Json, ModuleId, ModuleStatus, PageParams } from "./types";

/** Visible items of a slot (sorted; same array until the slot changes). */
export function useSlot<S extends SlotId>(slot: S): readonly AppSlotEntry<S>[] {
  const host = appModules();
  // The snapshot is cached until the slot changes, so it doubles as the server-rendered one.
  return useSyncExternalStore(host.subscribe, () => host.snapshot(slot), () => host.snapshot(slot));
}

export function useModuleStatuses(): ReadonlyMap<ModuleId, ModuleStatus> {
  const host = appModules();
  return useSyncExternalStore(host.subscribe, host.statuses);
}

/** Enabled pref of a module (required modules: always true). Re-renders with the statuses. */
export function useModuleEnabled(id: ModuleId): boolean {
  const host = appModules();
  useModuleStatuses();
  return host.isEnabled(id);
}

/** Placement of items in a slot with placement (§5); re-renders when an override changes. */
export function usePlacement<S extends SlotId>(slot: S): (item: SlotItem<S>) => string {
  const host = appModules();
  const overrides = useSyncExternalStore(host.subscribe, host.placements);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `overrides` invalidates the resolver
  return useCallback((item: SlotItem<S>) => host.placement(slot, item), [host, slot, overrides]);
}

/** One key of a module's prefs (`cutex-desktop.module.<id>`). `fallback` must be a primitive or a stable reference. */
export function useModulePref<T extends Json>(id: ModuleId, key: string, fallback: T): [T, (value: T) => void] {
  const prefs = appModules().prefs(id);
  const value = useSyncExternalStore(prefs.subscribe, () => prefs.get(key, fallback));
  const set = useCallback((next: T) => prefs.set(key, next), [prefs, key]);
  return [value, set];
}

/** A `main.page` useTitle for a page whose breadcrumb is just its name. */
export function pageTitle(key: MessageKey): () => readonly PageCrumb[] {
  return function usePageTitle() {
    const { t } = useI18n();
    return [{ text: t(key) }];
  };
}

/**
 * The open `main.page` (null in the conversation). `entry` is undefined while the page's module
 * is off / unavailable (or the id is unknown); `waiting` = only because capabilities have not loaded.
 */
export function useOpenPage(): { page: ItemId; params: PageParams; entry: AppSlotEntry<"main.page"> | undefined; waiting: boolean } | null {
  const view = useApp((s) => s.view);
  const pages = useSlot("main.page");
  const statuses = useModuleStatuses();
  if (view.kind !== "page") return null;
  const entry = pages.find((e) => e.item.id === view.page);
  const state = statuses.get(view.page.split(".")[0]!)?.state;
  const waiting = !entry && state?.kind === "unavailable" && state.missing.waiting;
  return { page: view.page, params: view.params, entry, waiting };
}
