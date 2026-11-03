// Form primitives shared by the Settings pages (docs/research/settings-audit-20261008.md §4).
//
// Save semantics — exactly three, one per field:
//   • immediate: Toggle / Segmented / Select apply on change;
//   • on commit: TextField / NumberField apply on Enter or blur (never per keystroke);
//   • draft + save bar: multi-field forms that validate together (Profile detail).
// Rows: every setting is a `SettingRow` (label + hint | control column | reset slot), so controls
// line up on one right edge on every page; entity lists use `ListRow` with click-twice removal.
import { Children, Component, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { bridge } from "../../bridge";
import { CARD_FLAGS } from "../../lib/narrowCard";
import { dataFlags, useSizeFlags } from "../../lib/sizeFlags";
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Info, Layers, Monitor, Plus, RotateCcw, RotateCw, Server, Wrench, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { isImeComposing } from "../../lib/ime";
import { graphemeCount } from "../../lib/graphemes";
import { ARMED_BUTTON, useArmed } from "../../lib/armedConfirm";
import { FIELD_W } from "../../lib/fieldWidths";
import { parseClamped, radioKeyTarget, RowA11yContext, useRowA11y } from "../../lib/formA11y";
import type { SettingsAgents, SettingsSource } from "../../lib/settingsNav";
import { SETTINGS_EFFECT_EXEMPTIONS } from "../../lib/settingsEffectPolicy";
import { useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";
import { Tag } from "../../components/Tag";
import { btn } from "../Button";
import { AgentTimingIcon } from "./AgentTimingIcon";
import { useOwnerWindow } from "../../lib/ownerContext";
import { ownerWindowOf } from "../../lib/ownerWindow";

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
    <span title={title} className={`inline-flex h-5 shrink-0 items-center rounded px-1.5 text-caption/[inherit] whitespace-nowrap ${tone}`}>
      {label}
    </span>
  );
}

/** Every field states its effect. Read-only values keep scope only; navigation contributes neither axis. */
export type SettingEffect = { agents: SettingsAgents; source: SettingsSource | readonly SettingsSource[]; allHosts?: boolean; readOnly?: boolean; navigation?: boolean };
type Timing = SettingsAgents | "mixed";
type Scope = string;
type RowMetadata = Partial<SettingEffect> & { hostId?: string; sourceKey?: string };
function sourceKey(source: SettingEffect["source"] | undefined): string | undefined {
  return Array.isArray(source) ? [...new Set(source)].sort().join("|") : source as SettingsSource | undefined;
}
function scopeOf(row: RowMetadata): Scope | undefined {
  if (row.allHosts) return "allHosts";
  return sourceKey(row.source)?.split("|").map(source => source === "local" ? "local" : `${source}:${row.hostId ?? ""}`).sort().join("|");
}

type MetadataReport = (id: string, value: RowMetadata | null) => void;
const PageMetadataReportContext = createContext<MetadataReport | null>(null);
const CardMetadataReportContext = createContext<readonly MetadataReport[]>([]);
const EffectPlacementContext = createContext<{ timingStated: boolean; scopeStated: boolean; scopeBaseline?: Scope }>({ timingStated: false, scopeStated: false });
const FormFieldsContext = createContext(false);

/** One-shot drafts are form fields, not settings: no scope/effect badges or metadata summaries.
 * Labels sit above their controls so creation forms and dialogs fit narrow panes too. */
export function FormFields({ children }: { children: ReactNode }) {
  return <FormFieldsContext value={true}>{children}</FormFieldsContext>;
}

function summarize(rows: ReadonlyMap<string, RowMetadata>) {
  const values = [...rows.values()];
  const editable = values.filter(row => !row.readOnly);
  const timings = new Set(editable.map(row => row.agents));
  const scopes = new Set(values.map(scopeOf));
  return {
    timing: !editable.length ? undefined : timings.size === 1 && !timings.has(undefined) ? editable[0]!.agents : "mixed" as const,
    scope: !values.length ? undefined : scopes.size === 1 && !scopes.has(undefined) ? scopes.values().next().value : "mixed" as const,
  };
}

function useMetadataRows() {
  const [rows, setRows] = useState<ReadonlyMap<string, RowMetadata>>(new Map());
  const report = useCallback<MetadataReport>((id, value) => {
    setRows(previous => {
      const old = previous.get(id);
      if (previous.has(id) === !!value && old?.agents === value?.agents && old?.readOnly === value?.readOnly && old?.sourceKey === value?.sourceKey && old?.allHosts === value?.allHosts && old?.hostId === value?.hostId) return previous;
      const next = new Map(previous);
      if (value) next.set(id, value); else next.delete(id);
      return next;
    });
  }, []);
  return [rows, report] as const;
}

function useRowMetadata(value: RowMetadata | null) {
  const form = useContext(FormFieldsContext);
  const id = useId();
  const page = useContext(PageMetadataReportContext);
  const card = useContext(CardMetadataReportContext);
  const targetHostId = useTargetHostId();
  const key = sourceKey(value?.source);
  const hostId = key && key !== "local" && !value?.allHosts ? targetHostId : undefined;
  const active = !form && value !== null && !value.navigation;
  const agents = value?.agents, source = value?.source, allHosts = value?.allHosts, readOnly = value?.readOnly;
  useLayoutEffect(() => {
    const metadata = active ? { agents, source, allHosts, readOnly, hostId, sourceKey: key } : null;
    page?.(id, metadata); for (const report of card) report(id, metadata);
    return () => { page?.(id, null); for (const report of card) report(id, null); };
  }, [page, card, id, active, agents, key, allHosts, readOnly, hostId]);
  return hostId;
}
/** Host selection is navigation, never an effect declaration. */
const PartPickerContext = createContext<ReactNode>(null);
export function PartSource({ picker, children }: { picker?: ReactNode; children: ReactNode }) {
  return <PartPickerContext value={picker ?? null}>{children}</PartPickerContext>;
}

const CHIP = "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-chip px-1.5 text-caption leading-none whitespace-nowrap";
const CHIP_TONE = { plain: "bg-surface-2 text-muted", quiet: "bg-surface-2 text-subtle", host: "bg-accent-soft text-accent", agents: "bg-attention-soft text-warn-text" } as const;

/** A scope chip: a click floats a short explanation under it; an outside click or Esc closes it. */
/** `joined`: the left half of a tag whose right half is a host picker (HostPicker `chip`), e.g. 「cutex 后端 · ● HOST-A ▾」. */
export function ScopeChip({ tone, icon, label, title, body, joined, timing }: { tone: keyof typeof CHIP_TONE; icon: ReactNode; label: string; title: string; body: string; joined?: boolean; timing?: { kind: Timing; presentation: "header" | "row"; short: string } }) {
  const win = useOwnerWindow();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const visible = open || (!!timing && hovered);
  const ref = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const id = useId();
  useEffect(() => {
    if (!visible) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) { setOpen(false); setHovered(false); }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setHovered(false); }
    };
    win.document.addEventListener("mousedown", down);
    win.document.addEventListener("keydown", key);
    return () => {
      win.document.removeEventListener("mousedown", down);
      win.document.removeEventListener("keydown", key);
    };
  }, [visible, win]);
  // The popover lives in a portal, fixed under its chip (above it when there is no room below): each row's marker
  // strip is its own stacking context (relative z-10), so an in-row popover went under the next row's chips (owner
  // 2026-10-25: 「下次启动生效」's popover had 内置网页搜索's icon on top of it). In a modal <dialog> (the top layer) the
  // portal goes into that dialog, else into the body.
  useLayoutEffect(() => {
    setLayer(visible ? (ref.current?.closest("dialog") ?? win.document.body) : null);
  }, [visible, win]);
  useLayoutEffect(() => {
    if (!visible || !layer) { setAt(null); return; }
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      const box = pop.current;
      if (!r || !box) return;
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const left = Math.max(8, Math.min(r.left, win.innerWidth - w - 8));
      const below = r.bottom + 6;
      setAt({ left, top: below + h > win.innerHeight - 8 && r.top - 6 - h >= 8 ? r.top - 6 - h : below });
    };
    place();
    win.addEventListener("resize", place);
    win.addEventListener("scroll", place, true);
    return () => {
      win.removeEventListener("resize", place);
      win.removeEventListener("scroll", place, true);
    };
  }, [visible, layer, win]);
  return (
    <span ref={ref} className="relative inline-flex align-middle" onMouseEnter={timing ? () => setHovered(true) : undefined} onMouseLeave={timing ? () => setHovered(false) : undefined}>
      <button type="button" aria-label={timing ? label : undefined} aria-expanded={visible} aria-controls={id} data-settings-agents={timing?.kind} data-timing-presentation={timing?.presentation} onClick={() => setOpen((v) => !v)} className={timing ? `inline-flex shrink-0 cursor-pointer items-center gap-1 rounded p-0.5 text-xs font-normal ${timing.kind === "none" || timing.kind === "mixed" || timing.kind === "access" ? "text-subtle" : "text-warn-text"} hover:bg-hover ${FOCUS}` : `${CHIP} ${CHIP_TONE[tone]} cursor-pointer hover:brightness-125 ${joined ? "rounded-r-none pr-1" : ""} ${FOCUS}`}>
        {icon}
        {timing ? timing.presentation === "header" && <span className="text-muted">{timing.short}</span> : label}
      </button>
      {visible && layer && createPortal(
        // React events bubble through the portal to the chip: hovering the popover keeps it open.
        <span ref={pop} id={id} role="note" data-popover="" style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? "visible" : "hidden" }} className="fixed z-[60] w-72 rounded-lg border border-border bg-raised p-3 text-xs shadow-lg">
          <span className="mb-1 block font-medium text-foreground">{title}</span>
          <span className="block leading-relaxed text-muted">{body}</span>
        </span>,
        layer,
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
function WhereChip({ source, short, except, shown, hostId: scopedHostId }: { source: SettingsSource | undefined; hostId?: string; short?: boolean; except?: boolean; /** On a 混合设置 header: the host the page's host cards show. */ shown?: boolean }) {
  const { t } = useI18n();
  const targetHostId = useTargetHostId();
  const hostId = scopedHostId ?? targetHostId;
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
 * Whether (and when) agents feel a setting. Uniform pages use one header label; mixed pages use row icons.
 * Display settings stay grey; behavior settings use the robot with a timing badge and a full popover.
 */
function AgentsChip({ agents, presentation = "header" }: { agents: Timing; presentation?: "header" | "row" }) {
  const { t } = useI18n();
  return <ScopeChip tone="plain" timing={{ kind: agents, presentation, short: t(`settings.scope.agents.${agents}.short`) }} icon={<AgentTimingIcon timing={agents} />} label={t(`settings.scope.agents.${agents}`)} title={t(`settings.scope.agents.${agents}.title`)} body={t(`settings.scope.agents.${agents}.body`)} />;
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

/** A marker is placed only by the shared renderer, using summarized row data. */
function EffectScope({ scope, picker }: { scope: Scope; picker?: ReactNode }) {
  const { t } = useI18n();
  // A multi-place scope lists each place. A host page's picker (navigation, not a place) still follows them: the
  // host places go last and the last one becomes its left half (「这台桌面应用  主机 · ● HOST-A ▾」).
  if (scope.includes("|")) {
    const parts = scope.split("|");
    const hosted = picker ? parts.filter(part => part.startsWith("host:") || part.startsWith("codex:")) : [];
    const joined = hosted.at(-1);
    return <span data-effect-scope-marker={scope} className="inline-flex flex-wrap items-center gap-1">
      {[...parts.filter(part => !hosted.includes(part)), ...hosted].map(part => <EffectScope key={part} scope={part} picker={part === joined ? picker : undefined} />)}
      {!joined && picker}
    </span>;
  }
  const [place, ...hostParts] = scope.split(":");
  const hostId = hostParts.join(":");
  const source = place === "host" || place === "codex" ? place : scope === "local" ? "local" : undefined;
  return <span data-effect-scope-marker={scope} className="inline-flex items-center">
    {scope === "allHosts" ? <ScopeChip tone="host" icon={<Server size={11} aria-hidden />} label={t("hostPicker.allHosts")} title={t("hostPicker.allHosts")} body={t("hostPicker.allHosts")} /> : <WhereChip hostId={hostId || undefined} source={source} short={!!picker && !!source && source !== "local"} />}
    {picker}
  </span>;
}
function EffectMarkers({ agents, source, allHosts, readOnly, row = false }: RowMetadata & { row?: boolean }) {
  const form = useContext(FormFieldsContext);
  const placement = useContext(EffectPlacementContext);
  const hostId = useTargetHostId();
  const scope = scopeOf({source, allHosts, hostId});
  const showScope = !!scope && !placement.scopeStated && scope !== placement.scopeBaseline;
  const showTiming = !!agents && !placement.timingStated;
  if (form || readOnly || (!showScope && !showTiming)) return null;
  return <span className="relative z-10 col-span-full ml-1 inline-flex flex-wrap items-center gap-1 align-middle" data-effect-markers={row ? "row" : "card"}>
    {showScope && scope && <EffectScope scope={scope} />}
    {showTiming && agents && <AgentsChip agents={agents} presentation={row ? "row" : "header"} />}
  </span>;
}

/**
 * Page header: what the page is for (`hint`, one line) and the scope chips. The page name is in the
 * breadcrumb. `host`: the host picker of a host page (multi-host). `link`: a related page at the
 * header's end (the page item's `headerLink`, e.g. 运行时 → 后端更新). `back`: a way back above it all
 * (the page item's `backLink`, e.g. 主机 → ‹ 所有设备).
 */
export function SettingsPage({ page, hint, host, link, back, children }: { page?: string; back?: ReactNode; hint?: ReactNode; host?: ReactNode; link?: ReactNode; children: ReactNode }) {
  const [rows, reportRows] = useMetadataRows();
  const summary = summarize(rows);
  const exemption = page ? SETTINGS_EFFECT_EXEMPTIONS[page] : undefined;
  const scopes = new Map<Scope, number>();
  if (exemption?.scope === "baseline" && summary.scope === "mixed") for (const row of rows.values()) {
    const scope = scopeOf(row); if (scope) scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
  }
  const scopeBaseline = [...scopes].sort((a, b) => b[1] - a[1])[0]?.[0];
  const headerScope = scopeBaseline ?? summary.scope;
  const placement = { timingStated: !!summary.timing && summary.timing !== "mixed", scopeStated: !!summary.scope && summary.scope !== "mixed", scopeBaseline };
  return <>
    <div data-settings-header data-settings-page={page} data-effect-exemption={exemption ? page : undefined} className="mb-5 space-y-1.5 border-b border-border/60 pb-3">
      {back && <div className="-mt-1 flex h-5 items-center">{back}</div>}
      {(hint || link) && <div className="flex min-h-5 items-start gap-3">{hint && <p className="min-w-0 text-ui/[inherit] text-muted">{hint}</p>}{link && <span className="-my-1.5 ml-auto flex shrink-0 items-center">{link}</span>}</div>}
      <div data-settings-scope={summary.scope} className="flex min-h-6 flex-wrap items-center gap-1.5">
        {headerScope && <EffectScope scope={headerScope} picker={host} />}
        {!headerScope && host}
        {summary.timing && <AgentsChip agents={summary.timing} />}
      </div>
    </div>
    <PageMetadataReportContext value={reportRows}><EffectPlacementContext value={placement}>{children}</EffectPlacementContext></PageMetadataReportContext>
  </>;
}

/** Shared placement for styled settings sections and existing dashboard cards. */
function useCardEffects(hasTitle = true) {
  const [rowMetadata, reportMetadata] = useMetadataRows();
  const parentPlacement = useContext(EffectPlacementContext);
  const parentReports = useContext(CardMetadataReportContext);
  const reports = useMemo(() => [...parentReports, reportMetadata], [parentReports, reportMetadata]);
  const summary = summarize(rowMetadata);
  const timing = hasTitle && !parentPlacement.timingStated && summary.timing !== "mixed" ? summary.timing : undefined;
  const coveredScope = !!summary.scope && summary.scope === parentPlacement.scopeBaseline;
  const scope = hasTitle && !parentPlacement.scopeStated && !coveredScope && summary.scope !== "mixed" ? summary.scope : undefined;
  const placement = { ...parentPlacement, timingStated: parentPlacement.timingStated || !!timing, scopeStated: parentPlacement.scopeStated || coveredScope || !!scope };
  return { scope, timing, placement, reports };
}

/** Adds mechanical summaries to an existing card without changing its layout or making defaults. */
function hasCardTitle(node: ReactNode): boolean {
  return Children.toArray(node).some(child => isValidElement<{ children?: ReactNode }>(child) && (child.type === "h3" || hasCardTitle(child.props.children)));
}
function withCardMarkers(node: ReactNode, marker: ReactNode): ReactNode {
  let placed = false;
  const insert = (value: ReactNode): ReactNode => Children.map(value, child => {
    if (placed || !isValidElement<{ children?: ReactNode; className?: string }>(child)) return child;
    if (child.type === "h3") {
      placed = true;
      return cloneElement(child, { className: `${child.props.className ?? ""} inline-flex items-center gap-2`, children: <>{child.props.children}{marker}</> });
    }
    return child.props.children ? cloneElement(child, { children: insert(child.props.children) }) : child;
  });
  return insert(node);
}

export function SettingsEffectCard({ children }: { children: ReactElement<{ children?: ReactNode }> }) {
  const { scope, timing, placement, reports } = useCardEffects(hasCardTitle(children));
  const marker = scope || timing ? <span className="inline-flex flex-wrap items-center gap-1.5" data-effect-card-summary="">
    {scope && <EffectScope scope={scope} />}{timing && <AgentsChip agents={timing} />}
  </span> : null;
  return <EffectPlacementContext value={placement}><CardMetadataReportContext value={reports}>
    {withCardMarkers(children, marker)}
  </CardMetadataReportContext></EffectPlacementContext>;
}

/**
 * A card with a title row (title · scope chips · actions on the right) and a one-line hint. `source` /
 * storage scope only repeats when it differs from the page. Timing defaults describe the rows;
 * the page summarizes their metadata, with row icons only when the page is mixed.
 */
export function Section({ title, hint, children, actions, id, tag, picker, tools, sub, collapsed }: { title?: ReactNode; collapsed?: boolean; hint?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string; /** A muted label after the title, e.g. 旧版 for a card that will be redone (title = tooltip). */ tag?: { label: string; title?: string }; /** A host card's host picker before its (then short) source chip (components/SettingsHostFrame SettingsHostSection). */ picker?: ReactNode; /** The agents' MCP tools this card is about: an [MCP工具] tag naming them. */ tools?: readonly CardTool[]; /** A child card under a heading of its own (a smaller title). */ sub?: boolean }) {
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
  const { scope, timing, placement, reports } = useCardEffects(!!title);
  const inheritedDecoration = useSettingsRowDecoration(!!title);
  const partPicker = useContext(PartPickerContext);
  picker = scope?.startsWith("host:") || scope?.startsWith("codex:") ? picker ?? partPicker : undefined;
  const compact = useContext(CompactContext);
  return (
    // Compact (a 在主界面调整 panel): the settings page may be mounted too, so the anchor is not an id there.
    <EffectPlacementContext value={placement}><CardMetadataReportContext value={reports}>
    <section className={compact ? "mb-3" : "mb-6"} id={compact ? undefined : id} data-settings-anchor={compact ? id : undefined}>
      {(title || actions || filter || picker || tools?.length) && (
        <div className={compact ? "mb-1" : "mb-2"}>
          {/* The title never truncates (owner 2026-10-25: 事件分级 showed as 「事...」 once the revamp's markers, the
              「只看你修改过的设置」 switch and a preset switch shared its row). Two groups that wrap: the title with its
              card-level markers and tag (inline with the title, never shrunk), then the controls — on the same line
              when they fit, else on a line of their own, right-aligned. At least one row tall whether or not there are
              controls / the switch, so one appearing on a roomy header never moves the page (owner 2026-10-18). */}
          <div className={`mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 ${compact ? "min-h-7" : "min-h-8"}`} data-settings-card-head="">
            <div className="flex max-w-full min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1" data-settings-card-title="">
              {title && <h3 className={`min-w-0 break-words ${sub ? "text-ui/[inherit] font-medium" : `font-semibold ${compact ? "text-ui/[inherit]" : "text-sm"}`}`}>{title}</h3>}
              {inheritedDecoration?.marker}
              {title && (scope || timing || tools?.length) && <span className="inline-flex flex-wrap items-center gap-1.5" data-effect-card-summary="">
                {scope && <EffectScope scope={scope} picker={picker} />}
                {timing && <AgentsChip agents={timing} />}
                {tools?.length ? <ToolsChip tools={tools} /> : null}
              </span>}
              {tag && (
                <Tag title={tag.title}>
                  {tag.label}
                </Tag>
              )}
            </div>
            {(actions || filter) && (
              <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1" data-settings-card-controls="">
                {filter}
                {actions}
              </div>
            )}
          </div>
          {hint && <p className="text-xs text-subtle">{hint}</p>}
        </div>
      )}
      <ModifiedContext value={{ only, report }}>
          <Card hidden={collapsed}>
            {children}
            {only && modified.size === 0 && <p className="py-3 text-xs text-subtle">{t("settings.noneModified")}</p>}
          </Card>
      </ModifiedContext>
    </section>
    </CardMetadataReportContext></EffectPlacementContext>
  );
}

/** A custom control declares one logical row, with the same automatic placement as SettingRow. */
export type SettingsRowDecoration = { attributes: Record<string, string | boolean | undefined>; marker: ReactNode };
const RowDecorationContext = createContext<{ decoration: SettingsRowDecoration; claim(active: boolean): void } | null>(null);
export function useSettingsRowDecoration(enabled = true) {
  const inherited = useContext(RowDecorationContext);
  const claim = enabled ? inherited?.claim : undefined;
  useLayoutEffect(() => { claim?.(true); return () => claim?.(false); }, [claim]);
  return enabled ? inherited?.decoration : undefined;
}
export function SettingsGroup({ agents, source, allHosts, readOnly, navigation, children }: SettingEffect & { children: ReactNode | ((decoration: SettingsRowDecoration) => ReactNode) }) {
  const hostId = useRowMetadata({ agents, source, allHosts, readOnly, navigation });
  const attributes = { "data-setting-row": "", "data-effect-timing": readOnly || navigation ? undefined : agents, "data-effect-read-only": readOnly || undefined, "data-effect-navigation": navigation || undefined, "data-effect-source": sourceKey(source), "data-effect-host": hostId, "data-effect-all-hosts": allHosts || undefined };
  const [claimed, setClaimed] = useState(false);
  const claim = useCallback((active: boolean) => setClaimed(active), []);
  const marker = <EffectMarkers agents={agents} source={source} allHosts={allHosts} readOnly={readOnly || navigation} row />;
  if (typeof children === "function") return children({ attributes, marker });
  const decoration = { attributes, marker };
  const visibleMarker = claimed ? null : marker;
  const decorate = (node: ReactNode) => <RowDecorationContext value={{ decoration, claim }}>{node}</RowDecorationContext>;
  // Keep the existing entity/DOM element as the row: list borders and direct-child
  // flex/grid layout must not change merely because a field declares its effect.
  if (isValidElement(children)) {
    if (children.type === ListRow) return cloneElement(children as ReactElement<ListRowProps>, { effect: { attributes, marker } });
    if (typeof children.type === "string" && ["div", "span", "form", "fieldset"].includes(children.type)) {
      const child = children as ReactElement<{ children?: ReactNode }>;
      return decorate(cloneElement(child, { ...attributes, children: <>{visibleMarker}{child.props.children}</> }));
    }
  }
  return decorate(<span className="contents" {...attributes}>{visibleMarker}{children}</span>);
}

/**
 * The card frame of a section (and of loose cards like the skills archive): `group/card` with
 * `data-narrow` below 28rem (lib/narrowCard + lib/sizeFlags; deliberately no CSS size container, see there). A render
 * error inside shows in the card with a retry instead of taking the page down.
 */
export function Card({ children, className, hidden }: { children: ReactNode; className?: string; hidden?: boolean }) {
  const compact = useContext(CompactContext);
  className ??= compact ? "rounded-lg border border-card-border bg-surface px-3" : "rounded-xl border border-card-border bg-surface px-4 py-1";
  const [ref, flags] = useSizeFlags(CARD_FLAGS);
  return (
    <div ref={ref} hidden={hidden} {...dataFlags(flags)} className={`group/card ${className}`}>
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
 * A short "what this is" line as an ⓘ next to the label (owner 2026-10-23, settings-hints): the text shows in a tooltip on
 * hover and keyboard focus, and is the controls' description (`hintId`) for screen readers. Consequences / risks stay visible
 * text under the row (`hint`).
 */
export function InfoTip({ id, children }: { id?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ below: boolean; shift: number }>({ below: false, shift: 0 });
  const root = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  // Beside its trigger and never over the row's own control (owner rule): above the label line, flipped below only when
  // the scrolling area has no room above; anchored at the ⓘ and clamped to the card.
  useLayoutEffect(() => {
    const el = root.current;
    const bubble = tip.current;
    if (!open || !el || !bubble) return;
    const r = el.getBoundingClientRect();
    const h = bubble.offsetHeight + 6;
    let top = 0;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if (o === "auto" || o === "scroll") {
        top = p.getBoundingClientRect().top;
        break;
      }
    }
    const card = el.closest("[data-setting-row]")?.parentElement?.getBoundingClientRect();
    const w = bubble.offsetWidth;
    const right = card ? card.right - 4 : ownerWindowOf(el).innerWidth - 8;
    const left = card ? card.left + 4 : 8;
    let shift = -Math.max(0, r.left + w - right);
    if (r.left + shift < left) shift = left - r.left;
    setPlace({ below: r.top - h < top, shift });
  }, [open]);
  return (
    <span ref={root} className="relative ml-1 inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <button type="button" data-setting-info="" aria-describedby={id} aria-label={typeof children === "string" ? children : undefined} className={`flex size-4 items-center justify-center rounded-full text-subtle hover:text-muted ${FOCUS}`}>
        <Info aria-hidden size={13} />
      </button>
      <span
        ref={tip}
        id={id}
        role="tooltip"
        data-setting-info-tip=""
        data-placed={place.below ? "below" : "above"}
        style={{ left: place.shift }}
        className={`pointer-events-none absolute z-30 w-max max-w-64 rounded-inner bg-surface px-2.5 py-1.5 text-caption font-normal text-muted shadow-e2 ${place.below ? "top-full mt-1" : "bottom-full mb-1"} ${open ? "block" : "hidden"}`}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * The one settings row: label (+ hint, + optional sample) | control column (right-aligned); the card's
 * right margin is as narrow as its left (owner 2026-10-18: no reset column). `reset` is a ResetButton:
 * while it is enabled the setting is modified, shown by a short bar at the card's inner left edge (our
 * mark for 「改过」), and 「↺ 恢复默认」 appears after the label on hover / keyboard focus, so the control
 * never moves. In a narrow card (< 28rem) the controls drop under the label, left-aligned.
 */
export function SettingRow({ label, hint, info, children, reset, sample, agents, source, allHosts, readOnly, navigation }: SettingEffect & { label: ReactNode; hint?: ReactNode; info?: ReactNode; children?: ReactNode; reset?: ReactNode; sample?: ReactNode }) {
  const form = useContext(FormFieldsContext);
  const id = useId();
  const hostId = useRowMetadata({ agents, source, allHosts, readOnly, navigation });
  const labelId = `${id}l`;
  const hintId = hint || info ? `${id}h` : undefined;
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
      data-form-field={form ? "" : undefined}
      data-effect-timing={readOnly || navigation ? undefined : agents}
      data-effect-read-only={readOnly || undefined}
      data-effect-navigation={navigation || undefined}
      data-effect-source={sourceKey(source)} data-effect-host={hostId}
      data-effect-all-hosts={allHosts || undefined}
      data-modified={modified ? "" : undefined}
      className={`group/row relative grid ${form ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[minmax(9rem,1fr)_auto] group-data-[narrow]/card:grid-cols-[minmax(0,1fr)]"} gap-x-3 border-b border-border/60 last:border-b-0 ${compact ? "gap-y-1 py-2" : "gap-y-1.5 py-3"} ${sample ? "items-start" : "items-center"}`}
    >
      <div className="relative min-w-0">
        {modified && <ModifiedMark compact={compact} />}
        <div id={labelId} className={form ? "text-sm break-words" : "text-sm"}>
          {/* The restore button floats after the label: showing / hiding it never reflows the row. */}
          <span className="relative">
            {label}
            {modified && <RestoreDefault onClick={reset$!.onClick} title={reset$!.title} />}
          </span>
          {info && !hint && <InfoTip id={hintId}>{info}</InfoTip>}
          <EffectMarkers agents={agents} source={source} allHosts={allHosts} readOnly={readOnly || navigation} row />
        </div>
        {hint && (
          <div id={hintId} className="text-xs text-subtle">
            {hint}
          </div>
        )}
        {sample}
      </div>
      <RowA11yContext value={{ labelId, hintId }}>
        <div className={`flex min-w-0 items-center gap-2 ${form ? "w-full flex-wrap justify-start [&_input]:min-w-0 [&_input]:max-w-full [&_select]:max-w-full" : "justify-end group-data-[narrow]/card:row-start-2 group-data-[narrow]/card:flex-wrap group-data-[narrow]/card:justify-start"}`}>
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
      className={`absolute top-1/2 left-full z-10 ml-1.5 inline-flex h-5 -translate-y-1/2 items-center gap-1 rounded bg-surface px-1 text-caption/[inherit] whitespace-nowrap text-subtle opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 ${FOCUS}`}
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
export function LinkRow({ label, hint, link, onClick, agents, source, allHosts }: SettingEffect & { label: ReactNode; hint?: ReactNode; link: string; onClick(): void }) {
  return (
    <SettingRow label={label} hint={hint} agents={agents} source={source} allHosts={allHosts} readOnly navigation>
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
      className={`${btn({ variant: "ghost", size: "sm", icon: true })} ${danger ? "hover:text-danger" : ""}`}
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
type ListRowProps = { leading?: ReactNode; title: ReactNode; detail?: ReactNode; actions?: ReactNode; below?: ReactNode; frame?: string; effect?: { attributes: Record<string, string | boolean | undefined>; marker: ReactNode } };
export function ListRow({ leading, title, detail, actions, below, frame, effect }: ListRowProps) {
  return (
    <div {...effect?.attributes} className={`-mx-4 border-b border-border px-4 py-2 last:border-b-0 ${frame ?? ""}`}>
      <div className="flex min-h-7 items-center gap-2.5">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1 text-sm" data-list-row-title><span className="min-w-0 truncate">{title}</span>{effect?.marker}</div>
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
          <div className="h-3 w-40 animate-skeleton rounded bg-surface-2" />
          <div className="ml-auto h-5 w-24 animate-skeleton rounded bg-surface-2" />
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

export function Segmented<T extends string>({ value, options, onChange, disabled, label, accent }: { value: T; options: { value: NoInfer<T>; label: string; /** What the choice means, as a tooltip (the row hint says what the setting is). */ title?: string; /** A small picture before the label (主管头饰's styles). */ icon?: ReactNode }[]; onChange(v: NoInfer<T>): void; disabled?: boolean; label?: string; /** The choice in the accent colour (通知 → 事件分级 only, owner 2026-10-19: a column of choices reads at a glance). */ accent?: boolean }) {
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
            className={`rounded-md px-2.5 py-1 text-xs whitespace-nowrap ${o.icon ? "inline-flex items-center gap-1.5" : ""} ${FOCUS} ${on ? (accent ? "bg-accent text-white shadow-sm" : "bg-raised text-foreground shadow-sm ring-1 ring-border") : "text-muted hover:text-foreground"}`}
          >
            {o.icon}
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
  const { t } = useI18n();
  const composing = useRef(false);
  const [compositionDraft, setCompositionDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const shown = compositionDraft ?? value;
  const count = compositionDraft === null ? graphemeCount(value) : null;
  const tooLong = count !== null && maxLength !== undefined && count > maxLength;
  const problem = tooLong ? t("input.limitExceeded", { max: maxLength! }) : "";
  useEffect(() => { input.current?.setCustomValidity(problem); }, [problem]);
  const field = (
    <input
      ref={input}
      type={type}
      {...aria}
      autoComplete={type === "password" ? "off" : undefined}
      value={shown}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-invalid={tooLong || undefined}
      aria-describedby={maxLength === undefined ? undefined : hintId}
      placeholder={placeholder}
      onCompositionStart={(e) => { composing.current = true; setCompositionDraft(e.currentTarget.value); }}
      onCompositionEnd={(e) => { composing.current = false; setCompositionDraft(null); onChange(e.currentTarget.value); }}
      onChange={(e) => { if (composing.current || isImeComposing(e)) setCompositionDraft(e.target.value); else onChange(e.target.value); }}
      onBlur={() => { if (!composing.current) onBlur?.(); }}
      onKeyDown={(e) => { if (!composing.current && !isImeComposing(e)) onKeyDown?.(e); }}
      className={`${width} ${FIELD} ${mono ? "font-mono text-xs" : ""}`}
    />
  );
  return maxLength === undefined ? field : <span className="inline-flex max-w-full flex-col gap-1">
    {field}<span id={hintId} className={`text-caption/[inherit] ${tooLong ? "text-danger" : "text-subtle"}`} aria-live="polite">
      {count === null ? "…" : t("input.limitCounter", { n: count, max: maxLength })}{problem ? ` · ${problem}` : ""}
    </span>
  </span>;
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
    if (maxLength !== undefined && graphemeCount(next) > maxLength) return;
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
          if (isImeComposing(e)) return;
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

type SelectOption = { value: string; label: string; disabled?: boolean; group?: string };
const renderOption = (o: SelectOption) => (
  <option key={o.value} value={o.value} disabled={o.disabled}>
    {o.label}
  </option>
);
/** Consecutive options with the same `group` as one run (ungrouped options are runs of their own). */
function optionRuns(options: readonly SelectOption[]): { group?: string; items: SelectOption[] }[] {
  const runs: { group?: string; items: SelectOption[] }[] = [];
  for (const o of options) {
    const last = runs[runs.length - 1];
    if (o.group && last?.group === o.group) last.items.push(o);
    else runs.push({ group: o.group, items: [o] });
  }
  return runs;
}

/** Fixed-width select (`width`: a FIELD_W token, default generic); long labels truncate with a tooltip. */
export function Select<T extends string>({ value, options, onChange, disabled, width = FIELD_W.generic, label }: { value: T; options: { value: NoInfer<T>; label: string; disabled?: boolean; group?: string }[]; onChange(v: NoInfer<T>): void; disabled?: boolean; width?: string; label?: string }) {
  const aria = useRowA11y(label);
  const current = options.find((o) => o.value === value)?.label;
  return (
    <select {...aria} value={value} disabled={disabled} title={current} onChange={(e) => onChange(e.target.value as T)} className={`${width} truncate ${FIELD}`}>
      {/* `group`: consecutive options sharing it sit under one <optgroup>. */}
      {optionRuns(options).map((run) =>
        run.group ? (
          <optgroup key={`group:${run.group}`} label={run.group}>
            {run.items.map(renderOption)}
          </optgroup>
        ) : (
          run.items.map(renderOption)
        ),
      )}
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
export function DefaultableToggleRow({ label, hint, checked, explicit, onChange, onReset, disabled, resetTitle, agents, source, allHosts }: SettingEffect & { label: ReactNode; hint?: ReactNode; checked: boolean; explicit: boolean; onChange(v: boolean): void; onReset(): void; disabled?: boolean; resetTitle: string }) {
  return (
    <SettingRow label={label} hint={hint} agents={agents} source={source} allHosts={allHosts} reset={<ResetButton disabled={disabled || !explicit} onClick={onReset} title={resetTitle} />}>
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
      className={btn({ variant: primary ? "primary" : "secondary" })}
    >
      {children}
    </button>
  );
}
