// Browser-preview data for the conversation search: native `thread/searchOccurrences` over the
// core's scripted threads (visible user / final assistant messages, like cute-codex and the Claude
// adapter), pages of 50.
import type { ThreadSearchHit } from "../../../../shared/ipc";
import type { ModuleMock } from "../../dev/mockTypes";

type Item = { type?: string; id?: string; text?: string; phase?: string | null; content?: { type?: string; text?: string }[] };

function textOf(item: Item): string {
  if (item.type === "userMessage") return (item.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  if (item.type === "agentMessage" && (item.phase == null || item.phase === "final_answer")) return item.text ?? "";
  return "";
}

function snippetOf(text: string, start: number, length: number): Pick<ThreadSearchHit, "snippet" | "snippetMatchRange"> {
  const from = Math.max(0, start - 80);
  const to = Math.min(text.length, start + length + 160);
  const prefix = from > 0 ? "…" : "";
  const snippet = prefix + text.slice(from, to) + (to < text.length ? "…" : "");
  const offset = prefix.length + start - from;
  return { snippet, snippetMatchRange: { start: offset, end: offset + length } };
}

export const mock: ModuleMock = {
  features: { new: ["thread-search-occurrences"] },
  api: (core) => ({
    async searchThread(sessionId, _threadId, term, cursor) {
      const read = core.threadRead(sessionId) as { thread?: { turns?: { id: string; items?: Item[] }[] } } | null;
      const needle = term.toLowerCase();
      const hits: ThreadSearchHit[] = [];
      for (const turn of read?.thread?.turns ?? []) {
        for (const item of turn.items ?? []) {
          const text = textOf(item);
          const lower = text.toLowerCase();
          for (let at = lower.indexOf(needle); needle && at >= 0; at = lower.indexOf(needle, at + needle.length)) {
            hits.push({ turnId: turn.id, itemId: item.id ?? "", ...snippetOf(text, at, needle.length), turnCursor: `mock:${turn.id}` });
          }
        }
      }
      const offset = cursor ? Number(cursor) || 0 : 0;
      const page = hits.slice(offset, offset + 50);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { data: page, nextCursor: offset + 50 < hits.length ? String(offset + 50) : null };
    },
  }),
};
