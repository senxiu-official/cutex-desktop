// 项目看板 — adapters for the backend board data (r290 P6, contract draft docs/project-board-contract.md in the cutex
// tree: `GET /v2/board`). Every read of a not-yet-shipped field is here and only here, behind its capability, so the
// final names change in one place. A host without a capability → the adapter returns null and the board falls back
// to today's reads (shared/boardModel.ts) or hides that part; it never guesses.
//
// What lights up when a host adds it:
//   project-board-summary-v1     (G1)  main reads `GET /v2/board` once per host instead of the delegation /
//                                       notice / approval / service / quota lists; counts, 今天完成, 需要你 and
//                                       problems come from it (member tiles still from the sidebar catalog).
//   delegation-steps-v1          (G2)  steps {done,total} on a delegation's progress line (缩略视图 动态).
//   delegation-quiet-v1          (G3)  cutex's own `stalled` → a red 「没有进展」 problem on the card.
//   project-director-progress-v1 (G10) the 主管's plan bar (计划 N/M · 当前) and 目标 on the card.
import type { ProjectSummary } from "@cutex-desktop/protocol";
import type { AskSummary } from "./ipc";
import type { BoardBackendParts, BoardProblem, BoardProblemKind } from "./board";

export const BOARD_SUMMARY_FEATURE = "project-board-summary-v1";
export const ASK_STEPS_FEATURE = "delegation-steps-v1";
export const ASK_STALLED_FEATURE = "delegation-quiet-v1";
export const PROJECT_PLAN_FEATURE = "project-director-progress-v1";

export function backendParts(features: ReadonlySet<string> | null | undefined): BoardBackendParts {
  const has = (f: string) => !!features?.has(f);
  return { summary: has(BOARD_SUMMARY_FEATURE), steps: has(ASK_STEPS_FEATURE), stalled: has(ASK_STALLED_FEATURE), plan: has(PROJECT_PLAN_FEATURE) };
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : null);
const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export interface BoardProgress { done: number; total: number; current: string | null }

/** `{done,total,currentStep}` (contract: steps and plan share this shape). */
export function progressOf(raw: unknown): BoardProgress | null {
  const p = obj(raw);
  const done = count(p?.done), total = count(p?.total);
  if (done === null || total === null || total === 0 || done > total) return null;
  return { done, total, current: str(p?.currentStep) ?? str(p?.current) };
}

/** G2: steps of a delegation (list row or board summary row). */
export function stepsOf(ask: AskSummary | Record<string, unknown>, parts: BoardBackendParts): BoardProgress | null {
  if (!parts.steps) return null;
  const a = ask as Record<string, unknown>;
  return progressOf(a.steps) ?? progressOf(obj(a.attempt)?.steps);
}

/** G3: cutex says this delegation is stalled (its rule: 15 min running + online + busy, no hold). */
export function stalledOf(ask: AskSummary | Record<string, unknown>, parts: BoardBackendParts): boolean {
  if (!parts.stalled) return false;
  const a = ask as Record<string, unknown>;
  return a.stalled === true || obj(a.attempt)?.stalled === true;
}

/** G10 via the projects list, should a host put it there; the board summary's `director.plan` is read in summaryProject(). */
export function planOf(project: ProjectSummary, parts: BoardBackendParts): BoardProgress | null {
  if (!parts.plan) return null;
  return progressOf(obj((project as unknown as Record<string, unknown>).director)?.plan);
}

export function goalOf(project: ProjectSummary, parts: BoardBackendParts): string | null {
  if (!parts.plan) return null;
  const d = obj((project as unknown as Record<string, unknown>).director);
  return goalText(d);
}

// ---------- G1: GET /v2/board ----------

/** A problem as `GET /v2/board` lists it: cutex's code and the agent / delegation id it is about (subject resolved by
 *  the model from the sidebar and the delegation examples). */
export interface BoardSummaryProblem {
  kind: BoardProblemKind; code: string; sessionId: string | null; askId: string | null;
  /** cutex marks it soft (lastTurnFailed: an idle member whose last turn failed) — shown, not an alarm. */
  soft: boolean;
}

/** One project of `GET /v2/board`, as far as the board uses it (null fields: the host declared the source unavailable). */
export interface BoardSummaryProject {
  projectKey: string;
  projectId: string;
  openDelegations: number | null;
  today: { done: number; failed: number } | null;
  needsYou: number | null;
  /** `problems.count`: exact even when `items` is cut at the examples limit; null: delegations unavailable (unknown). */
  problemCount: number | null;
  /** Of problemCount, how many are soft (lastTurnFailed) — only when the host gives per-code counts
   *  (`problems.byCode`, proposed for P6); null: the severity of unlisted problems is unknown. */
  softCount: number | null;
  /** `problems.byCode` when every count in it is valid: exact problems per cutex code; null otherwise. */
  byCode: Record<string, number> | null;
  problems: BoardSummaryProblem[];
  /** The project's 主管 as the summary saw it; its plan / goal belong to this session only. */
  directorSessionId: string | null;
  plan: BoardProgress | null;
  goal: string | null;
  /** `director.goalAvailable === false`: the host has not observed the 主管's goal — unknown, not "no goal". */
  goalUnknown: boolean;
  /** Open delegations the summary lists (for titles, steps / stalled on the progress lines); at most the examples limit. */
  delegations: { askId: string; title: string; target: string | null; steps: BoardProgress | null; stalled: boolean; note: string | null; at: string | null; toolSince: string | null }[];
}

/** cutex problem codes (P6 board.rs) → the card's kind and what the id names. Unknown codes stay "other" with the code. */
const PROBLEM_CODES: Record<string, { kind: BoardProblemKind; about: "ask" | "session"; soft?: true }> = {
  delegationStalled: { kind: "stalled", about: "ask" },
  stopUnconfirmed: { kind: "stopUnconfirmed", about: "ask" },
  delegationFailed: { kind: "delegationFailed", about: "ask" },
  handlerOffline: { kind: "handlerOffline", about: "ask" },
  handlerUnavailable: { kind: "handlerUnavailable", about: "ask" },
  memberError: { kind: "agentError", about: "session" },
  memberUnavailable: { kind: "memberUnavailable", about: "session" },
  lastTurnFailed: { kind: "lastTurnFailed", about: "session", soft: true },
};

function unavailable(availability: Record<string, unknown> | null, ...keys: string[]): boolean {
  return keys.some((key) => {
    const v = availability?.[key];
    return v === false || v === "unavailable" || obj(v)?.available === false;
  });
}

/** Soft problems in `problems.byCode` ({code: exact count}); null when the host does not send it or it is malformed. */
function softCountOf(byCode: Record<string, unknown> | null, listed: readonly BoardSummaryProblem[]): number | null {
  if (!byCode) return null;
  let soft = 0;
  for (const [code, n] of Object.entries(byCode)) {
    if (count(n) === null) return null;
    if (PROBLEM_CODES[code]?.soft) soft += count(n)!;
  }
  return Math.max(soft, listed.filter((x) => x.soft).length);
}

/** `problems.byCode` as exact counts; null when absent or any count is malformed. */
function byCodeOf(raw: Record<string, unknown> | null): Record<string, number> | null {
  if (!raw) return null;
  const out: Record<string, number> = {};
  for (const [code, n] of Object.entries(raw)) {
    if (count(n) === null) return null;
    out[code] = count(n)!;
  }
  return out;
}

/** Problem kinds about an agent whose rows group into one (「N 个智能体读不到状态」). */
export const GROUPED_PROBLEM_KINDS: ReadonlySet<BoardProblemKind> = new Set<BoardProblemKind>(["memberUnavailable", "agentError", "lastTurnFailed"]);

/** cutex code of a grouped kind (for its exact per-code count). */
export const PROBLEM_CODE_OF: Partial<Record<BoardProblemKind, string>> = { memberUnavailable: "memberUnavailable", agentError: "memberError", lastTurnFailed: "lastTurnFailed" };

/** An agent the board cannot name (not in this host's catalog): a short id, never the full `cutex.<uuid>`. */
export function shortAgentId(id: string): string {
  return id.replace(/^cutex./, "").slice(0, 8);
}

/** `director.goal`: cutex's native goal object `{objective,status}` (a plain string is accepted too). */
function goalText(director: Record<string, unknown> | null): string | null {
  if (!director || director.goalAvailable === false) return null;
  return str(director.goal, 1000) ?? str(obj(director.goal)?.objective, 1000);
}

/** Parse a `GET /v2/board` reply into per-project summaries keyed by projectId (malformed rows are skipped). */
export function parseBoardSummary(raw: unknown): Map<string, BoardSummaryProject> | null {
  const root = obj(raw);
  if (!root || !Array.isArray(root.projects)) return null;
  const rootAvail = obj(root.availability);
  const out = new Map<string, BoardSummaryProject>();
  for (const item of root.projects) {
    const p = obj(item);
    const projectId = str(p?.projectId, 200);
    if (!p || !projectId) continue;
    const avail = obj(p.availability) ?? rootAvail;
    const fin = p.finishedToday;
    const finObj = obj(fin);
    const today = unavailable(avail, "finishedToday") ? null
      // finishedToday: every ask closed in the host's local day (any disposition), not a success count.
      : count(fin) !== null ? { done: count(fin)!, failed: 0 }
      : finObj && count(finObj.done ?? finObj.completed) !== null ? { done: count(finObj.done ?? finObj.completed)!, failed: count(finObj.failed) ?? 0 } : null;
    const delegationsOff = unavailable(avail, "delegations");
    const problemsObj = obj(p.problems);
    const problems: BoardSummaryProblem[] = [];
    for (const it of Array.isArray(problemsObj?.items) ? (problemsObj!.items as unknown[]) : []) {
      const x = obj(it);
      const code = str(x?.code, 60);
      if (!x || !code) continue;
      const known = PROBLEM_CODES[code];
      const id = str(x.id, 200);
      // targetKind (agent | delegation) says what the id names; the code table covers hosts without it.
      const about = x.targetKind === "delegation" ? "ask" : x.targetKind === "agent" ? "session" : known?.about;
      problems.push({ kind: known?.kind ?? "other", code, askId: about === "ask" ? id : null, sessionId: about === "session" ? id : null, soft: known?.soft === true });
    }
    const director = obj(p.director);
    const delegations = (Array.isArray(p.delegations) ? p.delegations : []).flatMap((d) => {
      const r = obj(d);
      const askId = str(r?.askId, 200);
      if (!r || !askId) return [];
      const note = obj(r.progressNote);
      return [{
        askId, title: str(r.title) ?? "", target: str(r.target, 200), steps: progressOf(r.steps), stalled: r.stalled === true, note: str(note?.text), at: str(note?.at, 60),
        // A tool open for 15 min (stallReason longToolCall; never stalled): when it started.
        toolSince: r.stallReason === "longToolCall" ? str(r.toolCallStartedAt, 60) : null,
      }];
    });
    out.set(projectId, {
      projectKey: str(p.projectKey, 300) ?? projectId,
      projectId,
      openDelegations: delegationsOff ? null : count(p.openDelegationsCount),
      today,
      needsYou: unavailable(avail, "needs", "needsYou") ? null : (count(obj(p.needsYou)?.count) ?? count(p.needsYouCount)),
      // Never fewer than the examples listed; null (unknown) when the host cannot read delegations.
      problemCount: delegationsOff || count(problemsObj?.count) === null ? null : Math.max(count(problemsObj?.count)!, problems.length),
      softCount: softCountOf(obj(problemsObj?.byCode), problems),
      byCode: byCodeOf(obj(problemsObj?.byCode)),
      problems,
      directorSessionId: str(director?.sessionId, 200),
      plan: progressOf(director?.plan),
      goal: goalText(director),
      goalUnknown: director?.goalAvailable === false,
      delegations,
    });
  }
  return out;
}

/** A summary problem → the card's problem: the delegation's title / the agent's name, and a jump to it. */
export function summaryProblem(p: BoardSummaryProblem, hostId: string, sum: BoardSummaryProject, nameOf: (sessionId: string) => string | null): BoardProblem {
  if (p.askId) {
    const d = sum.delegations.find((x) => x.askId === p.askId);
    return { kind: p.kind, hostId, subject: d?.title ?? "", detail: d?.target ? (nameOf(d.target) ?? null) : null, target: { kind: "delegation", hostId, askId: p.askId }, ...(p.soft ? { soft: true } : {}) };
  }
  if (p.sessionId) return { kind: p.kind, hostId, subject: nameOf(p.sessionId) ?? shortAgentId(p.sessionId), detail: p.kind === "other" ? p.code : null, target: { kind: "agent", hostId, sessionId: p.sessionId }, ...(p.soft ? { soft: true } : {}) };
  return { kind: p.kind, hostId, subject: "", detail: p.kind === "other" ? p.code : null, target: null, ...(p.soft ? { soft: true } : {}) };
}
