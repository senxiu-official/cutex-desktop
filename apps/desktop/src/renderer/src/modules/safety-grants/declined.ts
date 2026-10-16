// Which timeline tool rows the safety-grants line may belong to (pure; module index + tests).
import type { RawItem } from "../../lib/timeline";

/** Declined tool rows (commands, file changes; other tools end `failed`). Pure and cheap. */
export function isDeclinedTool(item: RawItem): boolean {
  if (item.type === "commandExecution" || item.type === "fileChange") return item.status === "declined";
  return item.type === "dynamicToolCall" && item.namespace === "claude" && item.status === "failed";
}
