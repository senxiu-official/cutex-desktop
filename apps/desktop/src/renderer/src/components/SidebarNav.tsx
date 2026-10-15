// The sidebar's top entries (`nav.primary`, area "top"; owner 2026-10-14): a first screen of pinned
// entries (lib/navPins: default 新建智能体, 快速启动, 委托, 审批, in pin order), unpinned entries
// that need the owner right now (badge `attention`) until that clears, and a last row 「更多」 whose
// menu lists every entry with a pin toggle (like the title bar's ＋, lib/sideMenus launcherMenu).
// Right-click an entry: pin / unpin. Badges come from each entry's own `useBadge` (probes below), so
// folded entries still count.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Ellipsis, Pin, PinOff } from "lucide-react";
import { useI18n } from "../i18n";
import { contextMenu, openMenuFrom, useMenuOwner, type MenuAction, type MenuEntry } from "../lib/contextMenu";
import { runNav, useNavActive } from "../lib/navEntries";
import { layoutNav, withNavPin } from "../lib/navPins";
import { getUiPrefs, setUiPref, useUiPrefs } from "../lib/prefs";
import { isExternalModuleId } from "../modules/external";
import { ExternalBadge } from "../modules/ExternalBadge";
import { ItemBoundary } from "../modules/Outlet";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, NavItem } from "../modules/slots";
import { ScriptText } from "./ScriptText";

type Entry = AppSlotEntry<"nav.primary">;
type Badge = ReturnType<NonNullable<NavItem["useBadge"]>>;
const MORE_MENU = "sidebar.navMore";

function setPinned(id: string, on: boolean) {
  setUiPref("navPins", withNavPin(getUiPrefs().navPins, id, on));
}

/** Reports an entry's badge (rendered for every entry, shown or folded). */
const BadgeProbe = memo(function BadgeProbe({ entry, report }: { entry: Entry; report(id: string, badge: Badge): void }) {
  const badge = entry.item.useBadge?.() ?? null;
  const id = entry.item.id;
  useEffect(() => report(id, badge), [id, badge?.text, badge?.attention, badge?.dot, badge?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => report(id, null), [id, report]);
  return null;
});

/** One entry above the agent list: icon, label, badge (⚠ N), optional drop-down. */
function TopEntry({ entry, pinned }: { entry: Entry; pinned: boolean }) {
  const { t } = useI18n();
  const { item } = entry;
  const active = useNavActive(item);
  const titleKey = item.useTitleKey?.() ?? item.titleKey;
  const badge = item.useBadge?.() ?? null;
  const disabled = entry.mode !== "show";
  const Icon = item.icon;
  const Menu = item.Menu;
  return (
    <div
      className="group/navitem relative"
      onContextMenu={contextMenu(() => [{ label: t(pinned ? "navMore.unpin" : "navMore.pin"), icon: pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => setPinned(item.id, !pinned) }])}
    >
      <button
        disabled={disabled}
        title={disabled && !entry.waiting ? t("modules.needsCapability", { list: entry.missing.join(", ") }) : undefined}
        onClick={() => runNav(item)}
        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] disabled:opacity-50 ${active ? "bg-background text-foreground shadow-[var(--card-shadow)]" : "text-muted hover:bg-hover hover:text-foreground"}`}
      >
        <span className="text-subtle">
          <Icon size={15} />
        </span>
        <span className="flex-1"><ScriptText text={item.title ?? t(titleKey)} /></span>
        {isExternalModuleId(entry.moduleId) && <ExternalBadge />}
        {!disabled && badge?.text && <span title={badge.title} className={`text-[10px] ${badge.attention ? "font-semibold text-warn-text" : "text-subtle"}`}><ScriptText text={badge.text} /></span>}
        {!disabled && badge?.dot && <span title={badge.title} className="h-1.5 w-1.5 rounded-full bg-danger" />}
      </button>
      {Menu && !disabled && <Menu />}
    </div>
  );
}

/** 「更多」: the menu of every entry (pinned first, in pin order) with a pin toggle each. */
function MoreEntry({ entries, pinned, badges, attention }: { entries: Entry[]; pinned: string[]; badges: Record<string, Badge>; attention: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const open = useMenuOwner() === MORE_MENU;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open && (document.activeElement === document.body || document.activeElement === null)) ref.current?.focus();
    wasOpen.current = open;
  }, [open]);
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
  const menu = (): MenuEntry[] => {
    const byId = new Map<string, Entry>(entries.map((e) => [e.item.id, e]));
    const first = pinned.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    const rest = entries.filter((e) => !pinned.includes(e.item.id as string));
    return [...first.map((e) => row(e, true)), "separator", ...rest.map((e) => row(e, false))];
  };
  const label = t("navMore.title");
  return (
    <button
      ref={ref}
      onClick={(e) => openMenuFrom(e.currentTarget, menu(), { owner: MORE_MENU })}
      aria-haspopup="menu"
      aria-expanded={open}
      title={attention ? t("navMore.attention") : undefined}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${open ? "bg-hover text-foreground" : "text-muted hover:bg-hover hover:text-foreground"}`}
    >
      <span className="text-subtle">
        <Ellipsis size={15} />
      </span>
      <span className="flex-1">{label}</span>
      {attention && <span aria-label={t("navMore.attention")} className="h-1.5 w-1.5 rounded-full bg-warn" />}
    </button>
  );
}

export function TopNav() {
  const entries = useSlot("nav.primary").filter((e) => (e.item.area ?? "top") === "top");
  const { navPins } = useUiPrefs();
  const [badges, setBadges] = useState<Record<string, Badge>>({});
  const report = useCallback((id: string, badge: Badge) => {
    setBadges((all) => {
      const before = all[id] ?? null;
      if (before === badge || (before && badge && before.text === badge.text && before.attention === badge.attention && before.dot === badge.dot && before.title === badge.title)) return all;
      return { ...all, [id]: badge };
    });
  }, []);
  const byId = new Map<string, Entry>(entries.map((e) => [e.item.id, e]));
  const ids: string[] = entries.map((e) => e.item.id);
  const attention = new Set(ids.filter((id) => badges[id]?.attention));
  const layout = layoutNav(ids, navPins, attention, (id) => byId.get(id)?.mode === "show");
  const pinnedSet = new Set(layout.pinned);
  return (
    <>
      {entries.map((e) => (
        <ItemBoundary key={`probe:${e.item.id}`} moduleId={e.moduleId}>
          <BadgeProbe entry={e} report={report} />
        </ItemBoundary>
      ))}
      {[...layout.pinned, ...layout.surfaced].map((id) => {
        const e = byId.get(id)!;
        return (
          <ItemBoundary key={id} moduleId={e.moduleId}>
            <TopEntry entry={e} pinned={pinnedSet.has(id)} />
          </ItemBoundary>
        );
      })}
      {(layout.folded.length > 0 || layout.surfaced.length > 0) && <MoreEntry entries={entries} pinned={layout.pinned} badges={badges} attention={layout.moreAttention} />}
    </>
  );
}
