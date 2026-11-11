// The kinds' icons and the timeline's reading of an `owner_pin` call (args + result), apart from the components.
import { CircleHelp, ListTodo, StickyNote, type LucideIcon } from "lucide-react";
import { OWNER_PIN_TOOL, type OwnerPinKind } from "../../../../../shared/ownerPins";
import { toolArgs, toolResult } from "../../../lib/taskRows";
import type { RawItem } from "../../../lib/timeline";

export const KIND_ICON: Record<OwnerPinKind, LucideIcon> = { decide: CircleHelp, todo: ListTodo, note: StickyNote };
export const KIND_TONE: Record<OwnerPinKind, string> = { decide: "text-warn", todo: "text-accent", note: "text-subtle" };

export const isPinTool = (item: RawItem): boolean => item.type === "mcpToolCall" && item.server === "cutex" && item.tool === OWNER_PIN_TOOL;

export interface PinCall { status: "running" | "done" | "failed"; action: "pinned" | "updated" | "resolved"; pinId: string | null; title: string; kind: OwnerPinKind }

export function pinCallOf(item: RawItem): PinCall | null {
  if (!isPinTool(item)) return null;
  const a = toolArgs(item);
  const r = toolResult(item);
  const kind: OwnerPinKind = a.kind === "decide" || a.kind === "note" ? a.kind : "todo";
  const title = typeof a.title === "string" && a.title.trim() ? a.title.trim() : typeof r?.title === "string" ? r.title : "";
  const action = a.state === "done" || a.state === "dropped" ? "resolved" : r?.created === false || typeof a.pin_id === "string" ? "updated" : "pinned";
  const running = item.status === "inProgress" || item.status === "running";
  const refused = r?.ok === false || item.status === "failed" || item.status === "errored";
  const pinId = typeof r?.pinId === "string" ? r.pinId : null;
  return { status: running ? "running" : refused ? "failed" : "done", action, pinId, title, kind };
}

