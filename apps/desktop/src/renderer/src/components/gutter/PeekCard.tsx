// The reference card (docs/desktop-modules.md §19.4–§19.5): a `peekable` component shown in the left
// gutter (or, with 总在左侧 and a narrow gutter, floating over the column), with the right-side card
// look: category icon | title | ⤢ ⛶ ×, the component's Body (where "peek", read-only use), and a
// footer with its Actions + 在右侧打开. Not modal (role complementary, no dialog role); the Esc chain
// closes it first. When the gutter gets too narrow for it (自动), it moves to the right side. Its icon /
// title is a drag handle (lib/sideDnd externalDragHandle): onto a page button = pinned into that page,
// onto a "new page" target = a new page (RFC §3.7 last row).
import { useEffect, useRef } from "react";
import { Maximize2, PanelRight, Scan, X } from "lucide-react";
import { translate, useI18n } from "../../i18n";
import { COLUMN_PADDING, overlayPeekWidth, PEEK_MIN, peekPlacement, peekWidth, type GutterGeometry } from "../../lib/gutterLayout";
import { useGutter } from "../../lib/gutterStore";
import { peekToDrop, peekToRight, usePeekBodyProps } from "../../lib/peekBody";
import { externalDragHandle, useSideDnd, type ExternalDragSpec } from "../../lib/sideDnd";
import { closePeek, currentPeekTarget, setPeekWhere, usePeek, type PeekInstance } from "../../lib/peekStore";
import { useUiPrefs } from "../../lib/prefs";
import { useSideRegistry, type SideComponentEntry } from "../../lib/sideComponents";
import { agentHost, useApp } from "../../store";
import { ItemBoundary } from "../../modules/Outlet";
import type { GutterBox } from "./GutterHost";

function HeaderButton({ title, onClick, children }: { title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground">
      {children}
    </button>
  );
}

function PeekTitle({ entry, peek }: { entry: SideComponentEntry; peek: PeekInstance }) {
  const props = usePeekBodyProps(peek);
  const info = entry.item.useTab({ instance: props.instance, hostId: props.hostId, sessionId: props.sessionId });
  return (
    <span data-peek-title className="min-w-0 flex-1 truncate text-xs font-semibold text-muted" title={info.tooltip ?? info.title}>
      {info.title}
    </span>
  );
}

/** The drag source id of the reference card (useSideDnd's drag.source). */
const PEEK_SOURCE = "gutter.peek";

/**
 * Its icon / title as a drag handle (RFC §3.7 last row, §7.4): onto a page button or the column = pinned
 * into that page, onto a "new page" target (the left-edge band, the conversation, the window
 * background) = a new page. Its own place — the card and the whole left gutter — is the origin (nothing).
 */
function peekDragSpec(entry: SideComponentEntry, card: HTMLElement | null): ExternalDragSpec {
  return {
    source: PEEK_SOURCE,
    icon: entry.item.icon,
    title: card?.querySelector("[data-peek-title]")?.textContent || translate("gutter.peek"),
    isOrigin: (el, x, y) => {
      if (!card) return false;
      if (card.contains(el)) return true;
      // The left gutter, the column's own padding included (the layer spans the conversation card).
      const layer = card.parentElement;
      const g = useGutter.getState().geometry;
      if (!layer || !g) return false;
      const r = layer.getBoundingClientRect();
      return x >= r.left && x < r.left + g.columnLeft + COLUMN_PADDING && y >= r.top && y <= r.bottom;
    },
    onDrop: peekToDrop,
  };
}

function PeekBody({ entry, peek }: { entry: SideComponentEntry; peek: PeekInstance }) {
  const props = usePeekBodyProps(peek);
  const Body = entry.item.Body;
  return <Body {...props} />;
}

function PeekActions({ entry, peek }: { entry: SideComponentEntry; peek: PeekInstance }) {
  const props = usePeekBodyProps(peek);
  const Actions = entry.item.Actions;
  return Actions ? <Actions {...props} /> : null;
}

function Card({ entry, peek, style, overlay }: { entry: SideComponentEntry; peek: PeekInstance; style: React.CSSProperties; overlay: boolean }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const flash = usePeek((s) => s.flash);
  const revealed = usePeek((s) => s.revealed);
  // The same reference opened again: flash instead of reopening.
  useEffect(() => {
    const el = box.current;
    if (!el || !flash) return;
    el.classList.remove("side-flash");
    void el.offsetWidth;
    el.classList.add("side-flash");
    const timer = setTimeout(() => el.classList.remove("side-flash"), 1400);
    return () => clearTimeout(timer);
  }, [flash]);
  // Opened with focus: the card takes it (arrows / PgUp / PgDn scroll its body).
  useEffect(() => {
    if (revealed) box.current?.querySelector<HTMLElement>("[data-peek-scroll]")?.focus({ preventScroll: true });
  }, [revealed]);
  // Dragged out (its icon / title): its content dims like a dragged right-side card; the card itself
  // stays opaque (floating over the column, a see-through card would mix with the text under it).
  const dragged = useSideDnd((s) => s.drag?.type === "external" && s.drag.source === PEEK_SOURCE);
  const Icon = entry.item.icon;
  return (
    <div
      ref={box}
      data-peek-card
      data-gutter-root
      data-focus-region="peek"
      role="complementary"
      aria-label={t("gutter.peek")}
      className={`pointer-events-auto absolute left-2 z-[7] flex flex-col overflow-hidden rounded-[14px] border border-card-border bg-background ${overlay ? "shadow-2xl" : "shadow-[var(--shadow)]"} ${dragged ? "*:opacity-45" : ""}`}
      style={style}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 pr-1 pl-1">
        <div data-peek-handle className="flex min-w-0 flex-1 items-center gap-1 self-stretch" {...externalDragHandle(() => peekDragSpec(entry, box.current))}>
          <span title={t("gutter.dragHint")} className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground">
            <Icon size={14} />
          </span>
          <ItemBoundary moduleId={entry.moduleId} resetKey={peek.id}>
            <PeekTitle entry={entry} peek={peek} />
          </ItemBoundary>
        </div>
        <HeaderButton title={t("gutter.maximise")} onClick={() => peekToRight("maximised")}>
          <Maximize2 size={13} />
        </HeaderButton>
        <HeaderButton title={t("gutter.fullscreen")} onClick={() => peekToRight("fullscreen")}>
          <Scan size={13} />
        </HeaderButton>
        <HeaderButton title={t("gutter.close")} onClick={() => closePeek()}>
          <X size={14} />
        </HeaderButton>
      </div>
      <div data-peek-scroll tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
        <ItemBoundary moduleId={entry.moduleId} resetKey={peek.id}>
          <PeekBody entry={entry} peek={peek} />
        </ItemBoundary>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border/60 px-2 py-1.5">
        <ItemBoundary moduleId={entry.moduleId} resetKey={peek.id}>
          <PeekActions entry={entry} peek={peek} />
        </ItemBoundary>
        <button
          onClick={() => peekToRight("page")}
          title={t("gutter.openRightHint")}
          className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted hover:bg-hover hover:text-foreground"
        >
          <PanelRight size={13} />
          {t("gutter.openRight")}
        </button>
        <span className="ml-auto truncate text-[11px] text-subtle">{t("gutter.readOnly")}</span>
      </div>
    </div>
  );
}

/** The reference card's place in the left gutter (hidden while the conversation is covered: GutterHost). */
export function PeekHost({ geometry, box }: { geometry: GutterGeometry; box: GutterBox }) {
  const peek = usePeek((s) => s.peek);
  const registry = useSideRegistry();
  // Peeks belong to the open agent's host (lib/sideServices).
  const host = useApp(agentHost);
  const { peekTarget: setting } = useUiPrefs();
  const stackTop = useGutter((s) => s.stackTop.left);
  const topStackBottom = useGutter((s) => s.topStackBottom.left);
  const g = geometry.left;
  const where = currentPeekTarget(peek, setting, g.width, PEEK_MIN, true);
  const entry = peek ? registry.get(peek.kind) : undefined;
  // A scope change closes it; a component that went away (module off) closes it.
  useEffect(() => {
    if (peek && (peek.hostId !== host || !entry)) closePeek({ focus: false });
  }, [peek, host, entry]);
  // The gutter got too narrow (自动) / the setting changed: move to the right side, or float.
  useEffect(() => {
    if (!peek || box.cardWidth <= 0) return;
    if (where === "page") peekToRight("page");
    else setPeekWhere(where);
  }, [peek, where, box.cardWidth]);
  if (!peek || !entry || where === "page") return null;
  // Below the top entries, above the triggers; clear of the overlays' boxes (below or beside the capsule).
  const { top, bottom: limit, width } = peekPlacement({
    x0: 8,
    width: where === "gutter" ? peekWidth(g.width) : overlayPeekWidth(box.cardWidth),
    top: Math.max(g.topInset + 8, (topStackBottom ?? 0) + 8),
    bottom: Math.min(stackTop ?? box.anchor?.top ?? box.height, g.bottomBand ? box.scrollerBottom - g.bottomBand : Number.POSITIVE_INFINITY) - 8,
    obstacles: box.overlays,
  });
  const room = Math.max(0, limit - top);
  const style: React.CSSProperties = { top, width, maxHeight: room, minHeight: Math.min(180, room) };
  return <Card entry={entry} peek={peek} style={style} overlay={where === "overlay"} />;
}
