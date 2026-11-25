// Sidebar session search (harness survey C3; cutex r295 `GET /v2/sessions/search`, capability `session-search-v1`,
// handoff .claude/reports/r295-session-search-sidebar.md). One host per request, read-only, background priority.
// `sessions` mode: sessions whose launch directory is `cwd` or below it (and / or whose name matches `q`).
// `tasks` mode: saved turn summaries (first user message, last reply) matching `q`, newest turn first per session.
// The host's rows are untrusted: main checks the shape before the renderer sees them; titles and snippets are plain text.

export const SESSION_SEARCH_FEATURE = "session-search-v1";
export const SESSION_SEARCH_PATH = "/v2/sessions/search";
/**
 * cutex r297 search v2 (`version=2` on the same route; v1 requests unchanged): order=newest (agents by updatedAt,
 * newest turn first within each), since / until, projectId, task kind and sender filters; rows carry projectId and,
 * for tasks, turn times, kind, matchedIn and sender. Contract: cutex docs/management-v2-session-search.md.
 */
export const SESSION_SEARCH_V2_FEATURE = "session-search-v2";
export const SEARCH_KINDS = ["messages", "delegations", "results"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
/** The sender filter (`agent` includes non-owner bus input). */
export type SearchSender = "owner" | "agent" | "all";
/** Where the text matched (v2 task rows). */
export type SearchMatchedIn = "userMessage" | "agentMessage" | "delegationBrief" | "delegationResult";
const PROJECT_ID_MAX = 200;
/** cutex refuses longer search text (characters). */
export const SESSION_SEARCH_Q_MAX = 128;
/** cutex refuses longer directory paths (bytes; checked here in characters, which is no looser for ASCII). */
export const SESSION_SEARCH_CWD_MAX = 2048;
const SESSION_ID_MAX = 512;
const CURSOR_MAX = 4096;
/** Untrusted text from the host is cut to this many characters before it reaches the UI. */
const TEXT_MAX = 16_384;

export type SessionSearchMode = "sessions" | "tasks";

export interface SessionSearchQuery {
  mode: SessionSearchMode;
  /** An absolute directory of that host (Windows or POSIX, as the host writes it). */
  cwd?: string;
  /** Literal, case-insensitive; required in `tasks` mode. */
  q?: string;
  /** `retired` = the archived catalog (owner connections only; cutex answers 403 owner_required otherwise). */
  lifecycle?: "active" | "retired";
  sessionId?: string;
  cursor?: string;
  // ---- v2 (session-search-v2 hosts only; any of these sends version=2) ----
  version?: 2;
  order?: "newest" | "sessionId";
  /** RFC 3339; inclusive (tasks: turn start, else completion; rows without a time are left out). */
  since?: string;
  /** RFC 3339; exclusive. */
  until?: string;
  projectId?: string;
  kind?: SearchKind;
  sender?: SearchSender;
}

/** The v2 filters of a task search (what a v1 host cannot apply). */
export interface SearchV2Filters {
  since?: string;
  until?: string;
  projectId?: string;
  kind?: SearchKind;
  sender?: SearchSender;
}

/** A v2 filter is set (not just the order): only session-search-v2 hosts can apply it. */
export function hasV2Filter(f: SearchV2Filters | null | undefined): boolean {
  return !!f && !!(f.since || f.until || f.projectId || f.kind || (f.sender && f.sender !== "all"));
}

export interface SessionSearchRow {
  hostId: string;
  cutexSessionId: string;
  displayName: string;
  cwd: string;
  lifecycle: "active" | "retired";
  updatedAt: string;
  /** v2: the agent's current project (null: none or unavailable); absent from v1 hosts. */
  projectId?: string | null;
}

export interface TaskSearchRow extends SessionSearchRow {
  turnId: string;
  title: string;
  snippet: string;
  turnStatus: "completed" | "failed" | "interrupted";
  /**
   * When the turn started / ended (RFC 3339). Not in session-search-v1 (requested 2026-11-26: the native turn has
   * `startedAt` / `completedAt`); read when a host sends them. Without them a hit has no time of its own (`updatedAt` is
   * the agent's, not the turn's).
   */
  turnStartedAt?: string;
  turnCompletedAt?: string;
  /** v2 rows: which kind of text matched, where, and who sent the turn's input (`unknown`: no evidence). */
  kind?: SearchKind;
  matchedIn?: SearchMatchedIn;
  sender?: "owner" | "agent" | "unknown";
}

interface SearchPage {
  contractVersion: 2;
  /** The host's own name (not necessarily the desktop's connection id). */
  hostId: string;
  nextCursor: string | null;
  /**
   * Another page may be requested: true exactly when `nextCursor` is set. A tasks page can be empty with more pages
   * (the host's scan budget of a few summary pages ran out); that is never the end.
   */
  more: boolean;
  /** Some authorized history of this page was truncated or unavailable. */
  partial: boolean;
  /** v2 replies: 2, and the order the host visited agents in (`agentUpdatedAt` = order=newest; not strict turn order). */
  searchVersion?: 2;
  order?: "agentUpdatedAt" | "sessionId";
}
export type SessionSearchResponse = SearchPage & ({ mode: "sessions"; items: SessionSearchRow[] } | { mode: "tasks"; items: TaskSearchRow[] });

const CONTROL = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex -- refuse control characters in ids / paths

/** The query as sent (only known fields, each checked); throws on what cutex would refuse anyway. */
export function sessionSearchParams(query: SessionSearchQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.mode !== "sessions" && query.mode !== "tasks") throw new Error("session search: mode must be sessions or tasks");
  out.mode = query.mode;
  const q = query.q?.trim() ?? "";
  if ([...q].length > SESSION_SEARCH_Q_MAX) throw new Error("session search: text too long");
  if (query.mode === "tasks" && !q) throw new Error("session search: task search requires text");
  if (q) out.q = q;
  if (query.cwd !== undefined) {
    const cwd = query.cwd.trim();
    if (!cwd || cwd.length > SESSION_SEARCH_CWD_MAX || CONTROL.test(cwd)) throw new Error("session search: invalid directory");
    out.cwd = cwd;
  }
  if (query.lifecycle !== undefined) {
    if (query.lifecycle !== "active" && query.lifecycle !== "retired") throw new Error("session search: invalid lifecycle");
    if (query.lifecycle === "retired") out.lifecycle = "retired";
  }
  if (query.sessionId !== undefined) {
    if (!query.sessionId || query.sessionId.length > SESSION_ID_MAX || CONTROL.test(query.sessionId)) throw new Error("session search: invalid sessionId");
    out.sessionId = query.sessionId;
  }
  const v2 = query.version === 2 || query.order !== undefined || query.since !== undefined || query.until !== undefined || query.projectId !== undefined || query.kind !== undefined || query.sender !== undefined;
  if (v2) {
    out.version = "2";
    if (query.order !== undefined) {
      if (query.order !== "newest" && query.order !== "sessionId") throw new Error("session search: invalid order");
      out.order = query.order;
    }
    const time = (v: string | undefined, name: string) => {
      if (v === undefined) return undefined;
      if (v.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v))) throw new Error(`session search: invalid ${name}`);
      out[name] = v;
      return Date.parse(v);
    };
    const since = time(query.since, "since"), until = time(query.until, "until");
    if (since !== undefined && until !== undefined && !(since < until)) throw new Error("session search: since must precede until");
    if (query.projectId !== undefined) {
      if (!query.projectId || query.projectId.length > PROJECT_ID_MAX || CONTROL.test(query.projectId)) throw new Error("session search: invalid projectId");
      out.projectId = query.projectId;
    }
    if (query.kind !== undefined || (query.sender !== undefined && query.sender !== "all")) {
      if (query.mode !== "tasks") throw new Error("session search: kind and sender require task mode");
    }
    if (query.kind !== undefined) {
      if (!(SEARCH_KINDS as readonly string[]).includes(query.kind)) throw new Error("session search: invalid kind");
      out.kind = query.kind;
    }
    if (query.sender !== undefined) {
      if (query.sender !== "owner" && query.sender !== "agent" && query.sender !== "all") throw new Error("session search: invalid sender");
      if (query.sender !== "all") out.sender = query.sender;
    }
  }
  if (query.cursor !== undefined) {
    if (!query.cursor || query.cursor.length > CURSOR_MAX || CONTROL.test(query.cursor)) throw new Error("session search: invalid cursor");
    out.cursor = query.cursor;
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = TEXT_MAX): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const id = (v: unknown): string | null => (typeof v === "string" && v && v.length <= SESSION_ID_MAX && !CONTROL.test(v) ? v : null);

function row(raw: unknown): SessionSearchRow | null {
  if (!isRecord(raw)) return null;
  const hostId = str(raw.hostId, 200), cutexSessionId = id(raw.cutexSessionId), displayName = str(raw.displayName, 400), cwd = str(raw.cwd, SESSION_SEARCH_CWD_MAX), updatedAt = str(raw.updatedAt, 64);
  if (hostId === null || !cutexSessionId || displayName === null || cwd === null || updatedAt === null) return null;
  if (raw.lifecycle !== "active" && raw.lifecycle !== "retired") return null;
  const projectId = raw.projectId === null ? null : typeof raw.projectId === "string" && raw.projectId.length <= PROJECT_ID_MAX && !CONTROL.test(raw.projectId) ? raw.projectId : undefined;
  return { hostId, cutexSessionId, displayName, cwd, lifecycle: raw.lifecycle, updatedAt, ...(projectId !== undefined ? { projectId } : {}) };
}

/** An RFC 3339 time a host sent (kept as sent), or null when absent / not a time. */
const when = (v: unknown): string | null => (typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v)) ? v : null);

function task(raw: unknown): TaskSearchRow | null {
  const base = row(raw);
  if (!base || !isRecord(raw)) return null;
  const turnId = id(raw.turnId), title = str(raw.title), snippet = str(raw.snippet);
  if (!turnId || title === null || snippet === null) return null;
  if (raw.turnStatus !== "completed" && raw.turnStatus !== "failed" && raw.turnStatus !== "interrupted") return null;
  const startedAt = when(raw.turnStartedAt), completedAt = when(raw.turnCompletedAt);
  const kind = (SEARCH_KINDS as readonly unknown[]).includes(raw.kind) ? (raw.kind as SearchKind) : undefined;
  const matchedIn = raw.matchedIn === "userMessage" || raw.matchedIn === "agentMessage" || raw.matchedIn === "delegationBrief" || raw.matchedIn === "delegationResult" ? raw.matchedIn : undefined;
  const sender = raw.sender === "owner" || raw.sender === "agent" || raw.sender === "unknown" ? raw.sender : undefined;
  return {
    ...base, turnId, title, snippet, turnStatus: raw.turnStatus,
    ...(startedAt ? { turnStartedAt: startedAt } : {}), ...(completedAt ? { turnCompletedAt: completedAt } : {}),
    ...(kind ? { kind } : {}), ...(matchedIn ? { matchedIn } : {}), ...(sender ? { sender } : {}),
  };
}

/** A host reply → the checked page; a malformed row is dropped, a malformed page throws. */
export function parseSessionSearchResponse(raw: unknown): SessionSearchResponse {
  if (!isRecord(raw) || raw.contractVersion !== 2 || typeof raw.hostId !== "string" || typeof raw.partial !== "boolean" || !Array.isArray(raw.items)) throw new Error("session search: malformed reply");
  if (raw.nextCursor !== null && (typeof raw.nextCursor !== "string" || !raw.nextCursor || raw.nextCursor.length > CURSOR_MAX)) throw new Error("session search: malformed cursor");
  // `more` (r295 merge): true exactly when there is a cursor; a reply that says otherwise is not trusted.
  const more = raw.nextCursor !== null;
  if (raw.more !== undefined && raw.more !== more) throw new Error("session search: more disagrees with nextCursor");
  const page = {
    contractVersion: 2 as const, hostId: raw.hostId.slice(0, 200), nextCursor: raw.nextCursor, more, partial: raw.partial,
    ...(raw.searchVersion === 2 ? { searchVersion: 2 as const } : {}),
    ...(raw.order === "agentUpdatedAt" || raw.order === "sessionId" ? { order: raw.order as "agentUpdatedAt" | "sessionId" } : {}),
  };
  if (raw.mode === "sessions") return { ...page, mode: "sessions", items: raw.items.slice(0, 30).map(row).filter((r): r is SessionSearchRow => !!r) };
  if (raw.mode === "tasks") return { ...page, mode: "tasks", items: raw.items.slice(0, 30).map(task).filter((r): r is TaskSearchRow => !!r) };
  throw new Error("session search: malformed mode");
}

/** cutex refused the cursor (changed filters, expired): the search starts again from the first page. */
export function isCursorRejected(error: unknown): boolean {
  return /search cursor/i.test(error instanceof Error ? error.message : String(error));
}

// ---- one result's turn (the search page's preview) ----

/** cutex `history-turn-read`: `GET /v2/sessions/{id}/history/turns/{turnId}`, one bounded turn. */
export const HISTORY_TURN_READ_FEATURE = "history-turn-read";
/** Messages of one turn the preview keeps (the first ones; a long turn says it was cut). */
const PREVIEW_MESSAGES = 24;
const PREVIEW_TEXT = 8_000;

export interface SearchTurnMessage {
  /** The turn's input (`userMessage`: the owner's, or an agent's / the bus's — the turn does not say) or the agent's reply. */
  role: "input" | "reply";
  text: string;
}

/** The turn a search result points at, as the preview shows it: plain text, the native times. */
export interface SearchTurnPreview {
  turnId: string;
  status: string;
  /** Unix seconds (the native turn's `startedAt` / `completedAt`); null when the runtime does not say. */
  startedAt: number | null;
  completedAt: number | null;
  messages: SearchTurnMessage[];
  /** The host cut the turn (bounded preview) or the preview kept only the first messages. */
  truncated: boolean;
}

const seconds = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

function messageOf(item: unknown): SearchTurnMessage | null {
  if (!isRecord(item)) return null;
  if (item.type === "userMessage" && Array.isArray(item.content)) {
    const text = item.content.map((c) => (isRecord(c) && c.type === "text" && typeof c.text === "string" ? c.text : "")).join("\n").trim();
    return text ? { role: "input", text: text.slice(0, PREVIEW_TEXT) } : null;
  }
  if (item.type === "agentMessage" && typeof item.text === "string" && item.text.trim()) return { role: "reply", text: item.text.trim().slice(0, PREVIEW_TEXT) };
  return null;
}

/** A `history-turn-read` answer → the preview of `turnId` (null: the answer has no such turn). Untrusted: shape checked. */
export function parseTurnPreview(raw: unknown, turnId: string): SearchTurnPreview | null {
  if (!isRecord(raw) || !isRecord(raw.native) || !isRecord(raw.native.result)) return null;
  const thread = raw.native.result.thread;
  const turns = isRecord(thread) && Array.isArray(thread.turns) ? thread.turns : [];
  const turn = turns.find((x): x is Record<string, unknown> => isRecord(x) && x.id === turnId);
  if (!turn) return null;
  const items = Array.isArray(turn.items) ? turn.items : [];
  const all = items.map(messageOf).filter((m): m is SearchTurnMessage => !!m);
  const cut = turn.truncated === true || raw.complete === false || items.some((i) => isRecord(i) && i.truncated === true);
  return {
    turnId,
    status: typeof turn.status === "string" ? turn.status.slice(0, 32) : "",
    startedAt: seconds(turn.startedAt),
    completedAt: seconds(turn.completedAt),
    messages: all.slice(0, PREVIEW_MESSAGES),
    truncated: cut || all.length > PREVIEW_MESSAGES,
  };
}
