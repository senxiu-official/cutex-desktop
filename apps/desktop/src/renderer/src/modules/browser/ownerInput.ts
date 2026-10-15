import { BROWSER_OWNER_INPUT_KINDS, type BrowserOwnerInputKind } from "../../../../shared/browser";

const INPUT_KINDS = BROWSER_OWNER_INPUT_KINDS;
const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift", "OS", "Hyper", "Super", "Fn", "FnLock", "CapsLock", "NumLock", "ScrollLock", "Symbol", "SymbolLock"]);
export interface BrowserOwnerEvent {
  readonly type: string;
  readonly isTrusted: boolean;
  readonly key?: string;
  readonly keyCode?: number;
  preventDefault(): void;
  stopPropagation(): void;
}

/** D-G accepts only native embedder input. Guest isTrusted / synthetic DOM input is not evidence. */
export function browserOwnerInputKind(event: Pick<BrowserOwnerEvent, "type" | "isTrusted" | "key" | "keyCode">): BrowserOwnerInputKind | null {
  if (!event.isTrusted || !INPUT_KINDS.includes(event.type as BrowserOwnerInputKind)) return null;
  // IME's first key must take over, even when its key name is absent or unusual.
  if (event.type === "keydown" && event.keyCode !== 229 && MODIFIER_KEYS.has(event.key ?? "")) return null;
  return event.type as BrowserOwnerInputKind;
}

/** One successful/pending delivery per granted-layer lifetime. Only a main event removes the layer. */
export function createBrowserOwnerCapture(deliver: (kind: BrowserOwnerInputKind) => Promise<void>, failed: (error: unknown) => void) {
  let active = true, state: "ready" | "pending" | "delivered" = "ready";
  return {
    handle(event: BrowserOwnerEvent): void {
      if (!active) return;
      const kind = browserOwnerInputKind(event);
      if (!kind) return;
      // Consume immediately, before IPC. Continued input is also consumed while awaiting main.
      event.preventDefault();
      if (kind !== "keydown") event.stopPropagation();
      if (state !== "ready") return;
      state = "pending";
      try {
        void deliver(kind).then(() => { if (active) state = "delivered"; }, error => {
          if (!active) return;
          state = "ready"; // A later trusted owner input may retry; never remove protection on failure.
          failed(error);
        });
      } catch (error) { state = "ready"; if (active) failed(error); }
    },
    dispose(): void { active = false; },
  };
}

export interface BrowserCaptureFocusTarget { focus(options?: FocusOptions): void }
/** Redirect only this guest's focus. Mount/reveal while the owner types elsewhere is inert. */
export function redirectBrowserGuestFocus(activeElement: unknown, guest: unknown, capture: BrowserCaptureFocusTarget): boolean {
  if (!guest || activeElement !== guest) return false;
  capture.focus({ preventScroll: true });
  return true;
}

interface BrowserCaptureElement extends EventTarget, BrowserCaptureFocusTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}
interface BrowserCaptureDocument extends EventTarget { readonly activeElement: unknown; readonly body?: unknown }
type BrowserRestorableFocus = BrowserCaptureFocusTarget & { readonly isConnected?: boolean };
/** Kept separate from React so passive flags, focus and exact listener cleanup are unit-testable. */
export function installBrowserOwnerCapture(capture: BrowserCaptureElement, guest: EventTarget, document: BrowserCaptureDocument,
  deliver: (kind: BrowserOwnerInputKind) => Promise<void>, failed: (error: unknown) => void): () => void {
  const control = createBrowserOwnerCapture(deliver, failed);
  const input = (event: Event) => control.handle(event);
  // The owner's last focus outside this guest / shield (composer, address bar, another card).
  // An agent's CDP click focuses the guest inside the app document (Electron 44: the <webview>
  // gets DOM focus). Parking that focus on the shield made the owner's next keystroke, typed
  // for the composer, a "takeover" and paused the grant. Hand focus back instead; the shield
  // only receives focus when no such element exists (e.g. Tab traversal from the page itself).
  let previous: BrowserRestorableFocus | null = null;
  const remember = (active: unknown) => {
    if (!active || active === guest || active === capture || active === document.body) return;
    const candidate = active as Partial<BrowserRestorableFocus>;
    if (typeof candidate.focus === "function") previous = candidate as BrowserRestorableFocus;
  };
  const restore = (): boolean => {
    const target = previous;
    if (!target || target.isConnected === false) return false;
    try { target.focus({ preventScroll: true }); } catch { return false; }
    return document.activeElement === target;
  };
  const redirect = () => {
    if (document.activeElement !== guest) { remember(document.activeElement); return; }
    if (!restore()) redirectBrowserGuestFocus(document.activeElement, guest, capture);
  };
  const options = { capture: true, passive: false };
  const cleanup = () => {
    // Revoke the main visibility proof before any part of the capture stops working.
    capture.removeAttribute("data-browser-owner-ready");
    control.dispose();
    for (const kind of INPUT_KINDS) capture.removeEventListener(kind, input, true);
    guest.removeEventListener("focus", redirect, true);
    document.removeEventListener("focusin", redirect, true);
  };
  capture.removeAttribute("data-browser-owner-ready");
  remember(document.activeElement);
  try {
    for (const kind of INPUT_KINDS) capture.addEventListener(kind, input, options);
    // A guest can receive focus through Tab, an agent click or programmatically. Focus itself never sends ownerInput.
    guest.addEventListener("focus", redirect, true);
    document.addEventListener("focusin", redirect, true);
    redirect();
    capture.setAttribute("data-browser-owner-ready", "true");
  } catch (error) { cleanup(); throw error; }
  return cleanup;
}
