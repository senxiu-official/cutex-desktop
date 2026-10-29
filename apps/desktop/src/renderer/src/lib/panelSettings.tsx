// Settings by panel (design 006 v1, owner 2026-10-22): each panel kind's ⋯ / right-click ends with 「⚙ X 设置…」,
// which opens the Settings Shelf on that panel's page (lib/settingsNav PANEL_PAGES), its 动作预告 saying where
// (design 008: blue = opens here — the Settings Shelf's place, or 设置换到「X」 when it is open — and a thin outline
// on the panel these settings are about). And the other way round (Q9): hovering a setting in the Settings Shelf
// outlines, after FORETELL_DELAY_MS, the panel(s) it affects in the real UI beside it (`settingsAffects`).
// Shell code: names no feature (only panel kinds and the shell's own settings anchors).
import { Settings as SettingsIcon } from "lucide-react";
import { translate, type MessageKey } from "../i18n";
import { useApp } from "../store";
import type { SettingsTab } from "../store";
import type { MenuAction } from "./contextMenu";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { FORETELL_DELAY_MS, setForetell, type Foretell, type ForetellBox, type ForetellMark } from "./foretell";
import { settingsRowKeep, settingsShelfWidth, useSettingsRowNeed, useSettingsShelf } from "./settingsShelf";
import { isElement } from "./ownerWindow";
import { queryAppWindows } from "./appWindowSet";

/** The panel pages (lib/settingsNav PANEL_PAGES), by their page id. */
export type PanelPage = "sidebar" | "conversation" | "status" | "sides" | "tray" | "desktop";

/** A page's name (its nav title). */
export const PANEL_PAGE_NAME: Record<PanelPage, MessageKey> = {
  sidebar: "settings.panel.sidebar",
  conversation: "settings.panel.conversation",
  status: "settings.panel.status",
  sides: "settings.panel.shelf",
  tray: "settings.panel.tray",
  desktop: "settings.panel.desktop",
};

/** The menu row's label. */
const MENU_LABEL: Record<PanelPage, MessageKey> = {
  sidebar: "settings.panel.menu.sidebar",
  conversation: "settings.panel.menu.conversation",
  status: "settings.panel.menu.status",
  sides: "settings.panel.menu.sides",
  tray: "settings.panel.menu.tray",
  desktop: "settings.panel.menu.desktop",
};

/** What a setting can affect on screen: a panel kind or a part of one. */
export type PanelTarget = "window" | "sidebar" | "conversation" | "composer" | "margin" | "capsule" | "shelf" | "rail" | "tray" | "desktop";

/** Where each target is in the DOM (the first one laid out is outlined; lib/foretell ForetellMark.selector). */
export const PANEL_SELECTOR: Record<PanelTarget, string> = {
  window: "[data-side-work]",
  sidebar: ".sidebar-card",
  conversation: '[data-focus-region="main"], [data-conv-pane]',
  composer: "[data-composer-block]",
  margin: "[data-gutter-layer]",
  capsule: "[data-status-capsule]",
  shelf: ".shelf-card[data-shelf-card]",
  rail: "nav[data-shelf-rail]",
  tray: "[data-pane-tray]",
  desktop: "[data-window-desk]",
};

/** A target's name in the outline's sentence. */
const TARGET_NAME: Record<PanelTarget, MessageKey> = {
  window: "settings.panel.affects.window",
  sidebar: "settings.panel.sidebar",
  conversation: "settings.panel.conversation",
  composer: "settings.panel.affects.composer",
  margin: "settings.panel.affects.margin",
  capsule: "settings.panel.affects.capsule",
  shelf: "settings.panel.shelf",
  rail: "settings.panel.affects.rail",
  tray: "settings.panel.tray",
  desktop: "settings.panel.desktop",
};

/** The panel a panel page is about (the 「这些设置管它」 outline of the menu row's foretell). */
const PAGE_TARGET: Record<PanelPage, PanelTarget> = { sidebar: "sidebar", conversation: "conversation", status: "composer", sides: "shelf", tray: "tray", desktop: "desktop" };

/**
 * The Settings Shelf's place while it is closed (where it will open): beside the work row on its side, at the
 * width it will be drawn (lib/settingsShelf settingsShelfWidth). Null: nothing measured.
 */
function settingsShelfBox(): ForetellBox | null {
  if (typeof document === "undefined") return null;
  const work = queryAppWindows("[data-side-work]")?.getBoundingClientRect();
  if (!work || work.width <= 0) return null;
  const { side, width } = useSettingsShelf.getState();
  const w = settingsShelfWidth(width, work.width, settingsRowKeep(useSettingsRowNeed.getState().need, work.width));
  return { left: side === "right" ? work.right - w : work.left, top: work.top, width: w, height: work.height };
}

/**
 * 「⚙ X 设置…」's foretell: blue where the Settings Shelf opens (or its card, 设置换到「X」, when open) and a thin
 * outline on the panel these settings are about (`panel`: a selector for that very panel, e.g. this Shelf).
 */
export function panelSettingsForetell(page: PanelPage, panel: string | null = null): Foretell | null {
  const name = translate(PANEL_PAGE_NAME[page]);
  const marks: ForetellMark[] = [];
  if (useSettingsShelf.getState().open) marks.push({ selector: "[data-settings-shelf]", text: translate("foretell.settingsSwitch", { page: name }) });
  else {
    const box = settingsShelfBox();
    if (!box) return null;
    marks.push({ box, text: translate("foretell.settingsHere", { page: name }) });
  }
  marks.push({ selector: panel ?? PANEL_SELECTOR[PAGE_TARGET[page]], text: translate("foretell.settingsPanel"), tone: "fold" });
  return { tone: "open", text: marks[0]!.text!, marks };
}

/** Opens the Settings Shelf on a panel's page (an anchor inside it: that card). */
export function openPanelSettings(page: PanelPage, anchor?: string): void {
  useApp.getState().openSettings(page as SettingsTab, anchor ? { anchor } : undefined);
}

/** The menu row 「⚙ X 设置…」 (the last row of a panel's ⋯ / right-click). */
export function panelSettingsItem(page: PanelPage, opts: { panel?: string | null; anchor?: string } = {}): MenuAction {
  return {
    label: translate(MENU_LABEL[page]),
    icon: <SettingsIcon size={14} />,
    foretell: () => panelSettingsForetell(page, opts.panel ?? null),
    onSelect: () => openPanelSettings(page, opts.anchor),
  };
}

// ── Q9: a setting's panel, outlined while hovered ──────────────────────────────────────────────────

/**
 * What the cards (settings anchors: a `Section` id, or a `settings.section` item id) affect. A card not listed
 * takes its page's (PAGE_AFFECTS); a page not listed outlines nothing.
 */
const ANCHOR_AFFECTS: Readonly<Record<string, readonly PanelTarget[]>> = {
  // 外观: the whole window's look (the launch art is the start page's: nothing on screen).
  colors: ["window"],
  fonts: ["window"],
  layout: ["window"],
  "work-surface": ["window"],
  launchArt: [],
  // 会话
  "shell.composer": ["composer"],
  send: ["composer"],
  queuePanel: ["composer"],
  aboveInput: ["composer"],
  inputBar: ["composer"],
  "shell.gutter": ["margin", "conversation"],
  gutter: ["margin", "conversation"],
  "bookmarks.settings": ["margin", "conversation"],
  "shell.shelfOnly": ["conversation", "shelf"],
  "shelf-only": ["conversation", "shelf"],
  // 状态显示
  places: ["composer", "capsule"],
  "status-capsule.settings": ["capsule"],
  // {{shelf}}
  "shelf-place": ["rail", "shelf"],
};

const PAGE_AFFECTS: Readonly<Partial<Record<string, readonly PanelTarget[]>>> = {
  appearance: ["window"],
  sidebar: ["sidebar"],
  conversation: ["conversation"],
  status: ["composer", "capsule"],
  sides: ["shelf"],
  tray: ["tray"],
  desktop: ["desktop"],
};

/** The targets of the card ids around a hovered row (innermost first) on page `tab`. Pure. */
export function settingsAffects(tab: string, anchors: readonly string[]): readonly PanelTarget[] {
  for (const a of anchors) {
    const hit = ANCHOR_AFFECTS[a];
    if (hit) return hit;
  }
  return PAGE_AFFECTS[tab] ?? [];
}

/** The outline of `targets` (not a click's preview: shown whatever 动作预告 says). Null: nothing to outline. */
export function affectsForetell(targets: readonly PanelTarget[]): Foretell | null {
  if (!targets.length) return null;
  const marks = targets.map((x) => ({ selector: PANEL_SELECTOR[x], text: translate("settings.panel.affects", { panel: translate(TARGET_NAME[x]) }) }));
  return { always: true, tone: "open", text: marks[0]!.text, marks };
}

/** The settings card ids (`settings-<anchor>`) from `el` up to `stop`, innermost first. */
export function anchorsAround(el: Element | null, stop: Element | null): string[] {
  const out: string[] = [];
  for (let n: Element | null = el; n && n !== stop; n = n.parentElement) if (n.id.startsWith("settings-")) out.push(n.id.slice("settings-".length));
  return out;
}

/**
 * The Settings Shelf's page column (components/SettingsShelf): the pointer resting FORETELL_DELAY_MS on a card
 * outlines what it affects; moving within the card keeps it; leaving the column (or `disabled`: maximised — the
 * real UI is covered) takes it away.
 */
export function useSettingsAffectsHover(tab: string, disabled: boolean): { onPointerOver(e: ReactPointerEvent<HTMLElement>): void; onPointerLeave(): void } {
  const owner = useRef<object>({}).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<string | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    last.current = null;
    setForetell(owner, null);
  };
  useEffect(() => clear, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (disabled) clear();
  }, [disabled, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    onPointerOver(e) {
      if (disabled) return;
      const targets = settingsAffects(tab, anchorsAround(isElement(e.target) ? e.target : null, e.currentTarget));
      const key = targets.join(" ");
      if (key === last.current) return;
      clear();
      last.current = key;
      const f = affectsForetell(targets);
      if (!f) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        setForetell(owner, f);
      }, FORETELL_DELAY_MS);
    },
    onPointerLeave: clear,
  };
}
