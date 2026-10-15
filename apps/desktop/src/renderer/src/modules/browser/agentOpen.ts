import type { ModuleServices, SideHoldLocator, SideOpenHeldRefusal } from "../slots";
import { BROWSER_TAB, browserNavigationUrl, isBrowserTabKey } from "./browserState";

export interface BrowserAgentOpenIntent {
  requestId: string; hostId: string; epoch: string; tabKey: string; cutexSessionId: string; url: string; remainingMs: number;
}
export type BrowserAgentOpenRefusal = "lease_limit" | "scope_invalid" | "scope_unsupported" | "target_closed" | "stale_connection" | "browser_disabled" | "invalid_request";
export function browserOpenRefusal(reason: SideOpenHeldRefusal | "stale"): BrowserAgentOpenRefusal {
  switch (reason) {
    case "hold-limit": return "lease_limit";
    case "scope-invalid": return "scope_invalid";
    case "scope-unsupported": return "scope_unsupported";
    case "stale": case "host-offline": return "stale_connection";
    case "module-off": case "capability": case "unknown-kind": case "not-holdable": return "browser_disabled";
    case "bad-params": return "invalid_request";
    case "no-agent": case "agent-feature": return "target_closed";
  }
}
/** Module lifecycle only: no shell store import, IPC credentials, guest allocation or agent authority. */
export function createBrowserAgentOpens(options: {
  side: Pick<ModuleServices["side"], "openHeld" | "releaseHold" | "reveal">;
  isSelected(hostId: string, sessionId: string): boolean;
  refused(intent: BrowserAgentOpenIntent, code: BrowserAgentOpenRefusal): Promise<void>;
  monotonicNow?: () => number;
}) {
  const now = options.monotonicNow ?? (() => performance.now());
  const pending = new Map<string, { intent: BrowserAgentOpenIntent; hold: SideHoldLocator; timer: ReturnType<typeof setTimeout>; deadline: number; instanceId: string }>();
  let disposed = false;
  const key = (hostId: string, requestId: string) => JSON.stringify([hostId, requestId]);
  function remove(id: string, discard: boolean) {
    const entry = pending.get(id); if (!entry) return;
    pending.delete(id); clearTimeout(entry.timer);
    if (discard) options.side.releaseHold(entry.hold, { discard: true });
  }
  function refuse(intent: BrowserAgentOpenIntent, code: BrowserAgentOpenRefusal) { void options.refused(intent, code).catch(() => {}); }
  return {
    open(intent: BrowserAgentOpenIntent) {
      if (disposed) { refuse(intent, "browser_disabled"); return; }
      const id = key(intent.hostId, intent.requestId);
      // Main never replays open commands, and a duplicate event cannot create another card.
      if (pending.has(id)) return;
      if (pending.size >= 16) { refuse(intent, "lease_limit"); return; }
      if (!isBrowserTabKey(intent.tabKey) || !browserNavigationUrl(intent.url) || !Number.isSafeInteger(intent.remainingMs) || intent.remainingMs < 1 || intent.remainingMs > 30_000) {
        refuse(intent, "invalid_request"); return;
      }
      // Main owns the command deadline. This fallback only removes orphaned UI if
      // its cancellation event is lost; never race main's confirmation at the same tick.
      const deadline = now() + intent.remainingMs + 30_000;
      let opened: ReturnType<ModuleServices["side"]["openHeld"]>;
      try { opened = options.side.openHeld(BROWSER_TAB, { url: intent.url, tabKey: intent.tabKey, pendingOpen: intent.requestId },
        { binding: { kind: "agent", hostId: intent.hostId, sessionId: intent.cutexSessionId }, hostEpoch: intent.epoch }); }
      catch { refuse(intent, "browser_disabled"); return; }
      if (opened.status !== "opened") { refuse(intent, browserOpenRefusal(opened.status === "stale" ? "stale" : opened.reason)); return; }
      // Browser tabs are multi/no dedupe. Do not take over an unexpected reused instance.
      if (opened.reused || !opened.hold.token) { options.side.releaseHold(opened.hold, { discard: true }); refuse(intent, "invalid_request"); return; }
      const remaining = deadline - now();
      if (disposed || remaining <= 0) { options.side.releaseHold(opened.hold, { discard: true }); refuse(intent, "stale_connection"); return; }
      const timer = setTimeout(() => { remove(id, true); refuse(intent, "stale_connection"); }, remaining);
      pending.set(id, { intent: { ...intent }, hold: opened.hold, timer, deadline, instanceId: opened.instanceId });
      // Selection can change inside openHeld's synchronous subscribers. Check again, and only
      // reveal after a successful hold. This API never focuses the OS window or selects an agent.
      if (options.isSelected(intent.hostId, intent.cutexSessionId)) options.side.reveal({ instanceId: opened.instanceId });
    },
    confirmed(hostId: string, requestId: string) { remove(key(hostId, requestId), false); },
    cancelled(hostId: string, requestId: string) { remove(key(hostId, requestId), true); },
    invalidateHost(hostId: string, currentEpoch: string | null) {
      for (const [id, entry] of pending) if (entry.intent.hostId === hostId && entry.intent.epoch !== currentEpoch) remove(id, true);
    },
    dispose() { if (disposed) return; disposed = true; for (const id of [...pending.keys()]) remove(id, true); },
  };
}
