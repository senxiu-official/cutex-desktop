// The 个人助理 nav entry's badge: requests waiting for the owner on any host, as last read. The badge is always mounted,
// so it also keeps the r296 change-event subscription (`usePaChangeEvents`) and reads each supported host whenever it
// comes online (first connection and every reconnection: events missed while away are covered by that read).
import { useEffect, useRef } from "react";
import { requestGroup } from "../../lib/personalAssistants";
import { refreshHost, usePa } from "../../lib/personalAssistantStore";
import { usePaChangeEvents, usePaHosts } from "./paHooks";

export function useAssistantsBadge(): { text?: string; attention?: boolean } | null {
  const hosts = usePaHosts();
  usePaChangeEvents();
  const key = hosts.filter((h) => h.supported && h.online).map((h) => h.hostId).join("\n");
  const online = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const now = new Set(key ? key.split("\n") : []);
    for (const hostId of now) if (!online.current.has(hostId)) void refreshHost(hostId);
    online.current = now;
  }, [key]);
  const n = usePa((s) => Object.values(s.byHost).reduce((sum, h) => sum + Object.values(h.requests).reduce((m, list) => m + list.filter((r) => requestGroup(r.state) === "decide").length, 0), 0));
  return n > 0 ? { text: String(n), attention: true } : null;
}
