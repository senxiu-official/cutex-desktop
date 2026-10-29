// The window an element lives in (multi-window P2, docs/desktop-modules.md §24.17). Desk windows are drawn by
// this renderer through portals (components/DeskWindows), so the global `window` / `document` always mean the
// MAIN window: a menu portalled into `document.body` opens there, a key listener on `window` never hears the
// desk, `document.activeElement` is the main window's, a ResizeObserver from this realm is checked in the main
// window's rendering steps, and `x instanceof HTMLElement` is false for a desk element (another realm).
//
// Everything here resolves to the element's own window / document instead; with no desk involved it returns
// the global `window` / `document`, so the main window behaves exactly as before. The source guard
// (test/ownerWindowGuard.test.ts) keeps new code on these helpers. React components: lib/ownerContext (useOwnerWindow,
// useOwnerDocument, useOverlayRoot).

/** The window of a document (the main window for one without a browsing context: document.implementation, tests). */
export function windowOfDocument(doc: Document): Window {
  return doc.defaultView ?? window;
}

function isWindow(value: unknown): value is Window {
  return !!value && typeof value === "object" && (value as Window).window === value;
}

/** The document of a node / event target / window (the main `document` for null or anything else). */
export function ownerDocumentOf(target: EventTarget | Node | Window | null | undefined): Document {
  if (!target) return document;
  if (isWindow(target)) return target.document;
  const node = target as Node;
  if (node.nodeType === 9) return node as Document;
  return node.ownerDocument ?? document;
}

/** The window of a node / event target (the main `window` for null, detached-document nodes or anything else). */
export function ownerWindowOf(target: EventTarget | Node | Window | null | undefined): Window {
  if (isWindow(target)) return target;
  // Without a document of its own (null, a fake node), the main window; never reads the global
  // `document`, so this works where only `window` exists (tests).
  const node = target as Node | null | undefined;
  const doc = node?.nodeType === 9 ? (node as Document) : node?.ownerDocument;
  return doc?.defaultView ?? window;
}

/** The focused element of `target`'s document (`document.activeElement` in the main window). */
export function activeElementOf(target?: EventTarget | Node | Window | null): Element | null {
  return ownerDocumentOf(target).activeElement;
}

/** The text selection of `target`'s window (`window.getSelection()` in the main window). */
export function selectionOf(target?: EventTarget | Node | Window | null): Selection | null {
  return ownerWindowOf(target).getSelection();
}

// Cross-realm type checks: a desk element was created by the desk document, so its prototype chain is the desk
// window's and `instanceof HTMLElement` (this realm's) is false.

/** `value` is a DOM node of any window. */
export function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && typeof (value as Node).nodeType === "number" && typeof (value as Node).nodeName === "string";
}

/** `value` is an element of any window. */
export function isElement(value: unknown): value is Element {
  return isNode(value) && value.nodeType === 1;
}

/** `value` is an HTML element (not SVG / MathML) of any window. */
export function isHTMLElement(value: unknown): value is HTMLElement {
  return isElement(value) && value.namespaceURI === "http://www.w3.org/1999/xhtml";
}

/** The DOM interface names on a window (HTMLInputElement, SVGElement, Text, …). */
type DomInterface = {
  [K in keyof typeof globalThis]: (typeof globalThis)[K] extends { prototype: Node } ? K : never;
}[keyof typeof globalThis];

/**
 * `value instanceof <name>` in this window or in the value's own window: `isDom(target, "HTMLInputElement")`
 * instead of `target instanceof HTMLInputElement`, which is false for a desk element.
 */
export function isDom<K extends DomInterface>(value: unknown, name: K): value is (typeof globalThis)[K]["prototype"] {
  if (!isNode(value)) return false;
  const here = (globalThis as unknown as Record<string, unknown>)[name];
  if (typeof here === "function" && value instanceof here) return true;
  const own = (ownerWindowOf(value) as unknown as Record<string, unknown>)[name];
  return typeof own === "function" && own !== here && value instanceof own;
}

/** A ResizeObserver from `target`'s window (one from this realm is checked in the main window's rendering steps). Null where there is none (tests). */
export function resizeObserverFor(target: EventTarget | Node | Window | null | undefined, callback: ResizeObserverCallback): ResizeObserver | null {
  const Observer = (ownerWindowOf(target) as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ?? (typeof ResizeObserver === "undefined" ? undefined : ResizeObserver);
  return Observer ? new Observer(callback) : null;
}

/** An IntersectionObserver from `target`'s window. Null where there is none (tests). */
export function intersectionObserverFor(target: EventTarget | Node | Window | null | undefined, callback: IntersectionObserverCallback, options?: IntersectionObserverInit): IntersectionObserver | null {
  const Observer = (ownerWindowOf(target) as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver ?? (typeof IntersectionObserver === "undefined" ? undefined : IntersectionObserver);
  return Observer ? new Observer(callback, options) : null;
}
