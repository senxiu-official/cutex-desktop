// Which desk window a component is drawn in (multi-window P1, components/DeskWindows): null = the main window.
// Code that must behave differently in a desk (agent HTML pages lease their document to that desk, the
// conversation header's controls) asks here.
import { createContext, useContext } from "react";

export const DeskContext = createContext<string | null>(null);

/** The desk id this component is drawn in, null in the main window. */
export function useDeskId(): string | null {
  return useContext(DeskContext);
}
