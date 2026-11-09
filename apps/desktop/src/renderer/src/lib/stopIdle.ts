// Stop idle agents (design 031, cutex `stop-idle-agents`; 下线空闲的智能体): cutex decides which online agents
// may be taken offline; the desktop shows its verdicts in one dialog (components/StopIdleDialog) for any scope
// (所有项目 / a project / 独立), sends the owner's choice, and can bring them back online (撤销). The idle time only
// pre-ticks (owner 2026-10-25): the listing and the stop ask cutex with 0, so the owner may tick any agent that
// is not blocked. The only desktop-side rule is the device-local sidebar pin: a pinned agent is not ticked by default.
import type { ReactNode } from "react";
import { create } from "zustand";
import { BLOCKING_REASONS, STOP_IDLE_FEATURE, type IdleAgent, type IdleReason, type StopIdleItemResult, type StopIdleMode } from "../../../shared/stopIdle";
import { translate, type MessageKey } from "../i18n";
import type { MenuAction, MenuEntry } from "./contextMenu";
import { isOwnerFeatures } from "../../../shared/users";
import { featuresOf, hostApi, pinnedOn, sidebarOf, useApp } from "../store";
import { showShelfToast } from "./shelves";
import { parseHostKey } from "./hostKeys";
import { INDEPENDENT_GROUP } from "./agentList";
import { beginOperation, trackedOperationItem, updateOperationItem } from "./backgroundOperations";

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
    const result = await trackedStopIdle(s.scope.hostId, ids, 0, s.mode, new Map(s.rows.map(row => [row.cutexSessionId, row.name ?? row.cutexSessionId])));
    useStopIdle.setState({ phase: "done", results: result.results });
  } catch (error) {
    useStopIdle.setState({ phase: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

/** Mirror cutex's returned per-agent outcomes; do not decide eligibility here. */
async function trackedStopIdle(host: string, ids: readonly string[], minIdleSecs: number, mode: StopIdleMode, names = new Map<string,string>()) {
  const operationId = beginOperation(host, "operations.kind.stopIdle", ids.map(id => ({key:id, name:names.get(id) ?? sidebarOf(useApp.getState(),host)?.active.find(row => row.cutexSessionId===id)?.displayName ?? id})));
  for (const id of ids) updateOperationItem({operationId,key:id}, {state:"running"});
  try {
    const result = await hostApi(host).stopIdle({requestId:crypto.randomUUID(),sessionIds:[...ids],minIdleSecs,mode});
    for (const id of ids) {
      const item = result.results.find(row => row.cutexSessionId === id);
      updateOperationItem({operationId,key:id}, {
        state: !item ? "uncertain" : item.result === "failed" ? "failed" : item.result === "skipped" ? "skipped" : "done",
        detail: item?.error ?? item?.reasons?.map(reason => translate(`stopIdle.reason.${reason}` as MessageKey)).join(" · "),
        retry: item?.result === "failed" ? () => trackedStopIdle(host,[id],minIdleSecs,mode,names) : undefined,
      });
    }
    return result;
  } catch (error) {
    for (const id of ids) updateOperationItem({operationId,key:id}, {state:"uncertain",detail:error instanceof Error?error.message:String(error)});
    throw error;
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
  const operationId = beginOperation(host, "operations.kind.undoStopIdle", ids.map(id => ({key:id, name: sidebarOf(useApp.getState(),host)?.active.find(row => row.cutexSessionId===id)?.displayName ?? id})));
  let back = 0;
  for (const id of ids) {
    try {
      await trackedOperationItem({operationId, key:id}, () => useApp.getState().sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false }, host));
      back++;
    } catch {
      // Counted by the caller.
    }
  }
  return back;
}

// ── The quick path (owner 2026-10-23: medium risk = confirm in place, not a dialog) ───────────────────

/**
 * Stop each host's `ids` (下线，可唤醒; a folder may hold projects of more than one host: each host stops its own
 * agents with the same cutex action) and say so in one toast with 撤销, which brings each back on its host.
 */
export async function stopQuick(batches: readonly { hostId: string; ids: readonly string[] }[], secs: number, t: T): Promise<void> {
  const notify = (text: string) => useApp.getState().notify(text, "error");
  const stopped: { hostId: string; ids: string[] }[] = [];
  let skipped = 0;
  const failed: StopIdleItemResult[] = [];
  const errors: string[] = [];
  for (const batch of batches) {
    if (!batch.ids.length) continue;
    try {
      const result = await trackedStopIdle(batch.hostId, batch.ids, secs, "wakeable");
      const ids = result.results.filter((r) => r.result === "stopped").map((r) => r.cutexSessionId);
      if (ids.length) stopped.push({ hostId: batch.hostId, ids });
      skipped += result.results.filter((r) => r.result === "skipped").length;
      failed.push(...result.results.filter((r) => r.result === "failed"));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length) notify(t("stopIdle.failed", { error: errors.join("; ") }));
  if (failed.length) notify(t("stopIdle.failedSome", { n: failed.length, error: failed.map((r) => r.error ?? "").join("; ") }));
  const n = stopped.reduce((sum, b) => sum + b.ids.length, 0);
  if (!n) {
    if (!failed.length && !errors.length) showShelfToast(t("stopIdle.quickNone"));
    return;
  }
  const text = skipped ? t("stopIdle.toastSkipped", { n, m: skipped }) : t("stopIdle.done", { n });
  showShelfToast(text, () => void Promise.all(stopped.map((b) => bringBack(b.hostId, b.ids))).then((backs) => showShelfToast(t("stopIdle.undone", { n: backs.reduce((a, b) => a + b, 0) }))));
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

// ── The menu (owner 2026-11-06: scope, then idle time, each with its count) ─────────────────────────────

/** The menu's idle times, longest last; 0 = every idle one. */
export const QUICK_IDLE_SECS = [30 * 60, 60 * 60, 3 * 60 * 60, 24 * 60 * 60, 0] as const;

/** Agents of one host a menu scope covers: some projects (null = an independent agent), or all (`projects` absent). */
export interface StopIdleTarget {
  hostId: string;
  projects?: ReadonlySet<string | null>;
}

/** One scope of the menu: 本项目 / 独立 / a folder / a host, with what it covers on each host. */
export interface StopIdleMenuScope {
  kind: "Project" | "Independent" | "Folder" | "Host";
  /** The project, folder or host name. */
  label: string;
  targets: StopIdleTarget[];
  /** The dialog's scope for 选择… (single-host scopes only). */
  dialog?: StopIdleScope;
}

const inTarget = (target: StopIdleTarget, projectId: string | null) => !target.projects || target.projects.has(projectId);
/** The cutex filter for a target: one project asks for that project only; otherwise the host's whole listing. */
const projectFilter = (target: StopIdleTarget): { projectId?: string } => {
  const only = target.projects && target.projects.size === 1 ? [...target.projects][0] : undefined;
  return typeof only === "string" ? { projectId: only } : {};
};

/** The clear 会停的 rows of a target as cutex lists them at `secs` (stoppable only: cautions, pinned, the Director, busy and waiting ones stay out). */
async function stoppableRows(target: StopIdleTarget, secs: number): Promise<IdleRow[]> {
  const listing = await hostApi(target.hostId).idleRuntimes({ minIdleSecs: secs, ...projectFilter(target) });
  if (!listing) throw new Error("unsupported");
  return idleRows(listing.agents, {}, pinnedOn(target.hostId)).filter((row) => row.verdict === "stoppable" && inTarget(target, row.projectId));
}

/** How many each idle time would take offline: `rows` (stoppable, listed at 0) idle at least that long (0: all of them). */
export function idleCounts(rows: readonly Pick<IdleRow, "idleSecs">[], secsList: readonly number[] = QUICK_IDLE_SECS): number[] {
  return secsList.map((secs) => rows.filter((row) => secs === 0 || (row.idleSecs !== null && row.idleSecs >= secs)).length);
}

/** The ids each host would stop at `secs` (asked again on the second look, so the armed count is cutex's own). */
export async function scopeIdleIds(scope: Pick<StopIdleMenuScope, "targets">, secs: number): Promise<{ hostId: string; ids: string[] }[]> {
  return Promise.all(scope.targets.map(async (target) => ({ hostId: target.hostId, ids: (await stoppableRows(target, secs)).map((row) => row.cutexSessionId) })));
}

/** The idle time's label: 「空闲 30 分钟以上」 / 「所有空闲的」. */
function idleLabel(secs: number, t: T): string {
  return secs === 0 ? t("stopIdle.idleAny") : t("stopIdle.idleOver", { time: t(presetKey(secs)) });
}

/** One idle time of a scope: its count on the right, what it does in ⓘ; counts again and arms in place, the second click takes them offline. */
function idleRow(scope: StopIdleMenuScope, secs: number, count: number, t: T): MenuAction {
  let batches: { hostId: string; ids: string[] }[] = [];
  const time = idleLabel(secs, t);
  return {
    label: time,
    hint: String(count),
    disabled: count === 0,
    info: t(secs === 0 ? "stopIdle.rowInfoAny" : "stopIdle.rowInfo", { scope: scope.label, time: secs === 0 ? "" : t(presetKey(secs)), n: count }),
    preparing: t("stopIdle.checking"),
    prepare: async () => {
      batches = await scopeIdleIds(scope, secs);
      const n = batches.reduce((sum, b) => sum + b.ids.length, 0);
      return n ? { armed: t("stopIdle.armedScope", { scope: scope.label, n }) } : { empty: t("stopIdle.quickNone") };
    },
    onSelect: () => stopQuick(batches, secs, t),
  };
}

/** The scope's idle-time rows, counted from one listing per host (asked with 0). */
async function idleRowsFor(scope: StopIdleMenuScope, t: T): Promise<{ rows: MenuAction[]; total: number }> {
  const listed = (await Promise.all(scope.targets.map((target) => stoppableRows(target, 0)))).flat();
  const counts = idleCounts(listed);
  return { rows: QUICK_IDLE_SECS.map((secs, i) => idleRow(scope, secs, counts[i]!, t)), total: counts[counts.length - 1]! };
}

/** The scope row's name: 「本项目 · X」, 「独立{{agent}}」, 「文件夹 · X」, 「主机 X 的所有项目」. */
function scopeName(scope: StopIdleMenuScope, t: T): string {
  return t(`stopIdle.scope${scope.kind}` as MessageKey, { name: scope.label });
}

/**
 * The menu entry (empty without the capability): 下线空闲的{{agent}} › with one row per scope (本项目 or 独立, its folder,
 * the host), each › its idle times with their counts (owner 2026-11-06: scope, then duration), then 选择… (the dialog).
 * With one scope the idle times stand directly in the submenu. Each idle time counts, arms in place and acts on the
 * second click (the same medium-risk confirm as before); only the clear 会停的 set goes, on each agent's own host.
 */
export function stopIdleMenuEntries(scopes: StopIdleMenuScope | readonly StopIdleMenuScope[], t: T, icon?: ReactNode): MenuEntry[] {
  const usable = (Array.isArray(scopes) ? (scopes as readonly StopIdleMenuScope[]) : [scopes as StopIdleMenuScope])
    .map((scope) => ({ ...scope, targets: scope.targets.filter((target) => stopIdleAvailable(target.hostId)) }))
    .filter((scope) => scope.targets.length > 0);
  if (!usable.length) return [];
  const dialog = usable.find((scope) => scope.dialog)?.dialog;
  const review: MenuEntry[] = dialog ? ["separator", { label: t("stopIdle.review"), title: t("stopIdle.reviewHint"), onSelect: () => void openStopIdle(dialog, DEFAULT_IDLE_SECS) }] : [];
  const fail = (error: unknown): MenuEntry[] => [{ label: t("stopIdle.failed", { error: error instanceof Error ? error.message : String(error) }), note: true, disabled: true, onSelect: () => {} }];
  const submenu = async (): Promise<MenuEntry[]> => {
    if (usable.length === 1) {
      try {
        return [...(await idleRowsFor(usable[0]!, t)).rows, ...review];
      } catch (error) {
        return [...fail(error), ...review];
      }
    }
    const rows = await Promise.all(
      usable.map(async (scope): Promise<MenuAction> => {
        try {
          const { rows, total } = await idleRowsFor(scope, t);
          // No ⓘ here: its tooltip would cover the idle times beside it; each idle time says what it does.
          return { label: scopeName(scope, t), hint: String(total), onSelect: () => {}, submenu: rows };
        } catch (error) {
          return { label: scopeName(scope, t), onSelect: () => {}, submenu: fail(error) };
        }
      }),
    );
    return [...rows, ...review];
  };
  const title = usable.length === 1 ? t(`stopIdle.menuHint${usable[0]!.kind}` as MessageKey) : undefined;
  return [{ label: t("stopIdle.menu"), icon, title, onSelect: () => {}, submenu }];
}

/** A host's scope: every project on it. */
export function hostIdleScope(hostId: string, label: string): StopIdleMenuScope {
  return { kind: "Host", label, targets: [{ hostId }], dialog: { hostId, label } };
}

/** A project's (or the independent agents') scope on its host. */
export function projectIdleScope(hostId: string, projectId: string | null, label: string): StopIdleMenuScope {
  return projectId === null
    ? { kind: "Independent", label, targets: [{ hostId, projects: new Set([null]) }], dialog: { hostId, independent: true, label } }
    : { kind: "Project", label, targets: [{ hostId, projects: new Set([projectId]) }], dialog: { hostId, projectId, label } };
}

/** A folder's scope: its projects, grouped by their host (`members` are host keys; `__independent__` = that host's independent agents). */
export function folderIdleScope(name: string, members: readonly string[]): StopIdleMenuScope {
  const byHost = new Map<string, Set<string | null>>();
  for (const member of members) {
    const parsed = parseHostKey(member);
    if (!parsed) continue;
    const [hostId, id] = parsed;
    if (!byHost.has(hostId)) byHost.set(hostId, new Set());
    byHost.get(hostId)!.add(id === INDEPENDENT_GROUP ? null : id);
  }
  return { kind: "Folder", label: name, targets: [...byHost].map(([hostId, projects]) => ({ hostId, projects })) };
}

/** The focus host's entries for the sidebar's own menu (then a separator; none without the capability). */
export function hostStopIdleEntries(t: T, icon?: ReactNode): MenuEntry[] {
  const app = useApp.getState();
  const hostId = app.hosts?.active ?? "local";
  const label = app.hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId;
  const entries = stopIdleMenuEntries(hostIdleScope(hostId, label), t, icon);
  return entries.length ? [...entries, "separator"] : [];
}
