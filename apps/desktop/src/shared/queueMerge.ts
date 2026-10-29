// 「全部合并插入」 (owner 2026-10-21): while a turn runs, every queued owner message (never a
// delegation) is merged in queue order into ONE input and steered into the running turn under one
// clientUserMessageId. Pure parts shared by main (the cutex sequence, DaemonService.queueMergeInsert)
// and the renderer (the optimistic row): the merge itself, the request-size budget, and the refusal
// messages (error codes do not survive the IPC hop, like shared/queueSteer).
//
// Merged input: one text item — each message's text parts (joined by "\n", as queueItemText shows
// them), messages separated by a blank line, empty ones skipped; `text_elements` byte ranges are
// shifted to their place in the merged text. Then every non-text item (images, local images, skills,
// mentions) in queue order; a skill / mention named twice is kept once.

import type { UserInputSubmitResult } from "@cutex-desktop/protocol";

export const QUEUE_MERGE_SEPARATOR = "\n\n";
/**
 * Budget for the merged input's JSON (cutex refuses a request body over 16 MiB; the rest is headroom
 * for the envelope). Messages that would overflow it stay queued: only a prefix is merged.
 */
export const QUEUE_MERGE_MAX_BYTES = 12 * 1024 * 1024;
/** At least this many owner messages are needed to offer a merge. */
export const QUEUE_MERGE_MIN = 2;

/** Origins that are not the owner's own messages (delegation / bus / automation traffic). */
const NOT_OWNER = new Set(["agent_bus", "automation"]);

type Part = { type?: string; text?: string; text_elements?: unknown; name?: string; path?: string } & Record<string, unknown>;
interface MergeItem {
  input: unknown[];
  origin?: { kind?: string } | null;
}

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

/** Whether a queue item is an owner message that may be merged (delegation / bus items never are). */
export function mergeableOwnerItem(item: MergeItem): boolean {
  return !NOT_OWNER.has(item.origin?.kind ?? "") && Array.isArray(item.input) && item.input.length > 0;
}

function shiftElements(elements: unknown, by: number): unknown[] {
  if (!Array.isArray(elements)) return [];
  return elements.flatMap((el) => {
    const range = (el as { byte_range?: { start?: unknown; end?: unknown } } | null)?.byte_range;
    if (!range || typeof range.start !== "number" || typeof range.end !== "number") return [];
    return [{ ...(el as object), byte_range: { start: range.start + by, end: range.end + by } }];
  });
}

/** The merged native input of `inputs` (each a queue item's input), in order. */
export function mergeQueueInputs(inputs: readonly (readonly unknown[])[]): unknown[] {
  let text = "";
  const elements: unknown[] = [];
  const extra: unknown[] = [];
  const named = new Set<string>();
  for (const input of inputs) {
    // This message's own text (its text parts joined by "\n"), its element ranges relative to it.
    let own = "";
    const ownElements: unknown[] = [];
    for (const raw of input) {
      const part = raw as Part;
      if (part?.type === "text") {
        if (own) own += "\n";
        ownElements.push(...shiftElements(part.text_elements, bytes(own)));
        own += part.text ?? "";
      } else if (part?.type === "skill" || part?.type === "mention") {
        const key = `${part.type}\u0000${part.path ?? ""}\u0000${part.name ?? ""}`;
        if (named.has(key)) continue;
        named.add(key);
        extra.push(raw);
      } else if (raw) extra.push(raw);
    }
    const lead = own.length - own.trimStart().length;
    const trimmed = own.trim();
    if (!trimmed) continue;
    if (text) text += QUEUE_MERGE_SEPARATOR;
    // Ranges move with the trimmed leading whitespace; one that falls outside the kept text is dropped.
    const at = bytes(text) - bytes(own.slice(0, lead));
    const limit = bytes(text) + bytes(trimmed);
    for (const el of shiftElements(ownElements, at)) {
      const r = (el as { byte_range: { start: number; end: number } }).byte_range;
      if (r.start >= bytes(text) && r.end <= limit) elements.push(el);
    }
    text += trimmed;
  }
  return text ? [{ type: "text", text, text_elements: elements }, ...extra] : extra;
}

/** The merged text alone (the optimistic row / pending insert shows it). */
export function mergedText(input: readonly unknown[]): string {
  return (input as Part[]).filter((p) => p?.type === "text").map((p) => p.text ?? "").join("\n");
}

export interface MergePlan<T extends MergeItem> {
  /** The messages merged, in queue order (a prefix of the owner messages that fits the budget). */
  items: T[];
  input: unknown[];
}

/**
 * Which of `items` (queue order) are merged: owner messages only, the longest prefix whose merged JSON
 * stays within `maxBytes`. Null when fewer than QUEUE_MERGE_MIN fit.
 */
export function planQueueMerge<T extends MergeItem>(items: readonly T[], maxBytes = QUEUE_MERGE_MAX_BYTES): MergePlan<T> | null {
  const owner = items.filter(mergeableOwnerItem);
  // Each message's own JSON size bounds what it adds to the merged input (+ the separator).
  let total = 0;
  let n = 0;
  for (const item of owner) {
    total += bytes(JSON.stringify(item.input)) + QUEUE_MERGE_SEPARATOR.length + 2;
    if (total > maxBytes) break;
    n++;
  }
  if (n < QUEUE_MERGE_MIN) return null;
  const taken = owner.slice(0, n);
  const input = mergeQueueInputs(taken.map((i) => i.input));
  return input.length > 0 ? { items: taken, input } : null;
}

// ---------- refusals (main → renderer) ----------

export const QUEUE_MERGE_ERROR_PREFIX = "queue_merge_failed";

/**
 * changed: the queue changed before anything was touched (nothing merged, nothing sent).
 * tooLarge: fewer than two messages fit one request.
 * kept: merged but not sent — the merged message is ONE queued item at the front; `detail` is the
 *   steer refusal (a shared/queueSteer message) when there was one.
 */
export type QueueMergeErrorKind = "changed" | "tooLarge" | "kept";
const KINDS = new Set<QueueMergeErrorKind>(["changed", "tooLarge", "kept"]);

export function queueMergeErrorMessage(kind: QueueMergeErrorKind, detail = ""): string {
  return `${QUEUE_MERGE_ERROR_PREFIX}:${kind}${detail ? ` ${detail.replace(/\s+/g, " ").trim()}` : ""}`;
}

/** The kind (+ detail) named by a queue-merge error message (Electron wraps it after the IPC hop). */
export function parseQueueMergeError(message: string): { kind: QueueMergeErrorKind; detail: string } | null {
  const m = new RegExp(`${QUEUE_MERGE_ERROR_PREFIX}:(\\w+)(?: (.*))?`).exec(message);
  const kind = m?.[1] as QueueMergeErrorKind | undefined;
  return kind && KINDS.has(kind) ? { kind, detail: m![2] ?? "" } : null;
}

/** DaemonApi.queueMergeInsert's answer. */
export interface QueueMergeResult {
  /** The steer / submit answer for the merged message (`imageDelivery`: the queue-steer receipt, image-input-steering). */
  result: UserInputSubmitResult & { imageDelivery?: "pathText" | "nativeImage" };
  /** The merged message's id (the first merged item's clientUserMessageId). */
  clientUserMessageId: string;
  input: unknown[];
  /** queueIds merged into it, in queue order. */
  merged: string[];
  /** Requested ids left queued (changed meanwhile, or over the size budget). */
  skipped: string[];
}
