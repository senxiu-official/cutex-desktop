// Mock `GET /v2/sessions/search` (cutex r295, session-search-v1) over a mock host's sessions and threads: the same
// paging as cutex (stable session-id order, `sessions` 30 per page, `tasks` one session per page up to 12 turns, newest
// turn first, an empty page can carry a cursor), cursors bound to their query, `partial` for a session without history.
import type { SessionResource } from "@cutex-desktop/protocol";
import { sessionSearchParams, type SessionSearchQuery, type SessionSearchResponse, type SessionSearchRow, type TaskSearchRow } from "../../../shared/sessionSearch";

type MockItem = { type?: string; text?: string; content?: { type?: string; text?: string }[] };
export type MockSearchTurn = { id: string; status?: string; items?: MockItem[]; startedAt?: number | null; completedAt?: number | null };

// `?turntimes`: the hosts send each result's turn time (turnStartedAt / turnCompletedAt, requested 2026-11-26; not in
// session-search-v1): the turn's own startedAt, else a time made up from its place (preview only).
const TURN_TIMES = typeof location !== "undefined" && new URLSearchParams(location.search).has("turntimes");
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

const SESSIONS_PAGE = 30;
const TASK_TURNS = 12;

/** Lexical, component-bounded: `cwd` itself or below it. Windows paths compare case-insensitively. */
export function mockCwdMatches(cwd: string | null | undefined, filter: string): boolean {
  if (!cwd) return false;
  const windows = /^[a-z]:[\\/]/i.test(filter) || filter.includes("\\");
  const norm = (p: string) => {
    const s = windows ? p.replace(/\//g, "\\").toLowerCase() : p;
    return s.length > 1 ? s.replace(/[\\/]+$/, "") : s;
  };
  const a = norm(cwd), b = norm(filter);
  if (a === b) return true;
  const sep = windows ? "\\" : "/";
  return a.startsWith(b.endsWith(sep) ? b : b + sep);
}

const textOf = (item: MockItem) => (item.type === "userMessage" ? (item.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join(" ") : item.type === "agentMessage" ? item.text ?? "" : "");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The turn's summary like the runtime's (first user message, last reply); null while it runs. */
function summary(turn: MockSearchTurn) {
  const status = turn.status === "failed" ? "failed" : turn.status === "interrupted" ? "interrupted" : turn.status === "completed" ? "completed" : null;
  if (!status) return null;
  const items = turn.items ?? [];
  const first = oneLine(textOf(items.find((i) => i.type === "userMessage") ?? {}));
  const last = oneLine(textOf([...items].reverse().find((i) => i.type === "agentMessage") ?? {}));
  return { status, first, last } as const;
}

function excerpt(text: string, q: string): string {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return text.slice(0, 140);
  const from = Math.max(0, at - 40);
  return (from > 0 ? "…" : "") + text.slice(from, at + q.length + 80) + (at + q.length + 80 < text.length ? "…" : "");
}

const encode = (key: string, index: number, turn = 0) => btoa(unescape(encodeURIComponent(JSON.stringify({ key, index, turn }))));
function decode(cursor: string, key: string): { index: number; turn: number } {
  let parsed: { key?: unknown; index?: unknown; turn?: unknown };
  try {
    parsed = JSON.parse(decodeURIComponent(escape(atob(cursor))));
  } catch {
    throw new Error("invalid_request: invalid search cursor");
  }
  if (parsed.key !== key) throw new Error("invalid_request: search cursor belongs to another query");
  if (typeof parsed.index !== "number" || parsed.index < 0 || typeof parsed.turn !== "number" || parsed.turn < 0) throw new Error("invalid_request: search cursor is invalid or expired");
  return { index: parsed.index, turn: parsed.turn };
}

export interface MockSearchHost {
  /** The host's own name (the reply's `hostId`). */
  name: string;
  sessions: () => SessionResource[];
  turns: (sessionId: string) => MockSearchTurn[] | null;
  /** Owner connection (archived search allowed). */
  owner?: boolean;
  /** v2 rows' projectId (the host's own project of the agent; null = none). */
  projectOf?: (sessionId: string) => string | null;
  delayMs?: number;
}

export async function mockSessionSearch(host: MockSearchHost, query: SessionSearchQuery): Promise<SessionSearchResponse> {
  const params = sessionSearchParams(query);
  if (params.lifecycle === "retired" && host.owner === false) throw new Error("owner_required: archived search is owner-only");
  await new Promise((r) => setTimeout(r, host.delayMs ?? 350));
  const key = JSON.stringify([params.mode, params.cwd ?? "", (params.q ?? "").toLowerCase(), params.lifecycle ?? "active", params.sessionId ?? "", params.version ?? "", params.order ?? "", params.since ?? "", params.until ?? "", params.projectId ?? "", params.kind ?? "", params.sender ?? ""]);
  // r297 session-search-v2 (version=2): order=newest, since / until, projectId, kind, sender; richer rows.
  const v2 = params.version === "2";
  const since = params.since ? Date.parse(params.since) : null, until = params.until ? Date.parse(params.until) : null;
  const inRange = (ms: number | null) => (since === null || (ms !== null && ms >= since)) && (until === null || (ms !== null && ms < until));
  const updated = (x: SessionResource) => Date.parse(x.updatedAt ?? x.createdAt ?? "") || 0;
  const { index: start, turn: turnFrom } = params.cursor ? decode(params.cursor, key) : { index: 0, turn: 0 };
  const lifecycle = params.lifecycle === "retired" ? "retired" : "active";
  const q = (params.q ?? "").toLowerCase();
  const candidates = host
    .sessions()
    .filter((s) => (s.lifecycle ?? "active") === lifecycle && (!params.cwd || mockCwdMatches(s.cwd, params.cwd)) && (!params.sessionId || s.cutexSessionId === params.sessionId))
    .filter((s) => !v2 || !params.projectId || (host.projectOf?.(s.cutexSessionId) ?? null) === params.projectId)
    .sort((a, b) => (v2 && params.order === "newest" ? updated(b) - updated(a) : 0) || (a.cutexSessionId < b.cutexSessionId ? -1 : a.cutexSessionId > b.cutexSessionId ? 1 : 0));
  const rowOf = (s: SessionResource): SessionSearchRow => ({ hostId: host.name, cutexSessionId: s.cutexSessionId, displayName: s.displayName, cwd: s.cwd ?? "", lifecycle, updatedAt: s.updatedAt ?? s.createdAt ?? "", ...(v2 ? { projectId: host.projectOf?.(s.cutexSessionId) ?? null } : {}) });
  const base = { contractVersion: 2 as const, hostId: host.name, ...(v2 ? { searchVersion: 2 as const, order: params.order === "newest" ? ("agentUpdatedAt" as const) : ("sessionId" as const) } : {}) };
  if (params.mode === "sessions") {
    const named = (q ? candidates.filter((s) => s.displayName.toLowerCase().includes(q) || (s.formalAgentName ?? "").toLowerCase().includes(q)) : candidates).filter((s) => !v2 || inRange(updated(s) || null));
    const page = named.slice(start, start + SESSIONS_PAGE);
    const next = start + SESSIONS_PAGE < named.length ? encode(key, start + SESSIONS_PAGE) : null;
    return { ...base, mode: "sessions", items: page.map(rowOf), nextCursor: next, more: next !== null, partial: false };
  }
  // The mock's many synthetic agents have no turns: task pages skip them (cutex would return an empty page for each).
  const withHistory = candidates.filter((s) => { const turns = host.turns(s.cutexSessionId); return turns === null || turns.length > 0; });
  const session = withHistory[start];
  if (!session) return { ...base, mode: "tasks", items: [], nextCursor: null, more: false, partial: false };
  const turns = host.turns(session.cutexSessionId);
  const newest = [...(turns ?? [])].reverse();
  const items: TaskSearchRow[] = [];
  for (const [i, turn] of newest.slice(turnFrom, turnFrom + TASK_TURNS).entries()) {
    const s = summary(turn);
    if (!s) continue;
    const hay = `${s.first} ${s.last}`;
    if (!hay.toLowerCase().includes(q)) continue;
    const inPrompt = s.first.toLowerCase().includes(q);
    if (v2) {
      const times = turnTimes(turn, start, turnFrom + i);
      if (!inRange(Date.parse(times.turnStartedAt))) continue;
      // Who sent the input (mock: from the turn id) and what kind of text matched.
      const sender = mockSender(turn.id);
      const kind = sender === "agent" ? (inPrompt ? "delegations" : "results") : "messages";
      const matchedIn = sender === "agent" ? (inPrompt ? "delegationBrief" : "delegationResult") : inPrompt ? "userMessage" : "agentMessage";
      if (params.kind && params.kind !== kind) continue;
      if (params.sender && params.sender !== sender) continue;
      items.push({ ...rowOf(session), turnId: turn.id, title: s.first.slice(0, 80), snippet: excerpt(inPrompt ? s.first : s.last, q), turnStatus: s.status, ...times, kind, matchedIn, sender });
      continue;
    }
    items.push({ ...rowOf(session), turnId: turn.id, title: s.first.slice(0, 80), snippet: excerpt(inPrompt ? s.first : s.last, q), turnStatus: s.status, ...(TURN_TIMES ? turnTimes(turn, start, turnFrom + i) : {}) });
  }
  // More turns of this session first, then the next session.
  const next = turnFrom + TASK_TURNS < newest.length ? encode(key, start, turnFrom + TASK_TURNS) : start + 1 < withHistory.length ? encode(key, start + 1) : null;
  return { ...base, mode: "tasks", items, nextCursor: next, more: next !== null, partial: turns === null };
}

function turnTimes(turn: MockSearchTurn, session: number, index: number): { turnStartedAt: string; turnCompletedAt?: string } {
  const started = turn.startedAt ?? Date.now() / 1000 - ((session * 5 + index) * 3.3 + 0.4) * 3600;
  return { turnStartedAt: iso(started), ...(turn.completedAt ? { turnCompletedAt: iso(turn.completedAt) } : {}) };
}

/** Mock origin evidence: most turns the owner's, some an agent's (a delegation), a few unknown. */
function mockSender(turnId: string): "owner" | "agent" | "unknown" {
  let h = 0;
  for (const c of turnId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 11 === 0 ? "unknown" : h % 3 === 0 ? "agent" : "owner";
}
