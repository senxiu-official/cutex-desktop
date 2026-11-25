// Whose text a subtree is, set explicitly by surfaces that show another agent's words (a delegation's brief and result,
// components/DelegationCard): an agent and turn, or "copy" when it is ambiguous (only 复制). Undefined = work it out
// from the side chat / note scope or the conversation (lib/useSelectionMenu). Provided by components/SelectionActions
// SelectionSourceScope.
import { createContext } from "react";
import type { SelectionAttribution } from "./selectionMenu";

export const SelectionSourceOverride = createContext<SelectionAttribution | undefined>(undefined);
