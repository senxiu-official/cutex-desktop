// Web lookups as their own tool rows (TODO 工具行专用视图, 2026-11-12): a Codex `webSearch` item (search, open a page,
// find in a page) and a Claude agent's `WebSearch` / `WebFetch` call read 「搜索网页 · <query>」 / 「打开网页 · <url>」
// instead of the generic 「工具 · claude.WebFetch」 / a bare query. Matched on the structured item only.
import type { RawItem } from "./timeline";
import { toolArgs } from "./taskRows";

export interface WebToolModel {
  kind: "webSearch" | "webPage";
  /** What the row shows after the label: the query (or queries), or the page (and the text looked for). */
  summary: string;
  /** The page, when one is opened (http / https only; anything else is shown as text, never as a link). */
  url: string | null;
  fields: { name: string; value: string }[];
}

const record = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (text(x) ? [text(x)!] : [])) : []);

/** `url` if it is an http(s) address. */
export function webUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const field = (name: string, value: string | null) => (value ? [{ name, value }] : []);

export function webToolRow(item: RawItem): WebToolModel | null {
  if (item.type === "webSearch") {
    const action = record(item.action);
    const type = text(action?.type);
    if (type === "openPage" || type === "findInPage") {
      const url = text(action?.url);
      const pattern = type === "findInPage" ? text(action?.pattern) : null;
      if (!url) return null;
      return { kind: "webPage", summary: pattern ? `${pattern} · ${url}` : url, url: webUrl(url), fields: [...field("url", url), ...field("pattern", pattern)] };
    }
    const queries = strings(action?.queries);
    const query = text(action?.query) ?? text(item.query) ?? queries[0] ?? null;
    if (!query) return null;
    const all = queries.length > 1 ? queries : [query];
    return { kind: "webSearch", summary: all.join(" · "), url: null, fields: all.map((q) => ({ name: "query", value: q })) };
  }
  if (item.type === "dynamicToolCall" && item.namespace === "claude" && (item.tool === "WebSearch" || item.tool === "WebFetch")) {
    const a = toolArgs(item);
    if (item.tool === "WebSearch") {
      const query = text(a.query);
      if (!query) return null;
      const allowed = strings(a.allowed_domains);
      const blocked = strings(a.blocked_domains);
      return { kind: "webSearch", summary: query, url: null, fields: [{ name: "query", value: query }, ...field("allowed_domains", allowed.join(", ") || null), ...field("blocked_domains", blocked.join(", ") || null)] };
    }
    const url = text(a.url);
    if (!url) return null;
    return { kind: "webPage", summary: url, url: webUrl(url), fields: [{ name: "url", value: url }, ...field("prompt", text(a.prompt))] };
  }
  return null;
}
