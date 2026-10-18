// Which words a settings preview marks (components/settings/PreviewBand): all of them (the band's
// 「标出术语」 switch) or the one whose row is hovered / focused (owner 2026-10-18: the preview looks
// like the real UI until you ask; marked words turn accent blue, nothing else changes).
import { createContext } from "react";
import type { TermId } from "./terms";

export interface PreviewMark {
  all: boolean;
  focus: TermId | null;
  setFocus(id: TermId | null): void;
}

export const PreviewMarkContext = createContext<PreviewMark>({ all: false, focus: null, setFocus: () => {} });
