// `/copy` and `/export`: plain-text views of a timeline. Pure, unit-tested.
import type { TimelineEntry } from "./timeline";

/** Text of the last finished-or-streaming assistant message (review output counts). */
export function lastAssistantText(entries: readonly TimelineEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === "agent" && e.text.trim()) return e.text;
    if (e.kind === "review" && e.phase === "exited" && e.text.trim()) return e.text;
  }
  return null;
}

export interface TranscriptLabels {
  user: string;
  assistant: string;
  /** `sender`: the received message's id / source kind (cutex services get a system name, lib/systemSenders). */
  from(name: string, sender?: { id: string; sourceKind: string | null }): string;
  to(name: string): string;
  review: string;
  reviewTarget: string;
  plan: string;
}

/** Conversation as Markdown: one `##` section per message; tool steps as a compact list. */
export function timelineToMarkdown(title: string, entries: readonly TimelineEntry[], labels: TranscriptLabels, nameOf: (id: string) => string = (id) => id): string {
  const out: string[] = [`# ${title}`, ""];
  let tools: string[] = [];
  const flush = () => {
    if (tools.length) out.push(...tools, "");
    tools = [];
  };
  for (const e of entries) {
    switch (e.kind) {
      case "user":
        flush();
        out.push(`## ${labels.user}`, "", e.text, "");
        break;
      case "agent":
        flush();
        out.push(`## ${labels.assistant}`, "", e.text, "");
        break;
      case "received":
        flush();
        out.push(`## ${labels.from(e.message.senderName, { id: e.message.senderId, sourceKind: e.message.sourceKind })}`, "", e.message.text, "");
        break;
      case "sent":
        flush();
        out.push(`## ${labels.to(nameOf(e.to))}`, "", e.text, "");
        break;
      case "review":
        flush();
        out.push(e.phase === "entered" ? `> ${labels.reviewTarget}: ${e.text}` : `## ${labels.review}\n\n${e.text}`, "");
        break;
      case "tool": {
        const item = e.item;
        if (item.type === "commandExecution") tools.push(`- \`${String(item.command ?? "").replace(/`/g, "'")}\``);
        else if (item.type === "fileChange") for (const c of (item.changes as { path: string }[] | undefined) ?? []) tools.push(`- ✎ ${c.path}`);
        else tools.push(`- ${item.type}${typeof item.tool === "string" ? ` ${item.tool}` : ""}`);
        break;
      }
      case "plan":
        flush();
        out.push(`## ${labels.plan}`, "", e.text, "");
        break;
      case "checklist":
        flush();
        out.push(...e.steps.map((s) => `- [${s.status === "completed" ? "x" : " "}] ${s.step}`), "");
        break;
      case "notice":
      case "other":
        break;
    }
  }
  flush();
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
