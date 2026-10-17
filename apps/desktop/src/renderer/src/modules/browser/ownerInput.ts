// Shared-tab co-control (0.1.3). The owner's clicks, scrolls and typing reach the page directly;
// they never pause the agent (main only makes agent writes wait while the owner types and makes
// the agent read again after owner input). This module keeps the remaining renderer duty: an
// input-transparent marker that proves the card is ready, and focus bookkeeping so main can hand
// keyboard focus back to the owner after an agent click pulled it into the page.

export const BROWSER_FOCUS_RETURN = "data-browser-focus-return";
interface BrowserMarkerElement { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }
interface FocusElement { setAttribute?(name: string, value: string): void; removeAttribute?(name: string): void; getAttribute?(name: string): string | null }
interface BrowserCaptureDocument extends EventTarget {
  readonly activeElement: unknown; readonly body?: unknown;
  querySelectorAll?(selector: string): ArrayLike<FocusElement>;
}

/**
 * Remember (as an attribute main's fixed restore script can find) the owner's last focus outside
 * this guest. Updated whenever focus moves; never moves focus itself, so an owner click into the
 * page keeps it there.
 */
export function installBrowserOwnerCapture(capture: BrowserMarkerElement, guest: EventTarget, document: BrowserCaptureDocument, guestId: string): () => void {
  let marked: FocusElement | null = null;
  const mark = (element: unknown) => {
    if (!element || element === guest || element === capture || element === document.body) return;
    const candidate = element as FocusElement;
    if (typeof candidate.setAttribute !== "function") return;
    if (marked && marked !== candidate) marked.removeAttribute?.(BROWSER_FOCUS_RETURN);
    candidate.setAttribute(BROWSER_FOCUS_RETURN, guestId);
    marked = candidate;
  };
  const focusin = (event: Event) => {
    const target = (event as FocusEvent).target;
    if (target === guest) mark((event as FocusEvent).relatedTarget);
    else mark(target);
  };
  const cleanup = () => {
    capture.removeAttribute("data-browser-owner-ready");
    document.removeEventListener("focusin", focusin, true);
    if (marked?.getAttribute?.(BROWSER_FOCUS_RETURN) === guestId) marked.removeAttribute?.(BROWSER_FOCUS_RETURN);
    marked = null;
  };
  capture.removeAttribute("data-browser-owner-ready");
  try {
    mark(document.activeElement);
    document.addEventListener("focusin", focusin, true);
    capture.setAttribute("data-browser-owner-ready", "true");
  } catch (error) { cleanup(); throw error; }
  return cleanup;
}
