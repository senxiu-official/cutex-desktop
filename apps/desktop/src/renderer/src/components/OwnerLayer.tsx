// A global overlay host's content in the window it was opened from (multi-window P2, lib/ownerWindow): the
// context menu, the confirm / prompt dialogs, the foretell layer and the like are mounted once in the main
// window's tree; opened from a desk window, they render into that desk's document instead (and their
// subtree resolves `useOwnerDocument()` to it). The main window renders inline, exactly as before.
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { OwnerDocumentContext } from "../lib/ownerContext";

export function OwnerLayer({ doc, children }: { doc: Document | null | undefined; children: ReactNode }) {
  if (!doc || doc === document || !doc.body) return <>{children}</>;
  return createPortal(<OwnerDocumentContext.Provider value={doc}>{children}</OwnerDocumentContext.Provider>, doc.body);
}

/** A portal into `doc`'s body (a host that always portalled into `document.body`), its subtree in that document. */
export function OwnerPortal({ doc, children }: { doc: Document; children: ReactNode }) {
  return createPortal(<OwnerDocumentContext.Provider value={doc}>{children}</OwnerDocumentContext.Provider>, doc.body);
}
