/** Inspect the durable per-ID registers; behavior/reload tests exercise the actual store. */
export function receiptOperations(host: string, session: string, id: string): { revision: number; state: string }[] {
  return Object.keys(localStorage).filter(key => key.startsWith("cutex-desktop.busReceiptVisibility.v2:")).flatMap(key => {
    const route = JSON.parse(key.slice("cutex-desktop.busReceiptVisibility.v2:".length));
    return route[0] === host && route[1] === session && route[2] === id ? [JSON.parse(localStorage.getItem(key)!)] : [];
  });
}
export function latestReceiptState(host: string, session: string, id: string): string | undefined {
  return receiptOperations(host, session, id).sort((a, b) => b.revision - a.revision || Number(b.state === "restored") - Number(a.state === "restored"))[0]?.state;
}
