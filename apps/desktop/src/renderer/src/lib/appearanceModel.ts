// Settings → 外观 model (pure): fields, ranges, parsing and the CSS variables they become.
// lib/appearance.ts stores and applies it.
import { FALLBACK_FONT_VARIABLES, type FontVariables } from "./fontFaces";
import { ACRYLIC_DEFAULT, ACRYLIC_RANGE, DESK_BRIGHTNESS_DEFAULT, DESK_BRIGHTNESS_RANGE, deskDim, SINGLE_PCT_DEFAULT, SINGLE_PCT_RANGE, type CardMaterial, type SingleWidthMode } from "./workSurface";
import type { WorkspaceRailPlacement, WorkspaceWidthMode } from "./workspaceRow";

export type Density = "compact" | "standard" | "comfortable";

/**
 * 页面打开位置 (owner 2026-10-21): where a `main.page` (项目, 委托, 服务, 审批…) opens — its own pane in the focused
 * conversation's Shelf (default), or 占用会话: over the conversation column, with its own page header (Esc / × back).
 */
export type PageOpenPlace = "shelf" | "column";

export interface Appearance {
  /** Whole-window zoom, percent (Electron zoom factor). */
  zoom: number;
  /** Latin UI font family ("" = built-in stack). */
  uiFont: string;
  /** Font restricted to CJK characters ("" = built-in CJK stack). */
  cjkFont: string;
  /** Conversation text font ("" = same as the UI). */
  chatFont: string;
  /** Conversation CJK font ("" = the UI CJK font). */
  chatCjkFont: string;
  /** Conversation text size, px. */
  chatFontSize: number;
  monoFont: string;
  /** Code CJK font ("" = the UI CJK font). */
  monoCjkFont: string;
  monoFontSize: number;
  /** Sidebar width, px (also set by dragging its edge). */
  sidebarWidth: number;
  /** Right side pane (files / changes / preview) width, px; set by dragging its left edge. */
  sidePaneWidth: number;
  /** Conversation column max width, px (0 = full width). */
  readingWidth: number;
  density: Density;
  /** Status capsule scale, percent. */
  capsuleScale: number;
  /** 卡片材质 (owner 2026-10-21): opaque cards (default) or 亚克力 (translucent, the desktop blurred behind). */
  cardMaterial: CardMaterial;
  /** 亚克力 opacity, percent of the card colour. */
  cardOpacity: number;
  /**
   * 工作区宽度 (owner 2026-10-21): 智能 (default) = 按内容 with one workspace, 铺满窗口 with two (lib/workspaceRow
   * rowWidthMode); 按内容 = each workspace at its content width, centred, the desktop beside; 铺满窗口 = the
   * columns share the window's width. Widths only (owner 2026-10-21): the cards keep their radii, gaps and
   * shadows — edge to edge is `edgeToEdge`. The stored `fillWindow: true` of 窗格铺满时占满整个窗口 reads as 铺满窗口.
   */
  fillMode: boolean;
  workspaceWidth: WorkspaceWidthMode;
  /**
   * 贴边显示 (owner 2026-10-21, default off): while the panes fill the work area, no gaps / margins / outer radii,
   * no desktop. Was part of 铺满窗口 / 窗格铺满时占满整个窗口: on when one of those was explicitly on (`migrateEdgeToEdge`).
   */
  edgeToEdge: boolean;
  /** The 工作区宽度 default's revision the stored value was written at (WORKSPACE_WIDTH_REV: 智能 became it). */
  workspaceWidthRev: number;
  /** 工作区的 Shelf Rail with two workspaces: 外侧 (default) / 永远偏右 (lib/workspaceRow). */
  wsRailPlacement: WorkspaceRailPlacement;
  /** Shelf Rail 在 Shelf 的 外侧 / 内侧: every Shelf (each one's ⋯ can still change its own), and new ones. */
  shelfRailPlacement: "outer" | "inner";
  /**
   * {{shelf}} Rail 常驻 (owner 2026-10-21, default on): every conversation's Shelf Rail stays at its place — a closed
   * tool area shows its Shelves as rails, an empty Shelf a rail with the owner's avatar and ＋ (the launchers), the
   * other workspace's too. Off: an empty Shelf shows no rail, a closed tool area nothing (one workspace).
   */
  shelfRailAlways: boolean;
  /** 单个对话的默认宽度. */
  singleWidth: SingleWidthMode;
  /** 自定义百分比 of the work area. */
  singleWidthPct: number;
  /** The single column's width dragged at its edges, px (0 = the default above). */
  singleColumnW: number;
  /** 桌面亮度 (owner 2026-10-21), percent: no pane in front / a conversation or page open / the panes fill the screen. */
  deskEmpty: number;
  deskOpen: number;
  deskFull: number;
  /** 页面打开位置: the focused conversation's Shelf (default) or 占用会话. */
  pageOpen: PageOpenPlace;
  /** 拖放落点预览 (owner 2026-10-23): 只要框线 (default, lighter) or 框线+底色 (the earlier look); components/side/SideDndLayer. */
  dropPreview: DropPreviewStyle;
}

/** How a drag's drop zone is drawn: an outline only, or an outline over a tint. */
export type DropPreviewStyle = "outline" | "fill";

/** 工作区宽度's default revision: 1 = 智能 (owner 2026-10-21; before it 按内容 was the default). */
export const WORKSPACE_WIDTH_REV = 1;

/**
 * Stored 工作区宽度 → setting: 智能 / 按内容 / 铺满窗口 as chosen; a 按内容 stored before revision 1 (the old
 * default, never chosen apart from it) becomes 智能 once; 窗格铺满时占满整个窗口 (`fillWindow`, before
 * 2026-10-21) reads as 铺满窗口; anything else is the default.
 */
export function migrateWorkspaceWidth(v: unknown, rev: unknown, fillWindow: unknown): WorkspaceWidthMode {
  if (v === "smart" || v === "fill") return v;
  if (v === "content") return typeof rev === "number" && rev >= WORKSPACE_WIDTH_REV ? "content" : "smart";
  return fillWindow === true ? "fill" : "smart";
}

/**
 * Stored 贴边显示: as chosen once written; before it existed, on when edge to edge was explicitly on — the old
 * 窗格铺满时占满整个窗口 (`fillWindow: true`) or 铺满窗口 chosen (it was edge to edge until 2026-10-21).
 */
export function migrateEdgeToEdge(v: unknown, workspaceWidth: unknown, fillWindow: unknown): boolean {
  if (typeof v === "boolean") return v;
  return fillWindow === true || workspaceWidth === "fill";
}

export const DEFAULT_APPEARANCE: Appearance = {
  zoom: 100,
  uiFont: "",
  cjkFont: "",
  chatFont: "",
  chatCjkFont: "",
  chatFontSize: 14,
  monoFont: "",
  monoCjkFont: "",
  monoFontSize: 13,
  sidebarWidth: 256,
  sidePaneWidth: 420,
  readingWidth: 768,
  density: "standard",
  capsuleScale: 100,
  cardMaterial: "opaque",
  cardOpacity: ACRYLIC_DEFAULT,
  fillMode: false,
  workspaceWidth: "smart",
  workspaceWidthRev: WORKSPACE_WIDTH_REV,
  edgeToEdge: false,
  wsRailPlacement: "outer",
  shelfRailPlacement: "outer",
  shelfRailAlways: true,
  singleWidth: "reading",
  singleWidthPct: SINGLE_PCT_DEFAULT,
  singleColumnW: 0,
  deskEmpty: DESK_BRIGHTNESS_DEFAULT.empty,
  deskOpen: DESK_BRIGHTNESS_DEFAULT.open,
  deskFull: DESK_BRIGHTNESS_DEFAULT.full,
  pageOpen: "shelf",
  dropPreview: "outline",
};

/** Allowed ranges (wide on purpose: 4K at 100% scaling and a laptop at 200% both need to fit). */
export const RANGES = {
  zoom: [50, 250],
  chatFontSize: [11, 28],
  monoFontSize: [10, 24],
  sidebarWidth: [180, 640],
  sidePaneWidth: [260, 1600],
  readingWidth: [480, 2400],
  capsuleScale: [70, 300],
  cardOpacity: ACRYLIC_RANGE,
  singleWidthPct: SINGLE_PCT_RANGE,
  singleColumnW: [300, 8000],
  deskEmpty: DESK_BRIGHTNESS_RANGE,
  deskOpen: DESK_BRIGHTNESS_RANGE,
  deskFull: DESK_BRIGHTNESS_RANGE,
} as const satisfies Partial<Record<keyof Appearance, readonly [number, number]>>;

const clamp = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

export function parseAppearance(raw: unknown): Appearance {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    zoom: clamp(v.zoom, RANGES.zoom, DEFAULT_APPEARANCE.zoom),
    uiFont: str(v.uiFont),
    cjkFont: str(v.cjkFont),
    chatFont: str(v.chatFont),
    chatCjkFont: str(v.chatCjkFont),
    chatFontSize: clamp(v.chatFontSize, RANGES.chatFontSize, DEFAULT_APPEARANCE.chatFontSize),
    monoFont: str(v.monoFont),
    monoCjkFont: str(v.monoCjkFont),
    monoFontSize: clamp(v.monoFontSize, RANGES.monoFontSize, DEFAULT_APPEARANCE.monoFontSize),
    sidebarWidth: clamp(v.sidebarWidth, RANGES.sidebarWidth, DEFAULT_APPEARANCE.sidebarWidth),
    sidePaneWidth: clamp(v.sidePaneWidth, RANGES.sidePaneWidth, DEFAULT_APPEARANCE.sidePaneWidth),
    readingWidth: v.readingWidth === 0 ? 0 : clamp(v.readingWidth, RANGES.readingWidth, DEFAULT_APPEARANCE.readingWidth),
    density: v.density === "compact" || v.density === "comfortable" ? v.density : "standard",
    capsuleScale: clamp(v.capsuleScale, RANGES.capsuleScale, DEFAULT_APPEARANCE.capsuleScale),
    cardMaterial: v.cardMaterial === "acrylic" ? "acrylic" : "opaque",
    cardOpacity: clamp(v.cardOpacity, RANGES.cardOpacity, DEFAULT_APPEARANCE.cardOpacity),
    fillMode: v.fillMode === true,
    workspaceWidth: migrateWorkspaceWidth(v.workspaceWidth, v.workspaceWidthRev, v.fillWindow),
    workspaceWidthRev: WORKSPACE_WIDTH_REV,
    edgeToEdge: migrateEdgeToEdge(v.edgeToEdge, v.workspaceWidth, v.fillWindow),
    wsRailPlacement: v.wsRailPlacement === "right" ? "right" : "outer",
    shelfRailPlacement: v.shelfRailPlacement === "inner" ? "inner" : "outer",
    shelfRailAlways: v.shelfRailAlways !== false,
    singleWidth: v.singleWidth === "full" || v.singleWidth === "custom" ? v.singleWidth : "reading",
    singleWidthPct: clamp(v.singleWidthPct, RANGES.singleWidthPct, DEFAULT_APPEARANCE.singleWidthPct),
    singleColumnW: v.singleColumnW === 0 || v.singleColumnW === undefined ? 0 : clamp(v.singleColumnW, RANGES.singleColumnW, 0),
    deskEmpty: clamp(v.deskEmpty, RANGES.deskEmpty, DEFAULT_APPEARANCE.deskEmpty),
    deskOpen: clamp(v.deskOpen, RANGES.deskOpen, DEFAULT_APPEARANCE.deskOpen),
    deskFull: clamp(v.deskFull, RANGES.deskFull, DEFAULT_APPEARANCE.deskFull),
    pageOpen: v.pageOpen === "column" ? "column" : "shelf",
    dropPreview: v.dropPreview === "fill" ? "fill" : "outline",
  };
}

/** CSS variables for an appearance (tested; applyAppearance writes them on <html>). */
export function appearanceVars(a: Appearance, fonts: FontVariables = FALLBACK_FONT_VARIABLES): Record<string, string> {
  return {
    ...fonts,
    "--chat-font-size": `${a.chatFontSize}px`,
    "--mono-font-size": `${a.monoFontSize}px`,
    "--sidebar-w": `${a.sidebarWidth}px`,
    "--sidepane-w": `${a.sidePaneWidth}px`,
    "--reading-w": a.readingWidth === 0 ? "none" : `${a.readingWidth}px`,
    "--capsule-scale": String(a.capsuleScale / 100),
    "--card-alpha": `${a.cardOpacity}%`,
    // 桌面亮度 (components/tray.css picks one by <html data-desk-state>).
    "--desk-veil-empty": deskDim(a.deskEmpty).veil,
    "--desk-veil-open": deskDim(a.deskOpen).veil,
    "--desk-veil-full": deskDim(a.deskFull).veil,
    "--desk-filter-empty": deskDim(a.deskEmpty).filter,
    "--desk-filter-open": deskDim(a.deskOpen).filter,
    "--desk-filter-full": deskDim(a.deskFull).filter,
  };
}

/** Room the conversation column always keeps when a pane is dragged wider, px. */
export const MIN_CONVERSATION_W = 360;

/**
 * Width for a dragged pane: within its range, and never so wide that the rest of its row (`room` =
 * the row's width, pane included) drops below MIN_CONVERSATION_W. The range minimum wins when the
 * window is too narrow for both.
 */
export function clampPaneWidth(width: number, [lo, hi]: readonly [number, number], room = Number.POSITIVE_INFINITY): number {
  const max = Math.min(hi, room - MIN_CONVERSATION_W);
  return Math.round(Math.max(lo, Math.min(max, width)));
}
