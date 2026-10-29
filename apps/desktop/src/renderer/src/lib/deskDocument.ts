// A desk window's document (multi-window, lib/deskWindows): an `about:blank` child of this window that this
// renderer draws into. It needs the app's look: every stylesheet of the main document (Vite's injected
// <style> in development, the built <link> in a package), the theme / palette / appearance the main document
// carries on <html> (data-theme, inline CSS variables) and the fonts added from script (appearance,
// stored fonts). Copied, not shared: a constructed stylesheet cannot be adopted by two documents, and a
// clone keeps working after HMR / a theme switch because the mirror follows the main document's changes.
//
// The desk document inherits the main document's CSP (about:blank takes its creator's policy container),
// so nothing copied here can load what the main window could not.

/** The stylesheets of `head`: <style> and <link rel="stylesheet">, in order. */
function sheetsOf(head: HTMLHeadElement): Element[] {
  return [...head.children].filter((el) => el.localName === "style" || (el.localName === "link" && /(^|\s)stylesheet(\s|$)/i.test(el.getAttribute("rel") ?? "")));
}

function copyAttributes(from: Element, to: Element): void {
  for (const attr of [...to.attributes]) if (!from.hasAttribute(attr.name)) to.removeAttribute(attr.name);
  for (const attr of [...from.attributes]) if (to.getAttribute(attr.name) !== attr.value) to.setAttribute(attr.name, attr.value);
}

/**
 * Keep `to` looking like `from` (styles, <html> / <body> attributes, script-added fonts) until the returned
 * stop is called. Runs in MutationObserver callbacks (microtasks), never on a timer: the main window may be
 * hidden while the desk is on screen.
 */
export function mirrorDocument(from: Document, to: Document): () => void {
  const clones = new Map<Element, Element>();
  const fonts = new WeakSet<FontFace>();
  const syncSheets = () => {
    const sources = sheetsOf(from.head);
    for (const [source, clone] of clones) {
      if (!sources.includes(source)) {
        clone.remove();
        clones.delete(source);
      }
    }
    let previous: Element | null = null;
    for (const source of sources) {
      let clone = clones.get(source);
      if (!clone) {
        clone = to.importNode(source, true) as Element;
        // A link's href resolved against the main document (about:blank's base is its creator's, but be explicit).
        if (clone.localName === "link") clone.setAttribute("href", (source as HTMLLinkElement).href);
        clones.set(source, clone);
      } else if (clone.localName === "style" && clone.textContent !== source.textContent) {
        // Vite HMR rewrites a module's <style> text in place.
        clone.textContent = source.textContent;
      } else if (clone.localName === "link" && clone.getAttribute("href") !== (source as HTMLLinkElement).href) {
        clone.setAttribute("href", (source as HTMLLinkElement).href);
      }
      // Same order as the main document (later sheets win in the cascade).
      const expected: ChildNode | null = previous ? previous.nextSibling : to.head.firstChild;
      if (expected !== clone) to.head.insertBefore(clone, expected);
      previous = clone;
    }
  };
  const syncRoot = () => {
    copyAttributes(from.documentElement, to.documentElement);
    if (from.body && to.body) copyAttributes(from.body, to.body);
  };
  const syncFonts = () => {
    // No FontFaceSet (tests, very old engines): nothing to carry over.
    if (!from.fonts || !to.fonts) return;
    for (const face of from.fonts as unknown as Iterable<FontFace>) {
      if (fonts.has(face)) continue;
      fonts.add(face);
      try {
        to.fonts.add(face);
      } catch {
        // A face this document refuses: the fallback font shows (no worse than before the face loaded).
      }
    }
  };
  syncSheets();
  syncRoot();
  syncFonts();
  const view = from.defaultView;
  const Observer = view?.MutationObserver ?? MutationObserver;
  const head = new Observer(() => {
    syncSheets();
    syncFonts();
  });
  head.observe(from.head, { childList: true, subtree: true, characterData: true, attributes: true });
  const root = new Observer(syncRoot);
  root.observe(from.documentElement, { attributes: true });
  if (from.body) root.observe(from.body, { attributes: true });
  // Script-added fonts load after they are added; a face that finished loading may be new to the desk.
  const onFonts = () => syncFonts();
  from.fonts?.addEventListener("loadingdone", onFonts);
  return () => {
    head.disconnect();
    root.disconnect();
    from.fonts?.removeEventListener("loadingdone", onFonts);
  };
}
