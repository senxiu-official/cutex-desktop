// What a reasoning item shows (DESIGN §4.14): the full reasoning when the model gives it, else its
// summaries, else nothing (the turn's live line then just says 推理中). Pure.
import type { TimelineEntry } from "./timeline";

export type ReasoningEntry = Extract<TimelineEntry, { kind: "reasoning" }>;

export interface ReasoningText {
  source: "content" | "summary";
  text: string;
}

const joined = (parts: string[]) =>
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");

/** Full reasoning (`content`) wins over summaries; null when neither has text. */
export function reasoningText(entry: ReasoningEntry): ReasoningText | null {
  const content = joined(entry.content);
  if (content) return { source: "content", text: content };
  const summary = joined(entry.summary);
  return summary ? { source: "summary", text: summary } : null;
}

const plain = (line: string) =>
  line
    .replace(/^#+\s*/, "")
    .replace(/\*\*|__|`/g, "")
    .trim();

/**
 * One line previewing live reasoning: full reasoning's current paragraph, or the title (first line)
 * of the latest summary part; markdown markers stripped. Null when there is no text yet.
 */
export function reasoningPreview(entry: ReasoningEntry | null): string | null {
  if (!entry) return null;
  const content = entry.content.join("").split("\n").map(plain).filter(Boolean);
  if (content.length) return content[content.length - 1]!;
  const parts = entry.summary.filter((p) => p.trim());
  const latest = parts[parts.length - 1];
  return latest ? (latest.split("\n").map(plain).find(Boolean) ?? null) : null;
}

/** The last line of what the row would show (full reasoning or summaries), markdown stripped: the
 *  collapsed row's one-line preview, updating as GLM-style streams flush. Null without text. */
export function reasoningLastLine(entry: ReasoningEntry): string | null {
  const body = reasoningText(entry);
  if (!body) return null;
  const lines = body.text.split("\n").map(plain).filter(Boolean);
  return lines.length ? lines[lines.length - 1]! : null;
}
