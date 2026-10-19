// Form primitives shared by the Settings pages (docs/research/settings-audit-20261008.md §4).
//
// Save semantics — exactly three, one per field:
//   • immediate: Toggle / Segmented / Select apply on change;
//   • on commit: TextField / NumberField apply on Enter or blur (never per keystroke);
//   • draft + save bar: multi-field forms that validate together (Profile detail).
// Rows: every setting is a `SettingRow` (label + hint | control column | reset slot), so controls
// line up on one right edge on every page; entity lists use `ListRow` with click-twice removal.
import { Component, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { bridge } from "../../bridge";
import { CARD_FLAGS } from "../../lib/narrowCard";
import { dataFlags, useSizeFlags } from "../../lib/sizeFlags";
import { ArrowRight, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, KeyRound, Layers, Monitor, Plus, RotateCcw, RotateCw, Server, Wrench, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { ARMED_BUTTON, useArmed } from "../../lib/armedConfirm";
import { FIELD_W } from "../../lib/fieldWidths";
import { shownSettingsSource } from "../../lib/hosts";
import { parseClamped, radioKeyTarget, RowA11yContext, useRowA11y } from "../../lib/formA11y";
import type { SettingsAgents, SettingsSource } from "../../lib/settingsNav";
import { useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface";
const FIELD = "rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

/** Where a page's (or section's) settings live: this machine, the target host's cutex (lib/targetHost: Settings' host), or its codex config. */
export function SourceTag({ source }: { source: SettingsSource }) {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const host = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.label) ?? "—";
  const label = source === "local" ? t("settings.source.local") : t(source === "host" ? "settings.source.host" : "settings.source.codex", { host });
  const title = source === "local" ? t("settings.source.localHint") : t(source === "host" ? "settings.source.hostHint" : "settings.source.codexHint", { host });
  const tone = source === "local" ? "bg-surface-2 text-muted" : "bg-accent/12 text-accent";
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] whitespace-nowrap ${tone}`}>
      {label}
    </span>
  );
}

/** The page header's scope (SettingsPage): a section chip repeating it is left out. */
const PageSourceContext = createContext<SettingsSource | undefined>(undefined);
const PageAgentsContext = createContext<SettingsAgents | undefined>(undefined);
/** A card reports here while its scope chip differs from its page's (SettingsPage: the page chip mentions it). */
const PageExceptionsContext = createContext<((id: string, on: boolean) => void) | null>(null);
/** A host card / host part reports here while mounted: a 混合设置 header then names the host they show. */
const PageHostUseContext = createContext<((id: string, on: boolean) => void) | null>(null);

/** For SettingsHostSection / SettingsHostPart: this page shows host settings (of the Settings target host). */
export function useReportsHost(): void {
  const report = useContext(PageHostUseContext);
  const id = useId();
  useEffect(() => {
    if (!report) return;
    report(id, true);
    return () => report(id, false);
  }, [report, id]);
}

/** A headless host part's host picker: its host cards join it to their scope tag (「cutex 后端 · ● HOST ▾」). */
const PartPickerContext = createContext<ReactNode>(null);
/** A headless part's place: its cards that name none show this one on a 混合设置 page. */
const PartFallbackContext = createContext<SettingsSource | undefined>(undefined);
/** The page is 混合设置 (no single place, or a card elsewhere): every titled card shows where it lives. */
const PageMixedContext = createContext(false);

/**
 * A mixed page half (SettingsHostFrame parts) states its scope once: its sections do not repeat it.
 * `cards` (a part without a heading, owner 2026-10-19): every card tags itself instead, like the cards of
 * a one-place page that live elsewhere (排队顺序 on 输入区); `picker` joins the host cards' tags.
 */
export function PartSource({ source, agents, cards, picker, children }: { source: SettingsSource; agents?: SettingsAgents; cards?: boolean; picker?: ReactNode; children: ReactNode }) {
  if (cards)
    return (
      <PartPickerContext value={picker ?? null}>
        <PartFallbackContext value={source}>{children}</PartFallbackContext>
      </PartPickerContext>
    );
  return (
    <PageSourceContext value={source}>
      <PageAgentsContext value={agents}>{children}</PageAgentsContext>
    </PageSourceContext>
  );
}

const CHIP = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const CHIP_TONE = { plain: "bg-surface-2 text-muted", quiet: "bg-surface-2 text-subtle", host: "bg-accent/12 text-accent", agents: "bg-warn/15 text-warn-text" } as const;

/** A scope chip: a click floats a short explanation under it; an outside click or Esc closes it. */
/** `joined`: the left half of a tag whose right half is a host picker (HostPicker `chip`), e.g. 「cutex 后端 · ● HOST-A ▾」. */
export function ScopeChip({ tone, icon, label, title, body, joined }: { tone: keyof typeof CHIP_TONE; icon: ReactNode; label: string; title: string; body: string; joined?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className={`${CHIP} ${CHIP_TONE[tone]} cursor-pointer hover:brightness-125 ${joined ? "rounded-r-none pr-1" : ""} ${FOCUS}`}>
        {icon}
        {label}
      </button>
      {open && (
        <span id={id} role="note" className="absolute top-full left-0 z-30 mt-1.5 w-72 rounded-lg border border-border bg-raised p-3 text-xs shadow-lg">
          <span className="mb-1 block font-medium text-foreground">{title}</span>
          <span className="block leading-relaxed text-muted">{body}</span>
        </span>
      )}
    </span>
  );
}

/**
 * Where the settings live (owner 2026-10-19, dev topic 标签设计): 本地桌面应用 / cutex 后端 · X /
 * Codex 运行时 · X — the place, never 「…设置」. On a page header, `except` (a card tagged elsewhere)
 * makes it 「混合：<place>」, and a page with no single place (each card tagged) says 混合设置.
 * `short`: the left half of a tag with a host picker (the picker names the host).
 */
function WhereChip({ source, short, except, shown }: { source: SettingsSource | undefined; short?: boolean; except?: boolean; /** On a 混合设置 header: the host the page's host cards show. */ shown?: boolean }) {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const host = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.label) ?? "—";
  if (except) source = undefined;
  if (source === "local") {
    // 「本地桌面应用」 (owner 2026-10-19: 「本机」 read oddly; it pairs with 「cutex 后端」). The same with or
    // without a local host in the list.
    return <ScopeChip tone="plain" icon={<Monitor size={11} aria-hidden />} label={t("settings.scope.local.label")} title={t("settings.scope.local.title")} body={t("settings.scope.local.body")} />;
  }
  if (source === "host" || source === "codex") {
    const label = short ? `${t(`settings.scope.${source}.short`)} ·` : t(`settings.scope.${source}.label`, { host });
    return <ScopeChip tone="host" joined={short} icon={<Server size={11} aria-hidden />} label={label} title={shown ? t("settings.scope.host.shownTitle", { host }) : t(`settings.scope.${source}.label`, { host })} body={t(`settings.scope.${source}.body`, { host })} />;
  }
  // A page whose cards each say where they live (通知).
  return <ScopeChip tone="plain" icon={<Layers size={11} aria-hidden />} label={t("settings.scope.mixedTag")} title={t("settings.scope.mixedTag")} body={t("settings.scope.mixed")} />;
}

/**
 * Whether (and when) agents feel these settings (follows the agent term): 不影响智能体, 智能体 · 下次启动生效,
 * 智能体 · 立即生效, 访问权限. A page header only ever says 不影响智能体 (owner 2026-10-19: when the whole
 * page does not affect agents); a card that does says how.
 */
function AgentsChip({ agents }: { agents: SettingsAgents }) {
  const { t } = useI18n();
  const icon = agents === "access" ? <KeyRound size={11} aria-hidden /> : <Bot size={11} aria-hidden />;
  const tone = agents === "none" ? "quiet" : agents === "access" ? "plain" : "agents";
  return <ScopeChip tone={tone} icon={icon} label={t(`settings.scope.agents.${agents}`)} title={t(`settings.scope.agents.${agents}.title`)} body={t(`settings.scope.agents.${agents}.body`)} />;
}

/** An MCP tool a card is about: its name and, optionally, one line of its own (what agents use it for). */
export interface CardTool {
  name: string;
  desc?: string;
}

/**
 * [MCP工具] (owner 2026-10-19): the popover's title names the tools, a fixed first line says the card holds
 * their settings, then each tool's own line (if it has one).
 */
function ToolsChip({ tools }: { tools: readonly CardTool[] }) {
  const { t } = useI18n();
  const title = tools.map((x) => x.name).join(" · ");
  const list = tools.map((x) => x.name).join(t("settings.scope.mcp.and"));
  const body = [t("settings.scope.mcp.body", { tools: list }), ...tools.flatMap((x) => (x.desc ? [x.desc] : []))].join(" ");
  return <ScopeChip tone="plain" icon={<Wrench size={11} aria-hidden />} label={t("settings.scope.mcp.label")} title={t("settings.scope.mcp.title", { tools: title })} body={body} />;
}

/**
 * The scope chips (owner 2026-10-18, variant F): where the settings live (on a host page / part one
 * tag, 「cutex 后端 · ● host ▾」: the where-chip joined to the host picker, Q2b) and whether agents feel them. Each chip floats its explanation
 * on click. Page headers and the halves of a mixed page (SettingsHostFrame parts) share it; `agents`
 * unset = the page is not reviewed yet (no chip).
 */
export function ScopeLine({ source, picker, agents, except, hostShown }: { source?: SettingsSource; picker?: ReactNode; agents?: SettingsAgents; except?: boolean; /** 混合设置 with host cards: name (and pick) the host they show, after the 混合设置 tag. */ hostShown?: boolean }) {
  // A page tag says only 不影响智能体 (cards say the rest).
  if (agents && agents !== "none") agents = undefined;
  const mixed = except || !source;
  if (mixed) {
    return (
      <div data-settings-scope="mixed" className="flex min-h-6 flex-wrap items-center gap-1.5">
        <WhereChip source={undefined} />
        {hostShown &&
          (picker ? (
            <span className="inline-flex items-center" data-settings-shown-host="">
              <WhereChip source="host" short shown />
              {picker}
            </span>
          ) : (
            <WhereChip source="host" shown />
          ))}
        {agents && <AgentsChip agents={agents} />}
      </div>
    );
  }
  return (
    <div data-settings-scope={except ? "mixed" : (source ?? "mixed")} className="flex min-h-6 flex-wrap items-center gap-1.5">
      {picker ? (
        <span className="inline-flex items-center">
          <WhereChip source={source} short except={except} />
          {picker}
        </span>
      ) : (
        <WhereChip source={source} except={except} />
      )}
      {agents && <AgentsChip agents={agents} />}
    </div>
  );
}

/**
 * Page header: what the page is for (`hint`, one line) and the scope chips. The page name is in the
 * breadcrumb. `host`: the host picker of a host page (multi-host). `link`: a related page at the
 * header's end (the page item's `headerLink`, e.g. 运行时 → 后端更新). `back`: a way back above it all
 * (the page item's `backLink`, e.g. 主机 → ‹ 所有设备).
 */
export function SettingsPage({ source, agents, hint, host, hostPage, link, back, children }: { source?: SettingsSource; back?: ReactNode; agents?: SettingsAgents; hint?: ReactNode; host?: ReactNode; /** A host page: `host` joins its tag. Otherwise `host` names the host of the page's host cards on a 混合设置 page. */ hostPage?: boolean; link?: ReactNode; children: ReactNode }) {
  const [hostUsers, setHostUsers] = useState<ReadonlySet<string>>(() => new Set());
  const reportHost = useCallback((id: string, on: boolean) => {
    setHostUsers((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  // Cards whose own scope chip differs from the page's (Section `source`), e.g. a host card on 输入区.
  const [exceptions, setExceptions] = useState<ReadonlySet<string>>(() => new Set());
  const reportException = useCallback((id: string, on: boolean) => {
    setExceptions((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  return (
    <>
      <div data-settings-header className="mb-5 space-y-1.5 border-b border-border/60 pb-3">
        {back && <div className="-mt-1 flex h-5 items-center">{back}</div>}
        {(hint || link) && (
          <div className="flex min-h-5 items-start gap-3">
            {hint && <p className="min-w-0 text-[13px] text-muted">{hint}</p>}
            {/* The link (在主界面调整, 后端更新 →) must not make the line taller: the chips sit at the same height on every page (owner 2026-10-18). */}
            {link && <span className="-my-1.5 ml-auto flex shrink-0 items-center">{link}</span>}
          </div>
        )}
        <ScopeLine source={source} picker={hostPage === false ? (hostUsers.size ? host : undefined) : host} agents={agents} except={exceptions.size > 0} hostShown={hostUsers.size > 0} />
      </div>
      <PageSourceContext value={source}>
        <PageAgentsContext value={agents}>
          <PageExceptionsContext value={reportException}>
            <PageMixedContext value={!source || exceptions.size > 0}>
              <PageHostUseContext value={reportHost}>{children}</PageHostUseContext>
            </PageMixedContext>
          </PageExceptionsContext>
        </PageAgentsContext>
      </PageSourceContext>
    </>
  );
}

/**
 * A card with a title row (title · scope chips · actions on the right) and a one-line hint. `source` /
 * `agents` chip a section whose scope differs from the page's (owner 2026-10-18: per page, a section
 * only when it differs, never per row); the same as the page header is not repeated.
 */
export function Section({ title, hint, source, agents, children, actions, id, tag, picker, tools, sub }: { title?: string; hint?: ReactNode; source?: SettingsSource; agents?: SettingsAgents; children: ReactNode; actions?: ReactNode; id?: string; /** A muted label after the title, e.g. 旧版 for a card that will be redone (title = tooltip). */ tag?: { label: string; title?: string }; /** A host card's host picker before its (then short) source chip (components/SettingsHostFrame SettingsHostSection). */ picker?: ReactNode; /** The agents' MCP tools this card is about: an [MCP工具] tag naming them. */ tools?: readonly CardTool[]; /** A child card under a heading of its own (a smaller title). */ sub?: boolean }) {
  const { t } = useI18n();
  // 「只看你修改过的设置」 (owner 2026-10-18): per card, offered only while a row in it is modified.
  const [modified, setModified] = useState<ReadonlySet<string>>(() => new Set());
  const [only, setOnly] = useState(false);
  const report = useCallback((rowId: string, on: boolean) => {
    setModified((prev) => {
      if (prev.has(rowId) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);
  const filter =
    modified.size > 0 || only ? (
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted">
        {t("settings.onlyModified", { n: modified.size })}
        <Toggle label={t("settings.onlyModified", { n: modified.size })} checked={only} onChange={setOnly} />
      </label>
    ) : null;
  const pageSource = useContext(PageSourceContext);
  const pageAgents = useContext(PageAgentsContext);
  const partPicker = useContext(PartPickerContext);
  const partFallback = useContext(PartFallbackContext);
  const mixed = useContext(PageMixedContext);
  const own = source ?? partFallback;
  if (!picker && partPicker && (own === "host" || own === "codex")) picker = partPicker;
  const elsewhere = !!own && own !== pageSource;
  const place = mixed && title ? (own ?? pageSource) : elsewhere ? own : undefined;
  const shown = useApp((s) => shownSettingsSource(place, s.hosts));
  source = place ? shown : undefined;
  if (agents === pageAgents) agents = undefined;
  const compact = useContext(CompactContext);
  const reportException = useContext(PageExceptionsContext);
  const sectionId = useId();
  const differs = elsewhere;
  useEffect(() => {
    if (!reportException) return;
    reportException(sectionId, differs);
    return () => reportException(sectionId, false);
  }, [reportException, sectionId, differs]);
  return (
    // Compact (a 在主界面调整 panel): the settings page may be mounted too, so the anchor is not an id there.
    <section className={compact ? "mb-3" : "mb-6"} id={compact ? undefined : id} data-settings-anchor={compact ? id : undefined}>
      {(title || actions || source || agents || filter || picker || tools?.length) && (
        <div className={compact ? "mb-1" : "mb-2"}>
          {/* Fixed-height title row whether or not there are actions / the 「只看你修改过的设置」 switch,
              so one appearing never moves the page (owner 2026-10-18: a little taller for that switch). */}
          <div className={`mb-0.5 flex items-center gap-2 ${compact ? "h-7" : "h-8"}`}>
            {title && <h3 className={`min-w-0 truncate ${sub ? "text-[13px] font-medium" : `font-semibold ${compact ? "text-[13px]" : "text-sm"}`}`}>{title}</h3>}
            {tag && (
              <span title={tag.title} className="inline-flex h-5 shrink-0 items-center rounded border border-dashed border-border px-1.5 text-[11px] text-subtle">
                {tag.label}
              </span>
            )}
            {(actions || filter) && (
              <div className="ml-auto flex shrink-0 items-center gap-3">
                {filter}
                {actions}
              </div>
            )}
          </div>
          {hint && <p className="text-xs text-subtle">{hint}</p>}
          {/* Tags on their own line under the hint (owner 2026-10-19, A): where, whether agents feel it,
              [MCP工具] — a card has them or not for good, so the line never comes and goes. */}
          {(source || picker || agents || tools?.length) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {picker ? (
                <span className="inline-flex shrink-0 items-center">
                  {source && <WhereChip source={source} short />}
                  {picker}
                </span>
              ) : (
                source && <WhereChip source={source} />
              )}
              {agents && <AgentsChip agents={agents} />}
              {tools?.length ? <ToolsChip tools={tools} /> : null}
            </div>
          )}
        </div>
      )}
      <ModifiedContext value={{ only, report }}>
        <Card>
          {children}
          {only && modified.size === 0 && <p className="py-3 text-xs text-subtle">{t("settings.noneModified")}</p>}
        </Card>
      </ModifiedContext>
    </section>
  );
}

/**
 * The card frame of a section (and of loose cards like the skills archive): `group/card` with
 * `data-narrow` below 28rem (lib/narrowCard + lib/sizeFlags; deliberately no CSS size container, see there). A render
 * error inside shows in the card with a retry instead of taking the page down.
 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  const compact = useContext(CompactContext);
  className ??= compact ? "rounded-lg border border-card-border bg-surface px-3" : "rounded-xl border border-card-border bg-surface px-4 py-1";
  const [ref, flags] = useSizeFlags(CARD_FLAGS);
  return (
    <div ref={ref} {...dataFlags(flags)} className={`group/card ${className}`}>
      <CardBoundary>{children}</CardBoundary>
    </div>
  );
}

/** Catches a render error of one card's content: the error text + 重试, logged like an uncaught one (errors.jsonl). */
export class CardBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const stack = [error.stack, info.componentStack].filter(Boolean).join("\n");
    void bridge?.shell?.logError({ kind: "error", message: `[settings card] ${error.message}`, stack }).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <CardError message={this.state.error.message || String(this.state.error)} onRetry={() => this.setState({ error: null })} />;
  }
}

function CardError({ message, onRetry }: { message: string; onRetry(): void }) {
  const { t } = useI18n();
  return (
    <div role="alert" data-card-error="" className="flex items-start gap-2 py-2.5 text-xs text-danger">
      <span className="min-w-0 flex-1 break-words select-text">{t("settings.cardError", { message })}</span>
      <button type="button" onClick={onRetry} className={`shrink-0 rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-foreground ${FOCUS}`}>
        {t("settings.cardRetry")}
      </button>
    </div>
  );
}

/**
 * Compact layout for the same cards outside the settings page: a 在主界面调整 panel (components/
 * CustomizeHost). Smaller titles, tighter rows and card padding; marks, 恢复默认 and 「只看你修改过的设置」
 * behave as on the page.
 */
const CompactContext = createContext(false);

export function CompactSettings({ children }: { children: ReactNode }) {
  return <CompactContext value={true}>{children}</CompactContext>;
}

/** True inside a 在主界面调整 panel: a page shared with it leaves out what the panel must not hold (host settings). */
export function useCompactSettings(): boolean {
  return useContext(CompactContext);
}

/** Which rows a card shows (Section's 「只看你修改过的设置」) and how its rows report being modified. */
const ModifiedContext = createContext<{ only: boolean; report(id: string, modified: boolean): void } | null>(null);

/**
 * The one settings row: label (+ hint, + optional sample) | control column (right-aligned); the card's
 * right margin is as narrow as its left (owner 2026-10-18: no reset column). `reset` is a ResetButton:
 * while it is enabled the setting is modified, shown by a short bar at the card's inner left edge (our
 * mark for 「改过」), and 「↺ 恢复默认」 appears after the label on hover / keyboard focus, so the control
 * never moves. In a narrow card (< 28rem) the controls drop under the label, left-aligned.
 */
export function SettingRow({ label, hint, children, reset, sample }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; reset?: ReactNode; sample?: ReactNode }) {
  const id = useId();
  const labelId = `${id}l`;
  const hintId = hint ? `${id}h` : undefined;
  const reset$ = isValidElement<{ disabled?: boolean; onClick(): void; title?: string }>(reset) ? reset.props : null;
  const modified = !!reset$ && !reset$.disabled;
  const card = useContext(ModifiedContext);
  const compact = useContext(CompactContext);
  const report = card?.report;
  useEffect(() => {
    if (!report) return;
    report(id, modified);
    return () => report(id, false);
  }, [report, id, modified]);
  if (card?.only && !modified) return null;
  return (
    <div
      data-setting-row=""
      data-modified={modified ? "" : undefined}
      className={`group/row relative grid grid-cols-[minmax(9rem,1fr)_auto] gap-x-3 border-b border-border/60 last:border-b-0 group-data-[narrow]/card:grid-cols-[minmax(0,1fr)] ${compact ? "gap-y-1 py-2" : "gap-y-1.5 py-3"} ${sample ? "items-start" : "items-center"}`}
    >
      <div className="relative min-w-0">
        {modified && <ModifiedMark compact={compact} />}
        <div id={labelId} className="text-sm">
          {/* The restore button floats after the label: showing / hiding it never reflows the row. */}
          <span className="relative">
            {label}
            {modified && <RestoreDefault onClick={reset$!.onClick} title={reset$!.title} />}
          </span>
        </div>
        {hint && (
          <div id={hintId} className="text-xs text-subtle">
            {hint}
          </div>
        )}
        {sample}
      </div>
      <RowA11yContext value={{ labelId, hintId }}>
        <div className="flex min-w-0 items-center justify-end gap-2 group-data-[narrow]/card:row-start-2 group-data-[narrow]/card:flex-wrap group-data-[narrow]/card:justify-start">
          {children}
        </div>
      </RowA11yContext>
    </div>
  );
}

/**
 * The 「改过」 mark: a short accent bar (14px) at the card's inner left edge, level with the label's first
 * line (owner 2026-10-18: H4 for now; diamond / triangle variants stay in /settings-variants.html).
 * Rows sit in the card's 1rem padding (compact: 0.75rem), so minus that is the inner edge.
 */
function ModifiedMark({ compact }: { compact: boolean }) {
  const { t } = useI18n();
  return <span role="img" aria-label={t("settings.modified")} title={t("settings.modified")} className={`absolute top-[3px] h-3.5 w-0.5 rounded-r bg-accent ${compact ? "-left-3" : "-left-4"}`} />;
}

/** 「↺ 恢复默认」 after a modified row's label: shown on row hover and while it has keyboard focus. */
function RestoreDefault({ onClick, title }: { onClick(): void; title?: string }) {
  const { t } = useI18n();
  const label = title ?? t("appearance.reset");
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 left-full z-10 ml-1.5 inline-flex h-5 -translate-y-1/2 items-center gap-1 rounded bg-surface px-1 text-[11px] whitespace-nowrap text-subtle opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 ${FOCUS}`}
    >
      <RotateCcw size={12} aria-hidden />
      {t("appearance.reset")}
    </button>
  );
}

/** A link-styled text button with a trailing →, e.g. a page header's related page. */
export function TextLink({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 rounded text-xs text-accent hover:underline ${FOCUS}`}>
      {children}
      <ArrowRight size={12} aria-hidden />
    </button>
  );
}

/** A link-styled way back with a leading ‹, e.g. 主机's 「‹ 所有设备」. */
export function BackLink({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button type="button" data-settings-back onClick={onClick} className={`-ml-0.5 inline-flex items-center gap-0.5 rounded text-xs text-accent hover:underline ${FOCUS}`}>
      <ChevronLeft size={13} aria-hidden />
      {children}
    </button>
  );
}

/**
 * 「详细信息」: developer facts of a card (hashes, sequences, paths, channels) folded at its end, so the
 * card leads with what a person acts on. Collapsed by default; the rows inside are ordinary SettingRows.
 */
export function Details({ children, label }: { children: ReactNode; label?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="border-b border-border/60 last:border-b-0" data-details={open ? "open" : "closed"}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={`-mx-1 my-1.5 flex items-center gap-1 rounded px-1 py-1 text-xs text-muted hover:text-foreground ${FOCUS}`}>
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        {label ?? t("settings.details")}
      </button>
      {open && (
        <div id={id} className="border-t border-border/60">
          {children}
        </div>
      )}
    </div>
  );
}

/** "Change this elsewhere →": a row whose whole right side is one link. */
export function LinkRow({ label, hint, link, onClick }: { label: ReactNode; hint?: ReactNode; link: string; onClick(): void }) {
  return (
    <SettingRow label={label} hint={hint}>
      <button onClick={onClick} className={`rounded text-xs text-accent hover:underline ${FOCUS}`}>
        {link}
      </button>
    </SettingRow>
  );
}

/** A text action inside a SettingRow hint (「恢复官方地址」…): link-styled, so the control column never shifts. */
export function HintAction({ children, onClick, title, disabled }: { children: ReactNode; onClick(): void; title?: string; disabled?: boolean }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`ml-1.5 rounded text-accent hover:underline disabled:opacity-40 ${FOCUS}`}>
      {children}
    </button>
  );
}

/** Reset-to-default for a SettingRow's reset slot (invisible while there is nothing to reset). */
export function ResetButton({ disabled, onClick, title }: { disabled?: boolean; onClick(): void; title?: string }) {
  const { t } = useI18n();
  const label = title ?? t("appearance.reset");
  return (
    <button title={label} aria-label={label} disabled={disabled} onClick={onClick} className={`rounded p-1 text-subtle hover:bg-surface-2 hover:text-foreground disabled:invisible ${FOCUS}`}>
      <RotateCcw size={13} />
    </button>
  );
}

/** Icon-only button (refresh / add / remove…): always has an accessible name and a tooltip. */
export function IconButton({ label, onClick, disabled, children, danger }: { label: string; onClick(e: React.MouseEvent<HTMLButtonElement>): void; disabled?: boolean; children: ReactNode; danger?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface-2 disabled:opacity-40 ${danger ? "hover:text-danger" : "hover:text-foreground"} ${FOCUS}`}
    >
      {children}
    </button>
  );
}

export function RefreshButton({ onClick, disabled, label }: { onClick(): void; disabled?: boolean; label?: string }) {
  const { t } = useI18n();
  return (
    <IconButton label={label ?? t("settings.reload")} disabled={disabled} onClick={onClick}>
      <RotateCw size={14} />
    </IconButton>
  );
}

/** Remove with click-twice confirmation: the first click arms (red "click again"), the second removes. */
export function ArmedRemove({ title, disabled, onRemove, armedLabel }: { title: string; disabled?: boolean; onRemove(): void; armedLabel?: string }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed();
  return armed ? (
    <button disabled={disabled} onClick={() => (setArmed(false), onRemove())} className={`${ARMED_BUTTON} flex h-6 shrink-0 items-center whitespace-nowrap ${FOCUS}`}>
      {armedLabel ?? t("settings.removeArmed")}
    </button>
  ) : (
    <IconButton label={title} danger disabled={disabled} onClick={() => setArmed(true)}>
      <X size={14} />
    </IconButton>
  );
}

/** "+ Add …" text button with the lucide Plus (`primary`: the main add action of a card). */
export function AddButton({ children, onClick, disabled, title, primary }: { children: ReactNode; onClick(e: React.MouseEvent<HTMLButtonElement>): void; disabled?: boolean; title?: string; primary?: boolean }) {
  return (
    <Button onClick={onClick} disabled={disabled} title={title} primary={primary}>
      <Plus size={13} className="mr-1 -ml-0.5 inline align-[-2px]" />
      {children}
    </Button>
  );
}

/**
 * One entity in a list (host, MCP server, model, price, domain pair…): optional leading mark, a
 * name and one grey detail line, icon actions on the right; `below` for anything that expands.
 */
export function ListRow({ leading, title, detail, actions, below, frame }: { leading?: ReactNode; title: ReactNode; detail?: ReactNode; actions?: ReactNode; below?: ReactNode; frame?: string }) {
  return (
    <div className={`-mx-4 border-b border-border px-4 py-2 last:border-b-0 ${frame ?? ""}`}>
      <div className="flex min-h-7 items-center gap-2.5">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{title}</div>
          {detail && <div className="truncate text-xs text-subtle">{detail}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {below}
    </div>
  );
}

/** Skeleton rows while a page or section loads (instead of a bare "…"). */
export function Loading({ rows = 2 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t("settings.loading")} data-settings-loading="" className="py-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
          <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
          <div className="ml-auto h-5 w-24 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="py-2 text-xs text-danger">
      {children}
    </p>
  );
}

/** A warning / info line inside a card (restart needed, mode notes…). */
export function Notice({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "info" }) {
  return <p className={`py-2 text-xs ${tone === "warn" ? "text-warn" : "text-subtle"}`}>{children}</p>;
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <p className="min-w-0 flex-1 text-xs text-subtle">{children}</p>
      {action}
    </div>
  );
}

/** A part that waits on a cutex route: what it will hold, and which API it needs. */
export function PlannedCard({ api, children }: { api: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="py-2.5">
      <p className="text-sm text-muted">{children}</p>
      <p className="mt-1 text-xs text-subtle">{t("settings.pendingCutex", { api })}</p>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, disabled, label, accent }: { value: T; options: { value: NoInfer<T>; label: string; /** What the choice means, as a tooltip (the row hint says what the setting is). */ title?: string }[]; onChange(v: NoInfer<T>): void; disabled?: boolean; label?: string; /** The choice in the accent colour (通知 → 事件分级 only, owner 2026-10-19: a column of choices reads at a glance). */ accent?: boolean }) {
  const aria = useRowA11y(label);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div role="radiogroup" {...aria} aria-disabled={disabled || undefined} className={`flex shrink-0 rounded-lg bg-surface-2 p-0.5 ${disabled ? "opacity-50" : ""}`}>
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={on}
            title={o.title}
            tabIndex={i === selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const next = radioKeyTarget(e.key, i, options.length);
              if (next === null) return;
              e.preventDefault();
              refs.current[next]?.focus();
              onChange(options[next]!.value);
            }}
            className={`rounded-md px-2.5 py-1 text-xs whitespace-nowrap ${FOCUS} ${on ? (accent ? "bg-accent text-white shadow-sm" : "bg-raised text-foreground shadow-sm ring-1 ring-border") : "text-muted hover:text-foreground"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Raw controlled text input, for draft forms (add host, add MCP server…) that save with a button. */
export function TextInput({ value, onChange, placeholder, mono, width = "w-64", disabled, type = "text", maxLength, label, onBlur, onKeyDown, autoFocus }: { value: string; onChange(v: string): void; placeholder?: string; mono?: boolean; width?: string; disabled?: boolean; type?: "text" | "password"; maxLength?: number; label?: string; onBlur?(): void; onKeyDown?(e: React.KeyboardEvent<HTMLInputElement>): void; autoFocus?: boolean }) {
  const aria = useRowA11y(label);
  return (
    <input
      type={type}
      {...aria}
      autoComplete={type === "password" ? "off" : undefined}
      value={value}
      autoFocus={autoFocus}
      disabled={disabled}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={`${width} ${FIELD} ${mono ? "font-mono text-xs" : ""}`}
    />
  );
}

/** Raw controlled multi-line input for draft forms (one value per line: MCP args…). */
export function TextArea({ value, onChange, placeholder, mono, width = "w-64", rows = 3, disabled, label }: { value: string; onChange(v: string): void; placeholder?: string; mono?: boolean; width?: string; rows?: number; disabled?: boolean; label?: string }) {
  const aria = useRowA11y(label);
  return (
    <textarea
      {...aria}
      value={value}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      spellCheck={false}
      wrap={mono ? "off" : "soft"}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} resize-y ${FIELD} ${mono ? "font-mono text-xs" : ""}`}
    />
  );
}

/**
 * A text setting saved on commit (Enter or blur), never per keystroke; Esc restores the saved
 * value. After a successful commit "已保存" shows briefly next to the field.
 */
export function TextField({ value, onCommit, placeholder, mono, width = "w-64", disabled, maxLength, label }: { value: string; onCommit(v: string): Promise<unknown> | void; placeholder?: string; mono?: boolean; width?: string; disabled?: boolean; maxLength?: number; label?: string }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const commit = async () => {
    if (draft === null) return;
    const next = draft;
    setDraft(null);
    if (next === value) return;
    await onCommit(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <>
      {saved && <span className="text-xs text-subtle">{t("settings.saved")}</span>}
      <TextInput
        label={label}
        mono={mono}
        width={width}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        value={draft ?? value}
        onChange={setDraft}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
    </>
  );
}

/**
 * A number setting: optional slider + a number box + unit suffix. The box keeps what is typed as a
 * draft and applies it (clamped) on Enter / blur, so typing "120" never applies 1 → 12 → 120.
 */
/**
 * A number with an optional slider. `commitOnRelease`: the slider applies only when let go (pointer up,
 * key up, blur) and shows the value it is dragged to meanwhile, for a value that moves the slider itself
 * while it applies (界面缩放 rescales the whole window, the thumb ran away from the pointer).
 */
export function NumberField({ value, range, unit, step = 1, slider, onCommit, disabled, label, placeholder, commitOnRelease }: { value: number | null; range: readonly [number, number]; unit?: string; step?: number; slider?: boolean; onCommit(v: number | null): void; disabled?: boolean; label?: string; placeholder?: string; commitOnRelease?: boolean }) {
  const aria = useRowA11y(label);
  const [draft, setDraft] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const release = () => {
    if (dragging === null) return;
    if (dragging !== value) onCommit(dragging);
    setDragging(null);
  };
  const shown = dragging ?? value;
  const commit = () => {
    if (draft === null) return;
    const n = parseClamped(draft, range);
    if (n !== value && (n !== null || draft.trim() === "")) onCommit(n);
    setDraft(null);
  };
  return (
    <>
      {slider && (
        <input
          type="range"
          {...aria}
          min={range[0]}
          max={range[1]}
          step={step}
          value={shown ?? range[0]}
          disabled={disabled}
          onChange={(e) => (commitOnRelease ? setDragging(Number(e.target.value)) : onCommit(Number(e.target.value)))}
          onPointerUp={commitOnRelease ? release : undefined}
          onKeyUp={commitOnRelease ? release : undefined}
          onBlur={commitOnRelease ? release : undefined}
          className={`w-40 accent-[var(--accent)] ${FOCUS}`}
        />
      )}
      <input
        type="text"
        inputMode="numeric"
        {...aria}
        disabled={disabled}
        placeholder={placeholder}
        value={draft ?? (shown === null ? "" : String(shown))}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        className={`w-16 text-right tabular-nums ${FIELD} py-0.5 text-xs`}
      />
      {unit !== undefined && <span className="w-6 text-xs text-subtle">{unit}</span>}
    </>
  );
}

/**
 * Colour palette picker (外观 → 浅色 / 深色配色): a wrapping row of choices, each a two-tone dot (page and
 * card colour) and its name; a radio group, arrow keys move the choice.
 */
export function SwatchPicker<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; colors: readonly [string, string] }[]; onChange(v: T): void; label?: string }) {
  const aria = useRowA11y(label);
  return (
    <div role="radiogroup" {...aria} className="flex max-w-[30rem] flex-wrap justify-end gap-1.5">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const next = radioKeyTarget(e.key, i, options.length);
              if (next === null) return;
              e.preventDefault();
              onChange(options[next]!.value);
              (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs ${on ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted hover:text-foreground"} ${FOCUS}`}
          >
            <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-border" style={{ background: `linear-gradient(135deg, ${o.colors[0]} 50%, ${o.colors[1]} 50%)` }} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Fixed-width select (`width`: a FIELD_W token, default generic); long labels truncate with a tooltip. */
export function Select<T extends string>({ value, options, onChange, disabled, width = FIELD_W.generic, label }: { value: T; options: { value: NoInfer<T>; label: string; disabled?: boolean }[]; onChange(v: NoInfer<T>): void; disabled?: boolean; width?: string; label?: string }) {
  const aria = useRowA11y(label);
  const current = options.find((o) => o.value === value)?.label;
  return (
    <select {...aria} value={value} disabled={disabled} title={current} onChange={(e) => onChange(e.target.value as T)} className={`${width} truncate ${FIELD}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; label?: string }) {
  const aria = useRowA11y(label);
  return (
    <button
      role="switch"
      {...aria}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${FOCUS} ${checked ? "bg-accent" : "bg-surface-2 ring-1 ring-border ring-inset"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/**
 * A check box (several independent picks in a table or list: delivery channels, grants, "remember
 * this person"); one on/off setting in a row is a `Toggle`. Same look as the notification matrix.
 * Inside a `<label>` the label text toggles it too.
 */
export function Checkbox({ checked, onChange, disabled, label }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-40 ${FOCUS} ${checked ? "border-accent bg-accent text-white" : "border-border bg-background hover:border-accent/70"}`}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

/**
 * A boolean setting that may be left at a default: one switch showing the effective value and a ↺
 * in the reset slot, visible only while a value is stored (`explicit`). Switching always stores a
 * value; ↺ clears it (`onReset`). `resetTitle` names the default (「恢复默认（开）」).
 */
export function DefaultableToggleRow({ label, hint, checked, explicit, onChange, onReset, disabled, resetTitle }: { label: ReactNode; hint?: ReactNode; checked: boolean; explicit: boolean; onChange(v: boolean): void; onReset(): void; disabled?: boolean; resetTitle: string }) {
  return (
    <SettingRow label={label} hint={hint} reset={<ResetButton disabled={disabled || !explicit} onClick={onReset} title={resetTitle} />}>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} />
    </SettingRow>
  );
}

export function Button({ children, onClick, primary, disabled, title }: { children: ReactNode; onClick(e: React.MouseEvent<HTMLButtonElement>): void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`shrink-0 rounded-md px-3 py-1 text-xs whitespace-nowrap disabled:opacity-40 ${FOCUS} ${primary ? "bg-accent font-medium text-white" : "border border-border hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}
