// Stop idle agents (design 031, cutex `stop-idle-agents`; 下线空闲的智能体): cutex decides which online agents
// may be taken offline; the desktop shows its verdicts in one dialog (components/StopIdleDialog) for any scope
// (所有项目 / a project / 独立), sends the owner's choice, and can bring them back online (撤销). The idle time only
// pre-ticks (owner 2026-10-25): the listing and the stop ask cutex with 0, so the owner may tick any agent that
// is not blocked. The only desktop-side rule is the device-local sidebar pin: a pinned agent is not ticked by default.
import type { ReactNode } from "react";
import { create } from "zustand";
import { BLOCKING_REASONS, STOP_IDLE_FEATURE, type IdleAgent, type IdleReason, type StopIdleItemResult, type StopIdleMode } from "../../../shared/stopIdle";
import type { MessageKey } from "../i18n";
import type { MenuAction, MenuEntry } from "./contextMenu";
import { isOwnerFeatures } from "../../../shared/users";
import { featuresOf, hostApi, pinnedOn, useApp } from "../store";
import { showShelfToast } from "./shelves";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** The direct click: idle 30 minutes or longer. */
export const DEFAULT_IDLE_SECS = 30 * 60;
/** The dialog's preset thresholds (0 = 全部, whatever the idle time; the owner can also type their own). */
export const IDLE_PRESETS = [0, 30 * 60, 60 * 60, 3 * 60 * 60, 24 * 60 * 60] as const;

export interface StopIdleScope {
  hostId: string;
  /** Only this project's agents (cutex filter). */
  projectId?: string;
  /** Only agents without a project (the sidebar's 独立智能体). */
  independent?: boolean;
  /** The scope's name (host, project or 独立). */
  label: string;
}

export type StopIdlePhase = "loading" | "review" | "stopping" | "done" | "error";

/** One row as shown: cutex's verdict, plus the device-local pin as a caution. */
export interface IdleRow extends IdleAgent {
  /** Ticked by default when idle long enough (`preTicked`): stoppable, not a caution. */
  preselect: boolean;
  /** Can be ticked at all. */
  selectable: boolean;
}

interface StopIdleState {
  open: boolean;
  scope: StopIdleScope | null;
  /** The idle time that pre-ticks (0 = every stoppable agent); never filters. */
  minIdleSecs: number;
  phase: StopIdlePhase;
  rows: IdleRow[];
  selected: ReadonlySet<string>;
  /** Rows the owner ticked / unticked by hand: a new idle time or scope keeps them (按阈值重选 clears). */
  touched: ReadonlyMap<string, boolean>;
  mode: StopIdleMode;
  results: StopIdleItemResult[];
  error: string | null;
  /** 撤销 ran: how many came back online (null = not yet). */
  undone: number | null;
  /** 撤销 is running. */
  undoing: boolean;
}

const initial: StopIdleState = {
  open: false, scope: null, minIdleSecs: DEFAULT_IDLE_SECS, phase: "loading", rows: [], selected: new Set(), touched: new Map(), mode: "wakeable", results: [], error: null, undone: null, undoing: false,
};

export const useStopIdle = create<StopIdleState>(() => initial);

/** Never stopped from the desktop, whatever cutex says (owner 2026-10-24): the project's Director, and an agent waiting for the results of its own delegations. */
export const NEVER_STOP: ReadonlySet<IdleReason> = new Set<IdleReason>(["director", "awaitingDelegations"]);

/** The rows for `agents` in `scope`: pinned stoppable agents become a caution (not ticked); the Director and agents awaiting their delegations are blocked. */
export function idleRows(agents: readonly IdleAgent[], scope: Pick<StopIdleScope, "independent">, pinned: ReadonlySet<string>): IdleRow[] {
  const order = { stoppable: 0, caution: 1, blocked: 2 } as const;
  return agents
    .filter((agent) => !scope.independent || agent.projectId === null)
    .map((agent) => {
      const never = agent.reasons.some((reason) => NEVER_STOP.has(reason));
      const pin = !never && agent.verdict === "stoppable" && pinned.has(agent.cutexSessionId);
      const verdict = never ? ("blocked" as const) : pin ? ("caution" as const) : agent.verdict;
      const reasons: IdleReason[] = pin ? ["pinned", ...agent.reasons] : agent.reasons;
      return { ...agent, verdict, reasons, preselect: verdict === "stoppable", selectable: verdict !== "blocked" };
    })
    .sort((a, b) => order[a.verdict] - order[b.verdict] || (b.idleSecs ?? 0) - (a.idleSecs ?? 0));
}

/** Ticked by default at `minIdleSecs`: stoppable and idle that long (0: every stoppable one, unknown idle time too). */
export function preTicked(row: Pick<IdleRow, "preselect" | "idleSecs">, minIdleSecs: number): boolean {
  return row.preselect && (minIdleSecs === 0 || (row.idleSecs !== null && row.idleSecs >= minIdleSecs));
}

/** The ticks: the owner's own where they ticked by hand, else the idle time's. */
export function tickedRows(rows: readonly IdleRow[], minIdleSecs: number, touched: ReadonlyMap<string, boolean>): Set<string> {
  return new Set(rows.filter((row) => row.selectable && (touched.get(row.cutexSessionId) ?? preTicked(row, minIdleSecs))).map((row) => row.cutexSessionId));
}

/** Blocking reasons first (cutex already orders them; the pin is a caution). */
export const blockingReasons = (row: Pick<IdleAgent, "reasons">): IdleReason[] => row.reasons.filter((reason) => BLOCKING_REASONS.has(reason) || NEVER_STOP.has(reason));

let loadSeq = 0;

/** Open the dialog for `scope`, pre-ticking agents idle at least `minIdleSecs` (0 = all). cutex lists every online agent of the scope (asked with 0). */
export async function openStopIdle(scope: StopIdleScope, minIdleSecs = DEFAULT_IDLE_SECS): Promise<void> {
  const prev = useStopIdle.getState();
  useStopIdle.setState({ ...initial, open: true, scope, minIdleSecs, mode: prev.mode });
  await load(scope);
}

async function load(scope: StopIdleScope): Promise<void> {
  const seq = ++loadSeq;
  try {
    const listing = await hostApi(scope.hostId).idleRuntimes({ minIdleSecs: 0, ...(scope.projectId ? { projectId: scope.projectId } : {}) });
    if (seq !== loadSeq) return;
    if (!listing) throw new Error("unsupported");
    const rows = idleRows(listing.agents, scope, pinnedOn(scope.hostId));
    const { minIdleSecs, touched } = useStopIdle.getState();
    useStopIdle.setState({ phase: "review", rows, selected: tickedRows(rows, minIdleSecs, touched) });
  } catch (error) {
    if (seq === loadSeq) useStopIdle.setState({ phase: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

/** The scopes the dialog offers on `hostId`: 所有项目, each project, 独立 (the dialog's scope dropdown). */
export function stopIdleScopes(hostId: string, projects: readonly { project_id: string; presentation: { display_name: string } }[], t: T): StopIdleScope[] {
  return [
    { hostId, label: t("stopIdle.scope.all") },
    ...projects.map((p) => ({ hostId, projectId: p.project_id, label: p.presentation.display_name || p.project_id })),
    { hostId, independent: true, label: t("stopIdle.scope.independent") },
  ];
}

/** The same key for a scope (the dropdown's value). */
export const scopeKey = (scope: Pick<StopIdleScope, "projectId" | "independent">): string => (scope.projectId ? `p:${scope.projectId}` : scope.independent ? "independent" : "all");

/** The host's name (the dialog title). */
export function hostLabel(hostId: string): string {
  return useApp.getState().hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId;
}

/** Another scope in the open dialog: a new listing; the idle time, the mode and the owner's own ticks stay. */
export function setStopIdleScope(scope: StopIdleScope): void {
  const s = useStopIdle.getState();
  if (!s.open || (s.scope && scopeKey(s.scope) === scopeKey(scope))) return;
  useStopIdle.setState({ scope, phase: "loading", rows: [], selected: new Set(), error: null });
  void load(scope);
}

/** A new idle time: it re-ticks the rows the owner has not ticked by hand (no new listing). */
export function setIdleThreshold(minIdleSecs: number): void {
  useStopIdle.setState((s) => ({ minIdleSecs, selected: tickedRows(s.rows, minIdleSecs, s.touched) }));
}

/** 按阈值重选: forget the owner's own ticks. */
export function resetIdleTicks(): void {
  useStopIdle.setState((s) => ({ touched: new Map(), selected: tickedRows(s.rows, s.minIdleSecs, new Map()) }));
}

/** Tick (or untick) `ids` by hand: 全选 / 全不选 / a project's box. */
export function setIdleTicks(ids: readonly string[], on: boolean): void {
  useStopIdle.setState((s) => {
    if (s.phase !== "review") return {};
    const touched = new Map(s.touched);
    for (const id of ids) if (s.rows.some((r) => r.cutexSessionId === id && r.selectable)) touched.set(id, on);
    return { touched, selected: tickedRows(s.rows, s.minIdleSecs, touched) };
  });
}

export function toggleIdleRow(id: string): void {
  useStopIdle.setState((s) => {
    const row = s.rows.find((r) => r.cutexSessionId === id);
    if (!row?.selectable || s.phase !== "review") return {};
    const touched = new Map(s.touched).set(id, !s.selected.has(id));
    return { touched, selected: tickedRows(s.rows, s.minIdleSecs, touched) };
  });
}

export function setStopIdleMode(mode: StopIdleMode): void {
  useStopIdle.setState({ mode });
}

export function closeStopIdle(): void {
  loadSeq++;
  useStopIdle.setState({ ...initial, mode: useStopIdle.getState().mode });
}

/** Take the ticked agents offline (cutex checks each again and skips one that started work; any idle time, the owner chose). */
export async function confirmStopIdle(): Promise<void> {
  const s = useStopIdle.getState();
  if (!s.scope || s.phase !== "review" || s.selected.size === 0) return;
  const ids = s.rows.map((row) => row.cutexSessionId).filter((id) => s.selected.has(id));
  useStopIdle.setState({ phase: "stopping" });
  try {
    const result = await hostApi(s.scope.hostId).stopIdle({ requestId: crypto.randomUUID(), sessionIds: ids, minIdleSecs: 0, mode: s.mode });
    useStopIdle.setState({ phase: "done", results: result.results });
  } catch (error) {
    useStopIdle.setState({ phase: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

/** 撤销: bring the agents this run stopped back online (the owner's start, as the agent menu's 启动). */
export async function undoStopIdle(): Promise<void> {
  const s = useStopIdle.getState();
  if (!s.scope || s.phase !== "done" || s.undoing || s.undone !== null) return;
  useStopIdle.setState({ undoing: true });
  const back = await bringBack(s.scope.hostId, s.results.filter((r) => r.result === "stopped").map((r) => r.cutexSessionId));
  useStopIdle.setState({ undone: back, undoing: false });
}

/** Online again, each by the owner's start; how many made it (the agent row shows the rest's own state). */
async function bringBack(host: string, ids: readonly string[]): Promise<number> {
  let back = 0;
  for (const id of ids) {
    try {
      await useApp.getState().sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false }, host);
      back++;
    } catch {
      // Counted by the caller.
    }
  }
  return back;
}

// ── The quick path (owner 2026-10-23: medium risk = confirm in place, not a dialog) ───────────────────

/** The clear 会停的 set of `scope` at `secs`: stoppable only — cautions (incl. pinned) and blocked ones stay out. */
export async function quickIdleIds(scope: StopIdleScope, secs: number): Promise<string[]> {
  const listing = await hostApi(scope.hostId).idleRuntimes({ minIdleSecs: secs, ...(scope.projectId ? { projectId: scope.projectId } : {}) });
  if (!listing) throw new Error("unsupported");
  return idleRows(listing.agents, scope, pinnedOn(scope.hostId)).filter((row) => row.verdict === "stoppable").map((row) => row.cutexSessionId);
}

/** Stop `ids` (下线，可唤醒) and say so in a toast with 撤销 (the dialog's result, without the dialog). */
export async function stopQuick(scope: StopIdleScope, secs: number, ids: readonly string[], t: T): Promise<void> {
  const notify = (text: string) => useApp.getState().notify(text, "error");
  try {
    const result = await hostApi(scope.hostId).stopIdle({ requestId: crypto.randomUUID(), sessionIds: [...ids], minIdleSecs: secs, mode: "wakeable" });
    const stopped = result.results.filter((r) => r.result === "stopped").map((r) => r.cutexSessionId);
    const skipped = result.results.filter((r) => r.result === "skipped").length;
    const failed = result.results.filter((r) => r.result === "failed");
    if (failed.length) notify(t("stopIdle.failedSome", { n: failed.length, error: failed.map((r) => r.error ?? "").join("; ") }));
    if (!stopped.length) {
      if (!failed.length) showShelfToast(t("stopIdle.quickNone"));
      return;
    }
    const text = skipped ? t("stopIdle.toastSkipped", { n: stopped.length, m: skipped }) : t("stopIdle.done", { n: stopped.length });
    showShelfToast(text, () => void bringBack(scope.hostId, stopped).then((n) => showShelfToast(t("stopIdle.undone", { n }))));
  } catch (error) {
    notify(t("stopIdle.failed", { error: error instanceof Error ? error.message : String(error) }));
  }
}

/** Which words a scope uses: this project's members only, the independent agents, or every project on the host. */
export function scopeWords(scope: Pick<StopIdleScope, "projectId" | "independent">): "Project" | "Independent" | "Host" {
  return scope.projectId ? "Project" : scope.independent ? "Independent" : "Host";
}

/** A menu row that counts first, arms in place (「下线 3 个？再点一次」) and takes them offline on the second click. */
function quickRow(scope: StopIdleScope, secs: number, t: T, row: Pick<MenuAction, "label" | "icon" | "title">): MenuAction {
  let ids: string[] = [];
  return {
    ...row,
    preparing: t("stopIdle.checking"),
    prepare: async () => {
      ids = await quickIdleIds(scope, secs);
      return ids.length ? { armed: t(`stopIdle.armed${scopeWords(scope)}` as MessageKey, { n: ids.length }) } : { empty: t("stopIdle.quickNone") };
    },
    onSelect: () => stopQuick(scope, secs, ids, t),
  };
}

/** Whether `hostId` offers stop-idle and this connection may use it (the owner). */
export function stopIdleAvailable(hostId: string): boolean {
  const features = featuresOf(useApp.getState(), hostId);
  return features.has(STOP_IDLE_FEATURE) && isOwnerFeatures(features);
}

/** Preset chip label key (the dialog's 全部 / 30 分钟 / 1 小时 / 3 小时 / 1 天). */
export function presetKey(secs: number): MessageKey {
  return `stopIdle.preset.${secs === 0 ? "all" : secs === 1800 ? "30m" : secs === 3600 ? "1h" : secs === 10800 ? "3h" : "1d"}` as MessageKey;
}

/** A custom idle time as typed: `amount` of `unit` in seconds (0 = 全部; null: not a whole number ≥ 0). */
export function customIdleSecs(amount: string, unit: "m" | "h" | "d"): number | null {
  const text = amount.trim();
  const n = Number(text);
  if (!text || !Number.isInteger(n) || n < 0 || n > 99999) return null;
  return n * (unit === "m" ? 60 : unit === "h" ? 3600 : 86400);
}

/**
 * The menu entry (empty without the capability): one 下线空闲的智能体 › submenu (owner 2026-10-25) with the quick
 * row (空闲 30 分钟以上的, counted and armed in place) and 选择… (the dialog, scoped to where it was opened).
 */
export function stopIdleMenuEntries(scope: StopIdleScope, t: T, icon?: ReactNode): MenuEntry[] {
  if (!stopIdleAvailable(scope.hostId)) return [];
  const words = scopeWords(scope);
  return [
    {
      label: t("stopIdle.menu"),
      icon,
      title: t(`stopIdle.menuHint${words}` as MessageKey),
      onSelect: () => {},
      submenu: [
        quickRow(scope, DEFAULT_IDLE_SECS, t, { label: t(`stopIdle.quick${words}` as MessageKey), title: t(`stopIdle.menuHint${words}` as MessageKey) }),
        { label: t("stopIdle.review"), title: t("stopIdle.reviewHint"), onSelect: () => void openStopIdle(scope, DEFAULT_IDLE_SECS) },
      ],
    },
  ];
}

/** The focus host's entries for the sidebar's own menu (then a separator; none without the capability). */
export function hostStopIdleEntries(t: T, icon?: ReactNode): MenuEntry[] {
  const app = useApp.getState();
  const hostId = app.hosts?.active ?? "local";
  const label = app.hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId;
  const entries = stopIdleMenuEntries({ hostId, label }, t, icon);
  return entries.length ? [...entries, "separator"] : [];
}
