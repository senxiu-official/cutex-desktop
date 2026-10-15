// "停止 = 全部暂停" (cutex capability `queue-pause`). A plain stop (cutex/turn/stop) pauses the
// session's cutex queue, so nothing is sent automatically afterwards; the steers that turn had not
// read yet come back as undelivered (lib/pendingSteers). The composer's queue panel shows both as
// one paused section — undelivered steers first, then the queued items — with 继续发送 / 放回输入框 /
// 清空. Interrupt-and-send never pauses (cutex submit strategy `interrupt`, or a transient stop that
// the store resumes right after sending). Pure helpers, unit-tested.
import type { QueueItem, QueuePause } from "@cutex-desktop/protocol";
import type { PendingSteer } from "./pendingSteers";

/** Between merged messages (steers merged into one turn, texts put back into the composer). */
export const MESSAGE_SEPARATOR = "\n\n";

export function mergeMessageTexts(texts: readonly string[]): string {
  return texts
    .map((t) => t.trim())
    .filter(Boolean)
    .join(MESSAGE_SEPARATOR);
}

export interface PausedSection {
  /** Undelivered steers, in send order (shown first, labelled 未送达). */
  steers: PendingSteer[];
  /** Queued items held by the cutex pause (empty when cutex has not paused the queue). */
  items: QueueItem[];
  count: number;
}

/**
 * The paused section of the queue panel. `hideQueue`: a transient stop of interrupt-and-send is
 * in flight (the store resumes it right away), so the queue is not shown as paused.
 */
export function pausedSection(steers: readonly PendingSteer[], items: readonly QueueItem[], pause: QueuePause | null, hideQueue = false): PausedSection {
  const undelivered = steers.filter((p) => p.state === "undelivered");
  const held = pause && !hideQueue ? [...items] : [];
  return { steers: undelivered, items: held, count: undelivered.length + held.length };
}

/** Input item types the composer can hold (text + image thumbnails + bound skills). */
const COMPOSER_TYPES = new Set(["text", "image", "localImage", "skill"]);

export interface RestorePlan {
  text: string;
  /** Image / skill input items for the composer, in message order. */
  extra: unknown[];
  /** Queued items to remove from the queue (their content is in `text` / `extra`). */
  take: QueueItem[];
  /** Queued items the composer cannot represent (e.g. `mention` parts): they stay queued. */
  keep: QueueItem[];
  steerIds: string[];
}

/** 放回输入框: steers first, then queued items, joined with a blank line. */
export function restorePlan(steers: readonly PendingSteer[], items: readonly QueueItem[]): RestorePlan {
  const take: QueueItem[] = [];
  const keep: QueueItem[] = [];
  for (const item of items) {
    const parts = item.input as { type?: string }[];
    (parts.every((p) => COMPOSER_TYPES.has(p.type ?? "")) ? take : keep).push(item);
  }
  const itemText = (item: QueueItem) =>
    (item.input as { type: string; text?: string }[])
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
  return {
    text: mergeMessageTexts([...steers.map((p) => p.text), ...take.map(itemText)]),
    extra: [...steers.flatMap((p) => p.extra ?? []), ...take.flatMap((item) => (item.input as { type: string }[]).filter((p) => p.type !== "text"))],
    take,
    keep,
    steerIds: steers.map((p) => p.id),
  };
}

export interface ComposerAttachments {
  images: { name: string; preview: string | null; source: { kind: "data"; url: string } | { kind: "path"; path: string } }[];
  skills: { name: string; path: string }[];
}

/** Composer draft attachments for input items put back into it. */
export function composerAttachments(extra: readonly unknown[]): ComposerAttachments {
  const out: ComposerAttachments = { images: [], skills: [] };
  for (const raw of extra) {
    const x = raw as { type?: string; url?: unknown; path?: unknown; name?: unknown };
    if (x.type === "image" && typeof x.url === "string") out.images.push({ name: "image", preview: x.url, source: { kind: "data", url: x.url } });
    else if (x.type === "localImage" && typeof x.path === "string") out.images.push({ name: x.path.split(/[\\/]/).pop() || x.path, preview: null, source: { kind: "path", path: x.path } });
    else if (x.type === "skill" && typeof x.name === "string" && typeof x.path === "string") out.skills.push({ name: x.name, path: x.path });
  }
  return out;
}

/** Interrupt-and-send: the steers the stopped turn dropped, then the new text, as one message. */
export function interruptSendText(dropped: readonly PendingSteer[], text: string): string {
  return mergeMessageTexts([...dropped.map((p) => p.text), text]);
}
