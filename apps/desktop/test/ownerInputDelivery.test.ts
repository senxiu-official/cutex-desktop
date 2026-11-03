import { describe, expect, it } from "vitest";
import type { QueueAdmission, QueueItem } from "@cutex-desktop/protocol";
import { withoutDeliveredOwnerItems } from "../src/renderer/src/lib/legacyDelivery/ownerInputDelivery";

describe("positive owner-input delivery precedence", () => {
  const input = (id: string, state = "queued") => ({ queueId: id, clientUserMessageId: `client-${id}`, state }) as QueueItem;
  const note = { id: "agent-note", deliveryKind: "tell", waitReason: "nativeReceipt", enqueuedAt: "2026-10-26T00:00:00Z" } as const;
  const admission: QueueAdmission = { revision: 3, items: [{ kind: "owner", id: "delivered", state: "waiting", position: 1, enqueuedAt: "" }, { kind: "ask", id: "ask", state: "waiting", position: 2, enqueuedAt: "" }], nextStep: [note] };

  it("removes only proven owner queue rows and their matching admission entry", () => {
    const waiting = input("waiting");
    const next = withoutDeliveredOwnerItems([input("delivered"), waiting], admission, (id) => id === "client-delivered");
    expect(next.queue).toEqual([waiting]);
    expect(next.admission?.items).toEqual([admission.items[1]]);
    expect(next.admission?.nextStep).toBe(admission.nextStep);
  });
  it("accepts an explicit delivered row but never infers agent-note delivery from queue absence or age", () => {
    const next = withoutDeliveredOwnerItems([input("delivered", "delivered")], admission, () => false);
    expect(next.queue).toEqual([]); expect(next.admission?.nextStep).toEqual([note]);
    expect(withoutDeliveredOwnerItems([], admission, () => false).admission).toBe(admission);
  });
  it("removes a stale admission-only owner row using its proven queue/client correlation, retained after receipt expiry", () => {
    const items: QueueItem[] = [];
    const first = withoutDeliveredOwnerItems(items, admission, (id) => id === "client-delivered", [input("delivered")]);
    expect(first.queue).toBe(items);
    expect(first.admission?.items).toEqual([admission.items[1]]);
    const later = withoutDeliveredOwnerItems(items, admission, () => false, [], first.deliveredOwnerQueueIds);
    expect(later.admission?.items).toEqual([admission.items[1]]);
    expect(later.admission?.nextStep).toBe(admission.nextStep);
    expect(withoutDeliveredOwnerItems(items, admission, () => true).admission).toBe(admission); // no guessed queueId/clientId relation
  });
});
