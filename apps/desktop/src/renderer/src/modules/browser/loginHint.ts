import { browserNavigationUrl, isBrowserTabKey } from "./browserState";
import type { SideOpenResult } from "../slots";

/** A delayed changed event for the previous origin must never label the new page as a login. */
export function browserLoginOrigin(currentUrl: string, loginOrigin: string | null | undefined): string | null {
  if (!loginOrigin) return null;
  try {
    const url = new URL(currentUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === loginOrigin ? loginOrigin : null;
  } catch { return null; }
}

/** Main retains the exact current URL; only safe metadata crosses into persisted pane params. */
export async function openOwnerLoginCopy(options: {
  reserve(): Promise<{ tabKey: string; url: string }>;
  close(tabKey: string): Promise<void>;
  current(): boolean;
  open(params: { tabKey: string; url: string; ownerTab: true }): SideOpenResult;
}): Promise<void> {
  if (!options.current()) throw Error("stale_browser");
  const copy = await options.reserve();
  if (!isBrowserTabKey(copy.tabKey)) throw Error("invalid_browser_identity");
  let opened = false;
  try {
    if (!options.current() || !browserNavigationUrl(copy.url)) throw Error("stale_browser");
    const result = options.open({ tabKey: copy.tabKey, url: copy.url, ownerTab: true });
    if (result.status !== "opened") throw Error("browser_unavailable");
    opened = true;
  } finally {
    if (!opened) await options.close(copy.tabKey).catch(() => {});
  }
}
