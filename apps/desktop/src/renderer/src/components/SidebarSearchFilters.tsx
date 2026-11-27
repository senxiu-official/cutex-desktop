// The sidebar search's 筛选 (design A, owner 2026-11-27; it replaced the folder icon, the ⓘ and the controls that
// appeared while typing): one button with how many conditions are set; its panel, under the field, groups the
// conditions by what they narrow — 工作目录 (names and message history), then 含已归档 / 发送方 / 类型 / 时间 (message
// history only). Set conditions stay visible as removable chips while the panel is closed. The conditions are
// lib/sessionSearchStore's state (dir, archived, choice), as before.
import { SlidersHorizontal, X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { setArchivedSearch, setDirFilter, setSearchChoice, useSessionSearch } from "../lib/sessionSearchStore";
import { NO_FILTERS } from "../lib/sessionSearchView";
import type { SessionSearchHosts } from "../lib/useSessionSearchHosts";
import { DirFilterRow } from "./SidebarSessionSearch";
import { SearchFilterSelects, SenderFilterSelect } from "./SessionSearchParts";

/** How many conditions are set (the button's count). */
function useFilterCount(): number {
  const dir = useSessionSearch((s) => s.dir);
  const archived = useSessionSearch((s) => s.archived);
  const choice = useSessionSearch((s) => s.choice);
  return (dir ? 1 : 0) + (archived ? 1 : 0) + (choice.sender !== "all" ? 1 : 0) + (choice.kind !== "all" ? 1 : 0) + (choice.time !== "any" ? 1 : 0);
}

export function FilterToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  const { t } = useI18n();
  const n = useFilterCount();
  const label = n ? t("searchX.filtersCount", { n }) : t("searchX.filters");
  return (
    <button type="button" data-search-filters-toggle="" aria-expanded={open} aria-label={label} data-tip={t("searchX.filtersTip")} onClick={onToggle}
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-ctl px-1.5 text-caption hover:bg-hover ${open || n ? "text-accent" : "text-muted"}`}>
      <SlidersHorizontal size={13} aria-hidden />
      {n > 0 && <span className="tabular-nums" data-search-filters-count="">{n}</span>}
    </button>
  );
}

function Group({ title, hint, children, data }: { title: string; hint: string; children: React.ReactNode; data: string }) {
  return (
    <div className="flex flex-col gap-1" data-search-filter-group={data}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-caption font-semibold text-muted">{title}</span>
        <span className="truncate text-caption text-subtle">{hint}</span>
      </div>
      {children}
    </div>
  );
}

/** The panel (inline under the field: no popover to aim at on a narrow or portrait sidebar). */
export function SearchFilterPanel({ hosts, cwdsOf, focus, onClose }: { hosts: SessionSearchHosts; cwdsOf: (hostId: string) => string[]; focus: string; onClose(): void }) {
  const { t } = useI18n();
  const archived = useSessionSearch((s) => s.archived);
  const choice = useSessionSearch((s) => s.choice);
  // 含已归档: owner connections only (cutex answers owner_required otherwise).
  const canArchived = hosts.capable.some((h) => hosts.owner.has(h.id));
  const anyV2 = hosts.capable.some((h) => hosts.v2.has(h.id));
  return (
    <div data-search-filters="" className="mx-2 mb-1.5 flex flex-col gap-2 rounded-ctl border border-border bg-surface px-2 py-1.5">
      <Group data="dir" title={t("searchX.dir")} hint={t("searchX.dirHint")}>
        <DirFilterRow hosts={hosts} cwdsOf={cwdsOf} focus={focus} />
      </Group>
      <Group data="history" title={t("searchX.historyGroup")} hint={t("searchX.historyGroupHint")}>
        {canArchived && (
          <label className="flex items-center gap-1.5 text-caption" data-search-filter-archived="">
            <input type="checkbox" checked={archived} onChange={(e) => setArchivedSearch(e.target.checked)} />
            {t("searchX.archived")}
          </label>
        )}
        <div className="flex min-w-0 flex-col gap-1 [&>*]:w-full">
          {anyV2 ? <SearchFilterSelects choice={choice} selectClass="h-5 flex-1" onChange={setSearchChoice} /> : <SenderFilterSelect className="min-w-0 [&>select]:h-5" />}
        </div>
      </Group>
      <div className="flex justify-end">
        <button type="button" data-search-filters-done="" onClick={onClose} className="rounded-ctl px-1.5 py-0.5 text-caption text-accent hover:bg-hover">{t("searchX.done")}</button>
      </div>
    </div>
  );
}

function Chip({ label, data, onRemove }: { label: string; data: string; onRemove(): void }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex h-5 min-w-0 max-w-full items-center gap-0.5 rounded-full bg-accent/10 pr-0.5 pl-2 text-caption text-accent" data-search-chip={data}>
      <span className="truncate">{label}</span>
      <button type="button" aria-label={t("searchX.remove")} data-tip={t("searchX.remove")} onClick={onRemove} className="inline-flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-accent/15"><X size={10} aria-hidden /></button>
    </span>
  );
}

/** Set conditions while the panel is closed (nothing when none is set: the sidebar stays quiet). */
export function SearchFilterChips() {
  const { t } = useI18n();
  const dir = useSessionSearch((s) => s.dir);
  const archived = useSessionSearch((s) => s.archived);
  const choice = useSessionSearch((s) => s.choice);
  const chips: { key: string; label: string; remove(): void }[] = [];
  if (dir) chips.push({ key: "dir", label: t("searchX.chipDir", { path: dir.path.split(/[\\/]/).filter(Boolean).pop() ?? dir.path }), remove: () => void setDirFilter(null) });
  if (archived) chips.push({ key: "archived", label: t("searchX.archived"), remove: () => setArchivedSearch(false) });
  if (choice.sender !== "all") chips.push({ key: "sender", label: t(`sidebar.sessionSearch.sender.${choice.sender}` as MessageKey), remove: () => setSearchChoice({ ...choice, sender: NO_FILTERS.sender }) });
  if (choice.kind !== "all") chips.push({ key: "kind", label: t(`sidebar.sessionSearch.kind.${choice.kind}` as MessageKey), remove: () => setSearchChoice({ ...choice, kind: NO_FILTERS.kind }) });
  if (choice.time !== "any") chips.push({ key: "time", label: t(`sidebar.sessionSearch.time.${choice.time}` as MessageKey), remove: () => setSearchChoice({ ...choice, time: NO_FILTERS.time, from: undefined, to: undefined }) });
  if (!chips.length) return null;
  return (
    <div data-search-chips="" className="flex min-w-0 flex-wrap gap-1 px-2.5 pb-1.5">
      {chips.map((c) => <Chip key={c.key} data={c.key} label={c.label} onRemove={c.remove} />)}
    </div>
  );
}

/** The name matches' own heading while searching (the message history has its own section above). */
export function NamesHeading() {
  const { t } = useI18n();
  return <div data-search-section="names" className="px-2 pt-1 pb-0.5 text-caption font-semibold text-muted">{t("searchX.names")}</div>;
}
