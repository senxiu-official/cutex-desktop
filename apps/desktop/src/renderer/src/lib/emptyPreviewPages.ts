import type { ItemId } from "../modules/types";
import { CHANGES_COMPONENT, DIFF_COMPONENT, FILES_COMPONENT, PREVIEW_COMPONENT } from "./sideKinds";

/** Content viewers keep an empty page; its source picker opens normally so the next item refills the viewer. */
export const EMPTY_PREVIEW_LAUNCHERS: Readonly<Record<string, ItemId>> = {
  [PREVIEW_COMPONENT]: FILES_COMPONENT,
  [DIFF_COMPONENT]: CHANGES_COMPONENT,
  "artifacts.view": "artifacts.library",
};
