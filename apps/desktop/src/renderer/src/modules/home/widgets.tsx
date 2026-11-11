// The desktop's built-in widgets (design 032 §7; `desktop.widget` items of the home module): 名片, 时钟, 需要你,
// 用量 and the icon tiles (one module instance per desktop icon — model deskIconsOf, apart from the tray's pins since
// owner 2026-10-24; a service icon's
// instance has the service as its source). Each fills the box the surface gives it. 少框 (owner 2026-10-24,
// .claude/previews/preview-widgets-v1.html): only the list (需要你) keeps the shell's acrylic card; 名片, 用量 and the
// tiles are bare — white text with a shadow on the wallpaper (.home-bare), a faint acrylic on hover when they
// open something (.home-bare-hit), an agent tile its cut-out portrait. Data through the home module's hooks (useHomeSource, useScopedAttention, useHomeUsage) only.
// Opening goes through the widget's `actions` (guide rule 4), with two home-only exceptions the actions do not
// cover: 名片 opens the home module's own 个人页 pane (openProfile) and a tile opens its pin, which may be an
// artifact, a link or a page pin (openPin). A widget of another module has neither: it uses `actions` only.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, Bell, Clock3, LayoutGrid, UserRound } from "lucide-react";
import type { HomePin, HomeTileSize } from "../../../../shared/home";
import { useI18n, type MessageKey } from "../../i18n";
import { formatDate } from "../../lib/dateText";
import { attentionChips, type AttentionChip } from "../../lib/agentAttention";
import { signalLabel } from "../../lib/attentionView";
import { hostKey } from "../../lib/hostKeys";
import { useIdentity } from "../../lib/identityView";
import { useScopedAttention, useScopedSidebar } from "../../lib/scopedSidebarView";
import { turnMarksOn } from "../../lib/turnUnread";
import type { AgentRow } from "../../lib/sidebar";
import { StatusAvatar } from "../../components/AgentStatus";
import { sidebarOf, useApp } from "../../store";
import type { DesktopWidgetItem, DesktopWidgetProps, WidgetInstanceRef, WidgetSteps } from "../widgetTypes";
import { useHomeSource, useHomeUsage } from "./hooks";
import { deskIconsOf, pinId, sizeOf, withoutDeskIcon } from "./model";
import { openFailedText, openPin, openProfile } from "./open";
import { MeAvatar } from "./Parts";
import { compactTokens, dayKey, homeStats } from "./stats";
import { homeStore } from "./store";
import { PinTileBody } from "./Tiles";
import { Tag, CountBadge } from "../../components/Tag";

export const PROFILE_WIDGET = "home.profile";
export const CLOCK_WIDGET = "home.clock";
export const NEEDS_WIDGET = "home.needs";
export const STATS_WIDGET = "home.stats";
export const TILE_WIDGET = "home.tile";

/** The tile presets in grid steps (8 px): S 96 × 96 · M 200 × 96 · W 408 × 200 · L 408 × 304. */
export const TILE_PRESETS: Readonly<Record<HomeTileSize, WidgetSteps>> = { s: [12, 12], m: [25, 12], w: [51, 25], l: [51, 38] };

/** The tile presets in units (1.24): S 2 × 2 · M 4 × 2 · W 8 × 4 · L 8 × 6 — the same boxes as the step presets. */
export const TILE_UNITS: Readonly<Record<HomeTileSize, readonly [number, number]>> = { s: [2, 2], m: [4, 2], w: [8, 4], l: [8, 6] };

/** The tile layout a free box gets (its body was designed for the four sizes). */
export function tileSizeFor(steps: { w: number; h: number }): HomeTileSize {
  if (steps.h < 20) return steps.w < 20 ? "s" : "m";
  return steps.h < 32 ? "w" : "l";
}

/** A desktop icon's tile instance (`pin:<pinId>`: the id the tiles had while they were the tray's pins, so they keep their boxes). */
export const tileInstanceId = (pin: HomePin): string => `pin:${pinId(pin)}`;

/** The greeting by the hour (5–11 morning, 11–18 afternoon, else evening). */
export function greetingKey(hour: number): MessageKey {
  return hour >= 5 && hour < 11 ? "home.greet.morning" : hour >= 11 && hour < 18 ? "home.greet.afternoon" : "home.greet.evening";
}

/**
 * 名片 (owner 2026-10-24: 「改成时间、名字、然后下面写个个性签名」 — the counts were already on the desktop): the
 * greeting by the hour, the name large, the one-line signature (the home's bio) under it; a big avatar beside
 * them when the box is tall enough. Bare on the wallpaper; a click opens the 个人页.
 */
function ProfileWidget({ arranging, now, height }: DesktopWidgetProps) {
  const { t } = useI18n();
  const identity = useIdentity();
  const { entry } = useHomeSource();
  const bio = entry?.doc.bio?.trim();
  const big = height >= 88;
  return (
    // Home-only exception (see the top): the 个人页 is this module's pane, not a page `actions.openPage` opens.
    <button onClick={() => !arranging && openProfile()} title={t("home.openProfile")} data-home-block="profile" className="home-bare home-bare-hit flex h-full w-full min-w-0 items-center gap-4 px-3 text-left">
      <MeAvatar identity={identity} size={big ? 72 : 40} ring />
      <span className="min-w-0">
        <span className="block truncate text-meta/[inherit] opacity-90" data-home-greet="">{t(greetingKey(new Date(now).getHours()))}</span>
        <b className="block truncate text-display/[inherit] font-semibold">{identity.name}</b>
        {bio && <span className={`${height >= 140 ? "line-clamp-2" : "line-clamp-1"} text-ui/[inherit] home-sub`} data-home-signature="">{bio}</span>}
      </span>
    </button>
  );
}

function ClockWidget({ now, height, width }: DesktopWidgetProps) {
  const { locale } = useI18n();
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const date = formatDate(now, locale, { month: "long", day: "numeric", weekday: "long" });
  const big = Math.round(Math.min(height * 0.56, width * 0.3));
  return (
    <div className="home-clock flex h-full flex-col items-end justify-center text-right" data-home-block="clock">
      <b className="block leading-[1.05] font-light tracking-wide tabular-nums" style={{ fontSize: big }}>
        {time}
      </b>
      {height >= 72 && <span className="text-ui/[inherit] opacity-90">{date}</span>}
    </div>
  );
}

/** 「需要你」: the agents waiting for the owner (or failed), across the scope's hosts — as many as the box holds. */
function NeedsWidget({ height, arranging, actions }: DesktopWidgetProps) {
  const { t } = useI18n();
  const scoped = useScopedSidebar();
  const { rows, signals, needs, marks } = useScopedAttention(scoped.model, scoped.scope);
  const focus = scoped.scope.focus;
  const chips = useMemo(() => {
    const markOf = (row: AgentRow) => ((row.hostId ?? focus) === focus ? marks[row.id] : turnMarksOn(row.hostId!)[row.id]);
    return attentionChips(rows, signals, needs, markOf, null).filter((c) => c.signal !== "done");
  }, [rows, signals, needs, marks, focus]);
  const byKey = useMemo(() => new Map(rows.map((r) => [hostKey(r.hostId ?? focus, r.id), r])), [rows, focus]);
  const open = (c: AttentionChip) => {
    if (arranging) return;
    const host = c.hostId ?? focus;
    const n = needs.get(c.key);
    if (c.signal === "needsYou" && n?.reasons.length === 1 && n.reasons[0] === "approval") actions.openPage("approvals.page");
    else void actions.openAgent(host, c.id);
  };
  // As many whole rows as the box holds, measured (two lines + padding; the text size follows the appearance); when
  // some don't fit, the last place says how many more instead of a row cut in half.
  const first = useRef<HTMLButtonElement>(null);
  const [rowPx, setRowPx] = useState(52);
  useLayoutEffect(() => {
    const h = first.current?.offsetHeight;
    if (h && h !== rowPx) setRowPx(h);
  });
  const room = Math.max(1, Math.floor((height - 48) / rowPx));
  const fits = chips.length > room ? Math.max(1, room - 1) : room;
  const more = chips.length - fits;
  return (
    <section className="h-full overflow-hidden px-3.5 py-3" data-home-block="needs">
      <h4 className="mb-1 flex items-center gap-2 text-ui/[inherit] font-semibold">
        {t("home.needs")}
        {chips.length > 0 && <CountBadge count={chips.length} className="ml-auto" />}
      </h4>
      {chips.length === 0 && <p className="py-1.5 text-xs home-sub">{t("home.needsNone")}</p>}
      {chips.slice(0, fits).map((c, i) => {
        const row = byKey.get(hostKey(c.hostId ?? focus, c.id));
        return (
          <button key={c.key} ref={i === 0 ? first : undefined} onClick={() => open(c)} className="flex w-full items-start gap-2.5 rounded-ctl px-1 py-2 text-left text-ui/[inherit] hover:bg-[rgba(127,127,140,0.12)]" data-home-need={c.signal}>
            {row ? <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={20} signal="idle" /> : <span className="size-[22px]" />}
            <span className="min-w-0">
              <span className="block truncate">{c.name}</span>
              <span className={`block truncate text-caption/[inherit] font-semibold ${c.signal === "error" ? "text-danger" : "text-warn-text"}`}>{signalLabel(t, c.signal, needs.get(c.key))}</span>
            </span>
          </button>
        );
      })}
      {more > 0 && <p className="px-1 pt-1 text-xs home-sub" data-home-needs-more="">{t("needsYou.more", { n: more })}</p>}
    </section>
  );
}

function StatsWidget() {
  const { t, locale } = useI18n();
  const { days } = useHomeUsage();
  const agents = useApp((s) => (s.hosts?.hosts ?? [{ id: "local" }]).reduce((n, h) => n + (sidebarOf(s, h.id)?.active.length ?? 0), 0));
  const stats = days ? homeStats(days, dayKey(new Date())) : null;
  const n = (v: number | undefined) => (stats ? compactTokens(v ?? 0, locale) : "—");
  const cell = (label: string, value: string) => (
    <span className="whitespace-nowrap">
      <span className="home-sub">{label} </span>
      <b className="text-title/[inherit] font-semibold tabular-nums">{value}</b>
    </span>
  );
  return (
    <section className="home-bare grid h-full grid-cols-2 content-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-xs" data-home-block="stats" title={t("home.stats.scope")}>
      {cell(t("home.stats.today"), t("home.stats.tokens", { n: n(stats?.today) }))}
      {cell(t("home.stats.week"), t("home.stats.tokens", { n: n(stats?.week) }))}
      {cell(t("home.stats.agents"), String(agents))}
      {cell(t("home.stats.streak"), stats ? t("home.stats.days", { n: stats.currentStreak }) : "—")}
    </section>
  );
}

function TileWidget({ instanceId, steps, arranging }: DesktopWidgetProps) {
  const { t } = useI18n();
  const pin = deskIconsOf(useHomeSource().entry?.doc ?? null).find((p) => tileInstanceId(p) === instanceId);
  if (!pin) return null;
  const explain = openFailedText;
  const size = tileSizeFor(steps);
  const carded = size === "w" || size === "l";
  return (
    <div
      role="button"
      tabIndex={arranging ? -1 : 0}
      data-home-tile={pin.kind}
      data-size={size}
      title={pin.title ?? pin.key}
      // Home-only exception (see the top): a pin may be an artifact / link / page pin, which `actions` do not open.
      onClick={() => !arranging && void openPin(pin, explain)}
      onKeyDown={(e) => {
        if (!arranging && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          void openPin(pin, explain);
        }
      }}
      // Small tiles (S / M) are bare; a wide / large one holds a template (cover, lines, progress, buttons) and
      // keeps an acrylic card of its own, like a list.
      className={`home-tile h-full w-full cursor-pointer outline-none ${carded ? "home-glass rounded-card p-3 focus-visible:ring-2 focus-visible:ring-accent/60" : `home-bare home-bare-hit ${pin.kind === "agent" ? "p-1" : "p-3"}`}`}
    >
      <PinTileBody pin={pin} size={size} bare={!carded} />
    </div>
  );
}

/** The desktop's icons as module instances (in their list's order; model deskIconsOf); a service's source is its service. */
function useTileInstances(): readonly WidgetInstanceRef[] {
  const doc = useHomeSource().entry?.doc ?? null;
  return useMemo(
    () =>
      deskIconsOf(doc).map((pin) => ({
        id: tileInstanceId(pin),
        title: pin.title ?? pin.key,
        size: TILE_PRESETS[sizeOf(pin)],
        units: TILE_UNITS[sizeOf(pin)],
        source: pin.kind === "service" ? { kind: "service" as const, hostId: pin.hostId, slug: pin.key } : pin.kind === "agent" ? { kind: "agent" as const, hostId: pin.hostId, sessionId: pin.key } : { kind: "module" as const },
      })),
    [doc],
  );
}

/** 从桌面移除 on the home source host (the tray keeps its pin). */
function removeTile(instanceId: string): void {
  const host = homeSourceHost();
  if (!host) return;
  void homeStore().update(host, (d) => {
    const pin = deskIconsOf(d).find((p) => tileInstanceId(p) === instanceId);
    return pin ? withoutDeskIcon(d, pinId(pin)) : d;
  });
}
let homeSourceHost: () => string | null = () => null;
/** The surface tells the tile kind where the home document lives (the source host). */
export function setTileHost(fn: () => string | null): void {
  homeSourceHost = fn;
}

export const HOME_WIDGETS: DesktopWidgetItem[] = [
  { id: PROFILE_WIDGET, titleKey: "home.block.profile", icon: UserRound, size: { min: [30, 9], max: [70, 20], default: [44, 12], units: { min: [4, 2], max: [12, 4], default: [8, 2] } }, shape: "bare", defaultPlace: { area: "header-left", order: 0 }, refresh: "minute", Widget: ProfileWidget },
  // Today's clock: no card, big digits (owner 10-22 Q9: keep it); the world clock is its own widget.
  { id: CLOCK_WIDGET, titleKey: "home.block.clock", icon: Clock3, size: { min: [16, 8], max: [60, 24], default: [30, 12], units: { min: [3, 2], max: [10, 4], default: [4, 2] } }, shape: "bare", defaultPlace: { area: "header-right", order: 0 }, refresh: "minute", Widget: ClockWidget },
  { id: NEEDS_WIDGET, titleKey: "home.block.needs", icon: Bell, size: { min: [30, 16], max: [60, 100], default: [36, 50], units: { min: [4, 4], max: [10, 16], default: [6, 8] } }, shape: "card", defaultPlace: { area: "side", order: 10 }, Widget: NeedsWidget },
  { id: STATS_WIDGET, titleKey: "home.block.stats", icon: Activity, size: { min: [28, 9], max: [80, 24], default: [36, 11], units: { min: [4, 2], max: [12, 4], default: [6, 2] } }, shape: "bare", defaultPlace: { area: "side", order: 20 }, Widget: StatsWidget },
  {
    id: TILE_WIDGET,
    titleKey: "home.block.tiles",
    icon: LayoutGrid,
    size: { min: [12, 12], max: [60, 45], default: [12, 12], presets: TILE_PRESETS, units: { min: [2, 2], max: [10, 8], default: [2, 2], presets: TILE_UNITS } },
    shape: "bare",
    instances: "module",
    defaultPlace: { area: "main", order: 0 },
    useInstances: useTileInstances,
    remove: removeTile,
    Widget: TileWidget,
  },
];
