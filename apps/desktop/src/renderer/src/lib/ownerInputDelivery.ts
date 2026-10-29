// Only positive owner-input evidence wins over a stale queue/insert projection. An empty queue,
// an old timestamp, a completed turn or an agent-bus nativeReceipt is not delivery evidence.
import type { QueueAdmission, QueueItem } from "@cutex-desktop/protocol";

export function deliveredOwnerQueue(items: readonly QueueItem[], delivered: (clientId: string) => boolean): Set<string> {
  return new Set(items.filter((item) => item.state === "delivered" || delivered(item.clientUserMessageId)).map((item) => item.queueId));
}

const EMPTY_DELIVERED: ReadonlySet<string> = new Set();

export function withoutDeliveredOwnerItems(items: QueueItem[], admission: QueueAdmission | null, delivered: (clientId: string) => boolean, knownItems: readonly QueueItem[] = [], knownDelivered: ReadonlySet<string> = EMPTY_DELIVERED): { queue: QueueItem[]; admission: QueueAdmission | null; deliveredOwnerQueueIds: ReadonlySet<string> } {
  const ids = new Set([...knownDelivered, ...deliveredOwnerQueue([...items, ...knownItems], delivered)]);
  const removed = (item: QueueItem) => ids.has(item.queueId);
  const removedAdmission = (item: QueueAdmission["items"][number]) => item.kind === "owner" && ids.has(item.id);
  return {
    queue: items.some(removed) ? items.filter((item) => !removed(item)) : items,
    // Never remove agent notes, nativeReceipt ride-alongs or delegations by association.
    admission: admission?.items.some(removedAdmission) ? { ...admission, items: admission.items.filter((item) => !removedAdmission(item)) } : admission,
    deliveredOwnerQueueIds: ids.size === knownDelivered.size ? knownDelivered : ids,
  };
}
