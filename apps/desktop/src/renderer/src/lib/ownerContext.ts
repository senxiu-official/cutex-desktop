// React side of lib/ownerWindow (multi-window P2): the document a subtree is drawn in. A desk window's portal root
// (components/DeskWindows) and components/OwnerLayer provide it; without a provider it is the main window's document,
// so the main window behaves exactly as before. Kept apart from lib/ownerWindow so pure DOM code does not load React.
import { createContext, useContext } from "react";
import { windowOfDocument } from "./ownerWindow";

/** The document a subtree is drawn in: set by a desk's portal root (components/DeskWindows) and by OwnerLayer. Null: the main window. */
export const OwnerDocumentContext = createContext<Document | null>(null);

/** Rendering without a DOM (server rendering in tests): what the hooks return; only effects dereference it, and they do not run. */
const NO_DOM = undefined as unknown as Document & Window;

/** The document this component is drawn in (the main window's `document` outside a desk). */
export function useOwnerDocument(): Document {
  return useContext(OwnerDocumentContext) ?? (typeof document === "undefined" ? NO_DOM : document);
}

/** The window this component is drawn in: listeners, rAF, viewport size, matchMedia, observers. */
export function useOwnerWindow(): Window {
  const doc = useOwnerDocument();
  return doc ? windowOfDocument(doc) : NO_DOM;
}

/** Where this component's menus / popovers / dialogs / tooltips / toasts portal to: its own document's body. */
export function useOverlayRoot(): HTMLElement {
  return useOwnerDocument()?.body;
}
