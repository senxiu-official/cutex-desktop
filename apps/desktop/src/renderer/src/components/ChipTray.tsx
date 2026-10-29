import { isImeComposing } from "../lib/ime";
// The window's bottom layer and its tray (canvas principles §7, owner 2026-10-21; contract 1.20; §25.4).
// DesktopBackground: the first shown `pane.desktop` item drawn as the background of the whole window, behind
// every card (sidebar, conversation columns, Shelves) — the gaps between the cards and the margins around them
// show it, never a flat window colour (owner 2026-10-21). It is mounted once with reason "covered" (the
// background only), is never interactive and stays drawn whatever is in front; 窗格铺满时占满整个窗口 hides it
// while the panes fill the work area (lib/workSurface edgeToEdge, styles.css).
// DesktopStage: the desktop's own content (reason "empty" / "desktop": profile card, tiles, clock, 需要你 …)
// over the work area when nothing is in front of it; while panes cover it the content is not drawn and its
// box is inert — only the background shows through the gaps. Its box never changes for what floats over it
// (lib/paneDesk, lib/trayModel deskGeometry).
// ChipTray: the tray = 任务栏 (docs/design/001-tray-taskbar.md): the item's Dock draws what is pinned (same list
// as the desktop tiles) and what is open (agents on screen / replaced / minimised, lib/trayOpen); the shell
// draws the frame and its menu (停靠在…, 托盘常驻, 分组). Tool chips are gone (checklist #7). It is a panel docked
// to an edge of the window's work area (TrayFrame, App: bottom by default, top, left or right — vertical on
// the sides; outside the sidebar card and the Shelves, at the window's edge), dragged there by its grip
// (the four edges light up as drop zones) or 停靠在… in its menu; remembered on this machine (lib/trayPrefs).
// 托盘常驻 (default on): at the bottom (checklist #36) an opaque low card under the conversation columns only
// (the sidebar card and the Shelves keep their full height; lib/trayRoom), else a low strip in its own band of
// the layout — the panes shrink by the band, nothing overlaps them. Off: the same strip while the desktop shows; while panes cover it, a small pill (handle)
// in a thin band at that edge — hovering it, a click or Ctrl/⌘+J reveals the dock over the panes (never
// pushing them), and it hides after use (lib/trayStore). Owner 2026-10-21 (the thin line was not findable).
// With a pin list (the item's Dock) the tray is there even with nothing pinned: 「＋ 固定」 (the desktop's
// picker) and a muted one-line hint; 托盘常驻 off, its handle shows all the same (owner 2026-10-21: an empty
// tray was never drawn, so it could not be found). No pin list (its module off): no tray.
// Conversations are no chips any more (the agent keeps running in cutex; its pin is the shortcut). Shell code:
// names no feature.
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { observeSync } from "../lib/syncResize";
import { fitTray, foldUnits } from "../lib/trayFold";
import { Check, Cog, GripHorizontal, GripVertical, Plus } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { useMenuOwner, type MenuEntry } from "../lib/contextMenu";
import { panelSettingsItem } from "../lib/panelSettings";
import { panelGuideItem } from "../lib/panelGuideMenu";
import { desktopMounted, desktopReason, useDesktopLayer, type DesktopInput } from "../lib/paneDesk";
import { useSide } from "../lib/sideLayoutStore";
import { usePanes } from "../lib/paneStore";
import { conversationPanes, paneBinding } from "../lib/paneLayout";
import { useStrips } from "../lib/convStrips";
import { useTrayOpen } from "../lib/trayOpen";
import { heldGeometry, roomGeometry, TRAY_HOLD_MS, TRAY_ROOM_GAP, useTrayRoom, type Box, type RoomGeometry } from "../lib/trayRoom";
import { useFullscreen } from "../lib/panelFull";
import { isTrayKey, trayDockPx, TRAY_DRAG_THRESHOLD, TRAY_EDGE_DWELL_MS, TRAY_EDGE_GRACE_MS, TRAY_EDGES, TRAY_MENU_OWNER, trayArrowStep, trayBand, trayDropEdge, trayPlacement, trayVertical, type TrayEdge, type TrayPlacement } from "../lib/trayModel";
import { openTrayMenu } from "../lib/trayMenu";
import { useTrayPinKeeper } from "../lib/trayPins";
import { setTrayPrefs, useTrayPrefs } from "../lib/trayPrefs";
import { hideTray, holdTray, publishTrayStage, releaseTray, revealTray, toggleTray, useTray, useTrayDrag, useTrayStage } from "../lib/trayStore";
import type { AppSlotEntry } from "../modules/slots";
import { ItemBoundary } from "../modules/Outlet";
import { agentHost, useApp } from "../store";
import { setTrayBandWidth } from "../lib/workspaces";
import { useInWindow, useWindowKey } from "../lib/windowScope";
// After the side stores (lib/deskBrightness reads them): keeps their import order.
import { useDeskState } from "../lib/deskBrightness";
import { useAppearance } from "../lib/appearance";
import { AcrylicFrost, TitlebarFrost } from "./AcrylicFrost";
import "./tray.css";
import { keyVar } from "../lib/keybindings";
import { DROP_TINT } from "../lib/dropTint";
import { isNode, ownerWindowOf, resizeObserverFor } from "../lib/ownerWindow";
import { useOwnerWindow } from "../lib/ownerContext";

// ── The bottom layer ────────────────────────────────────────────────────────────────────────────

/**
 * The desktop background behind the whole window (App root, under every card): the layer item with reason
 * "covered" — its background only. Not interactive; the work area's DesktopStage draws the content.
 */
export function DesktopBackground() {
  const layer = useDesktopLayer();
  const hostId = useApp(agentHost);
  const Desktop = layer?.item.Desktop;
  const acrylic = useAppearance().cardMaterial === "acrylic";
  if (!layer || !Desktop) return null;
  const desk = (
    <div data-window-desk="" aria-hidden inert className="window-desk">
      <ItemBoundary moduleId={layer.moduleId}>
        <Desktop reason="covered" hostId={hostId} />
      </ItemBoundary>
    </div>
  );
  // The same background again, blurred once and clipped to the window bar (any material) and, with 亚克力, to
  // the cards (components/AcrylicFrost, #14): no backdrop-filter re-blurring per frame.
  return (
    <Fragment key={layer.item.id}>
      {desk}
      <TitlebarFrost>{desk}</TitlebarFrost>
      {acrylic && <AcrylicFrost>{desk}</AcrylicFrost>}
    </Fragment>
  );
}

type StageInput = Omit<DesktopInput, "showWhenEmpty" | "hasLayer">;
type Reason = "empty" | "desktop";

/**
 * The work area over the desktop layer. `children(reason)`: the panes (reason non-null: the desktop is on
 * screen — draw no empty pane over it). Keyed by the item (its hooks stay put). It tells the tray (drawn by
 * TrayFrame at the work area's edge) what there is to dock and whether the desktop shows.
 */
export function DesktopStage({ entry, input, hostId, children }: { entry: AppSlotEntry<"pane.desktop"> | null; input: StageInput; hostId: string; children: (reason: Reason | null) => ReactNode }) {
  if (!entry) return <Stage reason={null} mounted={false} input={input} entry={null} hostId={hostId} dockCount={0} children={children} />;
  return <LayerStage entry={entry} input={input} hostId={hostId} children={children} />;
}

function LayerStage({ entry, input, hostId, children }: { entry: AppSlotEntry<"pane.desktop">; input: StageInput; hostId: string; children: (reason: Reason | null) => ReactNode }) {
  const showWhenEmpty = entry.item.useShowWhenEmpty?.() ?? true;
  const dockCount = entry.item.useDockCount?.() ?? 0;
  const reason = desktopReason({ ...input, showWhenEmpty, hasLayer: true });
  const mounted = desktopMounted({ ...input, hasLayer: true });
  return <Stage reason={reason} mounted={mounted} input={input} entry={entry} hostId={hostId} dockCount={entry.item.Dock ? dockCount : 0} children={children} />;
}

function Stage({ reason, mounted, input, entry, hostId, dockCount, children }: { reason: Reason | null; mounted: boolean; input: StageInput; entry: AppSlotEntry<"pane.desktop"> | null; hostId: string; dockCount: number; children: (reason: Reason | null) => ReactNode }) {
  const desktopOn = !!reason;
  // This window's tray (multi-window P3: a desk's effects run in the main window's commit too).
  const here = useInWindow();
  useLayoutEffect(() => here(() => publishTrayStage({ entry, dockCount, desktopOn, fullWindow: input.fullWindow })), [here, entry, dockCount, desktopOn, input.fullWindow]);
  useLayoutEffect(() => () => here(() => publishTrayStage(null)), [here]);
  // 桌面亮度: <html data-desk-state> (empty / open / full).
  useDeskState(desktopOn, input.fullWindow);
  const Desktop = entry?.item.Desktop;
  // The tray card floats over the desktop's bottom (lib/trayRoom): its content keeps clear of it.
  const trayRoom = useTrayRoom((s) => s.active);
  // 「托盘两排」: the card is taller by this much; the desktop's content keeps clear of it too (`--tray-extra`).
  const trayExtra = useTrayRoom((s) => trayDockPx(s.rows) - trayDockPx(1));
  return (
    <div data-pane-desk-stage="" data-desk-on={reason ? "" : undefined} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {mounted && Desktop && entry && (
        // The desktop's content: all of the work area, behind the panes and the Shelves, over the window's
        // background (DesktopBackground). Covered: nothing drawn here, the box inert (the background shows
        // through the gaps between the cards). The tray has its own band outside (TrayFrame), or — its
        // card at the bottom (lib/trayRoom) — floats over the content's bottom, which keeps clear of it.
        <div data-pane-desktop={reason ?? "covered"} aria-hidden={reason ? undefined : true} inert={!reason} className="pane-desk absolute inset-0 overflow-hidden rounded-xl" style={trayRoom && trayExtra ? ({ "--tray-extra": `${trayExtra}px` } as React.CSSProperties) : undefined}>
          {reason && (
            <ItemBoundary moduleId={entry.moduleId}>
              <Desktop reason={reason} hostId={hostId} tray={trayRoom} />
            </ItemBoundary>
          )}
        </div>
      )}
      {children(reason)}
    </div>
  );
}

// ── The tray's frame: its band at an edge of the work area ───────────────────────────────────────

/**
 * The window's work area (under the title bar: the work row and the Settings Shelf) with the tray's band at
 * the docked edge. The band is part of the layout (the work row gets the rest: nothing overlaps a pane);
 * the tree is the same for every edge (CSS `order` puts the band first on the top / left), so moving the
 * tray never remounts the panes. `hidden`: the row is covered (the Settings Shelf maximised): no tray.
 * 托盘常驻 at the bottom (#36): no band — the conversation cards leave room at their bottom (`data-tray-room`,
 * tray.css) and the tray card sits there, spanning the conversation columns only (lib/trayRoom); a Shelf
 * between two columns: the band again.
 */
export function TrayFrame({ hidden = false, children }: { hidden?: boolean; children?: ReactNode }) {
  const stage = useTrayStage((s) => s.stage);
  // A panel in full screen (§24.16): the tray auto-hides (its handle stays) whatever 托盘常驻 says.
  const full = useFullscreen();
  const persistent = useTrayPrefs((s) => s.persistent) && !full;
  const edge = useTrayPrefs((s) => s.edge);
  const revealed = useTray((s) => s.revealed);
  const target = useTrayDrag((s) => s.target);
  const entry = stage?.entry ?? null;
  // A pin list exists (the item has a Dock): the tray is there even when empty (「＋ 固定」, owner 2026-10-21).
  const canPin = !!entry?.item.Dock;
  const dockCount = canPin ? (stage?.dockCount ?? 0) : 0;
  // What the Dock shows besides the pins (001): the agents on screen and those open in the tray.
  const extras = useDockExtras(canPin);
  const placement: TrayPlacement = stage ? trayPlacement({ items: dockCount + extras, canPin, fullWindow: hidden || stage.fullWindow, persistent, desktopOn: stage.desktopOn, revealed }) : "none";
  // The desktop came back, the tray went or stays docked now: a reveal over the panes is over.
  useEffect(() => {
    if (placement !== "overlay" && useTray.getState().revealed) hideTray();
  }, [placement]);
  const vertical = trayVertical(edge);
  const frame = useRef<HTMLDivElement>(null);
  const roomBand = useRef<HTMLDivElement>(null);
  const roomWanted = placement === "docked" && edge === "bottom";
  // 「托盘两排」: the card is taller while its items take two rows (ChipTray measures them).
  const rows = useTrayRoom((s) => s.rows);
  const dockPx = trayDockPx(edge === "bottom" ? rows : 1);
  const roomMode = useRoomGeometry(frame, roomBand, roomWanted, !!stage?.desktopOn, dockPx);
  const room = roomWanted && roomMode.kind !== "band";
  const band = room ? 0 : trayBand(placement, edge === "bottom" ? rows : 1);
  // Docked left / right the band narrows the row: the sidebar's automatic rail counts it (lib/workspaces).
  const here = useInWindow();
  useLayoutEffect(() => here(() => setTrayBandWidth(vertical ? band : 0)), [here, vertical, band]);
  useLayoutEffect(() => () => here(() => setTrayBandWidth(0)), [here]);
  useLayoutEffect(() => here(() => useTrayRoom.setState({ active: room })), [here, room]);
  useLayoutEffect(() => () => here(() => useTrayRoom.setState({ active: false })), [here]);
  const dock = placement !== "none" && <ChipTray placement={placement as Exclude<TrayPlacement, "none">} edge={edge} entry={entry} dockCount={dockCount} extras={extras} card={edge === "bottom" || placement === "overlay"} />;
  return (
    <div
      ref={frame}
      data-tray-frame=""
      data-tray-at={edge}
      data-tray-vertical={vertical ? "" : undefined}
      data-tray-room={room ? (roomMode.kind === "wide" ? "wide" : "") : undefined}
      className={`relative flex min-h-0 min-w-0 flex-1 ${vertical ? "flex-row" : "flex-col"}`}
      style={room ? ({ "--tray-room": `${dockPx + TRAY_ROOM_GAP}px` } as React.CSSProperties) : undefined}
    >
      {children}
      {room && (
        <div
          ref={roomBand}
          data-tray-band="room"
          data-tray-centre={room && roomMode.centre ? "" : undefined}
          className="tray-room"
          // Not measured yet: laid out but not shown (useRoomGeometry places it before paint).
          style={{ left: 0, right: 0, bottom: TRAY_ROOM_GAP, height: dockPx, visibility: "hidden" }}
        >
          {dock}
        </div>
      )}
      {!room && band > 0 && (
        <div data-tray-band={placement} className="tray-band" style={vertical ? { width: band } : { height: band }}>
          {dock}
        </div>
      )}
      {target && <TrayDropZones target={target} />}
    </div>
  );
}

/** The Dock's items besides the pins: agents on screen + agents open in the tray (0 without a Dock). */
function useDockExtras(on: boolean): number {
  const open = useTrayOpen((s) => s.open.length);
  const shown = usePanes((s) => conversationPanes(s.layout).filter((id) => !!paneBinding(s.layout, id)?.sessionId).length);
  return on ? open + shown : 0;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

/** How long after a layout change the tray card follows the columns frame by frame (they glide). */
const FOLLOW_MS = 600;

/** What React still needs about the tray's room: its shape and centreing, never its live coordinates. */
type RoomMode = { kind: "band" | "room" | "wide"; centre: boolean };
type RoomModeSource = { kind: "band" } | { kind: "room" | "wide"; centre: boolean };

/**
 * Where the tray card goes (lib/trayRoom), re-measured on every pane / Shelf / strip change and window resize,
 * frame by frame for a moment after each (the columns glide). Coordinates go straight to the element;
 * React state moves only when the room changes shape or centreing.
 */
function useRoomGeometry(frame: React.RefObject<HTMLDivElement | null>, room: React.RefObject<HTMLDivElement | null>, active: boolean, desktopOn: boolean, dock: number): RoomMode {
  const [mode, setMode] = useState<RoomMode>(() => ({ kind: "room", centre: false }));
  const panes = usePanes((s) => s.layout);
  const side = useSide((s) => s.layout);
  const strips = useStrips((s) => s.strips);
  // The last place measured; the place it had when the last workspace closed (lib/trayRoom holdTrayPlace, taken
  // then — before the layout changes); that place kept over the desktop (the card stays put instead of flying to
  // the desktop's middle; a window resize or the conversations coming back let it go).
  const last = useRef<RoomGeometry | null>(null);
  const held = useRef<{ geo: RoomGeometry; at: number } | null>(null);
  const kept = useRef<RoomGeometry | null>(null);
  useEffect(
    () =>
      useTrayRoom.subscribe((s, p) => {
        if (s.hold === p.hold) return;
        const g = last.current;
        held.current = g && g.kind !== "band" && !g.centre ? { geo: g, at: s.hold } : null;
      }),
    [],
  );
  const apply = useCallback((geometry: RoomGeometry | null) => {
    const el = room.current;
    if (!el) return;
    if (!geometry || geometry.kind === "band") {
      el.style.visibility = "hidden";
      return;
    }
    el.style.left = `${geometry.left}px`;
    el.style.top = `${geometry.top}px`;
    el.style.width = `${geometry.width}px`;
    el.style.height = `${dock}px`;
    el.style.right = "";
    el.style.bottom = "";
    el.style.visibility = "";
  }, [room, dock]);
  const changeMode = useCallback((geometry: RoomModeSource) => {
    const centre = geometry.kind !== "band" && geometry.centre;
    setMode((previous) => previous.kind === geometry.kind && previous.centre === centre ? previous : { kind: geometry.kind, centre });
  }, []);
  useLayoutEffect(() => apply(last.current), [mode, apply]);
  useLayoutEffect(() => {
    if (!active) {
      last.current = null;
      changeMode({ kind: "band" });
      return;
    }
    const el = frame.current;
    if (!el) return;
    const view = ownerWindowOf(el);
    let raf = 0;
    let until = 0;
    let disposed = false;
    // Cards mount after this effect too (a scene / workspace change remounts a column): each measure observes
    // the ones it finds, so their later resizes move the tray.
    const watched = new WeakSet<Element>();
    const offs: (() => void)[] = [];
    const watch = (c: Element) => {
      if (watched.has(c)) return;
      watched.add(c);
      // Follow after the row's synchronous layout pass; waiting for the next rAF left the tray
      // a frame behind its conversation during an edge drag or a window resize.
      offs.push(observeSync(c, resized, "follow"));
    };
    const measure = () => {
      const cards = [...el.querySelectorAll<HTMLElement>("[data-conv-card], section.ws-col[data-conv-pane]")].filter((c) => !c.closest("[hidden]"));
      cards.forEach(watch);
      const shelves = [...el.querySelectorAll<HTMLElement>("[data-shelf-box], [data-side-box], [data-ws-shelf]")].filter((b) => !b.closest("[hidden]") && !cards.some((c) => c.contains(b)));
      const stage = desktopOn ? el.querySelector<HTMLElement>("[data-pane-desk-stage]") : null;
      // Design 038: the items never send the card to the band (what does not fit folds into 「… N」, ChipTray).
      const measured = roomGeometry({ frame: boxOf(el), cards: cards.map(boxOf), shelves: shelves.map(boxOf), stage: stage ? boxOf(stage) : null, dock });
      const centred = measured.kind !== "band" && measured.centre;
      if (!centred) kept.current = null;
      else {
        if (!kept.current && held.current && Date.now() - held.current.at < TRAY_HOLD_MS) kept.current = held.current.geo;
        held.current = null;
      }
      const next = heldGeometry(measured, kept.current) ?? measured;
      last.current = next;
      apply(next);
      changeMode(next);
    };
    const tick = () => {
      measure();
      raf = !disposed && performance.now() < until ? view.requestAnimationFrame(tick) : 0;
    };
    const follow = () => {
      if (disposed) return;
      until = performance.now() + FOLLOW_MS;
      if (!raf) raf = view.requestAnimationFrame(tick);
    };
    const resized = () => {
      measure();
      follow();
    };
    watch(el);
    for (const c of el.querySelectorAll("[data-side-work]")) watch(c);
    measure();
    follow();
    const windowResized = () => {
      kept.current = null;
      follow();
    };
    view.addEventListener("resize", windowResized);
    return () => {
      disposed = true;
      view.cancelAnimationFrame(raf);
      for (const off of offs) off();
      view.removeEventListener("resize", windowResized);
    };
  }, [active, desktopOn, panes, side, strips, frame, dock, apply, changeMode]);
  return mode;
}

/** While the grip is dragged: the four edges as drop zones, the one the tray would dock to lit. */
function TrayDropZones({ target }: { target: TrayEdge }) {
  const { t } = useI18n();
  return (
    <div data-tray-drop="" aria-hidden className="tray-drop">
      {TRAY_EDGES.map((e) => (
        <div key={e} data-tray-zone={e} data-on={e === target ? "" : undefined} className={`tray-zone ${DROP_TINT}`}>
          {e === target && <span className="tray-zone-label">{t("pane.tray.dockHere")}</span>}
        </div>
      ))}
    </div>
  );
}

// ── The tray ────────────────────────────────────────────────────────────────────────────────────

/** The tray's own menu (its grip, its background, the handle): 停靠在… › 底部 / 顶部 / 左侧 / 右侧, 托盘常驻. */
function useFrameMenu(): MenuEntry[] {
  const { t } = useI18n();
  const { edge, persistent } = useTrayPrefs();
  const mark = (on: boolean) => (on ? <Check size={14} /> : <span className="inline-block w-[14px]" />);
  return [
    { label: t("pane.tray.dockAt"), submenu: TRAY_EDGES.map((e) => ({ label: t(`pane.tray.edge.${e}` as MessageKey), icon: mark(e === edge), onSelect: () => setTrayPrefs({ edge: e }) })), onSelect: () => {} },
    { label: t("pane.tray.persistent"), icon: mark(persistent), onSelect: () => setTrayPrefs({ persistent: !persistent }) },
    // Panel settings go straight to the tray page; all settings uses the shell's usual entry.
    "separator",
    panelSettingsItem("tray"),
    { label: t("settings.panel.menu.all"), icon: <Cog size={14} />, onSelect: () => useApp.getState().openSettings() },
    "separator",
    panelGuideItem({ panel: "tray" }),
  ];
}

/** The dock: in its band ("docked") or revealed over the panes ("overlay"); the handle while auto-hidden. Arrows move between items. */
// Memo: TrayFrame re-renders on every step of a window resize or a column drag (the tray room follows the cards,
// useRoomGeometry); the Dock's items only change with their own props and stores (perf audit 2026-10-23 #28). Its
// fold is measured by its own observers.
const ChipTray = memo(function ChipTray({ placement, edge, entry, dockCount, extras, card }: { placement: Exclude<TrayPlacement, "none">; edge: TrayEdge; entry: AppSlotEntry<"pane.desktop"> | null; dockCount: number; extras: number; card: boolean }) {
  const { t } = useI18n();
  const dock = useRef<HTMLDivElement>(null);
  const via = useTray((s) => s.via);
  const menuOpen = useMenuOwner() === TRAY_MENU_OWNER;
  const frameMenu = useFrameMenu();
  const vertical = trayVertical(edge);
  const shortcut = keyVar("tray").key;
  const win = useOwnerWindow();

  // Ctrl/⌘+J: reveal / hide over the panes; docked: into the tray.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTrayKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (placement === "docked") dock.current?.querySelector<HTMLElement>("[data-tray-item]")?.focus();
      else toggleTray();
    };
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener("keydown", onKey, true);
  }, [placement, win]);

  // A menu opened from the tray holds it; when it closes, the tray hides after the usual delay.
  const hadMenu = useRef(false);
  useEffect(() => {
    if (menuOpen) holdTray();
    else if (hadMenu.current && !dock.current?.matches(":hover")) releaseTray();
    hadMenu.current = menuOpen;
  }, [menuOpen]);

  // Revealed by the shortcut (or a click on the handle): the keyboard focus goes to the first item, and back where it was afterwards.
  useEffect(() => {
    if (placement !== "overlay" || via !== "key") return;
    const doc = win.document;
    const before = doc.activeElement as HTMLElement | null;
    win.requestAnimationFrame(() => dock.current?.querySelector<HTMLElement>("[data-tray-item]")?.focus());
    return () => {
      if (before && doc.contains(before) && dock.current?.contains(doc.activeElement)) before.focus();
    };
  }, [placement, via, win]);

  const used = () => {
    if (placement === "overlay") hideTray();
  };

  // Design 038: the card under the conversations keeps its place; icons that do not fit fold into 「… N」 — 最近 gives
  // way first, down to none, then the pins fold (owner 2026-10-24). 「托盘两排」: two rows before anything gives way.
  const foldOn = card && placement === "docked" && edge === "bottom";
  const twoRows = useTrayPrefs((s) => s.twoRows);
  const more = useRef<HTMLButtonElement>(null);
  const [folded, setFolded] = useState<readonly number[]>(NO_FOLD);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const trayRoom = useTrayRoom.of(useWindowKey());
  useLayoutEffect(() => {
    const el = dock.current;
    if (!foldOn || !el) {
      setFolded(NO_FOLD);
      trayRoom.setState({ rows: 1 });
      return;
    }
    let raf = 0;
    const fit = () => {
      const r = fitTray(el, more.current, { twoRows });
      setFolded((f) => (sameIndices(f, r.folded) ? f : r.folded));
      if (trayRoom.getState().rows !== r.rows) trayRoom.setState({ rows: r.rows });
    };
    const schedule = () => {
      if (!raf)
        raf = win.requestAnimationFrame(() => {
          raf = 0;
          // The card's height follows its rows in the same frame (TrayFrame).
          flushSync(fit);
        });
    };
    fit();
    const ro = resizeObserverFor(el, schedule);
    ro?.observe(el);
    // Items come and go (agents open / close, pins): fit again. Our own attributes are not watched.
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    mo?.observe(el, { childList: true, subtree: true });
    return () => {
      win.cancelAnimationFrame(raf);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [foldOn, placement, twoRows, trayRoom]);
  useLayoutEffect(() => () => trayRoom.setState({ rows: 1 }), [trayRoom]);
  const n = folded.length;
  useEffect(() => {
    if (!n) setOverflowOpen(false);
  }, [n]);

  if (placement === "handle") return <TrayHandle label={t("pane.tray.reveal", { key: shortcut })} menu={frameMenu} />;

  const Dock = entry?.item.Dock;
  return (
    <div
      ref={dock}
      role="toolbar"
      aria-label={t("pane.trayDock")}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      data-pane-tray={placement}
      data-vertical={vertical ? "" : undefined}
      data-tray-card={card ? "" : undefined}
      data-tray-fold={foldOn ? "" : undefined}
      className="pane-tray-dock"
      onPointerEnter={() => placement === "overlay" && holdTray()}
      onPointerLeave={() => placement === "overlay" && !menuOpen && releaseTray()}
      onBlur={(e) => {
        if (placement === "overlay" && via === "key" && !e.currentTarget.contains(e.relatedTarget as Node | null) && !menuOpen) releaseTray(0);
      }}
      // Its background (not an item: they have their own menus): 停靠在…, 托盘常驻.
      onContextMenu={(e) => {
        e.preventDefault();
        openTrayMenu(e.currentTarget, frameMenu, { x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === "Escape" && placement === "overlay") {
          e.preventDefault();
          hideTray();
          return;
        }
        const step = trayArrowStep(e.key, vertical);
        if (!step && e.key !== "Home" && e.key !== "End") return;
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-tray-item]")];
        const i = items.indexOf(e.currentTarget.ownerDocument.activeElement as HTMLElement);
        const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + step));
        items[next]?.focus();
        e.preventDefault();
      }}
    >
      <TrayGrip vertical={vertical} menu={frameMenu} />
      {/* Nothing pinned yet: 「＋ 固定」 (the desktop's picker) and, with nothing else in it, how to pin. */}
      {Dock && dockCount === 0 && <TrayPinButton vertical={vertical} alone={extras === 0} />}
      {Dock && dockCount + extras > 0 && entry && (
        <ItemBoundary moduleId={entry.moduleId}>
          {/* "desktop": on screen in its band (contract 1.20: not a reveal); "overlay": revealed over the panes. */}
          <Dock placement={placement === "overlay" ? "overlay" : "desktop"} onUsed={used} />
        </ItemBoundary>
      )}
      {foldOn && (
        <button
          ref={more}
          type="button"
          data-tray-item=""
          data-tray-more=""
          hidden={n === 0}
          aria-haspopup="dialog"
          aria-expanded={overflowOpen}
          title={t("tray.moreTitle", { n })}
          aria-label={t("tray.moreTitle", { n })}
          className="tray-more"
          onClick={() => setOverflowOpen((o) => !o)}
        >
          {t("tray.more", { n })}
        </button>
      )}
      {foldOn && overflowOpen && n > 0 && Dock && entry && more.current && (
        <TrayOverflow anchor={more.current} folded={folded} moduleId={entry.moduleId} Dock={Dock} onClose={() => setOverflowOpen(false)} />
      )}
    </div>
  );
});

const NO_FOLD: readonly number[] = [];
const sameIndices = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 「… N」's list (design 038): the same Dock drawn again in a popover above the button, only its `folded` items shown
 * (indices into lib/trayFold foldUnits — 最近 left out by the tray is not among them) — with their names — so a click
 * there does what it does in the tray. Esc / a press outside closes it.
 */
function TrayOverflow({ anchor, folded, moduleId, Dock, onClose }: { anchor: HTMLElement; folded: readonly number[]; moduleId: string; Dock: NonNullable<AppSlotEntry<"pane.desktop">["item"]["Dock"]>; onClose(): void }) {
  const win = ownerWindowOf(anchor);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = box.current?.offsetWidth ?? 220;
    setPos({ left: Math.max(8, Math.min(r.right - w, win.innerWidth - w - 8)), bottom: win.innerHeight - r.top + 6 });
  }, [anchor, win]);
  // Only the folded ones (the same items, in the same order).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    foldUnits(el).forEach((u, i) => (folded.includes(i) ? u.removeAttribute("data-tray-overflow-hide") : u.setAttribute("data-tray-overflow-hide", "")));
  });
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (isNode(e.target) && !box.current?.contains(e.target) && !anchor.contains(e.target)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor.focus();
      }
    };
    win.addEventListener("pointerdown", away, true);
    win.addEventListener("keydown", key, true);
    return () => {
      win.removeEventListener("pointerdown", away, true);
      win.removeEventListener("keydown", key, true);
    };
  }, [anchor, onClose, win]);
  return createPortal(
    <div ref={box} role="dialog" data-tray-overflow="" className="tray-overflow" style={pos ?? { left: -9999, bottom: 0 }}>
      <ItemBoundary moduleId={moduleId}>
        <Dock placement="overlay" onUsed={onClose} />
      </ItemBoundary>
    </div>,
    win.document.body,
  );
}

/**
 * The empty tray's 「＋ 固定」: the pin list keeper's picker (the desktop's: {{agents}}, services, artifacts,
 * pages), opened away from the tray's edge. Alone in a horizontal tray it has its label and a muted hint
 * (右键…选「钉到托盘」); vertical, or beside collapsed tool panes, just the ＋ (the hint on hover).
 */
function TrayPinButton({ vertical, alone }: { vertical: boolean; alone: boolean }) {
  const { t } = useI18n();
  const keeper = useTrayPinKeeper();
  const hint = t("pane.tray.emptyHint");
  const wide = alone && !vertical;
  const picker = keeper?.pickerEntries;
  return (
    <>
      {picker && (
        <button
          type="button"
          data-tray-item=""
          data-tray-pin=""
          title={wide ? t("pane.tray.pinTitle") : `${t("pane.tray.pinTitle")} · ${hint}`}
          aria-label={t("pane.tray.pinTitle")}
          aria-haspopup="menu"
          className={wide ? "tray-pin tray-pin-wide" : "tray-item tray-pin"}
          onClick={(e) => {
            const el = e.currentTarget;
            void picker().then((entries) => el.isConnected && openTrayMenu(el, entries));
          }}
        >
          <Plus size={wide ? 14 : 16} aria-hidden />
          {wide && <span>{t("pane.tray.pin")}</span>}
        </button>
      )}
      {wide && (
        <span data-tray-hint="" className="tray-hint">
          {hint}
        </span>
      )}
    </>
  );
}

/**
 * The grip at the dock's start: drag it to an edge of the work area (the edges light up; let go = docked
 * there, remembered); a click (or Enter) opens the tray's menu (停靠在…, 托盘常驻); Esc cancels a drag.
 */
function TrayGrip({ vertical, menu }: { vertical: boolean; menu: MenuEntry[] }) {
  const { t } = useI18n();
  const dragged = useRef(false);
  const label = t("pane.tray.grip");
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const frame = el.closest<HTMLElement>("[data-tray-frame]");
    if (!frame) return;
    const win = ownerWindowOf(el);
    const x0 = e.clientX;
    const y0 = e.clientY;
    dragged.current = false;
    let target: TrayEdge | null = null;
    const move = (ev: PointerEvent) => {
      if (!dragged.current && Math.hypot(ev.clientX - x0, ev.clientY - y0) < TRAY_DRAG_THRESHOLD) return;
      if (!dragged.current) holdTray();
      dragged.current = true;
      target = trayDropEdge({ x: ev.clientX, y: ev.clientY }, frame.getBoundingClientRect());
      if (useTrayDrag.getState().target !== target) useTrayDrag.setState({ target });
    };
    const end = (drop: boolean) => {
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", up);
      win.removeEventListener("pointercancel", cancel);
      win.removeEventListener("keydown", key, true);
      useTrayDrag.setState({ target: null });
      if (!dragged.current) return;
      if (drop && target) setTrayPrefs({ edge: target });
      releaseTray();
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", up);
    win.addEventListener("pointercancel", cancel);
    win.addEventListener("keydown", key, true);
  };
  const Icon = vertical ? GripHorizontal : GripVertical;
  return (
    <button
      type="button"
      data-tray-grip=""
      title={label}
      aria-label={label}
      aria-haspopup="menu"
      className="tray-grip"
      onPointerDown={onPointerDown}
      onClick={(e) => {
        // The click that ends a drag opens nothing.
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        openTrayMenu(e.currentTarget, menu);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openTrayMenu(e.currentTarget, menu, { x: e.clientX, y: e.clientY });
      }}
    >
      <Icon size={14} />
    </button>
  );
}

/** Auto-hidden while panes cover the desktop: a small pill in its band; resting on it (a short dwell) or a click reveals the tray. */
function TrayHandle({ label, menu }: { label: string; menu: MenuEntry[] }) {
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (dwell.current) clearTimeout(dwell.current);
    dwell.current = null;
  };
  useEffect(() => stop, []);
  const enter = () => {
    stop();
    // Up it comes; it hides again unless the pointer goes into it.
    dwell.current = setTimeout(() => {
      revealTray("edge");
      releaseTray(TRAY_EDGE_GRACE_MS);
    }, TRAY_EDGE_DWELL_MS);
  };
  return (
    <button
      type="button"
      data-tray-handle=""
      title={label}
      aria-label={label}
      className="pane-tray-handle"
      onPointerEnter={enter}
      onPointerLeave={stop}
      onClick={() => {
        stop();
        revealTray("key");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openTrayMenu(e.currentTarget, menu, { x: e.clientX, y: e.clientY });
      }}
    >
      <span className="pane-tray-pill" aria-hidden />
    </button>
  );
}
