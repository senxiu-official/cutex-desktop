// Contract 1.22 (docs/desktop-modules.md §27, design 032): desktop widgets — what a module declares in the
// `desktop.widget` slot, and what its component receives. Contract 1.23 (owner 2026-10-24): the desktop places
// every instance on a grid of whole cells (96 px, 16 px apart — `WIDGET_CELL` / `WIDGET_GAP`); a kind gives its
// sizes in cells (`size.cells`), and a 1.22 declaration in 8 px steps still works: each size maps to the nearest
// cell count (`cellsOfSteps`). The props add `cells`; `steps` stays (the box's px / 8). Contract 1.24 (owner
// 2026-10-24: 两小格 = 一格): the grid is finer — units of 40 px, 16 px apart (`WIDGET_UNIT`); one 1.23 cell is
// exactly 2 × 2 units, so 1.23 sizes and layouts double with nothing moving. A kind may give `size.units`; else its
// `cells` double, else its steps map (`unitSizesOf`); a box is at least 2 × 2 units. The props add `units`. The shell draws the
// shape's chrome, positions and the per-instance settings live in the home document (`HomeDoc.desk`, on the home
// host). A widget reads data only through its own module's narrow services and acts only through `actions`
// (the shell's effect functions, with their 动作预告 and confirmations) — never by raw daemon calls.
import type { ComponentType } from "react";
import type { MessageKey } from "../i18n";
import type { Json, SlotItemBase } from "./types";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/** The 1.22 grid step in px: the unit of `size.min / max / default / presets` (design 030 v2 §2). */
export const WIDGET_STEP = 8;
/** 1.23: one cell of the desktop grid, in px, and the space between two cells (a box of n cells is n × 112 − 16 px). */
export const WIDGET_CELL = 96;
export const WIDGET_GAP = 16;

/** 1.24: the grid unit, in px (16 px apart: a box of n units is n × 56 − 16 px; 2 units + a gap = one 1.23 cell). */
export const WIDGET_UNIT = 40;
/** 1.24: no box smaller than this many units either way (one 40 px unit holds nothing). */
export const WIDGET_MIN_UNITS = 2;
/** [width, height] in units (1.24). */
export type WidgetUnits = readonly [w: number, h: number];

/** [width, height] in cells (1.23). */
export type WidgetCells = readonly [w: number, h: number];

/** The cells nearest to a 1.22 size in 8 px steps (at least one each way): e.g. [44, 12] (352 × 96 px) → [3, 1]. */
export function cellsOfSteps(steps: WidgetSteps): WidgetCells {
  const one = (n: number) => Math.max(1, Math.round((n * WIDGET_STEP + WIDGET_GAP) / (WIDGET_CELL + WIDGET_GAP)));
  return [one(steps[0]), one(steps[1])];
}

/** The units nearest to a 1.22 size in 8 px steps (at least WIDGET_MIN_UNITS each way): e.g. [44, 12] → [6, 2]. */
export function unitsOfSteps(steps: WidgetSteps): WidgetUnits {
  const one = (n: number) => Math.max(WIDGET_MIN_UNITS, Math.round((n * WIDGET_STEP + WIDGET_GAP) / (WIDGET_UNIT + WIDGET_GAP)));
  return [one(steps[0]), one(steps[1])];
}

/** 1.24: a kind's sizes in units. */
export interface WidgetUnitSizes {
  min: WidgetUnits;
  max: WidgetUnits;
  default: WidgetUnits;
  presets?: Readonly<Record<string, WidgetUnits>>;
}

/** 1.23: a kind's sizes in cells; when absent, the step sizes mapped by `cellsOfSteps`. */
export interface WidgetCellSizes {
  min: WidgetCells;
  max: WidgetCells;
  default: WidgetCells;
  presets?: Readonly<Record<string, WidgetCells>>;
}

/** [width, height] in grid steps. */
export type WidgetSteps = readonly [w: number, h: number];

export interface WidgetStepSizes {
  /** Smallest / largest / initial size, in grid steps. */
  min: WidgetSteps;
  max: WidgetSteps;
  default: WidgetSteps;
  /** Named quick sizes (the tile's S / M / W / L), offered in the widget's menu. */
  presets?: Readonly<Record<string, WidgetSteps>>;
  /** Keep width / height (e.g. 1 for a round face); the owner cannot change it. */
  ratio?: number;
  /** false: always the default size (no resize handle). Default true. */
  resizable?: boolean;
  /** 1.23: the same sizes in whole cells (preferred). Without it the desktop maps the step sizes above. */
  cells?: WidgetCellSizes;
  /** 1.24: the same sizes in units (40 px; preferred). Without it: `cells` doubled, else the step sizes mapped. */
  units?: WidgetUnitSizes;
}

/** v1.29: a kind that gives its sizes in units need not give the older steps (the public API has only units). */
export type WidgetSizeSpec = WidgetStepSizes | { units: WidgetUnitSizes; ratio?: number; resizable?: boolean };

/** A kind's initial size in 8 px steps; from its units when it gives no steps (n units = n × 56 − 16 px). */
export function defaultStepsOf(size: WidgetSizeSpec): WidgetSteps {
  if ("default" in size) return size.default;
  const one = (n: number) => (n * (WIDGET_UNIT + WIDGET_GAP) - WIDGET_GAP) / WIDGET_STEP;
  return [one(size.units.default[0]), one(size.units.default[1])];
}

/**
 * A kind's sizes in units (1.24): its own `units`, else its 1.23 `cells` doubled, else its 1.22 step sizes mapped —
 * never rejected; every size at least WIDGET_MIN_UNITS, the max at least the min, the default between them.
 */
export function unitSizesOf(size: WidgetSizeSpec): WidgetUnitSizes {
  const two = (c: WidgetCells): WidgetUnits => [c[0] * 2, c[1] * 2];
  const steps = size as WidgetStepSizes;
  const raw: WidgetUnitSizes = steps.units ?? (steps.cells ? { min: two(steps.cells.min), max: two(steps.cells.max), default: two(steps.cells.default), ...(steps.cells.presets ? { presets: Object.fromEntries(Object.entries(steps.cells.presets).map(([k, v]) => [k, two(v)])) } : {}) } : { min: unitsOfSteps(steps.min), max: unitsOfSteps(steps.max), default: unitsOfSteps(steps.default), ...(steps.presets ? { presets: Object.fromEntries(Object.entries(steps.presets).map(([k, v]) => [k, unitsOfSteps(v)])) } : {}) });
  const lo = (v: WidgetUnits): WidgetUnits => [Math.max(WIDGET_MIN_UNITS, Math.round(v[0])), Math.max(WIDGET_MIN_UNITS, Math.round(v[1]))];
  const min = lo(raw.min);
  const m = lo(raw.max);
  const max: WidgetUnits = [Math.max(min[0], m[0]), Math.max(min[1], m[1])];
  const d = lo(raw.default);
  const def: WidgetUnits = [Math.min(max[0], Math.max(min[0], d[0])), Math.min(max[1], Math.max(min[1], d[1]))];
  return { min, max, default: def, ...(raw.presets ? { presets: Object.fromEntries(Object.entries(raw.presets).map(([k, v]) => [k, lo(v)])) } : {}) };
}

/** A kind's sizes in cells: its own `cells`, else its 1.22 step sizes mapped (never rejected). */
export function cellSizesOf(size: WidgetStepSizes): WidgetCellSizes {
  if (size.cells) return size.cells;
  const presets = size.presets ? Object.fromEntries(Object.entries(size.presets).map(([k, v]) => [k, cellsOfSteps(v)])) : undefined;
  const min = cellsOfSteps(size.min);
  const max = cellsOfSteps(size.max);
  const def = cellsOfSteps(size.default);
  return { min, max: [Math.max(min[0], max[0]), Math.max(min[1], max[1])], default: def, ...(presets ? { presets } : {}) };
}

/**
 * How the shell draws the box (design 030 v2 §1: "the grid always exists; what sits on it need not be a
 * rectangle"). The box (x / y / w / h) snaps and never overlaps another widget's; clicks follow the visible shape.
 *  card  — the desktop's glass card (rounded rectangle);  round — a circle (keep `size.ratio` 1);
 *  path  — the glass clipped to `clipPath` (a CSS `polygon()` / `path()`); bare — no chrome, the widget draws.
 */
export type WidgetShape = "card" | "round" | "path" | "bare";

/** A per-instance setting value (JSON, so it can live in the home document). */
export type WidgetSettings = { readonly [key: string]: Json };

interface FieldBase {
  key: string;
  labelKey: MessageKey;
  hintKey?: MessageKey;
}
/** One field of a widget's settings form; the shell renders it (Settings → the widget's panel in 编辑主页). */
export type WidgetSettingField =
  | (FieldBase & { type: "text"; maxLength?: number; placeholderKey?: MessageKey })
  | (FieldBase & { type: "number"; min: number; max: number; step?: number; unit?: string })
  | (FieldBase & { type: "toggle" })
  | (FieldBase & { type: "select"; options: readonly { value: string; labelKey: MessageKey }[] })
  /** An IANA time zone (e.g. "Australia/Sydney"); the shell offers a searchable list. */
  | (FieldBase & { type: "timezone" })
  /** A list of records, each with these (flat) fields; `min` / `max` entries. */
  | (FieldBase & { type: "list"; fields: readonly Exclude<WidgetSettingField, { type: "list" }>[]; min?: number; max: number; addLabelKey: MessageKey; itemDefaults: WidgetSettings });

/**
 * Where a widget's content comes from (design 032 §3; owner 2026-10-22: widgets will be wired to agents and
 * services — first class now so the contract need not break later).
 *  module  — a desktop module draws it (built in, or a downloadable first-party pack). Implemented.
 *  service — a cutex service publishes it (capability `service-tiles`: a tile template + data; a pinned service's
 *            tile is an instance of the tile widget with this source). A service declaring extra widgets: §3.2.
 *  agent   — an agent's HTML artifact in the opaque frame (design 004's three channels only), optionally fed by a
 *            small JSON artifact the agent republishes. Specified (§3.3), not implemented yet.
 */
export type WidgetSource = { kind: "module" } | { kind: "service"; hostId: string; slug: string } | { kind: "agent"; hostId: string; sessionId: string; artifactId?: string };

/** A module-listed instance (`instances: "module"`, e.g. one per pin): its id is stable across devices. */
export interface WidgetInstanceRef {
  id: string;
  /** Shown in menus and provenance (「来自 …」). */
  title?: string;
  /** Its own initial size in 8 px steps (else the kind's default). */
  size?: WidgetSteps;
  /** 1.23: its own initial size in cells (wins over `size`). */
  cells?: WidgetCells;
  /** 1.24: its own initial size in units (wins over `cells` and `size`). */
  units?: WidgetUnits;
  /** Where its content comes from (default: the module). */
  source?: WidgetSource;
}

/**
 * What a widget may do beyond itself: the shell's own effect functions (the same as the sidebar's, the tray's,
 * ⌘K's), so 动作预告 / confirmations apply and nothing new can reach the daemon. Each returns false when it did
 * not happen (refused, cancelled, unavailable).
 */
export interface WidgetActions {
  /** Opens an agent's conversation (as a click on its sidebar row). */
  openAgent(hostId: string, sessionId: string): Promise<boolean>;
  /** Opens a page (`main.page` id + params), e.g. a project's overview. */
  openPage(page: `${string}.${string}`, params?: Readonly<Record<string, string>>): boolean;
  /** Opens a service (as its pinned tile does: a pane in the focused Shelf, or the browser). */
  openService(hostId: string, slug: string): Promise<boolean>;
  /** Sends text to an agent — only after the owner confirms it in a dialog that shows the text and the agent. */
  sendToAgent(hostId: string, sessionId: string, text: string): Promise<boolean>;
}

export interface DesktopWidgetProps {
  instanceId: string;
  /** The box, in px (the shape is drawn inside it), in 1.22 grid steps (px / 8), and in cells (1.23). */
  width: number;
  height: number;
  steps: { w: number; h: number };
  cells: { w: number; h: number };
  /** 1.24: the box in grid units (40 px, 16 px apart). */
  units: { w: number; h: number };
  theme: "light" | "dark";
  /** This instance's settings (the kind's `defaults` merged under what the owner chose). */
  settings: WidgetSettings;
  /** Replaces this instance's settings (stored in the home document; validated against the schema). */
  setSettings(next: WidgetSettings): void;
  reducedMotion: boolean;
  /** The desktop is being arranged: draw the content inert (the shell takes the pointer). */
  arranging: boolean;
  /** The shared ticker's time (epoch ms; `refresh` "minute": changes at each minute boundary). */
  now: number;
  /** The host that keeps the home document (the owner's home host), when known. */
  hostId: string | null;
  /** The instance's source (module / service / agent). */
  source: WidgetSource;
  actions: WidgetActions;
}

export interface DesktopWidgetItem extends SlotItemBase {
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  icon: Icon;
  size: WidgetSizeSpec;
  shape?: WidgetShape;
  /** For `shape: "path"`: a CSS clip-path in % of the box. */
  clipPath?: string;
  /**
   * "owner" (default): the owner adds / removes instances (编辑主页 / the desktop's 添加小组件 menu); stored in
   * `HomeDoc.desk.items`. "module": the module lists them (`useInstances`, e.g. one per pinned tile) and removes
   * them (`remove`).
   */
  instances?: "owner" | "module";
  /** Owner instances: more than one allowed (复制 / 添加 again). Default false. */
  multiple?: boolean;
  /** On a fresh desktop (and in 恢复默认布局): placed by the default layout in this area, by order. */
  defaultPlace?: { area: "header-left" | "header-right" | "side" | "main"; order: number };
  /** The per-instance settings form (rendered by the shell) and its initial values. */
  settings?: readonly WidgetSettingField[];
  /** Initial settings of a new instance; a function of the UI locale when they hold words (e.g. city names). */
  defaults?: WidgetSettings | ((locale: string) => WidgetSettings);
  /** Module instances (`instances: "module"`), in their order. */
  useInstances?(): readonly WidgetInstanceRef[];
  /** Removes a module instance (its × / 删除; e.g. unpin). */
  remove?(instanceId: string): void;
  /** Re-render cadence through the shared ticker (no own timers). Default: never (data hooks re-render it). */
  refresh?: "minute" | "second";
  /** Its source when every instance has the same (default `{ kind: "module" }`). */
  source?: WidgetSource;
  Widget: ComponentType<DesktopWidgetProps>;
}
