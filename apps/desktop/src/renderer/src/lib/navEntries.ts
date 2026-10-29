// `nav.primary` entries (sidebar top list, footer icons): what an entry does and when it is active.
import { services } from "../modules/app";
import type { NavItem } from "../modules/slots";
import { isColumnPage, useApp } from "../store";
import { PLAIN_OPEN, type OpenModifiers } from "./openModifiers";
import { openPageBeside } from "./paneStore";
import { openRef } from "./workspaces";
import { pageKind } from "./paneLayout";
import { useSideView } from "./sideComponents";
import { useSide } from "./sideLayoutStore";
import { kindsOnScreen } from "./pageOpener";

/** True while the entry's page (or one of its activePages) is open: over the conversation column, or on screen in a Shelf (§24.4). */
export function useNavActive(item: NavItem): boolean {
  const pages = item.activePages ?? ("page" in item.target ? [item.target.page] : []);
  const page = useApp((s) => s.view.kind === "page" && pages.includes(s.view.page));
  const ctx = useSideView();
  const inShelf = useSide((s) => pages.length > 0 && pages.some((p) => kindsOnScreen(s.layout, ctx).has(pageKind(p))));
  // v1.18: an entry's own active state (a `run()` target); the hook is fixed per item.
  const own = item.useActive?.() ?? false;
  return page || inShelf || own;
}

/**
 * An entry clicked. `mods` (lib/openModifiers, design 038): Ctrl/⌘ opens a page beside — 新建{{agent}} over a column
 * beside the focused one, any other page in the other workspace's Shelf (one workspace: a new page of its Shelf).
 * A `run()` entry ignores them.
 */
export function runNav(item: NavItem, mods: OpenModifiers = PLAIN_OPEN) {
  if (!("page" in item.target)) return void item.target.run();
  const { page, params } = item.target;
  if (!mods.newInstance) return services.ui.openPage(page, params);
  if (isColumnPage(page)) return openPageBeside(page, params);
  const pageParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) if (typeof v === "string") pageParams[k] = v;
  void openRef({ kind: "page", hostId: useApp.getState().hosts?.active ?? "local", key: page }, "beside", { pageParams });
}
