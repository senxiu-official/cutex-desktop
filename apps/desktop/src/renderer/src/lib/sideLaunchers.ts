// Title-bar launchers (docs/desktop-modules.md §18.3, owner 2026-10-12): the right side of the title bar
// is a bar of side-component TYPES, Chrome side-panel style — [pinned launchers…] [＋] [side toggle].
// Pure rules only (pins, order, what a click does, how many fit); lib/sideMenus + the title bar carry
// them out. Shell code: no feature names (which kinds are pinned by default is each component's
// `launcher.pin`).
import { laneClickAction, type CurrentPageClick, type LaneClickAction } from "./sideLaneClick";

/** Owner's per-device choices, by component id: true = pinned, false = unpinned. Absent = the component's default. */
export type LauncherPins = Record<string, boolean>;
export type LauncherPinDefault = "default" | "never" | undefined;

export function migrateLauncherPins(raw: unknown): LauncherPins {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: LauncherPins = {};
  for (const [kind, on] of Object.entries(raw as Record<string, unknown>)) if (typeof on === "boolean" && kind) out[kind] = on;
  return out;
}

/** Pinned to the title bar now: the owner's choice, else the component's `launcher.pin` ("never" can't be pinned). */
export function isPinned(kind: string, pin: LauncherPinDefault, pins: LauncherPins): boolean {
  if (pin === "never") return false;
  return pins[kind] ?? pin === "default";
}

/** Pins with `kind` set to `on`; a choice equal to the default is not stored (a later default change still applies). */
export function withPin(pins: LauncherPins, kind: string, pin: LauncherPinDefault, on: boolean): LauncherPins {
  if (pin === "never") return pins;
  const { [kind]: _old, ...rest } = pins;
  return on === (pin === "default") ? rest : { ...rest, [kind]: on };
}

/**
 * "tool": a component contributed as `side.component` (side chat, terminal, browser, notes …);
 * "status": a status category's derived component (`status:<id>`, §18.9) — listed after the tools.
 */
export type LauncherGroup = "tool" | "status";

export interface LauncherEntry {
  kind: string;
  order: number;
  pin?: LauncherPinDefault;
  group?: LauncherGroup;
}

const groupRank = (e: LauncherEntry) => (e.group === "status" ? 1 : 0);
const byOrder = (a: LauncherEntry, b: LauncherEntry) => groupRank(a) - groupRank(b) || a.order - b.order || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);

/** Tools before status categories, then by `launcher.order` (ties by id). */
export function sortLaunchers<T extends LauncherEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(byOrder);
}

/** Pinned first, then the rest; each tools before status categories, then by `launcher.order` (ties by id). */
export function splitLaunchers<T extends LauncherEntry>(entries: readonly T[], pins: LauncherPins): { pinned: T[]; others: T[] } {
  const sorted = [...entries].sort(byOrder);
  return { pinned: sorted.filter((e) => isPinned(e.kind, e.pin, pins)), others: sorted.filter((e) => !isPinned(e.kind, e.pin, pins)) };
}

/** How many of `count` pinned launchers (`size` px each) fit in `room` px; the rest go into the ＋ menu. */
export function fitLaunchers(room: number, count: number, size: number): number {
  if (count <= 0 || size <= 0) return 0;
  if (!Number.isFinite(room)) return count;
  return Math.max(0, Math.min(count, Math.floor(room / size)));
}

export interface LauncherClickInput {
  /** Ctrl/⌘ + click or middle click (lib/openModifiers): a new instance (multi-instance kinds only). */
  newInstance: boolean;
  /** The component is `instances: "multi"`. */
  multi: boolean;
  /** The column is open. */
  open: boolean;
  /** layout.activePage. */
  activePage: string | null;
  /** A maximised / full-screen side. */
  layered: boolean;
  /** The current page (in view, or the one the closed column would show); null = none. */
  page: string | null;
  /** This kind's card on the current page that the current agent can see; null = not there. */
  card: { id: string; collapsed: boolean } | null;
  /** Not on the current page: its most recently used instance the current agent can see on another page; null = none. */
  elsewhere: string | null;
  setting: CurrentPageClick;
}

export type LauncherClickAction =
  /** Open a card for the kind on `page` (null = by the placement rules); `fresh` = a new instance (`newParams`). */
  | { kind: "open"; page: string | null; fresh: boolean }
  /** Show that existing instance where it is (switch page / open the column, focus + flash). */
  | { kind: "reveal"; instanceId: string }
  | LaneClickAction;

/**
 * A title-bar launcher (or its ＋ menu row) clicked: a new instance only when asked for one (Ctrl/⌘ / middle
 * click / 「新…」, multi only); on the current page → exactly the page-button icon rule (lib/sideLaneClick:
 * collapsed → expand, visible → focus / flash, with 点击当前页图标 = 收起侧栏 → close the column); on another
 * page → reveal that instance there (singleton or multi alike, lead 2026-10-12); nowhere → open it on the
 * current page (opening the column).
 */
export function launcherClickAction(input: LauncherClickInput): LauncherClickAction {
  const { newInstance, multi, page, card, elsewhere } = input;
  if (newInstance && multi) return { kind: "open", page, fresh: true };
  if (!page || !card) return elsewhere ? { kind: "reveal", instanceId: elsewhere } : { kind: "open", page, fresh: false };
  return laneClickAction({
    open: input.open,
    activePage: input.activePage,
    layered: input.layered,
    pageId: page,
    cardId: card.id,
    cardCollapsed: card.collapsed,
    setting: input.setting,
  });
}
