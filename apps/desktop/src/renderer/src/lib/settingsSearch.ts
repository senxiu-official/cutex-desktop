// Settings search (设置 → 搜索): a pure index over settings pages and their declared sections, matched in
// the UI language AND the other shipped language (so "theme" and "主题" both find a row in either UI), case-insensitive, with simple
// substring / word-start / subsequence ranking. The index is built from the `settings.page` /
// `settings.section` slots (docs/desktop-modules.md §3.2 "设置搜索") by lib/settingsSearchView.ts; this
// file stays React-free for unit tests.

import type { SettingsTab } from "../store"; // type only (erased)

/** One text in the UI language and in the other shipped language (zh-CN ↔ en). */
export interface SearchText {
  current: string;
  other: string;
}

/** One searchable target: a page (anchor null) or a section on it. */
export interface SettingsSearchDoc {
  page: SettingsTab;
  /** Nav position of the page (ties and grouping order). */
  pageOrder: number;
  pageTitle: SearchText;
  /** null = the page itself. */
  anchor: string | null;
  sectionTitle: SearchText | null;
  /** Row labels / hints inside the section (or page-wide keywords for a page doc). */
  keywords: readonly SearchText[];
  /** Why it cannot be opened (module needs a capability, cutex too old…); null = available. */
  disabled: string | null;
}

/** [start, end) character ranges to highlight in a text. */
export type Ranges = readonly (readonly [number, number])[];

export interface TextMatch {
  score: number;
  ranges: Ranges;
}

export interface SettingsSearchHit {
  doc: SettingsSearchDoc;
  score: number;
  /** What matched: the title (page title for a page doc), a keyword, or tokens spread over several fields. */
  field: "title" | "keyword" | "combined";
  /** The matched text and where (in the language it matched in). */
  text: string;
  ranges: Ranges;
  /** True when it matched only in the other language (shown as a detail line). */
  viaOther: boolean;
}

export interface SettingsSearchGroup {
  page: SettingsTab;
  pageTitle: string;
  /** Highlight in the page title (current language) when the page itself matched. */
  pageRanges: Ranges;
  /** The page row itself matched (a page doc hit). */
  pageHit: SettingsSearchHit | null;
  disabled: string | null;
  /** Section hits, best first. */
  sections: SettingsSearchHit[];
  score: number;
}

/** Lower-case, trimmed, single-spaced. Keeps string length per char for ASCII / CJK. */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Removes `{var}` slots left in a translated template and collapses whitespace. */
export function cleanText(text: string): string {
  return text.replace(/\{\w+\}/g, "").replace(/\s+/g, " ").trim();
}

const WORD_BREAK = /[\s\-_/·:：,，.。()（）《》「」'"→›]/;

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * How well `text` matches the normalized query `q` (null = no match):
 * equal 100 > prefix 90 > word start 80 > substring 70 > every word somewhere 60 > subsequence ≤ 40.
 */
export function matchText(text: string, q: string): TextMatch | null {
  if (!q || !text) return null;
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) {
    const score = idx === 0 ? (t.length === q.length ? 100 : 90) : WORD_BREAK.test(t[idx - 1]!) ? 80 : 70;
    return { score, ranges: [[idx, idx + q.length]] };
  }
  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length > 1) {
    const ranges: [number, number][] = [];
    for (const tok of tokens) {
      const i = t.indexOf(tok);
      if (i < 0) return null;
      ranges.push([i, i + tok.length]);
    }
    return { score: 60, ranges: mergeRanges(ranges) };
  }
  // Subsequence ("fntsz" → "font size"): only for 3+ characters and few separate runs, to stay quiet.
  if (q.length < 3) return null;
  const ranges: [number, number][] = [];
  let from = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
    from = i + 1;
  }
  if (ranges.length > Math.ceil(q.length / 3) + 1) return null;
  // Every run must start a word ("fontsi" → "font size", not "fo…ageNT"); CJK has no word breaks.
  const wordStart = (i: number) => i === 0 || WORD_BREAK.test(t[i - 1]!) || t.charCodeAt(i) >= 0x2e80;
  if (!ranges.every(([s]) => wordStart(s))) return null;
  return { score: Math.max(10, 40 - (ranges.length - 1) * 6), ranges };
}

interface FieldMatch {
  score: number;
  text: string;
  ranges: Ranges;
  viaOther: boolean;
}

/** Best match of a bilingual text; the UI language wins ties (and gets a small bonus). */
function matchSearchText(text: SearchText, q: string): FieldMatch | null {
  const cur = matchText(text.current, q);
  const enText = text.other && text.other !== text.current ? text.other : null;
  const alt = enText ? matchText(enText, q) : null;
  if (cur && (!alt || cur.score + 1 >= alt.score)) return { score: cur.score + 1, text: text.current, ranges: cur.ranges, viaOther: false };
  if (alt && enText) return { score: alt.score, text: enText, ranges: alt.ranges, viaOther: true };
  return null;
}

const KEYWORD_WEIGHT = 0.85;
const COMBINED_WEIGHT = 0.8;

/** One doc against the query; null = no match. */
export function matchDoc(doc: SettingsSearchDoc, q: string): SettingsSearchHit | null {
  const title = doc.sectionTitle ?? doc.pageTitle;
  let best: SettingsSearchHit | null = null;
  const consider = (m: FieldMatch | null, field: SettingsSearchHit["field"], weight: number) => {
    if (!m) return;
    const score = m.score * weight;
    if (!best || score > best.score) best = { doc, score, field, text: m.text, ranges: m.ranges, viaOther: m.viaOther };
  };
  consider(matchSearchText(title, q), "title", 1);
  for (const k of doc.keywords) consider(matchSearchText(k, q), "keyword", KEYWORD_WEIGHT);
  if (best) return best;
  // Several words spread over the page title, the section title and keywords ("外观 字体", "sidebar width").
  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  const fields = [doc.pageTitle, ...(doc.sectionTitle ? [doc.sectionTitle] : []), ...doc.keywords];
  for (const tok of tokens) {
    if (!fields.some((f) => f.current.toLowerCase().includes(tok) || f.other.toLowerCase().includes(tok))) return null;
  }
  const tokenRanges = (text: string) =>
    mergeRanges(tokens.flatMap((tok): [number, number][] => {
      const i = text.toLowerCase().indexOf(tok);
      return i >= 0 ? [[i, i + tok.length]] : [];
    }));
  // Show the text that explains the hit best: the title when words hit it, else the field with most hits.
  const candidates = [title.current, title.other, ...doc.keywords.flatMap((k) => [k.current, k.other])].filter(Boolean);
  const fallback = candidates.map((text) => ({ text, ranges: tokenRanges(text) })).sort((a, b) => b.ranges.length - a.ranges.length)[0]!;
  const shown = tokenRanges(title.current).length ? { text: title.current, ranges: tokenRanges(title.current) } : fallback;
  return { doc, score: 50 * COMBINED_WEIGHT, field: "combined", text: shown.text, ranges: shown.ranges, viaOther: shown.text !== title.current && !doc.keywords.some((k) => k.current === shown.text) };
}

/**
 * Runs the query over the index and groups the hits by page: groups best first (ties in nav order),
 * a page's own hit separate from its section hits. `limit` caps the section hits overall.
 */
export function searchSettings(docs: readonly SettingsSearchDoc[], query: string, limit = 40): SettingsSearchGroup[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const groups = new Map<SettingsTab, SettingsSearchGroup>();
  const indexOf = new Map<SettingsSearchDoc, number>();
  docs.forEach((d, i) => indexOf.set(d, i));
  const hits = docs.map((d) => matchDoc(d, q)).filter((h): h is SettingsSearchHit => !!h);
  hits.sort((a, b) => b.score - a.score || a.doc.pageOrder - b.doc.pageOrder || indexOf.get(a.doc)! - indexOf.get(b.doc)!);
  let sections = 0;
  for (const hit of hits) {
    const { doc } = hit;
    if (doc.anchor !== null && sections >= limit) continue;
    let g = groups.get(doc.page);
    if (!g) {
      const pageDoc = docs.find((d) => d.page === doc.page && d.anchor === null);
      g = { page: doc.page, pageTitle: doc.pageTitle.current, pageRanges: [], pageHit: null, disabled: pageDoc?.disabled ?? null, sections: [], score: hit.score };
      groups.set(doc.page, g);
    }
    if (doc.anchor === null) {
      g.pageHit = hit;
      if (hit.field === "title" && !hit.viaOther) g.pageRanges = hit.ranges;
    } else {
      g.sections.push(hit);
      sections++;
    }
  }
  return [...groups.values()].sort((a, b) => b.score - a.score || pageOrderOf(docs, a.page) - pageOrderOf(docs, b.page));
}

function pageOrderOf(docs: readonly SettingsSearchDoc[], page: SettingsTab): number {
  return docs.find((d) => d.page === page)?.pageOrder ?? 0;
}

export interface ResultRow {
  page: SettingsTab;
  anchor: string | null;
  disabled: string | null;
  /** The row itself matched (a page row may only be the heading of its matching sections). */
  hit: boolean;
}

/** The selectable rows of the result list in display order: each group's page row, then its sections. */
export function flattenResults(groups: readonly SettingsSearchGroup[]): ResultRow[] {
  return groups.flatMap((g) => [
    { page: g.page, anchor: null, disabled: g.disabled, hit: !!g.pageHit },
    ...g.sections.map((h) => ({ page: g.page, anchor: h.doc.anchor, disabled: h.doc.disabled, hit: true })),
  ]);
}

/** The row Enter opens before any arrow key: the first available row that matched itself. */
export function firstResult(rows: readonly ResultRow[]): number {
  const i = rows.findIndex((r) => r.hit && !r.disabled);
  return i >= 0 ? i : Math.max(0, rows.findIndex((r) => !r.disabled));
}

/** Number of matches (page rows that only head their sections do not count). */
export function resultCount(rows: readonly ResultRow[]): number {
  return rows.filter((r) => r.hit).length;
}

/** Splits `text` into plain / highlighted parts along `ranges`. */
export function highlightParts(text: string, ranges: Ranges): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s < at || s >= text.length) continue;
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    out.push({ text: text.slice(s, Math.min(e, text.length)), hit: true });
    at = Math.min(e, text.length);
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
