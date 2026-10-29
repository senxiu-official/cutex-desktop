// The desktop's widgets in the home document (design 032 §5; pure, unit-tested in test/deskModel.test.ts):
// `HomeDoc.desk` = which owner instances there are (kind + settings), the kinds whose module instances are off,
// and per width band the boxes the owner arranged. cutex keeps unknown top-level keys of the home document
// (`user-home`: client-owned, forward compatible), so this needs nothing from the host; older desktops ignore it
// and still read `blocks` / `pins` (kept in step here). No `desk` yet = the migrated default (today's blocks),
// written only once the owner changes something.
// Contract 1.23 (the cell grid, deskCells): the boxes the owner arranges are stored in `cells` (per band, whole
// cells). `bands` (the 8 px boxes of 1.22) is no longer written: it stays as it was — the backup the cell layout
// was migrated from (deskCells.migratePxBand, until the owner arranges that band), and what an older desktop
// still shows. An older desktop that rewrites the desk drops `cells`; this one then migrates its `bands` again.
// Contract 1.24 (40 px units): the arranged boxes go to `units` (per band, whole units); `cells` (1.23) is no longer
// written either — read once more as a backup (doubled exactly: deskCells.unitsOfCellBand).
import type { HomeDoc } from "../../../../shared/home";
import type { DesktopWidgetItem, WidgetSettingField, WidgetSettings } from "../widgetTypes";
import type { Json } from "../types";
import type { AnchoredBox, BandKey } from "./deskLayout";
import type { AnchoredCells, CellBand } from "./deskCells";
import { homeBlocks, withBlockVisible, type BlockId } from "./model";

export const DESK_V = 1;

export interface DeskItem {
  id: string;
  kind: string;
  settings?: WidgetSettings;
}
export interface DeskBand {
  width: number;
  at: Record<string, AnchoredBox>;
}
export interface DeskDoc {
  v: typeof DESK_V;
  items: DeskItem[];
  /** Kinds with module instances (e.g. the pinned tiles) that the owner turned off. */
  off?: string[];
  bands: Partial<Record<BandKey, DeskBand>>;
  /** 1.23: per band, the boxes on the cell grid (absent: migrated from `bands` / the default). */
  cells?: Partial<Record<BandKey, CellBand>>;
  /** 1.24: per band, the boxes in grid units (40 px). Absent: from `cells` (doubled), else `bands`, else the default. */
  units?: Partial<Record<BandKey, CellBand>>;
}

/** The legacy block each built-in kind stands for (編輯主页's old toggles; older desktops read them). */
export const LEGACY_BLOCK: Readonly<Record<string, BlockId>> = { "home.profile": "profile", "home.clock": "clock", "home.needs": "needs", "home.stats": "stats", "home.tile": "tiles" };

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isInt = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v < 10000;
const isCells = (b: unknown): b is AnchoredCells => isRecord(b) && isInt(b.x, 0) && isInt(b.y, 0) && isInt(b.w, 1) && isInt(b.h, 1) && (b.ax === "l" || b.ax === "r" || b.ax === "c");
const isBox = (b: unknown): b is AnchoredBox => isRecord(b) && ["x", "y", "w", "h"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k])) && (b.ax === "l" || b.ax === "r" || b.ax === "c");

/** The stored desk, malformed parts dropped (null: none stored). */
export function deskOf(doc: HomeDoc | null): DeskDoc | null {
  const raw = doc?.desk;
  if (!isRecord(raw) || raw.v !== DESK_V || !Array.isArray(raw.items)) return null;
  const items: DeskItem[] = [];
  const seen = new Set<string>();
  for (const it of raw.items) {
    if (!isRecord(it) || typeof it.id !== "string" || typeof it.kind !== "string" || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    items.push({ id: it.id, kind: it.kind, ...(isRecord(it.settings) ? { settings: it.settings as WidgetSettings } : {}) });
  }
  const bands: DeskDoc["bands"] = {};
  if (isRecord(raw.bands))
    for (const key of ["n", "m", "w"] as const) {
      const b = raw.bands[key];
      if (!isRecord(b) || typeof b.width !== "number" || !isRecord(b.at)) continue;
      bands[key] = { width: b.width, at: Object.fromEntries(Object.entries(b.at).filter(([, v]) => isBox(v))) as Record<string, AnchoredBox> };
    }
  const gridBands = (src: unknown): NonNullable<DeskDoc["cells"]> => {
    const out: NonNullable<DeskDoc["cells"]> = {};
    if (isRecord(src))
      for (const key of ["n", "m", "w"] as const) {
        const b = src[key];
        if (!isRecord(b) || !isInt(b.cols, 1) || !isRecord(b.at)) continue;
        out[key] = { cols: b.cols, at: Object.fromEntries(Object.entries(b.at).filter(([, v]) => isCells(v))) as Record<string, AnchoredCells> };
      }
    return out;
  };
  const cells = gridBands(raw.cells);
  const units = gridBands(raw.units);
  const off = Array.isArray(raw.off) ? raw.off.filter((k): k is string => typeof k === "string") : undefined;
  return { v: DESK_V, items, bands, ...(Object.keys(cells).length ? { cells } : {}), ...(Object.keys(units).length ? { units } : {}), ...(off?.length ? { off } : {}) };
}

type Kind = Pick<DesktopWidgetItem, "id" | "instances" | "defaultPlace" | "defaults">;

/** A fresh desktop's owner instances: every owner kind with a default place, minus the blocks hidden before (migration). */
export function initialDesk(doc: HomeDoc | null, kinds: readonly Kind[]): DeskDoc {
  const hidden = new Set(homeBlocks(doc).filter((b) => !b.visible).map((b) => b.id));
  const items = kinds.filter((k) => (k.instances ?? "owner") === "owner" && k.defaultPlace && !hidden.has(LEGACY_BLOCK[k.id]!)).map((k) => ({ id: k.id, kind: k.id }));
  const off = kinds.filter((k) => k.instances === "module" && hidden.has(LEGACY_BLOCK[k.id]!)).map((k) => k.id);
  return { v: DESK_V, items, bands: {}, ...(off.length ? { off } : {}) };
}

/** The desk to show / edit: the stored one, else the migrated default. */
export function currentDesk(doc: HomeDoc | null, kinds: readonly Kind[]): DeskDoc {
  return deskOf(doc) ?? initialDesk(doc, kinds);
}

/** `doc` with its desk replaced by `edit(desk)` (the default materialised first). */
export function withDesk(doc: HomeDoc, kinds: readonly Kind[], edit: (desk: DeskDoc) => DeskDoc): HomeDoc {
  return { ...doc, desk: JSON.parse(JSON.stringify(edit(currentDesk(doc, kinds)))) as Json };
}

export function withBand(desk: DeskDoc, band: BandKey, value: DeskBand): DeskDoc {
  return { ...desk, bands: { ...desk.bands, [band]: value } };
}

/** 1.24: the band's boxes in grid units (`bands` and `cells` are left as they are: the backups). */
export function withUnitBand(desk: DeskDoc, band: BandKey, value: CellBand): DeskDoc {
  return { ...desk, units: { ...desk.units, [band]: value } };
}

/** 1.23: the band's boxes on the cell grid (`bands` is left as it is: the backup). */
export function withCellBand(desk: DeskDoc, band: BandKey, value: CellBand): DeskDoc {
  return { ...desk, cells: { ...desk.cells, [band]: value } };
}

/** A new owner instance of `kind`: its id is the kind's for a single one, `kind#n` for more. */
export function withItem(desk: DeskDoc, kind: string, settings?: WidgetSettings): { desk: DeskDoc; id: string } {
  let id = kind;
  for (let n = 2; desk.items.some((i) => i.id === id); n++) id = `${kind}#${n}`;
  return { desk: { ...desk, items: [...desk.items, { id, kind, ...(settings ? { settings } : {}) }] }, id };
}

/** Removes an owner instance (its boxes go too: no reflow — the others stay where they are). */
export function withoutItem(desk: DeskDoc, id: string): DeskDoc {
  const bands: DeskDoc["bands"] = {};
  for (const [k, b] of Object.entries(desk.bands) as [BandKey, DeskBand][]) {
    const { [id]: _gone, ...at } = b.at;
    bands[k] = { ...b, at };
  }
  const drop = (src: DeskDoc["cells"]): DeskDoc["cells"] => {
    if (!src) return undefined;
    const out: NonNullable<DeskDoc["cells"]> = {};
    for (const [k, b] of Object.entries(src) as [BandKey, CellBand][]) {
      const { [id]: _gone, ...at } = b.at;
      out[k] = { ...b, at };
    }
    return out;
  };
  const cells = drop(desk.cells);
  const units = drop(desk.units);
  return { ...desk, items: desk.items.filter((i) => i.id !== id), bands, ...(cells ? { cells } : {}), ...(units ? { units } : {}) };
}

export function withSettings(desk: DeskDoc, id: string, settings: WidgetSettings): DeskDoc {
  return { ...desk, items: desk.items.map((i) => (i.id === id ? { ...i, settings } : i)) };
}

export function withKindOff(desk: DeskDoc, kind: string, off: boolean): DeskDoc {
  const set = new Set(desk.off ?? []);
  if (off) set.add(kind);
  else set.delete(kind);
  const { off: _o, ...rest } = desk;
  return set.size ? { ...rest, off: [...set] } : rest;
}

/** The legacy `blocks` visibility kept in step (older desktops still show the right blocks). */
export function mirrorBlocks(doc: HomeDoc, desk: DeskDoc): HomeDoc {
  let out = doc;
  for (const [kind, block] of Object.entries(LEGACY_BLOCK)) {
    const on = block === "tiles" ? !(desk.off ?? []).includes(kind) : desk.items.some((i) => i.kind === kind);
    if (homeBlocks(out).find((b) => b.id === block)?.visible !== on) out = withBlockVisible(out, block, on);
  }
  return out;
}

// ── Settings: the kind's defaults under the stored values, values checked against the schema ─────────

function validValue(field: WidgetSettingField, v: Json | undefined): boolean {
  switch (field.type) {
    case "text":
      return typeof v === "string" && v.length <= (field.maxLength ?? 200);
    case "number":
      return typeof v === "number" && Number.isFinite(v) && v >= field.min && v <= field.max;
    case "toggle":
      return typeof v === "boolean";
    case "select":
      return typeof v === "string" && field.options.some((o) => o.value === v);
    case "timezone":
      return typeof v === "string" && isTimeZone(v);
    case "list":
      return Array.isArray(v) && v.length <= field.max && v.length >= (field.min ?? 0) && v.every((row) => isRecord(row) && field.fields.every((f) => validValue(f, (row as Record<string, Json>)[f.key])));
  }
}

/** Whether `tz` is an IANA zone this runtime knows. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * A stored list with each row's missing fields filled from `itemDefaults`: a field added to a list later (世界时钟's
 * `icon`) must not make the rows saved before it invalid, or the owner's list would fall back to the defaults.
 * Present values are kept as they are (still validated by the caller).
 */
function filledRows(field: Extract<WidgetSettingField, { type: "list" }>, v: Json): Json {
  if (!Array.isArray(v)) return v;
  return v.map((row) => (isRecord(row) ? Object.fromEntries([...Object.entries(field.itemDefaults), ...Object.entries(row).filter(([, x]) => x !== undefined)]) : row)) as Json;
}

/**
 * An instance's settings: each field's stored value when valid, else the kind's default (unknown keys dropped). A
 * list's rows get the fields they lack from `itemDefaults` first (`filledRows`).
 */
export function settingsOf(kind: Pick<DesktopWidgetItem, "settings" | "defaults">, stored: WidgetSettings | undefined, locale = "zh-CN"): WidgetSettings {
  const defaults = typeof kind.defaults === "function" ? kind.defaults(locale) : kind.defaults;
  const out: Record<string, Json> = { ...(defaults ?? {}) };
  for (const field of kind.settings ?? []) {
    const raw = stored?.[field.key];
    const v = raw !== undefined && field.type === "list" ? filledRows(field, raw) : raw;
    if (v !== undefined && validValue(field, v)) out[field.key] = v;
  }
  return out;
}
