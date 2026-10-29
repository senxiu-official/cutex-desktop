/**
 * Stable wire form shared by the composer and transcript (owner 2026-10-26: the link always carries the full id, so a
 * rename, a duplicate name, a retired-and-recreated name or a same-named agent on another host never points at the
 * wrong one): `[@name](cutex:agent/<full cutex session id>)`; an agent on another host than the conversation's
 * `[@name@host](cutex:agent/<id>@<host>)` — the host rides in the key after `@`, like an artifact ref's version
 * (`cutex:artifact/af-…@4`), since `cutex:` keys take no query. No host lookup or I/O here.
 */
const SESSION_ID = /^cutex\.(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|ag-[a-z0-9][a-z0-9-]{0,99})$/;
const PREFIX = "cutex:agent/";
/**
 * Markdown punctuation in a name is escaped (no markup or link injection), except `-` `.` `_` `@`, which names use and
 * Markdown leaves alone there: agents read 「@deleg-core」, not 「@deleg\-core」.
 */
const LINK_TEXT = /[!"#$%&'()*+,/:;<=>?[\\\]^`{|}~]/g;
// eslint-disable-next-line no-control-regex -- labels and host names: no whitespace runs or control characters
const SPACE = /[\s\u0000-\u001f\u007f]+/g;

/** The id and (another host's) host of an agent link; null when it is not one. */
export function parseAgentMention(href: string): { id: string; host: string | null } | null {
  if (typeof href !== "string" || !href.startsWith(PREFIX)) return null;
  const key = href.slice(PREFIX.length);
  const at = key.indexOf("@");
  const id = at < 0 ? key : key.slice(0, at);
  if (!SESSION_ID.test(id)) return null;
  if (at < 0) return { id, host: null };
  let host: string;
  try {
    host = decodeURIComponent(key.slice(at + 1));
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex -- a host label: no control characters
  return host && host.length <= 100 && !/[\u0000-\u001f\u007f]/.test(host) ? { id, host } : null;
}

export function parseAgentMentionHref(href: string): string | null {
  return parseAgentMention(href)?.id ?? null;
}

/** `host`: the agent is on another host than the conversation's (its label, e.g. remote). */
export function agentMentionMarkdown(name: string, id: string, host?: string | null): string {
  if (!parseAgentMentionHref(PREFIX + id)) throw new Error("invalid_agent_mention_id");
  const label = name.replace(SPACE, " ").trim() || id;
  const where = host ? host.replace(SPACE, " ").trim() : "";
  const text = where ? `${label}@${where}` : label;
  return `[@${text.replace(LINK_TEXT, "\\$&")}](${PREFIX}${id}${where ? `@${encodeURIComponent(where)}` : ""})`;
}

/** `name`: the label without the leading @ (and without the trailing @host when the link names that host). */
export interface AgentMentionToken { id: string; host: string | null; name: string; raw: string; start: number; end: number }

function escaped(text: string, offset: number): boolean {
  let slashes = 0;
  while (offset > 0 && text[--offset] === "\\") slashes++;
  return slashes % 2 === 1;
}

export function agentMentionTokens(text: string): AgentMentionToken[] {
  const result: AgentMentionToken[] = [];
  const links = /\[@((?:\\[^\r\n]|[^\]\\\r\n])*)\]\((cutex:agent\/[^\s)]+)\)/g;
  for (const match of text.matchAll(links)) {
    const start = match.index;
    if (escaped(text, start) || (text[start - 1] === "!" && !escaped(text, start - 1))) continue;
    const parsed = parseAgentMention(match[2]!);
    if (!parsed) continue;
    // Older drafts escaped every punctuation mark; any backslash escape reads as the character.
    const label = match[1]!.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
    const name = parsed.host && label.endsWith(`@${parsed.host}`) ? label.slice(0, -parsed.host.length - 1) : label;
    result.push({ id: parsed.id, host: parsed.host, name, raw: match[0], start, end: start + match[0].length });
  }
  return result;
}
