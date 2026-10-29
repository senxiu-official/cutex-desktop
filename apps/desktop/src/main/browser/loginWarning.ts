import type { WebContents } from "electron";

/** Fixed structural probe only: never read input values, text, names or form contents. */
export function browserLoginIntentScript(typing: boolean): string {
  return `new Promise(resolve => setTimeout(() => {
    try {
      let root = document, element = root.activeElement;
      for (let depth = 0; depth < 12 && element; depth++) {
        if (element.shadowRoot?.activeElement) {
          root = element.shadowRoot; element = root.activeElement; continue;
        }
        if (element.tagName === 'IFRAME') {
          try { if (element.contentDocument) { root = element.contentDocument; element = root.activeElement; continue; } } catch {}
        }
        break;
      }
      if (!element || element.tagName !== 'INPUT' || element.disabled || element.readOnly) return resolve(false);
      if (element.type === 'password') return resolve(true);
      if (!${typing ? "true" : "false"}) return resolve(false);
      const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/);
      if (autocomplete.includes('username') || autocomplete.includes('current-password') || autocomplete.includes('one-time-code')) return resolve(true);
      if (!['text', 'email', 'tel'].includes(element.type)) return resolve(false);
      resolve(!!element.form?.querySelector('input[type="password"]'));
    } catch { resolve(false); }
  }, 0))`;
}

/** Origins alone can leave main. No path, query, credentials or fragment. */
export function browserLoginOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

/** App-run memory only. Agent pools share login state across tabs on one host. */
export class BrowserLoginWarningDismissals {
  private dismissed = new Set<string>();
  private listeners = new Set<(hostId: string, origin: string) => void>();
  subscribe(listener: (hostId: string, origin: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  allows(hostId: string, origin: string): boolean {
    return browserLoginOrigin(origin) === origin && !this.dismissed.has(JSON.stringify([hostId, origin]));
  }
  dismiss(hostId: string, origin: string): void {
    if (!this.allows(hostId, origin)) return;
    this.dismissed.add(JSON.stringify([hostId, origin]));
    for (const listener of this.listeners) {
      try { listener(hostId, origin); } catch { /* One disposed consumer cannot prevent the others from refreshing. */ }
    }
  }
}

/** Key metadata is reduced to this bit in main; no key or text enters the page probe. */
export function browserLoginTypingInput(input: { type: string; key?: string; control?: boolean; meta?: boolean; alt?: boolean }): boolean {
  if (!["keyDown", "rawKeyDown", "char"].includes(input.type)) return false;
  if (input.control || input.meta) return input.key?.toLowerCase() === "v";
  return !input.alt && (input.type === "char" || input.key?.length === 1 || ["Process", "Unidentified"].includes(input.key ?? ""));
}

/** Cross-origin focus is inspected only in the current guest's own current focused child frame.
 * WebFrameMain has no isolated-world API. This fixed boolean-only fallback exposes no bridge. */
async function inspectBrowserLoginIntent(
  guest: Pick<WebContents, "mainFrame" | "focusedFrame" | "isDestroyed" | "executeJavaScriptInIsolatedWorld">,
  typing: boolean,
): Promise<boolean> {
  const main = guest.mainFrame;
  const code = browserLoginIntentScript(typing);
  const result: unknown = await guest.executeJavaScriptInIsolatedWorld(1006, [{ code }], false);
  if (guest.isDestroyed() || guest.mainFrame !== main) return false;
  if (result === true) return true;
  const frame = guest.focusedFrame;
  if (!frame || frame === main || frame.detached || frame.top !== main || !browserLoginOrigin(frame.url)) return false;
  const url = frame.url;
  const focused: unknown = await frame.executeJavaScript(code, false);
  return focused === true && !guest.isDestroyed() && guest.mainFrame === main && guest.focusedFrame === frame
    && !frame.detached && frame.top === main && frame.url === url;
}

/** A page dialog or a child-frame overridden timer must never pin the input detector. */
export async function readBrowserLoginIntent(
  guest: Parameters<typeof inspectBrowserLoginIntent>[0], typing: boolean,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      inspectBrowserLoginIntent(guest, typing),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000); timer.unref?.(); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
