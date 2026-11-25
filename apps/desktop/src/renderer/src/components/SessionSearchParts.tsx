// Pieces the sidebar's 查找旧任务 (components/SidebarSessionSearch) and the search page (modules/session-search) share:
// a result's time, the searched words marked in plain text, and a filter the host's search cannot apply yet (greyed,
// with why). Helpers live in lib/sessionSearchView (Fast Refresh).
import { useI18n, type MessageKey } from "../i18n";
import { formatAbsolute, useClock } from "../lib/time";
import { rowAge } from "../lib/queueRowTime";
import { matchRuns, SENDER_FILTERS, TIME_PRESETS, type SearchFilterChoice, type SenderFilter } from "../lib/sessionSearchView";
import { SEARCH_KINDS, type SearchKind } from "../../../shared/sessionSearch";

/** Plain text with the searched words marked (never markup from the host). */
export function Marked({ text, q }: { text: string; q: string }) {
  return <>{matchRuns(text, q).map((run, i) => (run.hit ? <mark key={i} className="rounded-sm bg-accent/15 text-current">{run.text}</mark> : run.text))}</>;
}

/** A result's time like a 接下来 row's: 「3 小时前」, the exact time in the tip. */
export function HitTime({ ms, className = "" }: { ms: number; className?: string }) {
  const { t } = useI18n();
  useClock(true);
  const age = rowAge(ms, Date.now());
  const exact = formatAbsolute(ms / 1000);
  return (
    <time data-search-hit-time="" dateTime={new Date(ms).toISOString()} data-tip={exact} className={`shrink-0 tabular-nums ${className}`}>
      {age ? t(age.key, { n: age.n }) : exact}
    </time>
  );
}

/**
 * A filter the host's search cannot apply yet: shown greyed at its first choice, the reason in the tip (the wrapper
 * takes the hover: a disabled control gets no pointer events).
 */
export function GreyedFilter({ label, options, tip, data, className = "" }: { label: string; options: readonly string[]; tip: string; data: string; className?: string }) {
  return (
    <span data-tip={tip} data-search-greyed={data} className={`inline-flex min-w-0 ${className}`}>
      <select disabled aria-label={label} aria-description={tip} className="pointer-events-none min-w-0 truncate rounded-ctl border border-border bg-background px-1 text-caption text-subtle opacity-60">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </span>
  );
}

/** 发送方: all / sent by me / sent by agents (owner 2026-11-26). Greyed: session-search-v1 has no sender filter. */
export function SenderFilterSelect({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <GreyedFilter
      data="sender"
      label={t("sidebar.sessionSearch.sender")}
      tip={t("sidebar.sessionSearch.senderUnavailable")}
      options={SENDER_FILTERS.map((v) => t(`sidebar.sessionSearch.sender.${v}` as MessageKey))}
      className={className}
    />
  );
}

/**
 * 发送方 / 类型 / 时间 as working filters (cutex session-search-v2 hosts; the others keep GreyedFilter). `custom` (the
 * page): 时间 offers 自定义… (the page draws the two dates).
 */
export function SearchFilterSelects({ choice, onChange, custom = false, selectClass = "" }: { choice: SearchFilterChoice; onChange(next: SearchFilterChoice): void; custom?: boolean; selectClass?: string }) {
  const { t } = useI18n();
  const cls = `min-w-0 truncate rounded-ctl border border-border bg-background px-1 text-caption outline-none focus:border-accent ${selectClass}`;
  const on = (v: string, base: string) => (v === base ? "text-subtle" : "text-accent");
  return (
    <>
      <select data-search-filter="sender" aria-label={t("sidebar.sessionSearch.sender")} value={choice.sender} onChange={(e) => onChange({ ...choice, sender: e.target.value as SenderFilter })} className={`${cls} ${on(choice.sender, "all")}`}>
        {SENDER_FILTERS.map((v) => <option key={v} value={v}>{t(`sidebar.sessionSearch.sender.${v}` as MessageKey)}</option>)}
      </select>
      <select data-search-filter="kind" aria-label={t("sidebar.sessionSearch.kind")} value={choice.kind} onChange={(e) => onChange({ ...choice, kind: e.target.value as SearchFilterChoice["kind"] })} className={`${cls} ${on(choice.kind, "all")}`}>
        {(["all", ...SEARCH_KINDS] as const).map((v) => <option key={v} value={v}>{t(`sidebar.sessionSearch.kind.${v}` as MessageKey)}</option>)}
      </select>
      <select data-search-filter="time" aria-label={t("sidebar.sessionSearch.time")} value={choice.time} onChange={(e) => onChange({ ...choice, time: e.target.value as SearchFilterChoice["time"] })} className={`${cls} ${on(choice.time, "any")}`}>
        {[...TIME_PRESETS, ...(custom ? (["custom"] as const) : [])].map((v) => <option key={v} value={v}>{t(`sidebar.sessionSearch.time.${v}` as MessageKey)}</option>)}
      </select>
    </>
  );
}

/** What a v2 result is, beside its agent: 委托 / 结果 (plain messages say nothing), and who sent the turn's input. */
export function HitBadges({ hit }: { hit: { kind?: SearchKind; sender?: "owner" | "agent" | "unknown" } }) {
  const { t } = useI18n();
  return (
    <>
      {hit.kind && hit.kind !== "messages" && <span data-search-hit-kind={hit.kind} className="shrink-0 rounded px-1 ring-1 ring-border">{t(`sidebar.sessionSearch.kind.${hit.kind}` as MessageKey)}</span>}
      {(hit.sender === "owner" || hit.sender === "agent") && <span data-search-hit-sender={hit.sender} className="shrink-0">{t(hit.sender === "owner" ? "sidebar.sessionSearch.sender.owner" : "sidebar.sessionSearch.sender.agents")}</span>}
    </>
  );
}
