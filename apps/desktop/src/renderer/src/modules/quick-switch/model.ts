// ⌘K quick switcher (canvas principles §3: the entry that never depends on a pane). Pure model: items,
// matching and ranking, scope chips, keyboard actions and what an open does (unit-tested in
// test/quickSwitch.test.ts). No React, no store: the palette (Palette.tsx) builds the items from the
// sidebar rows, the hosts' service lists, the artifact lists, the `nav.primary` pages and the Shelf pages
// once per data change, and every keystroke only runs `rankItems` over that list (no network).
import { isImeComposing } from "../../lib/ime";
import { matchesCommand } from "../../lib/keybindings";
import type { WorkspaceOpenMode, WorkspaceRef } from "../../lib/workspaces";
import type { Icon } from "../slots";
import type { ItemId, PageParams } from "../types";

export type QsKind = "agent" | "service" | "artifact" | "page" | "shelfPage";
export type QsScope = "all" | QsKind;

/** Chip order; Tab / Shift+Tab cycle through it. */
export const SCOPES: readonly QsScope[] = ["all", "agent", "service", "artifact", "page", "shelfPage"];
/** Section order when nothing ranks them (the empty query). */
export const KINDS: readonly QsKind[] = ["agent", "service", "artifact", "page", "shelfPage"];

/** What opening an item does (planOpen turns it into calls). */
export type QsTarget =
  | { kind: "agent"; hostId: string; sessionId: string }
  | { kind: "service"; hostId: string; slug: string }
  | { kind: "artifact"; hostId: string; ref: string; name: string }
  | { kind: "page"; page: ItemId; params?: PageParams }
  | { kind: "run"; run: () => void | Promise<void> }
  | { kind: "shelfPage"; shelfId: string; pageId: string };

/** The row's leading picture. */
export type QsLead =
  | { kind: "avatar"; name: string; color: string | null; seed: string; initial?: string; avatar?: unknown }
  | { kind: "icon"; icon: Icon; tone?: string }
  | { kind: "named"; name: string };

/** A short state at the row's end (需要你, 运行中, 离线 …). */
export interface QsBadge {
  text: string;
  tone: "attention" | "accent" | "muted" | "danger";
}

export interface QsItem {
  /** Unique across kinds and hosts (recents are stored by it). */
  id: string;
  kind: QsKind;
  title: string;
  subtitle?: string;
  /** Other searchable text (ids, slugs, project names); matched after the title. */
  terms?: readonly string[];
  /** The title's pinyin (pinyin.ts, filled once the data is loaded): only for titles with Chinese characters. */
  pinyin?: readonly PinyinUnit[];
  hostId?: string;
  /** Base order inside its section (lower first): attention / activity for agents, list order elsewhere. */
  rank: number;
  /** Shown but not openable (its host is offline). */
  disabled?: boolean;
  badge?: QsBadge;
  lead?: QsLead;
  target: QsTarget;
}

/**
 * One searchable character of a title for pinyin search: a Chinese character with its readings (toneless,
 * the likely one first; ü also as v and u), or a Latin letter / digit as itself. Spaces and punctuation
 * are not units (a match runs across them).
 */
export interface PinyinUnit {
  /** Its place in the title (code units). */
  at: number;
  /** Its length in the title (2 for a character outside the BMP). */
  len: number;
  /** Lower-case readings; a Latin letter / digit: [itself]. */
  syl: readonly string[];
  /** A Chinese character (a match must use at least one). */
  zh: boolean;
}

export interface QsMatch {
  score: number;
  /** Matched character ranges of the title ([start, end)), for highlighting. */
  ranges: [number, number][];
}

export interface QsRow {
  item: QsItem;
  ranges: [number, number][];
}

export interface QsSection {
  /** A kind, or "recent" (the empty query's first section). */
  id: QsKind | "recent";
  rows: QsRow[];
  /** Matches in this section before the cap. */
  total: number;
}

export interface RecentEntry {
  id: string;
  at: number;
}

// ── matching ────────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.normalize("NFKC").toLowerCase();
const BOUNDARY = /[\s\-_./:·@#(（[【「]/;
/** A CJK ideograph / kana / hangul: every such character starts a "word". */
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;

function wordStarts(text: string): Set<number> {
  const out = new Set<number>([0]);
  for (let i = 1; i < text.length; i++) {
    const prev = text[i - 1]!;
    const ch = text[i]!;
    if (BOUNDARY.test(prev) || CJK.test(ch) || (/[a-z0-9]/.test(prev) && /[A-Z]/.test(ch))) out.add(i);
  }
  return out;
}

/**
 * One query token against one text (original case, for camelCase word starts): exact 100, prefix 80,
 * word start 65, substring 50, subsequence 8–45 (letters in order and close together; denser = higher;
 * `fuzzy` false = none). null = no match.
 */
export function matchToken(token: string, text: string, fuzzy = true): QsMatch | null {
  if (!token) return { score: 0, ranges: [] };
  const lower = norm(text);
  if (lower.length !== text.length) text = lower; // NFKC changed the length: word starts on the normalized text
  const t = norm(token);
  if (lower === t) return { score: 100, ranges: [[0, t.length]] };
  if (lower.startsWith(t)) return { score: 80, ranges: [[0, t.length]] };
  const starts = wordStarts(text);
  let at = lower.indexOf(t);
  let first = at;
  while (at >= 0) {
    if (starts.has(at)) return { score: 65, ranges: [[at, at + t.length]] };
    at = lower.indexOf(t, at + 1);
  }
  if (first >= 0) return { score: 50, ranges: [[first, first + t.length]] };
  // Subsequence: greedy; one letter tokens never fuzz, and the letters must stay close together (at most
  // max(8, 3 × the token) characters from the first to the last) — 「res」 is not r…e…s across a long name.
  if (!fuzzy || t.length < 2) return null;
  const ranges: [number, number][] = [];
  let pos = 0;
  let gaps = 0;
  let onStarts = 0;
  for (const ch of t) {
    const i = lower.indexOf(ch, pos);
    if (i < 0) return null;
    if (ranges.length && ranges[ranges.length - 1]![1] === i) ranges[ranges.length - 1]![1] = i + 1;
    else {
      if (ranges.length) gaps++;
      ranges.push([i, i + 1]);
    }
    if (starts.has(i)) onStarts++;
    pos = i + 1;
  }
  first = ranges[0]![0];
  if (ranges[ranges.length - 1]![1] - first > Math.max(8, 3 * t.length)) return null;
  const score = Math.max(8, 30 - gaps * 4 - Math.min(first, 10) + onStarts * 3);
  return { score: Math.min(score, 45), ranges };
}

/**
 * One query token (Latin letters, e.g. 「tingshu」 / 「ts」 / 「tings」) as pinyin against a title's units: a run of
 * consecutive units, each taking its whole reading or the start of it (an initial), the whole token used,
 * at least one Chinese character in the run. One letter only matches the title's first character.
 * Score: from the title's start 72, elsewhere 56 (every Chinese character starts a word); the whole title
 * +8; any reading taken partly (initials) −6 — below a literal prefix (80) and exact (100). null = no match.
 */
export function matchPinyin(token: string, units: readonly PinyinUnit[]): QsMatch | null {
  const t = norm(token);
  if (!/^[a-z0-9]+$/.test(t) || !units.length) return null;
  // Reading by reading from unit j at token position p: the whole reading first (fewer partial units), else a shorter start of it.
  const walk = (j: number, p: number, zh: boolean, partial: boolean): { end: number; partial: boolean } | null => {
    if (p === t.length) return zh ? { end: j, partial } : null;
    const unit = units[j];
    if (!unit) return null;
    const rest = t.slice(p);
    let best: { end: number; partial: boolean } | null = null;
    for (const syl of unit.syl) {
      const n = Math.min(syl.length, rest.length);
      for (let k = n; k >= 1; k--) {
        if (syl.slice(0, k) !== rest.slice(0, k)) continue;
        // A piece of a reading before the token's end: its initial only (one letter, or zh / ch / sh) — 「tinshu」 is not tin(g) + shu.
        const whole = k === syl.length;
        if (!whole && p + k < t.length && k > 1 && !(k === 2 && /^[zcs]h/.test(syl))) continue;
        const r = walk(j + 1, p + k, zh || unit.zh, partial || !whole);
        if (r && (!best || (best.partial && !r.partial))) best = r;
        if (best && !best.partial) return best;
      }
    }
    return best;
  };
  const starts = t.length === 1 ? 1 : units.length;
  for (let k = 0; k < starts; k++) {
    const r = walk(k, 0, false, false);
    if (!r) continue;
    const score = (k === 0 ? 72 : 56) + (k === 0 && r.end === units.length ? 8 : 0) - (r.partial ? 6 : 0);
    return { score, ranges: mergeRanges(units.slice(k, r.end).map((u) => [u.at, u.at + u.len] as [number, number])) };
  }
  return null;
}

/**
 * The whole query (whitespace-separated tokens, all must match) against an item: each token on the
 * title first (literally, or as pinyin when the title has some), else on its subtitle / terms at a lower
 * weight. null = not a match.
 */
export function matchItem(query: string, item: Pick<QsItem, "title" | "subtitle" | "terms" | "pinyin">): QsMatch | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { score: 0, ranges: [] };
  let score = 0;
  const ranges: [number, number][] = [];
  const others = [...(item.terms ?? []), ...(item.subtitle ? [item.subtitle] : [])];
  for (const token of tokens) {
    let onTitle = matchToken(token, item.title);
    // Pinyin (「tingshu」 / 「ts」 → 听书): only titles with Chinese characters have units, so Latin titles rank as before.
    const py = item.pinyin ? matchPinyin(token, item.pinyin) : null;
    if (py && (!onTitle || py.score > onTitle.score)) onTitle = py;
    let best = onTitle ? onTitle.score : -1;
    for (const other of others) {
      // Terms (ids, slugs, project names) match as written: no subsequences there.
      const m = matchToken(token, other, false);
      // A term counts a bit less than the title.
      if (m && m.score * 0.6 > best) best = m.score * 0.6;
    }
    if (best < 0) return null;
    score += best;
    if (onTitle && onTitle.score >= best) ranges.push(...onTitle.ranges);
  }
  // Whole query as one run in the title: a small bonus (「cutex dev」 over scattered hits).
  if (tokens.length > 1 && norm(item.title).includes(norm(tokens.join(" ")))) score += 10;
  return { score, ranges: mergeRanges(ranges) };
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

// ── ranking ─────────────────────────────────────────────────────────────────────────────────

/** Rows per section in 全部 (a single scope lists everything). */
export const ALL_CAP: Readonly<Record<QsKind, number>> = { agent: 5, service: 3, artifact: 3, page: 4, shelfPage: 4 };
/** Recent rows on top of an empty 全部. */
export const RECENT_CAP = 5;
/** Recents kept (prefs). */
export const RECENT_KEEP = 20;

export interface RankOptions {
  query: string;
  scope: QsScope;
  recent?: readonly RecentEntry[];
}

/**
 * The sections to show. Empty query: 全部 = 最近 (opened from here before, newest first) then each kind's
 * first rows in base order; one scope = that kind with its recents first. With a query: matches by score
 * (then base order), sections ordered by their best match (ties: chip order), capped in 全部.
 */
export function rankItems(items: readonly QsItem[], opts: RankOptions): QsSection[] {
  const inScope = opts.scope === "all" ? items : items.filter((i) => i.kind === opts.scope);
  const query = opts.query.trim();
  const recentAt = new Map((opts.recent ?? []).map((r) => [r.id, r.at]));
  if (!query) {
    const byRecent = (a: QsItem, b: QsItem) => (recentAt.get(b.id) ?? 0) - (recentAt.get(a.id) ?? 0) || a.rank - b.rank;
    if (opts.scope !== "all") {
      const rows = [...inScope].sort(byRecent).map((item) => ({ item, ranges: [] }));
      return rows.length ? [{ id: opts.scope, rows, total: rows.length }] : [];
    }
    const recent = inScope.filter((i) => recentAt.has(i.id) && !i.disabled).sort(byRecent).slice(0, RECENT_CAP);
    const taken = new Set(recent.map((i) => i.id));
    const sections: QsSection[] = recent.length ? [{ id: "recent", rows: recent.map((item) => ({ item, ranges: [] })), total: recent.length }] : [];
    for (const kind of KINDS) {
      const all = inScope.filter((i) => i.kind === kind && !taken.has(i.id)).sort((a, b) => a.rank - b.rank);
      if (all.length) sections.push({ id: kind, rows: all.slice(0, ALL_CAP[kind]).map((item) => ({ item, ranges: [] })), total: all.length });
    }
    return sections;
  }
  const scored: { item: QsItem; match: QsMatch }[] = [];
  for (const item of inScope) {
    const match = matchItem(query, item);
    if (match) scored.push({ item, match });
  }
  // Recently opened breaks score ties (then the base order).
  scored.sort((a, b) => b.match.score - a.match.score || (recentAt.get(b.item.id) ?? 0) - (recentAt.get(a.item.id) ?? 0) || a.item.rank - b.item.rank);
  const sections: (QsSection & { best: number })[] = [];
  for (const kind of KINDS) {
    const hits = scored.filter((s) => s.item.kind === kind);
    if (!hits.length) continue;
    const shown = opts.scope === "all" ? hits.slice(0, ALL_CAP[kind]) : hits;
    sections.push({ id: kind, rows: shown.map((s) => ({ item: s.item, ranges: s.match.ranges })), total: hits.length, best: hits[0]!.match.score });
  }
  sections.sort((a, b) => b.best - a.best || KINDS.indexOf(a.id as QsKind) - KINDS.indexOf(b.id as QsKind));
  return sections.map(({ best: _best, ...s }) => s);
}

/** The rows in display order (selection index space). */
export function flatRows(sections: readonly QsSection[]): QsRow[] {
  return sections.flatMap((s) => s.rows);
}

/** Records an open: newest first, one entry per id, at most RECENT_KEEP. */
export function pushRecent(list: readonly RecentEntry[], id: string, at: number): RecentEntry[] {
  return [{ id, at }, ...list.filter((r) => r.id !== id)].slice(0, RECENT_KEEP);
}

/** Untrusted prefs JSON → recents. */
export function parseRecent(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is RecentEntry => !!r && typeof r === "object" && typeof (r as RecentEntry).id === "string" && typeof (r as RecentEntry).at === "number").slice(0, RECENT_KEEP);
}

// ── keyboard ────────────────────────────────────────────────────────────────────────────────

export function nextScope(scope: QsScope, back = false): QsScope {
  const i = SCOPES.indexOf(scope);
  return SCOPES[(i + (back ? SCOPES.length - 1 : 1)) % SCOPES.length]!;
}

/** ↑ / ↓ with wrap-around; no rows = 0. */
export function moveSelection(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

export type PaletteKey =
  | { type: "move"; delta: number }
  | { type: "scope"; back: boolean }
  | { type: "open"; beside: boolean }
  | { type: "close" };

interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}

/** The quick switcher's key (lib/keybindings `quickSwitch`, default ⌘K / Ctrl+K). */
export function isQuickSwitchKey(e: KeyLike): boolean {
  return matchesCommand("quickSwitch", e);
}

/** A key while the palette is open → what it does (null = the input's own key: typing, ←/→ …). */
export function paletteKey(e: KeyLike, mac: boolean): PaletteKey | null {
  if (isImeComposing(e)) return null; // an IME candidate's Enter / arrows
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (e.key === "Escape") return { type: "close" };
  if (isQuickSwitchKey(e)) return { type: "close" };
  if (e.key === "ArrowDown" && !e.altKey) return { type: "move", delta: 1 };
  if (e.key === "ArrowUp" && !e.altKey) return { type: "move", delta: -1 };
  if (e.key === "PageDown") return { type: "move", delta: 8 };
  if (e.key === "PageUp") return { type: "move", delta: -8 };
  if (!mod && !e.altKey && (e.key === "n" || e.key === "p") && e.ctrlKey) return { type: "move", delta: e.key === "n" ? 1 : -1 };
  if (e.key === "Tab" && !mod && !e.altKey) return { type: "scope", back: e.shiftKey };
  if (e.key === "Enter" && !e.altKey) return { type: "open", beside: mod };
  return null;
}

// ── opening ─────────────────────────────────────────────────────────────────────────────────

/** The conversation pane kind (lib/paneLayout CONVERSATION_KIND; §24.4). */
export const CONVERSATION_KIND = "core.conversation";
/** Tool kinds opened by id (§18.8: never imported from their modules). */
export const BROWSER_TAB = "browser.tab";
export const ARTIFACT_VIEW = "artifacts.view";

/**
 * What an open does, as calls (executed by open.ts against the module services). In place: an agent
 * replaces the focused conversation pane; a service / artifact opens as a tab in the focused workspace's
 * Shelf, a page where 页面打开位置 says (services.panes.open "page:<id>": its own Shelf pane, or over the
 * conversation column). Beside: an agent becomes the second conversation column; a service /
 * artifact / page goes through the workspaces API (lib/workspaces openRef "beside": the other workspace's
 * Shelf, or a new page of this one's Shelf — `besideAction` says which, and whether there is a beside at
 * all). A service or artifact of a host the Shelf does not show (`showsHost`: lib/sideServices
 * sideShowsHost) opens in place the way its own list does then: the system browser / the artifact ref.
 */
export type OpenPlan =
  | { via: "panes"; kind: string; params: Record<string, string>; beside: boolean; fallback?: OpenPlan }
  | { via: "serviceExternal"; hostId: string; slug: string }
  | { via: "ref"; ref: { hostId: string; kind: string; key: string; title: string; params: Record<string, string> } }
  | { via: "run"; run: () => void | Promise<void> }
  | { via: "shelfPage"; shelfId: string; pageId: string }
  | { via: "workspace"; ref: WorkspaceRef; mode: WorkspaceOpenMode; pageParams?: Record<string, string> };

/** `title`: the row's title (a beside open's tab / ref title). */
export function planOpen(target: QsTarget, beside: boolean, showsHost: (hostId: string) => boolean, title?: string): OpenPlan {
  if (beside && (target.kind === "service" || target.kind === "artifact" || target.kind === "page")) {
    if (target.kind !== "page") {
      const ref = workspaceRefOf({ target, title: (title ?? (target.kind === "artifact" ? target.name : target.slug)).slice(0, 200) })!;
      return { via: "workspace", ref, mode: "beside" };
    }
    // A page item: `key` = its item id (not draggable, so not a workspaceRefOf row); its params beside the ref.
    const ref: WorkspaceRef = { kind: "page", hostId: "", key: target.page, ...(title ? { title } : {}) };
    const pageParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(target.params ?? {})) if (typeof v === "string") pageParams[k] = v;
    return { via: "workspace", ref, mode: "beside", pageParams };
  }
  switch (target.kind) {
    case "agent":
      return { via: "panes", kind: CONVERSATION_KIND, params: { sessionId: target.sessionId, hostId: target.hostId }, beside };
    case "service": {
      const external: OpenPlan = { via: "serviceExternal", hostId: target.hostId, slug: target.slug };
      if (!showsHost(target.hostId)) return external;
      // The owner browser tab (`cutex:service/<slug>/`, the services page's 打开); browser module off → the system browser.
      return { via: "panes", kind: BROWSER_TAB, params: { url: `cutex:service/${target.slug}/` }, beside: false, fallback: external };
    }
    case "artifact": {
      const ref: OpenPlan = { via: "ref", ref: { hostId: target.hostId, kind: "artifact", key: target.ref, title: target.name.slice(0, 200), params: {} } };
      if (!showsHost(target.hostId)) return ref;
      return { via: "panes", kind: ARTIFACT_VIEW, params: { ref: target.ref, name: target.name }, beside: false, fallback: ref };
    }
    case "page": {
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(target.params ?? {})) if (typeof v === "string") params[k] = v;
      return { via: "panes", kind: `page:${target.page}`, params, beside: false };
    }
    case "run":
      return { via: "run", run: target.run };
    case "shelfPage":
      // Jumping to a page has no "beside": the Shelf shows it in place.
      return { via: "shelfPage", shelfId: target.shelfId, pageId: target.pageId };
  }
}

/** The workspaces on screen as the palette sees them when it opens (lib/workspaces screenOf). */
export interface QsScreen {
  /** Conversation panes (workspaces) on screen: 1 or 2. */
  workspaces: number;
  /** The host of the other workspace's agent (two workspaces), null = none / it shows no agent. */
  otherHostId: string | null;
  /** A page that opens over the whole window (lib/paneKinds isFullWindowPage: 设置): never in a workspace. */
  fullWindowPage?(page: string): boolean;
}

/**
 * What Ctrl/⌘+Enter does for this item (§24.13 / canvas principles §7, owner 2026-10-21: ↵ = replace,
 * Ctrl/⌘+↵ = beside; services, artifacts and pages always go into a Shelf), null = nothing more than ↵ (the
 * row shows no beside hint and Ctrl/⌘+↵ opens as ↵):
 *   sideBySide     an agent: a second workspace (two on screen: the other one shows it)
 *   otherShelf     a service / artifact, two workspaces: into the other workspace's Shelf (its agent's host
 *                  must be the item's: a Shelf shows its own host only)
 *   newPage        a service / artifact, one workspace: a new page of its Shelf instead of a tab (a host the
 *                  Shelf does not show: none — ↵ opens it outside the Shelf)
 *   otherWorkspace a page, two workspaces: in the other workspace (one workspace: none — a page is not a Shelf page)
 */
export type BesideAction = "sideBySide" | "otherShelf" | "newPage" | "otherWorkspace";

export function besideAction(target: QsTarget, screen: QsScreen, showsHost: (hostId: string) => boolean): BesideAction | null {
  const two = screen.workspaces >= 2;
  switch (target.kind) {
    case "agent":
      return "sideBySide";
    case "service":
    case "artifact":
      if (two) return screen.otherHostId === target.hostId ? "otherShelf" : null;
      return showsHost(target.hostId) ? "newPage" : null;
    case "page":
      return two && !screen.fullWindowPage?.(target.page) ? "otherWorkspace" : null;
    default:
      return null;
  }
}

/** Whether Ctrl/⌘+Enter means more than Enter for this item (`besideAction` is not null). */
export function hasBeside(target: QsTarget, screen: QsScreen = { workspaces: 1, otherHostId: null }, showsHost: (hostId: string) => boolean = () => true): boolean {
  return besideAction(target, screen, showsHost) !== null;
}

/** The item as a workspace ref (lib/workspaces: a row can be dragged into a Shelf / to an edge / onto a conversation); null: not draggable. */
export function workspaceRefOf(item: Pick<QsItem, "target" | "title">): WorkspaceRef | null {
  const t = item.target;
  switch (t.kind) {
    case "agent":
      return { kind: "agent", hostId: t.hostId, key: t.sessionId, title: item.title };
    case "service":
      return { kind: "service", hostId: t.hostId, key: t.slug, title: item.title };
    case "artifact":
      return { kind: "artifact", hostId: t.hostId, key: t.ref, title: item.title };
    default:
      return null;
  }
}
