// Observe only runtime runs started by this desktop. Existing cutex run snapshots own progress.
import type { RuntimePackageRun, RuntimePackageRunItem, RuntimePackagesView } from "../../../shared/ipc";
import { translate, type MessageKey } from "../i18n";
import { beginOperation, replaceOperationItems, itemRunning, type OperationItem } from "./backgroundOperations";

interface RuntimeReceipt {
  host: string;
  id: string;
  starting: boolean;
  native: RuntimePackageRun | null;
  claude: RuntimePackageRun | null;
  failures: OperationItem[];
  retryNative(id: string): Promise<unknown>;
  retryClaude(id: string): Promise<unknown>;
  retryOnline(id: string): Promise<unknown>;
}
const receipts = new Map<string, RuntimeReceipt>();
function detailOf(item: RuntimePackageRunItem): string | undefined {
  if (item.reason) return item.reason;
  if (item.code === "hostBusy") return translate("hostAction.exhausted");
  if (["busy","alreadyCurrent","notFound","contractChanged","notEligible"].includes(item.code ?? "")) return translate(`runtimePackages.skip.${item.code}` as MessageKey);
  if (["offlineFailed","staleClaim","reviewRefused","targetMismatch","selectedChanged","applyFailed","revertFailed","interrupted"].includes(item.code ?? "")) return translate(`runtimePackages.fail.${item.code}` as MessageKey);
  return undefined;
}
function itemsOf(run: RuntimePackageRun | null, retry: RuntimeReceipt["retryNative"], online: RuntimeReceipt["retryOnline"]): OperationItem[] {
  return (run?.items ?? []).map((item: RuntimePackageRunItem) => {
    const offlineFailure = item.state === "moved" && item.wasOnline === true && item.backOnline === false;
    const state = offlineFailure ? "failed" : item.state === "moved" ? "done" : item.state === "pending" ? "queued" : item.state;
    return { key: item.cutexSessionId, name: item.name, state,
      detail: detailOf(item),
      retry: state === "failed" ? () => (offlineFailure ? online : retry)(item.cutexSessionId) : undefined };
  });
}
function publish(receipt: RuntimeReceipt) {
  const items = [...itemsOf(receipt.native, receipt.retryNative, receipt.retryOnline), ...itemsOf(receipt.claude, receipt.retryClaude, receipt.retryOnline), ...receipt.failures];
  if (!items.length) items.unshift({key:"request",name:"",state:receipt.starting?"running":"done"});
  replaceOperationItems(receipt.id, items);
  if (!receipt.starting && !items.some(itemRunning)) receipts.delete(receipt.id);
}
export function beginRuntimeOperation(host: string, revert: boolean, retryNative: RuntimeReceipt["retryNative"], retryClaude: RuntimeReceipt["retryClaude"], retryOnline: RuntimeReceipt["retryOnline"]) {
  const id = beginOperation(host, revert ? "operations.kind.runtimeRevert" : "operations.kind.runtimeUpgrade", [{key:"request",name:""}]);
  const receipt: RuntimeReceipt = { host, id, starting:true, native:null, claude:null, failures:[], retryNative, retryClaude, retryOnline };
  receipts.set(id, receipt);
  publish(receipt);
  return {
    native(run: RuntimePackageRun) { receipt.native = run; publish(receipt); },
    claude(run: RuntimePackageRun) { receipt.claude = run; publish(receipt); },
    failure(detail: string) { receipt.failures.push({key:`request-${receipt.failures.length}`,name:"",state:"failed",detail}); publish(receipt); },
    finish() { receipt.starting = false; publish(receipt); },
  };
}
export function observeRuntimeOperations(host: string, view: RuntimePackagesView | null) {
  for (const receipt of receipts.values()) {
    if (receipt.host !== host || !receipt.native) continue;
    const native = [view?.activeRun, view?.lastRun].find(run => run?.runId === receipt.native!.runId);
    if (native) { receipt.native = native; publish(receipt); }
  }
}
