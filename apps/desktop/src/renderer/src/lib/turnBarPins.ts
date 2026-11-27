// 操作栏 pins (owner 2026-11-28): the reply row's and the user bubble's floating action bars show the actions the
// owner pinned, in pin order, like the window bar's entries (lib/navPins). Every row of a bar's 「⋯」 carries a pin
// toggle; right-clicking a pinned icon unpins it. Ids: the bar's own actions by name (`copy`, `fork`, `quote`,
// `fold`, `revert`, `revertFiles`, `editResend`) and the modules' `ref.action` items as `ref:<item id>`.
// Until the owner changes a bar's pins it shows today's set: its defaults plus the `ref.action` items marked
// `inline` (书签). Pure model, unit-tested in test/turnBarPins.test.ts; stored in lib/prefs `turnBarPins` and synced
// with the person's sidebar layout like the window bar's pins (lib/userLayoutModel `turnBar` / `turnBarDefault`).

export type TurnBar = "reply" | "user";

/** Today's bars: 复制 · 分叉 on replies, 复制 · 回退并编辑 on user bubbles (then the `inline` ref items). */
export const DEFAULT_TURN_BAR_PINS: Record<TurnBar, readonly string[]> = { reply: ["copy", "fork"], user: ["copy", "editResend"] };
const ID = /^[A-Za-z0-9:._-]{1,200}$/;
const MAX = 50;

export type TurnBarPins = Partial<Record<TurnBar, string[] | null>>;

/** A `ref.action` item's pin id. */
export const refPinId = (itemId: string): string => `ref:${itemId}`;

function cleanList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && ID.test(id)))].slice(0, MAX);
}

/** The stored pins (per bar; a missing / null bar = never changed). */
export function migrateTurnBarPins(raw: unknown): TurnBarPins {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TurnBarPins = {};
  for (const bar of ["reply", "user"] as const) {
    const list = cleanList((raw as Record<string, unknown>)[bar]);
    if (list) out[bar] = list;
  }
  return out;
}

/** The pins in effect for `bar`; `inline`: the pin ids of the `ref.action` items that ask to be on the bar. */
export function turnBarPins(stored: TurnBarPins, bar: TurnBar, inline: readonly string[] = []): readonly string[] {
  return stored[bar] ?? [...DEFAULT_TURN_BAR_PINS[bar], ...inline.filter((id) => !DEFAULT_TURN_BAR_PINS[bar].includes(id))];
}

/** `stored` with `id` pinned on `bar` (appended: the newest pin comes last) or unpinned. */
export function withTurnBarPin(stored: TurnBarPins, bar: TurnBar, id: string, on: boolean, inline: readonly string[] = []): TurnBarPins {
  const pins = turnBarPins(stored, bar, inline).filter((p) => p !== id);
  return { ...stored, [bar]: on ? [...pins, id].slice(-MAX) : pins };
}

export interface TurnBarLayout {
  /** Pinned actions that exist on this turn, in pin order, as many as fit. */
  shown: string[];
  /** Live-state actions (e.g. a turn with notes) not among `shown`: on the bar after the pins, whatever the pins say. */
  live: string[];
  /** The 「⋯」 rows: pinned ones first (pin order, those that fit and those that did not), then the rest in bar order. */
  menuPinned: string[];
  menuRest: string[];
}

/**
 * Split this turn's actions (`ids`, in the bar's order) by the pins. `cap`: how many pinned icons fit on the
 * bar (narrow panes); the others stay in 「⋯」. `live`: actions whose state is on.
 */
export function layoutTurnBar(ids: readonly string[], pins: readonly string[], cap: number, live: ReadonlySet<string> = new Set()): TurnBarLayout {
  const present = new Set(ids);
  const pinned = pins.filter((id) => present.has(id));
  const shown = pinned.slice(0, Math.max(0, cap));
  return {
    shown,
    live: ids.filter((id) => live.has(id) && !shown.includes(id)),
    menuPinned: pinned,
    menuRest: ids.filter((id) => !pinned.includes(id)),
  };
}

/** Pinned icons that fit on a bar in a row `width` px wide (the reply row also holds the turn's status). */
export function turnBarCap(width: number): number {
  if (!(width > 0)) return 8;
  if (width < 320) return 3;
  if (width < 480) return 5;
  return 8;
}
