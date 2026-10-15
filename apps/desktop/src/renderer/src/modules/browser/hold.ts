/** Body-local adapter for the v1.9 shell hook. A hold is never a lease by itself. */
export interface BrowserHoldOptions {
  keepMounted(hold: boolean): boolean;
  ready(leaseId: string, held: boolean): Promise<void>;
  revoke(leaseId: string): Promise<void>;
  failed(error: unknown): void;
}
export function createBrowserHold(options: BrowserHoldOptions) {
  let current: { id: string; acquired: boolean; observed: boolean; revoked: boolean } | undefined;
  let disposed = false;
  const revoke = (entry: NonNullable<typeof current>) => {
    if (entry.revoked) return;
    entry.revoked = true;
    entry.acquired = false;
    options.keepMounted(false);
    void options.revoke(entry.id).catch(options.failed);
  };
  return {
    update(leaseId: string | undefined, held: boolean) {
      if (disposed) return;
      if (current?.id !== leaseId) {
        if (current?.acquired) options.keepMounted(false);
        current = undefined;
        if (leaseId) {
          const entry = { id: leaseId, acquired: options.keepMounted(true), observed: false, revoked: false };
          current = entry;
          // Main keeps the daemon lease pending until this acknowledgement AND provider readiness.
          // Refusal does not allocate another hold or turn into an automatic retry.
          void options.ready(entry.id, entry.acquired).catch(error => {
            if (current !== entry || disposed) return;
            revoke(entry); options.failed(error);
          });
        }
      }
      const entry = current;
      if (!entry || !entry.acquired || entry.revoked) return;
      // keepMounted(true) updates a store; the first render still has held=false. Only a real
      // observed true -> false edge means the shell withdrew the previously acquired hold.
      if (held) entry.observed = true;
      else if (entry.observed) revoke(entry);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (current) revoke(current);
      current = undefined;
    },
  };
}
