// The categories of settings that can follow the person (design 056 §12). The app registers its own
// (lib/settingsSync/categories.ts); a feature can add one (e.g. 快捷键方案) with registerSyncCategory, and Settings → 你
// lists it with its 「同步」 switch, its summary and the 「已同步」 marker on its pages — no change to that card.
import { create } from "zustand";
import type { MessageKey } from "../../i18n";
import type { LayoutHost } from "../userLayoutModel";
import { CATEGORY_ID, type SyncValues } from "./model";

export interface SyncContext {
  /** This device's hosts with their portable ids (references to a host are stored as its `instanceId`). */
  hosts: readonly LayoutHost[];
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export interface SyncCategory {
  /** The section is `settings-<id>`; never renamed once shipped. */
  id: string;
  /** Place in the list (lower first). */
  order: number;
  titleKey: MessageKey;
  /** What it covers, one line. */
  hintKey: MessageKey;
  /** A device that never chose follows these. */
  defaultOn: boolean;
  /** Settings pages (`page` ids) that show 「已同步」 while this category is synced. */
  pages: readonly string[];
  /**
   * `layout`: the sidebar layout of design 056 phase 1, synced by its own store (lib/userLayout): the switch only says
   * whether this device follows it, and read / write / summary are not used.
   */
  kind?: "fields" | "layout";
  /** This device's values (JSON; only what the category syncs). */
  read(ctx: SyncContext): SyncValues;
  /** Take synced values (only the fields that differ). Unknown or unusable values are skipped, never guessed. */
  write(values: SyncValues, ctx: SyncContext): void;
  /** Called when this device's values may have changed (a periodic check covers categories without one). */
  subscribe?(onChange: () => void): () => void;
  /** A short line naming the values (e.g. 「主题 深色 · 强调色 靛蓝」); empty values → "". */
  summary(values: SyncValues, t: Translate, ctx: SyncContext): string;
}

const categories = new Map<string, SyncCategory>();
/** Bumps on every (un)registration, for React. */
export const useSyncRegistry = create<{ version: number }>(() => ({ version: 0 }));

export function registerSyncCategory(category: SyncCategory): () => void {
  if (!CATEGORY_ID.test(category.id)) throw new Error(`settings sync: bad category id ${category.id}`);
  if (categories.has(category.id)) throw new Error(`settings sync: category ${category.id} is registered twice`);
  categories.set(category.id, category);
  useSyncRegistry.setState((s) => ({ version: s.version + 1 }));
  return () => {
    if (categories.get(category.id) !== category) return;
    categories.delete(category.id);
    useSyncRegistry.setState((s) => ({ version: s.version + 1 }));
  };
}

export function syncCategories(): SyncCategory[] {
  return [...categories.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export const syncCategory = (id: string): SyncCategory | undefined => categories.get(id);

export function useSyncCategories(): SyncCategory[] {
  useSyncRegistry((s) => s.version);
  return syncCategories();
}
