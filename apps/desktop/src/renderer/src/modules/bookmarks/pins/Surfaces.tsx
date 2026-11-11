// 备忘 surfaces (owner 2026-11-10): the card (tabs 要处理 = what agents left with owner_pin, from cutex; 书签 = this
// module's own device-local bookmarks list, unchanged), the tray button (open 要你做 / 要你定 count), the desktop widget
// and the tool strip's 要处理 (this agent's). Without a host that has `owner-pins` the card is the bookmarks list alone.
import { Pin } from "lucide-react";
import { CountBadge } from "../../../components/Tag";
import { useI18n } from "../../../i18n";
import { agentHost, useApp } from "../../../store";
import { services } from "../../app";
import type { GutterBodyProps, GutterTriggerProps, SideBodyProps } from "../../slots";
import type { DesktopWidgetProps } from "../../widgetTypes";
import { BookmarksList } from "../BookmarksList";
import { BOOKMARKS, type ListState } from "../model";
import { PinBoard } from "./Board";
import { useCounts, usePinsAvailable } from "./hooks";

export function MemoCard(props: SideBodyProps<ListState>) {
  const { t } = useI18n();
  const { hostId, instance, setState } = props;
  const pins = usePinsAvailable();
  const { action } = useCounts();
  const selected = useApp((s) => (agentHost(s) === hostId ? s.selectedId : null));
  const state = instance.state;
  const tab = pins ? (state.tab ?? "pins") : "bookmarks";
  const agentOnly = !!state.agentOnly && !!selected;
  const chip = (on: boolean, label: string, value: boolean) => (
    <button type="button" aria-pressed={on} onClick={() => setState({ ...state, agentOnly: value })} className={`rounded-full px-2 py-0.5 text-xs ${on ? "bg-accent/10 text-accent" : "text-subtle hover:bg-hover"}`}>{label}</button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-memo-card="">
      {pins && (
        <div role="tablist" className="flex items-center gap-1 border-b border-border px-2 pt-1.5">
          {(["pins", "bookmarks"] as const).map((id) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} data-memo-tab={id} onClick={() => setState({ ...state, tab: id })}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-2 pb-1.5 text-xs ${tab === id ? "border-accent font-medium text-foreground" : "border-transparent text-subtle hover:text-foreground"}`}>
              {t(id === "pins" ? "bookmarks.memo.tab.pins" : "bookmarks.memo.tab.bookmarks")}
              {id === "pins" && action > 0 && <CountBadge count={action} tone="accent" />}
            </button>
          ))}
        </div>
      )}
      {tab === "pins" ? (
        <div className="flex min-h-0 flex-1 flex-col" data-owner-pins-card="">
          <div className="flex items-center gap-1 px-2 py-1.5">
            {chip(!agentOnly, t("bookmarks.memo.filter.all"), false)}
            {selected && chip(agentOnly, t("bookmarks.memo.filter.agent"), true)}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1"><PinBoard agentId={agentOnly ? selected : null} /></div>
        </div>
      ) : (
        <BookmarksList {...props} />
      )}
    </div>
  );
}

export function PinsTrayButton() {
  const { t } = useI18n();
  const { action, notes } = useCounts();
  const hostId = useApp((s) => s.hosts?.active ?? "local");
  if (!action && !notes) return null;
  const board = t("bookmarks.memo.title");
  const label = action ? t("bookmarks.memo.tray", { n: action, board }) : t("bookmarks.memo.trayNotes", { n: notes, board });
  return (
    <button type="button" data-tray-item="" data-owner-pins-tray="" className="tray-item relative" data-tip={label} aria-label={label} onClick={() => services.side.open(BOOKMARKS, { tab: "pins" }, { binding: { kind: "host", hostId } })}>
      <Pin size={16} aria-hidden className={action ? "text-accent" : undefined} />
      {action > 0 && <CountBadge count={action} tone="accent" className="absolute -top-0.5 -right-0.5" />}
    </button>
  );
}

export function PinsWidget({ settings }: DesktopWidgetProps) {
  const { t } = useI18n();
  const { action } = useCounts();
  const max = typeof settings.maxRows === "number" ? settings.maxRows : 6;
  return (
    <section className="flex h-full flex-col overflow-hidden px-2 py-3" data-owner-pins-widget="">
      <h4 className="mb-1 flex items-center gap-2 px-1.5 text-ui/[inherit] font-semibold">
        <Pin size={14} aria-hidden />
        {t("bookmarks.memo.title")}
        {action > 0 && <CountBadge tone="accent" count={action} className="ml-auto" />}
      </h4>
      <div className="min-h-0 flex-1 overflow-auto"><PinBoard max={max} compact showResolved={false} /></div>
    </section>
  );
}

export function PinsTrigger({ sessionId, open, toggle }: GutterTriggerProps) {
  const { t } = useI18n();
  const { action, notes } = useCounts(sessionId);
  const n = action + notes;
  return (
    <button onClick={toggle} aria-expanded={open} aria-label={t("bookmarks.memo.tab.pins")} title={t("bookmarks.memo.tab.pins")} className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${open ? "bg-accent/10 text-accent" : "text-subtle hover:bg-hover"}`} data-owner-pins-trigger="">
      <Pin size={15} fill={n ? "currentColor" : "none"} />
      <span>{t("bookmarks.memo.tab.pins")}</span>
      {n > 0 && <span>{n}</span>}
    </button>
  );
}

export function PinsGutter({ sessionId }: GutterBodyProps) {
  return <div className="p-1"><PinBoard agentId={sessionId} /></div>;
}
