// The `nav.primary` top entries (area "top"). Sidebar v5 (design 040 §4.1, owner 2026-10-23): they live in the
// window bar, right of the host picker — a thin divider, then flat icon buttons in the bar's style: the pinned
// entries (lib/navPins: default 新建智能体, 快速启动, 委托, 审批, in pin order), unpinned entries that need the
// owner right now (badge `attention`) until that clears, and 「⋯ 更多」 whose menu lists every entry with a pin
// toggle (owner 2026-10-14). A number in an entry's badge is a `CountBadge`. Right-click an entry: its own
// `menu` when it has one (快速启动's profiles), else pin / unpin. Narrow (`entriesCompact`): the first entry
// stays, the rest fold into one ⋯ carrying their total, opening a flat list with 「更多 ›」 last.
// The roster sidebar has no entry list any more (collapsed it is hidden; the entries stay here). Badges come from
// each entry's own `useBadge` (probes below), so folded entries still count.
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis, Pin, PinOff } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu, openMenuFrom, useMenuOwner, type MenuAction, type MenuEntry } from "../lib/contextMenu";
import { runNav, useNavActive } from "../lib/navEntries";
import { newInstanceKey, openModifiers } from "../lib/openModifiers";
import { layoutNav, withNavPin } from "../lib/navPins";
import { conversationPanes } from "../lib/paneLayout";
import { usePanes } from "../lib/paneStore";
import { getUiPrefs, setUiPref, useUiPrefs } from "../lib/prefs";
import { useWsUi, watchWindow } from "../lib/workspaces";
import { ItemBoundary } from "../modules/Outlet";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, NavItem } from "../modules/slots";
import { CountBadge } from "./Tag";
import { ShowDesktopButton, useShowDesktopRow } from "./ShowDesktopButton";
import { useOwnerDocument } from "../lib/ownerContext";
import { ownerWindowOf } from "../lib/ownerWindow";

type Entry = AppSlotEntry<"nav.primary">;
type Badge = ReturnType<NonNullable<NavItem["useBadge"]>>;
type T = (k: MessageKey, v?: Record<string, string | number>) => string;
const MORE_MENU = "titlebar.navMore";
const FOLD_MENU = "titlebar.navFold";

/** The window is narrower than this: the entries fold into one ⋯ (design 040 §4.1). */
export const ENTRIES_NARROW_PX = 900;
/** Two workspaces side by side squeeze the bar below this. */
export const ENTRIES_TWO_WORKSPACES_PX = 1280;

/** Whether the window bar's entries fold into one ⋯ (keeping the first). */
export function entriesCompact({ windowWidth, workspaces }: { windowWidth: number; workspaces: number }): boolean {
  return windowWidth < ENTRIES_NARROW_PX || (workspaces >= 2 && windowWidth < ENTRIES_TWO_WORKSPACES_PX);
}

/** The number in a badge (「⚠ 7」 → 7); null without one. */
export function badgeCount(badge: Badge): number | null {
  const m = badge?.text?.match(/\d+/);
  return m ? Number(m[0]) : null;
}

function setPinned(id: string, on: boolean) {
  setUiPref("navPins", withNavPin(getUiPrefs().navPins, id, on));
}

/** What Ctrl/⌘-click and middle click do on this entry, for its tooltip (window audit 2026-10-23): a page entry opens beside; a `run` entry has no alternate. */
export const navAltHint = (item: NavItem, t: T): string | null => ("page" in item.target ? t("pane.openBesideHint", { key: newInstanceKey() }) : null);

/** Middle-click = the alternate open (Ctrl/⌘-click's), like an agent row (window audit #4); also stops the autoscroll cursor. */
export const middleOpen = (run: () => void) => ({
  onAuxClick: (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    run();
  },
  onMouseDown: (e: React.MouseEvent) => e.button === 1 && e.preventDefault(),
});

const altOpen = (item: NavItem) => middleOpen(() => runNav(item, openModifiers({ ctrlKey: false, metaKey: false, shiftKey: false, button: 1 })));

/** Reports an entry's badge (rendered for every entry, shown or folded). */
const BadgeProbe = memo(function BadgeProbe({ entry, report }: { entry: Entry; report(id: string, badge: Badge): void }) {
  const badge = entry.item.useBadge?.() ?? null;
  const id = entry.item.id;
  useEffect(() => report(id, badge), [id, badge?.text, badge?.attention, badge?.dot, badge?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => report(id, null), [id, report]);
  return null;
});

/** The badges of `entries`, kept by their probes. */
function useBadges(entries: readonly Entry[]): { badges: Record<string, Badge>; probes: ReactNode } {
  const [badges, setBadges] = useState<Record<string, Badge>>({});
  const report = useCallback((id: string, badge: Badge) => {
    setBadges((all) => {
      const before = all[id] ?? null;
      if (before === badge || (before && badge && before.text === badge.text && before.attention === badge.attention && before.dot === badge.dot && before.title === badge.title)) return all;
      return { ...all, [id]: badge };
    });
  }, []);
  const probes = entries.map((e) => (
    <ItemBoundary key={`probe:${e.item.id}`} moduleId={e.moduleId}>
      <BadgeProbe entry={e} report={report} />
    </ItemBoundary>
  ));
  return { badges, probes };
}

/** The top entries split into pinned / surfaced / folded (lib/navPins), with their badges. */
function useNavLayout() {
  const all = useSlot("nav.primary").filter((e) => (e.item.area ?? "top") === "top");
  const leads = all.filter((e) => e.item.lead);
  const entries = all.filter((e) => !e.item.lead);
  const { navPins } = useUiPrefs();
  const { badges, probes } = useBadges(entries);
  const byId = new Map<string, Entry>(entries.map((e) => [e.item.id, e]));
  const ids: string[] = entries.map((e) => e.item.id);
  const attention = new Set(ids.filter((id) => badges[id]?.attention));
  const layout = layoutNav(ids, navPins, attention, (id) => byId.get(id)?.mode === "show");
  return { leads, entries, byId, badges, probes, layout };
}

/** 「⋯ 更多」's menu: every entry (pinned first, in pin order) with a pin toggle each. */
function moreMenu(t: T, entries: readonly Entry[], pinned: readonly string[], badges: Record<string, Badge>): MenuEntry[] {
  const row = (entry: Entry, on: boolean): MenuAction => {
    const { item } = entry;
    const Icon = item.icon;
    const disabled = entry.mode !== "show";
    return {
      label: item.title ?? t(item.titleKey),
      icon: <Icon size={14} />,
      hint: disabled ? undefined : (badges[item.id]?.text ?? undefined),
      disabled,
      title: disabled && !entry.waiting ? t("modules.needsCapability", { list: entry.missing.join(", ") }) : undefined,
      onSelect: () => runNav(item),
      toggle: {
        on,
        onIcon: <Pin size={13} className="fill-current" />,
        offIcon: <Pin size={13} />,
        onLabel: t("navMore.unpin"),
        offLabel: t("navMore.pin"),
        onToggle: (next) => setPinned(item.id, next),
      },
    };
  };
  const byId = new Map<string, Entry>(entries.map((e) => [e.item.id, e]));
  const first = pinned.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const rest = entries.filter((e) => !pinned.includes(e.item.id as string));
  return [...first.map((e) => row(e, true)), "separator", ...rest.map((e) => row(e, false))];
}

/** The badge on a window-bar icon: a `CountBadge` with the number, else a dot. */
function IconBadge({ badge }: { badge: Badge }) {
  const n = badgeCount(badge);
  if (n !== null && n > 0) return <CountBadge aria-hidden count={n} tone={badge?.attention === false ? "neutral" : "attention"} className="pointer-events-none absolute -top-[3px] -right-1 ring-2 ring-(--win)" />;
  if (badge?.dot || badge?.attention) return <span aria-hidden className={`pointer-events-none absolute top-1 right-1 size-1.5 rounded-full ${badge.attention ? "bg-attention" : "bg-danger"}`} />;
  return null;
}

/** Restore the focus to `ref` when its menu closed with the focus nowhere (keyboard use). */
function useMenuFocusBack(ref: React.RefObject<HTMLButtonElement | null>, open: boolean) {
  const doc = useOwnerDocument();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open && (doc.activeElement === doc.body || doc.activeElement === null)) ref.current?.focus();
    wasOpen.current = open;
  }, [open, ref, doc]);
}

/** One flat icon in the window bar: click = the entry, right-click = its `menu` or pin / unpin; tooltip = name · N 件等你. */
function FlatEntry({ entry, pinned, badge, btn }: { entry: Entry; pinned: boolean; badge: Badge; btn: string }) {
  const { t } = useI18n();
  const { item } = entry;
  const active = useNavActive(item);
  const titleKey = item.useTitleKey?.() ?? item.titleKey;
  const disabled = entry.mode !== "show";
  const Icon = item.icon;
  const hint = item.useHint?.() ?? null;
  const label = item.title ?? t(titleKey);
  const n = badgeCount(badge);
  const tip = disabled
    ? [label, !entry.waiting && t("modules.needsCapability", { list: entry.missing.join(", ") })]
    : [n ? t("titlebar.entries.waiting", { name: label, n }) : label, !n && (badge?.title ?? badge?.text), hint && t(hint), item.menu && t(item.menu.hintKey), navAltHint(item, t)];
  return (
    <button
      disabled={disabled}
      title={tip.filter(Boolean).join("\n")}
      aria-label={n ? t("titlebar.entries.waiting", { name: label, n }) : label}
      onClick={(e) => runNav(item, openModifiers(e))}
      {...altOpen(item)}
      onContextMenu={
        item.menu && !disabled
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              item.menu!.open(e.currentTarget);
            }
          : contextMenu(() => [{ label: t(pinned ? "navMore.unpin" : "navMore.pin"), icon: pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => setPinned(item.id, !pinned) }])
      }
      data-titlebar-entry={item.id}
      data-nav-active={active ? "" : undefined}
      className={`${btn} relative shrink-0 disabled:opacity-50 ${active ? "bg-surface-2 text-foreground" : ""}`}
    >
      <Icon size={16} />
      {!disabled && <IconBadge badge={badge} />}
    </button>
  );
}

/** 「⋯ 更多」 (wide bar): the menu of every entry with a pin toggle; a dot while a folded entry needs the owner. */
function MoreButton({ entries, pinned, badges, attention, btn }: { entries: readonly Entry[]; pinned: readonly string[]; badges: Record<string, Badge>; attention: boolean; btn: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const open = useMenuOwner() === MORE_MENU;
  useMenuFocusBack(ref, open);
  const label = t("navMore.title");
  return (
    <button
      ref={ref}
      onClick={(e) => openMenuFrom(e.currentTarget, moreMenu(t, entries, pinned, badges), { owner: MORE_MENU })}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label}
      title={attention ? `${label}\n${t("navMore.attention")}` : label}
      data-titlebar-entry="more"
      className={`${btn} relative shrink-0 ${open ? "bg-surface-2 text-foreground" : ""}`}
    >
      <Ellipsis size={16} />
      {attention && <span aria-hidden className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-attention" />}
    </button>
  );
}

/** Narrow bar: one ⋯ for the folded entries, carrying their total; a flat list (icon · name · number), `extra` (显示桌面) after them, 「更多 ›」 last. */
function FoldButton({ folded, extra, entries, pinned, badges, attention, btn }: { folded: readonly Entry[]; extra: MenuAction; entries: readonly Entry[]; pinned: readonly string[]; badges: Record<string, Badge>; attention: boolean; btn: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const owner = useMenuOwner();
  const open = owner === FOLD_MENU || owner === MORE_MENU;
  useMenuFocusBack(ref, open);
  const total = folded.reduce((sum, e) => sum + (e.mode === "show" ? (badgeCount(badges[e.item.id] ?? null) ?? 0) : 0), 0);
  const name = (e: Entry) => e.item.title ?? t(e.item.titleKey);
  const parts = folded.map((e) => {
    const n = e.mode === "show" ? badgeCount(badges[e.item.id] ?? null) : null;
    return n ? `${name(e)} ${n}` : name(e);
  });
  const tip = [...parts, extra.label, t("navMore.title")].join(t("titlebar.entries.listSep"));
  const list = (anchor: HTMLElement): MenuEntry[] => [
    ...folded.map((e): MenuAction => {
      const Icon = e.item.icon;
      const disabled = e.mode !== "show";
      const n = disabled ? null : badgeCount(badges[e.item.id] ?? null);
      return {
        label: name(e),
        icon: <Icon size={14} />,
        hint: n ? String(n) : undefined,
        disabled,
        title: disabled && !e.waiting ? t("modules.needsCapability", { list: e.missing.join(", ") }) : undefined,
        onSelect: () => runNav(e.item),
      };
    }),
    extra,
    "separator",
    { label: t("titlebar.entries.more"), icon: <Ellipsis size={14} />, onSelect: () => void ownerWindowOf(anchor).requestAnimationFrame(() => openMenuFrom(anchor, moreMenu(t, entries, pinned, badges), { owner: MORE_MENU })) },
  ];
  return (
    <button
      ref={ref}
      onClick={(e) => openMenuFrom(e.currentTarget, list(e.currentTarget), { owner: FOLD_MENU })}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={total ? t("titlebar.entries.foldWaiting", { list: tip, n: total }) : tip}
      title={tip}
      data-titlebar-entry="fold"
      className={`${btn} relative shrink-0 ${open ? "bg-surface-2 text-foreground" : ""}`}
    >
      <Ellipsis size={16} />
      {total > 0 ? <IconBadge badge={{ text: String(total), attention: true }} /> : attention && <span aria-hidden className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-attention" />}
    </button>
  );
}

/** Whether the window bar's entries fold now (window width, workspaces side by side). */
export function useEntriesCompact(): boolean {
  watchWindow();
  // A boolean from the store (not the width): the bar re-renders when it folds, not on every step of a window resize.
  const workspaces = usePanes((s) => conversationPanes(s.layout).length);
  return useWsUi((s) => entriesCompact({ windowWidth: s.windowWidth - (s.reserved ?? 0), workspaces }));
}

/**
 * The window bar's entry group (sidebar v5, right of the host picker): a divider, the pinned and surfaced entries
 * as flat icons, 「⋯ 更多」; narrow, the first entry and one ⋯ with the rest. `btn`: the bar's icon-button classes.
 */
export function TitleBarEntries({ btn }: { btn: string }) {
  const { t } = useI18n();
  const { entries, byId, badges, probes, layout } = useNavLayout();
  const compact = useEntriesCompact();
  const shown = [...layout.pinned, ...layout.surfaced].map((id) => byId.get(id)!);
  const inline = compact ? shown.slice(0, 1) : shown;
  const folded = compact ? shown.slice(1) : [];
  const pinnedSet = new Set(layout.pinned);
  const desktop = useShowDesktopRow();
  // 显示桌面 (owner 2026-10-23: moved here from the right-hand group): last before ⋯; narrow, a row of the ⋯ list.
  const any = entries.length > 0;
  return (
    <div role="toolbar" aria-label={t("titlebar.entries.label")} data-window-bar="entries" data-compact={compact ? "" : undefined} className="flex shrink-0 items-center gap-0.5 [app-region:no-drag]">
      <span aria-hidden data-titlebar-divider="" className="mx-1 h-4 w-px shrink-0 bg-[color-mix(in_srgb,var(--fg)_18%,transparent)]" />
      {probes}
      {inline.map((e) => (
        <ItemBoundary key={e.item.id} moduleId={e.moduleId}>
          <FlatEntry entry={e} pinned={pinnedSet.has(e.item.id)} badge={badges[e.item.id] ?? null} btn={btn} />
        </ItemBoundary>
      ))}
      {(!compact || !any) && <ShowDesktopButton className={btn} />}
      {any &&
        (compact ? (
          <FoldButton folded={folded} extra={desktop} entries={entries} pinned={layout.pinned} badges={badges} attention={layout.moreAttention} btn={btn} />
        ) : (
          <MoreButton entries={entries} pinned={layout.pinned} badges={badges} attention={layout.moreAttention} btn={btn} />
        ))}
    </div>
  );
}
