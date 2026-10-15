import type { HostBrowserBridge } from "../../../../shared/browser";
import { isBrowserTabKey } from "./browserState";

/** Reserve only, never navigate. A removed/StrictMode/old-host completion closes its own key. */
export function reserveNewOwnerTab(api: Pick<HostBrowserBridge, "reserveOwnerTab" | "close">, isCurrent: () => boolean,
  accepted: (tabKey: string) => void, failed: (error: unknown) => void): () => void {
  let active = true;
  void Promise.resolve().then(async () => {
    if (!active || !isCurrent()) return;
    const result = await api.reserveOwnerTab();
    if (!isBrowserTabKey(result?.tabKey)) throw Error("invalid_browser_identity");
    if (!active || !isCurrent()) { await api.close(result.tabKey); return; }
    try { accepted(result.tabKey); }
    catch (error) { await api.close(result.tabKey).catch(() => {}); throw error; }
  }).catch(error => { if (active && isCurrent()) failed(error); });
  return () => { active = false; };
}
