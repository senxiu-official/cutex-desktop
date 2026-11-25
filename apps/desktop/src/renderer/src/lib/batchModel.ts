// 批量换模型 (owner 2026-11-18: "astra 6 → astra 6.2, sol 6.1 → sol 6.2"): change the model of many agents at once,
// each within its own Profile and runtime. cutex has no batch route; the desktop sends one per-agent request, the same
// ones the composer and the agent's settings use:
//   - runtime online (app-server connected): native `thread/settings/update` {model, effort}. cutex applies it from the
//     agent's next turn (a running turn finishes on the old model) and writes it back to the agent's record.
//   - runtime offline (Codex agents): `cutex/session/defaults/update` {model, reasoningEffort}, stored on the record and
//     used when the runtime next starts.
// What cutex refuses or ignores is shown greyed with the reason instead of failing silently: DSH / Kimi fix the model
// at creation; an offline Claude agent's model only changes while it runs; an online agent whose runtime does not list
// the target model (`model/list`; e.g. GPT 6.2 needs Native r63) cannot take it. Target models come only from the
// agent's own Profile catalog (`profileModels`): never another Profile or runtime. Dialog: components/BatchModelDialog.
import { create } from "zustand";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { CatalogModel, ModelOption } from "../../../shared/ipc";
import { agentState, featuresOf, hostApi, sidebarOf, useApp } from "../store";
import { usesInputLedger } from "./deliveryMode";
import { turnRunning } from "./effortNextTurn";
import { modelOf, profileOf, runtimeOf } from "./agentList";
import type { AgentRuntime } from "./agentFeatures";

export interface BatchModelScope {
  hostId: string;
  /** Only this project's agents. */
  projectId?: string;
  /** Only agents without a project. */
  independent?: boolean;
  /** Only these agents (the agent list's selection). */
  ids?: readonly string[];
  /** The scope's name for the title. */
  label: string;
}

export interface BatchAgent {
  id: string;
  name: string;
  projectId: string | null;
  profile: string | null;
  runtime: AgentRuntime;
  /** The app-server is connected: the change goes to the live thread. */
  online: boolean;
  /** A turn is running: the change applies when it ends. As in the composer (lib/effortNextTurn): the ledger delivery
   *  (turn / finishing) on ledger hosts, the runtime's active turn on older hosts. */
  busy: boolean;
  threadId: string | null;
  model: string | null;
  effort: string | null;
  /** The runtime package the agent is pinned to (e.g. a Native release), when cutex says. */
  runtimeVersion: string | null;
}

/** Why an agent cannot take the target (greyed, with this reason). */
export type BatchBlock = "fixedAtCreation" | "claudeOffline" | "runtimeLacksModel" | "noThread";
/** When the change takes effect (cutex's rule for each route). */
export type BatchWhen = "now" | "afterTurn" | "nextStart";

export interface BatchRow extends BatchAgent {
  block: BatchBlock | null;
  when: BatchWhen;
  /** The reasoning effort sent with the model for this agent (null: none sent, the agent keeps its own). */
  effortSent: string | null;
  /** The chosen / kept effort is not offered for this agent's target: its target default is sent instead. */
  effortFallback: boolean;
  /** This agent's runtime lists the target with no efforts: the model takes no effort setting, none is sent. */
  effortNone: boolean;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One agent as the batch sees it (live thread settings first while online, else what cutex stored). `running`: the
 *  host's running rule (scopeAgents); absent = the runtime's active turn. */
export function batchAgent(s: SessionResource, projectId: string | null, running?: boolean): BatchAgent {
  const live = s.runtime?.threadSettings as { model?: unknown; effort?: unknown } | null | undefined;
  const online = s.runtime?.appServerConnected === true;
  return {
    id: s.cutexSessionId,
    name: s.displayName || s.cutexSessionId,
    projectId,
    profile: profileOf(s),
    runtime: runtimeOf(s),
    online,
    busy: running ?? !!s.runtime?.activeTurnId,
    threadId: s.native?.threadId ?? null,
    model: (online ? text(live?.model) : null) ?? modelOf(s) ?? text(s.launchBinding?.model),
    effort: (online ? text(live?.effort) : null) ?? text(s.runtimeDefaults?.reasoningEffort) ?? text(s.launchBinding?.reasoningEffort),
    runtimeVersion: text(s.launchBinding?.runtimePackageVersion),
  };
}

export function inScope(agent: BatchAgent, scope: Omit<BatchModelScope, "hostId" | "label">): boolean {
  if (scope.ids) return scope.ids.includes(agent.id);
  if (scope.independent) return agent.projectId === null;
  if (scope.projectId) return agent.projectId === scope.projectId;
  return true;
}

/** A source choice: one model of one Profile, with how many agents in scope use it. */
export interface BatchSource {
  key: string;
  profile: string;
  model: string;
  count: number;
}
export const sourceKey = (profile: string, model: string) => `${profile}\u0000${model}`;

/** The models in use (per Profile), most used first. Agents without a Profile or a known model are not sources. */
export function batchSources(agents: readonly BatchAgent[]): BatchSource[] {
  const counts = new Map<string, BatchSource>();
  for (const a of agents) {
    if (!a.profile || !a.model) continue;
    const key = sourceKey(a.profile, a.model);
    const row = counts.get(key) ?? { key, profile: a.profile, model: a.model, count: 0 };
    row.count++;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.profile.localeCompare(b.profile) || a.model.localeCompare(b.model));
}

/** One model of an online agent's own runtime (`model/list`): its names and the reasoning efforts it offers there. */
export interface RuntimeModel { ids: readonly string[]; efforts: readonly string[]; defaultEffort: string | null }
/** The models an online agent's own runtime offers; undefined: not read (yet), or the read failed. */
export type RuntimeModels = ReadonlyMap<string, readonly RuntimeModel[] | undefined>;

export function runtimeModel(m: Pick<ModelOption, "id" | "model" | "efforts" | "defaultEffort">): RuntimeModel {
  return { ids: [m.id, m.model], efforts: m.efforts ?? [], defaultEffort: m.defaultEffort ?? null };
}

const sameModel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const findModel = (list: readonly RuntimeModel[], model: string) => list.find((m) => m.ids.some((id) => sameModel(id, model)));

/** The effort limits that bind one agent for a target. `fromRuntime`: its own runtime's answer (an empty list there means
 *  the model takes no effort setting); otherwise the Profile catalog's (an empty list there says nothing). */
export interface EffortLimits { efforts: readonly string[]; defaultEffort: string | null; fromRuntime: boolean }

/** The effort limits that bind this agent for `target`: its own runtime's entry when read (online), else the Profile catalog's. */
export function effortLimits(agent: Pick<BatchAgent, "id" | "online">, target: string, runtimeModels: RuntimeModels, catalogTarget: Pick<CatalogModel, "supportedReasoningEfforts" | "defaultReasoningEffort"> | undefined): EffortLimits {
  const own = agent.online ? findModel(runtimeModels.get(agent.id) ?? [], target) : undefined;
  if (own) return { efforts: own.efforts, defaultEffort: own.defaultEffort, fromRuntime: true };
  return { efforts: catalogTarget?.supportedReasoningEfforts ?? [], defaultEffort: catalogTarget?.defaultReasoningEffort ?? null, fromRuntime: false };
}

/** The source's agents with their verdict for `target` and the effort each would get. */
export function batchRows(agents: readonly BatchAgent[], source: BatchSource, target: string, runtimeModels: RuntimeModels, effort: { choice: EffortChoice; catalogTarget?: Pick<CatalogModel, "supportedReasoningEfforts" | "defaultReasoningEffort"> } = { choice: "keep" }): BatchRow[] {
  return agents
    .filter((a) => a.profile === source.profile && a.model === source.model && a.model !== target)
    .map((a): BatchRow => {
      const when: BatchWhen = !a.online ? "nextStart" : a.busy ? "afterTurn" : "now";
      let block: BatchBlock | null = null;
      if (a.runtime === "dsh" || a.runtime === "kimi") block = "fixedAtCreation";
      else if (a.online) {
        const list = runtimeModels.get(a.id);
        if (!a.threadId) block = "noThread";
        else if (list && !findModel(list, target)) block = "runtimeLacksModel";
      } else if (a.runtime === "claude") block = "claudeOffline";
      const sent = effortFor(a, effort.choice, effortLimits(a, target, runtimeModels, effort.catalogTarget));
      return { ...a, block, when, effortSent: sent.effort, effortFallback: sent.fallback, effortNone: sent.none };
    })
    .sort((x, y) => Number(!!x.block) - Number(!!y.block) || x.name.localeCompare(y.name));
}

/** "keep": the agent's own effort when the target offers it, else the target's default; otherwise this effort. */
export type EffortChoice = "keep" | string;

/**
 * The effort sent with the model for one agent, within the limits that bind it (effortLimits). null: none sent (the
 * agent keeps its own). An effort the target does not offer there is never sent: its default goes instead (fallback).
 */
export function effortFor(row: Pick<BatchAgent, "effort">, choice: EffortChoice, limits: Partial<EffortLimits> & Pick<EffortLimits, "efforts" | "defaultEffort">): { effort: string | null; fallback: boolean; none: boolean } {
  // The agent's runtime lists the target without efforts: it takes no effort setting at all.
  if (limits.fromRuntime && limits.efforts.length === 0) return { effort: null, fallback: false, none: true };
  const offered = (e: string) => limits.efforts.length === 0 || limits.efforts.includes(e);
  const wanted = choice === "keep" ? row.effort : choice;
  if (!wanted) return { effort: null, fallback: false, none: false };
  if (offered(wanted)) return { effort: choice === "keep" ? null : wanted, fallback: false, none: false };
  const fallback = limits.defaultEffort && offered(limits.defaultEffort) ? limits.defaultEffort : null;
  return { effort: fallback, fallback: true, none: false };
}

export type BatchResult = { id: string; ok: true; when: BatchWhen } | { id: string; ok: false; error: string };

/** One agent's change through cutex (see the head of this file). */
export async function applyOne(hostId: string, row: BatchRow, model: string, effort: string | null): Promise<BatchResult> {
  const api = hostApi(hostId);
  try {
    if (row.online) {
      if (!row.threadId) throw new Error("no thread");
      await api.updateThreadSettings(row.id, row.threadId, { model, ...(effort ? { effort } : {}) });
    } else {
      await api.sessionAction(row.id, "cutex/session/defaults/update", { patch: { model, ...(effort ? { reasoningEffort: effort } : {}) } });
    }
    return { id: row.id, ok: true, when: row.when };
  } catch (error) {
    return { id: row.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------- the dialog's state ----------

export type BatchPhase = "pick" | "applying" | "done";

interface BatchModelState {
  scope: BatchModelScope | null;
  /** The agent list's selection the dialog opened with (stays a scope choice after switching scope). */
  selection: BatchModelScope | null;
  sourceKey: string | null;
  target: string | null;
  effort: EffortChoice;
  /** Unticked rows (everything that is not blocked starts ticked). */
  unticked: ReadonlySet<string>;
  /** The target Profile's catalog (null: loading; error text on failure). */
  catalog: CatalogModel[] | null;
  catalogError: string | null;
  runtimeModels: RuntimeModels;
  /** Online agents' model lists still being read (应用 waits for them). */
  pendingReads: number;
  phase: BatchPhase;
  results: readonly BatchResult[];
}

const initial: BatchModelState = { scope: null, selection: null, sourceKey: null, target: null, effort: "keep", unticked: new Set(), catalog: null, catalogError: null, runtimeModels: new Map(), pendingReads: 0, phase: "pick", results: [] };

export const useBatchModel = create<BatchModelState>(() => initial);

export function openBatchModel(scope: BatchModelScope): void {
  useBatchModel.setState({ ...initial, scope, selection: scope.ids ? scope : null });
}
/** Another scope in the open dialog (the source / target / ticks start again). */
export function setBatchScope(scope: BatchModelScope): void {
  catalogRead++;
  useBatchModel.setState((s) => ({ ...initial, scope, selection: s.selection }));
}
export function closeBatchModel(): void {
  useBatchModel.setState(initial);
}

/** The agents of the open scope on its host (active, not archived). */
/** Whether `s` has a running turn by the composer's rule: ledger hosts read the delivery (a stale activeTurnId of a held /
 *  starting agent is not running; finishing without one is), older hosts — and a ledger session whose delivery is not
 *  read yet — the runtime's active turn. The dialog reads the listed agents' ledgers (watchInputs). */
export function runningOn(app: ReturnType<typeof useApp.getState>, hostId: string, s: SessionResource): boolean {
  const ledger = usesInputLedger([...(featuresOf(app, hostId) ?? [])]);
  return turnRunning(ledger, agentState(app.inputs ?? {}, hostId, s.cutexSessionId)?.delivery, !!s.runtime?.activeTurnId);
}

export function scopeAgents(scope: BatchModelScope, app = useApp.getState()): BatchAgent[] {
  const sidebar = sidebarOf(app, scope.hostId);
  if (!sidebar) return [];
  return sidebar.active
    .filter((s) => s.lifecycle !== "retired")
    .map((s) => batchAgent(s, (sidebar.hostRows[s.cutexSessionId]?.projectId as string | null | undefined) ?? null, runningOn(app, scope.hostId, s)))
    .filter((a) => inScope(a, scope));
}

let catalogRead = 0;
/** Picks the source: reads that Profile's catalog and the online agents' own model lists. */
export async function chooseSource(source: BatchSource | null, agents: readonly BatchAgent[]): Promise<void> {
  const scope = useBatchModel.getState().scope;
  useBatchModel.setState({ sourceKey: source?.key ?? null, target: null, effort: "keep", unticked: new Set(), catalog: null, catalogError: null, runtimeModels: new Map(), pendingReads: 0 });
  if (!scope || !source) return;
  const read = ++catalogRead;
  const api = hostApi(scope.hostId);
  const online = agents.filter((a) => a.profile === source.profile && a.model === source.model && a.online && (a.runtime === "codex" || a.runtime === "claude"));
  useBatchModel.setState({ pendingReads: online.length });
  void Promise.all(online.map(async (a) => {
    const list = await api.listModels(a.id).then((models: ModelOption[]) => models.map(runtimeModel), () => undefined);
    if (read !== catalogRead) return;
    useBatchModel.setState((s) => ({ runtimeModels: new Map([...s.runtimeModels, [a.id, list]]), pendingReads: Math.max(0, s.pendingReads - 1) }));
  }));
  try {
    const view = await api.profileModels(source.profile);
    if (read === catalogRead) useBatchModel.setState({ catalog: view.models });
  } catch (error) {
    if (read === catalogRead) useBatchModel.setState({ catalog: [], catalogError: error instanceof Error ? error.message : String(error) });
  }
}

export function chooseTarget(target: string | null): void {
  useBatchModel.setState({ target, effort: "keep", unticked: new Set() });
}
export function chooseEffort(effort: EffortChoice): void {
  useBatchModel.setState({ effort });
}
export function toggleBatchRow(id: string): void {
  useBatchModel.setState((s) => {
    const next = new Set(s.unticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { unticked: next };
  });
}

/** The ticked, unblocked rows: what 应用 changes. */
export function tickedRows(rows: readonly BatchRow[], unticked: ReadonlySet<string>): BatchRow[] {
  return rows.filter((r) => !r.block && !unticked.has(r.id));
}

/** Runs the batch: a few agents at a time, one result per agent. */
export async function applyBatch(rows: readonly BatchRow[]): Promise<void> {
  const { scope, target, effort, catalog } = useBatchModel.getState();
  if (!scope || !target || rows.length === 0) return;
  const catalogTarget = catalog?.find((m) => m.id === target);
  useBatchModel.setState({ phase: "applying", results: [] });
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      // Worked out when this agent's request is built, from its model list as read by now (a list that arrived after
      // the click or while earlier agents were sent counts), never from a stale row or snapshot.
      const latest = useBatchModel.getState().runtimeModels;
      const result = await applyOne(scope.hostId, row, target, effortFor(row, effort, effortLimits(row, target, latest, catalogTarget)).effort);
      useBatchModel.setState((s) => ({ results: [...s.results, result] }));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  useBatchModel.setState({ phase: "done" });
}
