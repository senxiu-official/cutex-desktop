// 项目看板 (board window, owner 2026-11-17): a separate, lightweight, portrait-first window for a second monitor. One
// card per project (or a shrunken 项目视图 per project, the 缩略视图 switch): health, the 主管 and what it is doing,
// counts, today's finished delegations, problems. Read-only; a click shows the main window at that project / agent.
// Main owns the window and its data (main/board.ts); the window has its own narrow preload (preload/board.ts) and
// only receives BoardState. This file: the IPC contract and the stored prefs.

import type { ShellLocale, ShellTermsPref } from "./ipc";

export const BOARD_CHANNEL = "cutex-desktop:board";
export const BOARD_STATE = "cutex-desktop:board-state";

export type BoardView = "cards" | "thumbnail";
export const BOARD_VIEWS: readonly BoardView[] = ["cards", "thumbnail"];

/** Stored by main in userData/board-window.json. */
export interface BoardPrefs {
  /** Open the board when the app starts (on its remembered display). */
  openOnLaunch: boolean;
  alwaysOnTop: boolean;
  bigText: boolean;
  view: BoardView;
  /** Project identity keys (shared/boardModel projectIdentity), in the owner's order; unknown ones are dropped on read. */
  order: string[];
  pinned: string[];
  hidden: string[];
  /** The window's last bounds (and its display), restored when that display is still there. */
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export const DEFAULT_BOARD_PREFS: BoardPrefs = {
  openOnLaunch: false, alwaysOnTop: false, bigText: false, view: "cards", order: [], pinned: [], hidden: [], bounds: null,
};

/** Portrait-first default size (a 1080×1920 screen's half width is too narrow; this is a third of 2560×1440 tall). */
export const BOARD_DEFAULT_SIZE = { width: 720, height: 1100 };
export const BOARD_MIN_SIZE = { width: 420, height: 480 };

const KEY_RE = /^[\s\S]{1,300}$/;
const keys = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && KEY_RE.test(v)))].slice(0, 500) : [];
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100_000 ? Math.round(v) : null);

/** Parse stored / renderer-sent prefs (anything unknown or malformed falls back to the default). */
export function parseBoardPrefs(raw: unknown): BoardPrefs {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const b = r.bounds && typeof r.bounds === "object" ? (r.bounds as Record<string, unknown>) : null;
  const [x, y, width, height] = b ? [int(b.x), int(b.y), int(b.width), int(b.height)] : [null, null, null, null];
  const bounds = x !== null && y !== null && width !== null && height !== null && width >= BOARD_MIN_SIZE.width && height >= BOARD_MIN_SIZE.height ? { x, y, width, height } : null;
  return {
    openOnLaunch: r.openOnLaunch === true,
    alwaysOnTop: r.alwaysOnTop === true,
    bigText: r.bigText === true,
    view: BOARD_VIEWS.includes(r.view as BoardView) ? (r.view as BoardView) : "cards",
    order: keys(r.order),
    pinned: keys(r.pinned),
    hidden: keys(r.hidden),
    bounds,
  };
}

/** What the window may change from its own toolbar (never bounds: main records those itself). */
export type BoardPrefsPatch = Partial<Pick<BoardPrefs, "alwaysOnTop" | "bigText" | "view" | "order" | "pinned" | "hidden" | "openOnLaunch">>;

export function applyBoardPatch(prefs: BoardPrefs, patch: unknown): BoardPrefs {
  const p = patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...prefs };
  for (const k of ["alwaysOnTop", "bigText", "openOnLaunch"] as const) if (typeof p[k] === "boolean") next[k] = p[k];
  if (BOARD_VIEWS.includes(p.view as BoardView)) next.view = p.view;
  for (const k of ["order", "pinned", "hidden"] as const) if (Array.isArray(p[k])) next[k] = p[k];
  return parseBoardPrefs(next);
}

// ---------- the view the window draws ----------

export type BoardHostState = "connected" | "connecting" | "offline";
export interface BoardHostView {
  hostId: string;
  label: string;
  state: BoardHostState;
  /** Epoch ms of the last complete read of this host (null: none yet). */
  readAt: number | null;
}

export type BoardMemberState = "busy" | "idle" | "paused" | "error" | "offline";
export interface BoardMemberView {
  hostId: string;
  sessionId: string;
  name: string;
  /** Two letters for the tile (the app's avatar fallback). */
  initials: string;
  director: boolean;
  state: BoardMemberState;
  /** cutex's activity projection: the last tool call / output line (null: none). */
  doing: string | null;
  /** ISO time the state began (busy: busySince; else the last activity). */
  since: string | null;
}

/** Problems shown on the card. Only facts cutex states — the board never infers "stuck" itself. */
export type BoardProblemKind =
  | "hostOffline" | "agentError" | "stopUnconfirmed" | "stalled" | "service" | "quotaOut"
  // From the host's board summary (cutex P6 problem codes delegationFailed / handlerOffline / handlerUnavailable / memberUnavailable).
  | "delegationFailed" | "handlerOffline" | "handlerUnavailable" | "memberUnavailable" | "lastTurnFailed"
  | "other";
export interface BoardProblem {
  kind: BoardProblemKind;
  /** Facts only; the window words them (i18n). */
  hostId: string;
  /** The agent / delegation / service / profile it is about. */
  subject: string;
  /** Extra detail (error text, service health, delegation title). */
  detail: string | null;
  target: BoardTarget | null;
  /** Soft (cutex's lastTurnFailed): shown in amber, does not make the project 出问题. */
  soft?: true;
}

export type BoardActivityKind = "done" | "failed" | "stopped" | "progress" | "started";
export interface BoardActivity {
  kind: BoardActivityKind; text: string; at: string; target: BoardTarget | null;
  /** A tool of this delegation has been running since then (cutex's longToolCall; not a problem). */
  toolSince?: string;
}

export interface BoardProjectView {
  /** projectIdentity(): one key across hosts. */
  key: string;
  name: string;
  /** cutex presentation colour (cyan|blue|…|#RRGGBB). */
  color: string;
  /** The hosts (and per-host project ids) this project lives on. */
  places: { hostId: string; projectId: string; projectKey?: string }[];
  director: BoardMemberView | null;
  /** Everyone else in the project (archived agents left out). */
  members: BoardMemberView[];
  /** openDelegations null: some place of this project could not read its delegations (unknown, never a zero). */
  counts: { busy: number; idle: number; paused: number; error: number; offline: number; openDelegations: number | null };
  /** Delegations of this project closed today, any disposition (`done`), and how many of them failed (the host's local
   *  day with G1 — its finishedToday — else this device's; null: not readable on some place). */
  today: { done: number; failed: number } | null;
  /** 需要你: a count only (owner 2026-11-17); null: some place could not read it. */
  needsYou: number | null;
  /** Problems to show (a host summary lists at most 20 per project). */
  problems: BoardProblem[];
  /** How many problems there are (≥ problems.length: cutex's exact count), soft ones included. */
  problemCount: number;
  /** Of those, the ones known to be hard (not lastTurnFailed): only these make the project 出问题. */
  hardProblems: number;
  /** Of those, unlisted ones whose severity the host did not say (beyond its 20 examples, no per-code counts):
   *  neither hard nor soft — the project reads 情况不明 unless a hard one is known. */
  unsizedProblems: number;
  /** A source problems come from could not be read (fully) on some place: "no problems" is not known, so not 正常. */
  problemsUnknown: boolean;
  /** Latest 动态 lines (thumbnail view), newest first. */
  recent: BoardActivity[];
  /** Epoch ms of the latest activity seen (quiet projects dim). */
  lastActivityAt: number | null;
  /** 主管's plan (backend G10; null until a host provides it — the plan bar is hidden then). */
  plan: { done: number; total: number; current: string | null } | null;
  /** 主管's goal (backend G10). */
  goal: string | null;
  /** The 主管's host has not observed its goal (goalAvailable false): shown as unknown, not as "no goal". */
  goalUnknown: boolean;
}

/** Which parts light up because a host provides the backend data (shared/boardBackend.ts). */
export interface BoardBackendParts {
  /** G1: one summary read per host. */
  summary: boolean;
  /** G2: delegation steps done / total. */
  steps: boolean;
  /** G3: cutex's own stalled flag on delegations. */
  stalled: boolean;
  /** G10: the 主管's plan and goal in the project summary. */
  plan: boolean;
}

export interface BoardState {
  locale: ShellLocale;
  terms: ShellTermsPref | null;
  prefs: BoardPrefs;
  hosts: BoardHostView[];
  projects: BoardProjectView[];
  backend: BoardBackendParts;
  /** Dev demo data (CUTEX_DESKTOP_DEMO_BOARD=1, never packaged). */
  demo?: true;
}

export type BoardTarget =
  | { kind: "project"; hostId: string; projectId: string }
  | { kind: "agent"; hostId: string; sessionId: string }
  | { kind: "delegation"; hostId: string; askId: string }
  | { kind: "needsYou" };

export type BoardRequest =
  | { op: "state" }
  | { op: "prefs"; patch: BoardPrefsPatch }
  | { op: "open"; target: BoardTarget }
  | { op: "refresh" };

/** Accept only well-formed targets from the window. */
export function parseBoardTarget(raw: unknown): BoardTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200;
  if (r.kind === "needsYou") return { kind: "needsYou" };
  if (!id(r.hostId)) return null;
  if (r.kind === "project" && id(r.projectId)) return { kind: "project", hostId: r.hostId as string, projectId: r.projectId as string };
  if (r.kind === "agent" && id(r.sessionId)) return { kind: "agent", hostId: r.hostId as string, sessionId: r.sessionId as string };
  if (r.kind === "delegation" && id(r.askId)) return { kind: "delegation", hostId: r.hostId as string, askId: r.askId as string };
  return null;
}

export interface BoardBridge {
  state(): Promise<BoardState>;
  onState(listener: (state: BoardState) => void): void;
  setPrefs(patch: BoardPrefsPatch): Promise<BoardState>;
  open(target: BoardTarget): Promise<void>;
  refresh(): Promise<void>;
}
