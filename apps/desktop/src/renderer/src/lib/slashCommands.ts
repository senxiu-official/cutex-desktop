// Composer slash-command palette and @-file mentions (DESIGN §4.3): the command registry, fuzzy
// ranking, token detection in the draft and the dispatcher. Pure (effects go through
// `SlashContext`) so it is unit-tested; the Composer wires the context to store actions.
import { INIT_PROMPT } from "./initPrompt";
import { lacks, type AgentFeatures, type AgentFeature } from "./agentFeatures";
import { structuralBlock, type StructuralBlock } from "./structuralGate";

export type SlashId =
  | "goal"
  | "plan"
  | "review"
  | "compact"
  | "init"
  | "model"
  | "permissions"
  | "status"
  | "usage"
  | "rename"
  | "new"
  | "fork"
  | "side"
  | "archive"
  | "diff"
  | "ps"
  | "stop"
  | "copy"
  | "export"
  | "memories"
  | "experimental"
  | "mcp"
  | "skills"
  | "hooks"
  | "logout";

export interface SlashCommandSpec {
  id: SlashId;
  /** Alternate spellings accepted by the dispatcher and searchable in the palette. */
  aliases?: readonly string[];
  /**
   * "insert": picking it puts `/name ` in the composer and it runs on submit with the typed
   * argument (the argument is optional; `/goal` alone shows the goal). Otherwise it runs at once.
   */
  pick: "run" | "insert";
  /** Needs a live native thread (runtime online). */
  needsThread?: boolean;
  /** Listed but not runnable yet; the value names the reason (i18n `slash.unavailable.<value>`). */
  unavailable?: "forkGap" | "sideGap";
  /** cutex capability that makes an `unavailable` command runnable. */
  enabledBy?: string;
  /** Agent feature (Claude adapter features.json) the command needs; `false` there disables it. */
  agentFeature?: AgentFeature;
  /** A fork / revert: not while a Claude agent is busy (lib/structuralGate). */
  structural?: boolean;
}

export type SlashUnavailable = NonNullable<SlashCommandSpec["unavailable"]> | "agentUnsupported" | StructuralBlock;

/**
 * Why `spec` can't run with these cutex capabilities (and this agent's features; `busy` = it runs a
 * turn), or undefined when it can.
 */
export function slashUnavailable(spec: SlashCommandSpec, features: ReadonlySet<string>, agent?: AgentFeatures, busy = false): SlashUnavailable | undefined {
  const gap = spec.enabledBy && features.has(spec.enabledBy) ? undefined : spec.unavailable;
  if (gap) return gap;
  if (agent && spec.agentFeature && lacks(agent, spec.agentFeature)) return "agentUnsupported";
  return (agent && spec.structural && structuralBlock(agent, busy)) || undefined;
}

/** Palette order (most used first, like the TUI / the reference screenshot). */
export const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  { id: "goal", pick: "insert", needsThread: true, agentFeature: "goals" },
  { id: "plan", pick: "run", needsThread: true },
  { id: "review", pick: "run", needsThread: true, agentFeature: "review" },
  { id: "compact", pick: "run", needsThread: true },
  { id: "init", pick: "run" },
  { id: "model", pick: "run" },
  { id: "permissions", pick: "run" },
  { id: "status", pick: "run" },
  { id: "usage", pick: "run" },
  { id: "diff", pick: "run" },
  { id: "ps", pick: "run", agentFeature: "backgroundTerminals" },
  { id: "stop", pick: "run", needsThread: true, agentFeature: "backgroundTerminals" },
  { id: "copy", pick: "run" },
  { id: "export", pick: "run" },
  { id: "rename", pick: "insert" },
  { id: "new", pick: "run" },
  { id: "fork", pick: "run", unavailable: "forkGap", enabledBy: "session-fork", agentFeature: "fork", structural: true },
  { id: "side", aliases: ["btw"], pick: "insert", needsThread: true, unavailable: "sideGap", enabledBy: "side-chat", agentFeature: "sideChat" },
  { id: "archive", pick: "run" },
  { id: "memories", pick: "run", needsThread: true, agentFeature: "memoryMode" },
  { id: "experimental", pick: "run" },
  { id: "mcp", pick: "run" },
  { id: "skills", pick: "run" },
  { id: "hooks", pick: "run" },
  { id: "logout", pick: "run" },
];

const BY_NAME = new Map(SLASH_COMMANDS.flatMap(c => [c.id, ...(c.aliases ?? [])].map(name => [name, c] as const)));

export function slashSpec(id: string): SlashCommandSpec | undefined {
  return BY_NAME.get(id);
}

// ---------- fuzzy ranking ----------

/**
 * Score `query` against `target` (case-insensitive): prefix > word-start > substring >
 * subsequence; null = no match. Works for CJK too (substring / subsequence on code points).
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1100;
  if (t.startsWith(q)) return 1000; // ties keep registry (usage) order
  const at = t.indexOf(q);
  if (at >= 0) {
    const wordStart = at > 0 && /[\s\-_/.:(（]/.test(t[at - 1]!);
    return (wordStart ? 800 : 600) - at;
  }
  // Subsequence: every query char in order; fewer gaps = better.
  const qs = [...q];
  const ts = [...t];
  let ti = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of qs) {
    while (ti < ts.length && ts[ti] !== ch) ti++;
    if (ti >= ts.length) return null;
    if (last >= 0 && ti > last + 1) gaps += ti - last - 1;
    last = ti;
    ti++;
  }
  return Math.max(1, 300 - gaps * 10 - (qs.length === 1 ? 100 : 0));
}

export interface PaletteEntry {
  key: string;
  kind: "command" | "skill";
  /** Shown after the sigil (`/name` or `$name`). */
  name: string;
  description: string;
  /** Extra text matched but not shown (the other locale's description, aliases). */
  keywords?: string[];
  /** Set → dimmed, not runnable; shown as the description suffix. */
  disabledReason?: string;
}

/**
 * Description match: CJK (or any non-ASCII) query → substring; ASCII → ≥ 3 characters at a word
 * start ("co" would otherwise hit "un-co-mmitted", "con-figuration", …).
 */
function proseMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (/[^\x00-\x7f]/.test(q)) return t.includes(q);
  if (q.length < 3) return false;
  return new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t);
}

/**
 * Rank entries for `query`. The name weighs most; descriptions / keywords only match as
 * substrings (subsequences over prose are noise). Empty query keeps registry order.
 */
export function rankEntries<T extends PaletteEntry>(query: string, entries: readonly T[]): T[] {
  const q = query.trim();
  if (!q) return [...entries];
  const scored: { entry: T; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const name = fuzzyScore(q, entry.name);
    const prose = [entry.description, ...(entry.keywords ?? [])].some((text) => proseMatch(q, text)) ? 200 : null;
    const best = Math.max(name === null ? -1 : name + 1000, prose ?? -1);
    if (best >= 0) scored.push({ entry, score: best - (entry.disabledReason ? 50 : 0), index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.entry);
}

// ---------- tokens in the draft ----------

/** Palette query while the draft is just `/word` (slash at the very start, no whitespace yet). */
export function paletteQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text);
  return m ? m[1]! : null;
}

/** `/name args` for a known command (unknown `/…`, e.g. a path, is ordinary text). */
export function parseSlash(text: string): { id: SlashId; args: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const spec = slashSpec(m[1]!);
  return spec ? { id: spec.id, args: (m[2] ?? "").trim() } : null;
}

/** The `@query` token ending at the caret (start of text or after whitespace), if any. */
export function mentionAt(text: string, caret: number): { start: number; end: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  const start = before.length - m[2]!.length - 1;
  // The token extends past the caret up to the next whitespace.
  const rest = /^[^\s]*/.exec(text.slice(caret))![0];
  return { start, end: caret + rest.length, query: m[2]! };
}

/** Replace the `@query` token with the path (quoted when it has spaces, like the Codex TUI). */
export function insertMention(text: string, token: { start: number; end: number }, path: string): { text: string; caret: number } {
  const inserted = /\s/.test(path) && !path.includes('"') ? `"${path}"` : path;
  const after = text.slice(token.end);
  const sep = after.startsWith(" ") ? "" : " ";
  const next = `${text.slice(0, token.start)}${inserted}${sep}${after}`;
  return { text: next, caret: token.start + inserted.length + 1 };
}

/** Skills picked from the palette whose `$name` is still in the text (cute-codex skill inputs). */
export function boundSkills<T extends { name: string }>(text: string, picked: readonly T[]): T[] {
  const seen = new Set<string>();
  return picked.filter((s) => {
    if (seen.has(s.name)) return false;
    const re = new RegExp(`(^|\\s)\\$${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s.,;:!?])`);
    if (!re.test(text)) return false;
    seen.add(s.name);
    return true;
  });
}

// ---------- dispatch ----------

export type GoalVerb = "clear" | "pause" | "resume" | "edit";

/** Effects the dispatcher can ask for; the Composer implements them with store actions. */
export interface SlashContext {
  /** A native thread is available (runtime online). */
  online: boolean;
  /** Has a goal right now (`/goal` alone shows it, otherwise explains usage). */
  hasGoal: boolean;
  /** Plan collaboration mode is active (`/plan` alone toggles back). */
  planActive: boolean;
  /** cutex capabilities (commands with `enabledBy`). */
  features: ReadonlySet<string>;
  /** This agent's features (Claude agents lack some Codex commands); omitted = all. */
  agent?: AgentFeatures;
  /** The agent runs a turn (a busy Claude agent cannot fork). */
  busy?: boolean;
  open(target: "model" | "permissions" | "quota" | "status" | "goal" | "memories" | "experimental" | "ps"): void;
  /** Put text back in the composer (e.g. `/goal ` while showing the usage hint). */
  insert(text: string): void;
  notify(key: SlashNotice, vars?: Record<string, string | number>): void;
  submitText(text: string): Promise<void>;
  compact(): Promise<void>;
  setGoal(objective: string): Promise<void>;
  goalVerb(verb: GoalVerb): Promise<void>;
  review(instructions: string | null): Promise<void>;
  /** false = plan mode unavailable; null = stale (selection / host changed meanwhile), say nothing. */
  setPlan(on: boolean): Promise<boolean | null>;
  rename(name: string | null): Promise<void>;
  archive(): Promise<void>;
  /** `/fork`: a new agent from the latest turn (session-fork). */
  fork(): Promise<void>;
  side(text: string): void;
  newAgent(): void;
  openDiff(): void;
  stopBackground(): Promise<number>;
  copyLast(): Promise<boolean>;
  exportMarkdown(): Promise<void>;
  openSettings(tab: "mcp" | "skills" | "hooks" | "logout"): void;
}

export type SlashNotice =
  | "slash.notice.needsOnline"
  | "slash.notice.goalUsage"
  | "slash.notice.planUnavailable"
  | "slash.notice.stopped"
  | "slash.notice.nothingToStop"
  | "slash.notice.copied"
  | "slash.notice.nothingToCopy"
  | "slash.notice.reviewStarted"
  | "slash.notice.unavailable"
  | "slash.notice.agentUnsupported"
  | "structural.claudeBusy";

export async function runSlash(id: SlashId, args: string, ctx: SlashContext): Promise<void> {
  const spec = slashSpec(id);
  if (!spec) return;
  const unavailable = slashUnavailable(spec, ctx.features, ctx.agent, ctx.busy);
  if (unavailable === "agentUnsupported") return ctx.notify("slash.notice.agentUnsupported", { name: id });
  if (unavailable === "claudeBusy") return ctx.notify("structural.claudeBusy");
  if (unavailable) return ctx.notify("slash.notice.unavailable", { name: id });
  if (spec.needsThread && !ctx.online) return ctx.notify("slash.notice.needsOnline", { name: id });
  switch (id) {
    case "goal": {
      const verb = args.toLowerCase();
      if (!args) {
        if (ctx.hasGoal) return ctx.open("goal");
        ctx.insert("/goal ");
        return ctx.notify("slash.notice.goalUsage");
      }
      if (verb === "clear" || verb === "pause" || verb === "resume" || verb === "edit") return ctx.goalVerb(verb);
      return ctx.setGoal(args);
    }
    case "plan": {
      if (!args) {
        if ((await ctx.setPlan(!ctx.planActive)) === false) ctx.notify("slash.notice.planUnavailable");
        return;
      }
      const applied = await ctx.setPlan(true);
      if (applied === null) return;
      if (!applied) return ctx.notify("slash.notice.planUnavailable");
      return ctx.submitText(args);
    }
    case "review":
      await ctx.review(args || null);
      return ctx.notify("slash.notice.reviewStarted");
    case "compact":
      return ctx.compact();
    case "init":
      return ctx.submitText(INIT_PROMPT);
    case "model":
    case "permissions":
    case "status":
    case "memories":
    case "experimental":
    case "ps":
      return ctx.open(id);
    case "usage":
      return ctx.open("quota");
    case "rename":
      return ctx.rename(args || null);
    case "archive":
      return ctx.archive();
    case "new":
      return ctx.newAgent();
    case "diff":
      return ctx.openDiff();
    case "stop": {
      const n = await ctx.stopBackground();
      return ctx.notify(n > 0 ? "slash.notice.stopped" : "slash.notice.nothingToStop", { n });
    }
    case "copy":
      return ctx.notify((await ctx.copyLast()) ? "slash.notice.copied" : "slash.notice.nothingToCopy");
    case "export":
      return ctx.exportMarkdown();
    case "mcp":
    case "skills":
    case "hooks":
    case "logout":
      return ctx.openSettings(id);
    case "fork":
      return ctx.fork();
    case "side":
      return ctx.side(args);
  }
}
