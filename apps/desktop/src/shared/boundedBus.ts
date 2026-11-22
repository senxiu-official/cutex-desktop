// bootstrap-bounded-bus (cutex): main sends `bus=bounded` and bus-messages reads only to a host that offers it.
import type { BusMessagesDirection } from "@cutex-desktop/protocol";

export const BOUNDED_BUS_FEATURE = "bootstrap-bounded-bus";

/** One bus-messages page read: rows linked to `turnIds` / `itemIds` (≤ 200 each), continued by `cursor`. */
export interface BusMessagesRequest {
  direction: BusMessagesDirection;
  cursor?: string | null;
  limit?: number;
  turnIds?: string[];
  itemIds?: string[];
}
