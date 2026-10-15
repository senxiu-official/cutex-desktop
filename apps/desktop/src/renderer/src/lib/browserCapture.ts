// The browser module's host capture layer (handoff codex-browser-i2 §7 D-G): while a tab is granted to
// an agent, a transparent layer over the page takes the owner's first trusted input, calls
// preventDefault (the input must not reach the page) and lets keydown bubble so app shortcuts keep
// working. Window-level shortcut handlers skip defaultPrevented keys; they use this predicate to make
// the one exception for that layer. Never replays the event and never cancels the layer's preventDefault.

/** The marker attribute of the capture layer (`modules/browser/BrowserOwnerCapture.tsx`). */
export const BROWSER_CAPTURE_ATTR = "data-browser-owner-capture";

interface KeydownLike {
  readonly type: string;
  readonly isTrusted: boolean;
  readonly target: EventTarget | null;
}

/** A trusted keydown whose target is a browser capture layer element. */
export function isCaptureKeydown(e: KeydownLike): boolean {
  if (e.type !== "keydown" || e.isTrusted !== true) return false;
  const target = e.target as { hasAttribute?: unknown } | null;
  return !!target && typeof target.hasAttribute === "function" && (target as Element).hasAttribute(BROWSER_CAPTURE_ATTR);
}

/** Window shortcut handlers: true = another handler already used this key, skip it. */
export function shortcutKeyUsed(e: KeydownLike & { readonly defaultPrevented: boolean }): boolean {
  return e.defaultPrevented && !isCaptureKeydown(e);
}
