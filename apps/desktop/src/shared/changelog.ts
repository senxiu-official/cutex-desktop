// 更新记录 (Settings → 关于): the desktop's own history, parsed from the repository's CHANGELOG.md at
// build time by scripts/bundle-changelog.mjs into modules/about/changelog.bundled.json (test/changelog.test.ts
// fails when that file is stale). Self-contained on purpose (no imports, no enums): the script runs this
// file directly with Node's type stripping.
//
// CHANGELOG.md shape: `## 0.1.3 (2026-10-17)` / `## 0.1.0 "First Take" (2026-10-15)` sections; inside
// one, paragraphs, `**Group**` headings and `- ` items (continuation lines indented). An entry carries an
// English text followed by a Chinese one; `splitBilingual` separates them where that is unambiguous,
// otherwise the block keeps the whole text (shown to every language). `## Unreleased` is NOT bundled:
// every branch edits it, so bundling it would make the JSON conflict on each merge, and a packaged
// build must not show it anyway. The trailing "Known issues: …" pointer is dropped (the list is next door).
//
//   { "schema": 1, "releases": [ { "version": "0.1.3", "title"?: "First Take", "date"?: "2026-10-17",
//       "blocks": [ { "kind": "text" | "heading" | "item", "text": "…", "zh"?: "…" } ] } ] }
//
// `text` is the English part when `zh` is set, else the block's whole text. Inline Markdown stays as
// written (`code`, **bold**, [label](url)); the renderer shows code / bold and a link's label only.

export const CHANGELOG_SCHEMA = 1;

export type ChangelogBlockKind = "text" | "heading" | "item";

export interface ChangelogBlock {
  kind: ChangelogBlockKind;
  text: string;
  zh?: string;
}

export interface ChangelogRelease {
  version: string;
  title?: string;
  date?: string;
  blocks: ChangelogBlock[];
}

export interface ChangelogDoc {
  schema: 1;
  releases: ChangelogRelease[];
}

const HEADING = /^## (.+?)\s*$/;
const RELEASE = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+"([^"]+)")?(?:\s+\((\d{4}-\d{2}-\d{2})\))?$/;
const GROUP = /^\*\*(.+)\*\*$/;
const ITEM = /^- (.*)$/;
const CJK = /[㐀-鿿豈-﫿]/;
const CJK_ALL = /[㐀-鿿豈-﫿]/g;
/** An English sentence inside a supposed Chinese tail: a word followed by sentence punctuation. */
const ENGLISH_PUNCT = /[A-Za-z]{2,}[.,;:!?](\s|$)/;
/** What may precede the first Chinese character of a Chinese part: up to three capitalised name tokens. */
const LEAD = /^(?:[A-Z][A-Za-z0-9+.-]*\s+){0,3}$/;
/** Three Latin words in a row: an English phrase, not a name inside Chinese text. */
const ENGLISH_PHRASE = /[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){2,}/;
const ZH_END = /[。！？」）㐀-鿿]$/;
const BOUNDARY_BEFORE = /[.!?)\]」`]/;

/**
 * Splits "English sentence(s). 中文句子。" at the first sentence boundary whose remainder reads as
 * Chinese: it ends like a Chinese sentence, has no English sentence punctuation, and any Latin words
 * before its first Chinese character are a short name (「Claude Profile 可读取…」). No such boundary
 * (an English-only or Chinese-only entry, or an ambiguous mix): `{ en: text }`, i.e. show it whole.
 */
export function splitBilingual(text: string): { en: string; zh?: string } {
  const s = text.trim();
  for (let i = 1; i < s.length; i++) {
    if (!/\s/.test(s[i]!) || /\s/.test(s[i - 1]!) || !BOUNDARY_BEFORE.test(s[i - 1]!)) continue;
    const head = s.slice(0, i).trim();
    const tail = s.slice(i).trim();
    if (!/[A-Za-z]{3,}/.test(head) || !looksChinese(tail)) continue;
    return { en: head, zh: tail };
  }
  return { en: s };
}

function looksChinese(tail: string): boolean {
  if (!ZH_END.test(tail) || ENGLISH_PUNCT.test(tail)) return false;
  const first = tail.search(/[\u3400-\u9fff\uf900-\ufaff「（]/);
  if (first < 0) return false;
  // Latin text before the first Chinese character: at most a short name (「Claude Profile 可读取…」).
  if (!LEAD.test(tail.slice(0, first)) || ENGLISH_PHRASE.test(tail)) return false;
  const cjk = (tail.match(CJK_ALL) ?? []).length;
  const latin = (tail.match(/[A-Za-z]/g) ?? []).length;
  return cjk >= 2 && cjk * 2 >= latin;
}

/** Wrapped lines joined: a space between Latin text, none where a line break falls inside Chinese text. */
function joinLines(lines: readonly string[]): string {
  let out = "";
  for (const line of lines) {
    const next = line.trim();
    if (!next) continue;
    const prev = out.at(-1) ?? "";
    const glue = out && !(WIDE_PUNCT.test(prev) || (WIDE.test(prev) && WIDE.test(next[0]!))) ? " " : "";
    out += glue + next;
  }
  return out;
}
const WIDE = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const WIDE_PUNCT = /[\u3000-\u303f\uff00-\uffef]/;

function block(kind: ChangelogBlockKind, lines: readonly string[]): ChangelogBlock | null {
  const text = joinLines(lines).replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (kind === "heading") return { kind, text };
  const { en, zh } = splitBilingual(text);
  return zh ? { kind, text: en, zh } : { kind, text: en };
}

/** CHANGELOG.md → the bundled document (released sections only, newest first as written). */
export function parseChangelog(markdown: string): ChangelogDoc {
  const releases: ChangelogRelease[] = [];
  let current: ChangelogRelease | null = null;
  let buf: { kind: ChangelogBlockKind; lines: string[] } | null = null;
  const flush = () => {
    if (current && buf) {
      const b = block(buf.kind, buf.lines);
      if (b && !(b.kind === "text" && /^Known issues:/.test(b.text))) current.blocks.push(b);
    }
    buf = null;
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const m = RELEASE.exec(h[1]!);
      current = m ? { version: m[1]!, ...(m[2] ? { title: m[2] } : {}), ...(m[3] ? { date: m[3] } : {}), blocks: [] } : null;
      if (current) releases.push(current);
      continue;
    }
    if (!current) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      flush();
      buf = { kind: "item", lines: [item[1]!] };
      continue;
    }
    const group = GROUP.exec(line.trim());
    if (group && !buf) {
      current.blocks.push({ kind: "heading", text: group[1]!.trim() });
      continue;
    }
    if (buf) buf.lines.push(line.trim());
    else buf = { kind: "text", lines: [line.trim()] };
  }
  flush();
  return { schema: CHANGELOG_SCHEMA, releases };
}

/** The bundled file's exact bytes (the freshness test compares them). */
export function changelogJson(doc: ChangelogDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Lenient read of a bundled document: wrong shapes are dropped, never thrown. */
export function readChangelogDoc(value: unknown): ChangelogDoc {
  const doc = value as { schema?: unknown; releases?: unknown } | null;
  if (!doc || doc.schema !== CHANGELOG_SCHEMA || !Array.isArray(doc.releases)) return { schema: CHANGELOG_SCHEMA, releases: [] };
  const releases: ChangelogRelease[] = [];
  for (const r of doc.releases as Array<Record<string, unknown>>) {
    if (!r || typeof r.version !== "string" || !Array.isArray(r.blocks)) continue;
    const blocks = (r.blocks as Array<Record<string, unknown>>).filter(
      (b): b is ChangelogBlock & Record<string, unknown> => !!b && (b.kind === "text" || b.kind === "heading" || b.kind === "item") && typeof b.text === "string" && (b.zh === undefined || typeof b.zh === "string"),
    );
    releases.push({ version: r.version, ...(typeof r.title === "string" ? { title: r.title } : {}), ...(typeof r.date === "string" ? { date: r.date } : {}), blocks: blocks.map((b) => (b.zh ? { kind: b.kind, text: b.text, zh: b.zh } : { kind: b.kind, text: b.text })) });
  }
  return { schema: CHANGELOG_SCHEMA, releases };
}

/** The block's text for a UI language: Chinese locales get the Chinese part when there is one. */
export function changelogText(b: ChangelogBlock, locale: string): string {
  return locale.startsWith("zh") && b.zh ? b.zh : b.text;
}
