// Ledger path: admission is used only to address a reorder target. It never determines visibility/state.
import type { AdmissionRef, InputRecord, QueueAdmission, QueueItem } from "@cutex-desktop/protocol";

export function ledgerOrderRef(record: InputRecord, items: readonly QueueItem[], admission: QueueAdmission | null | undefined): AdmissionRef | undefined {
  const owner = record.kind === "owner" ? items.find(item => item.clientUserMessageId === record.inputId) : undefined;
  const entry = admission?.items.find(entry => owner ? entry.kind === "owner" && entry.id === owner.queueId :
    record.kind === "delegationRequest" ? entry.kind === "ask" && entry.id === (record.askId ?? record.inputId) :
      entry.id === record.inputId || entry.id === record.order?.admissionKey || `${entry.kind}:${entry.id}` === record.order?.admissionKey);
  return entry ? { kind: entry.kind, id: entry.id } : undefined;
}
