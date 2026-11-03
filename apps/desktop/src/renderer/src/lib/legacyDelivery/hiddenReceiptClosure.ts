// LEGACY(input-ledger-v1): frozen delivery inference for older hosts.
// Delete only when EVERY host advertises input-ledger-v1 (including hachimi).
// A hidden receipt that the server has since closed (this desktop's close, another client's, or a
// live settlement event) is shown again: a closed row leaves 接下来 on its own, so the hidden entry
// would only linger in 待清理. Local display state only; nothing is sent.
import { useEffect } from "react";
import { useApp } from "../../store";
import { useAgentMessages } from "../agentMessageStore";
import { restoreReceipt, type HiddenReceipt } from "./busReceiptVisibility";
import { settlementWriteKey, useSettlementWrites } from "../messageSettlementWrites";

export function useRestoreClosedReceipts(hostId: string, rows: readonly HiddenReceipt[]): void {
  const writes = useSettlementWrites((s) => s.entries);
  const messages = useAgentMessages((s) => s.byId);
  const activeHost = useApp((s) => s.hosts?.active);
  useEffect(() => {
    for (const { session, id } of rows)
      if (writes[settlementWriteKey(hostId, id)]?.settlement?.state === "closed" || ((!activeHost || activeHost === hostId) && messages[id]?.settlement?.state === "closed"))
        restoreReceipt(hostId, session, id);
  }, [rows, writes, hostId, messages, activeHost]);
}
