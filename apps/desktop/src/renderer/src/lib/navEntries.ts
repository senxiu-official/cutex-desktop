// `nav.primary` entries (sidebar top list, footer icons): what an entry does and when it is active.
import { services } from "../modules/app";
import type { NavItem } from "../modules/slots";
import { useApp } from "../store";

/** True while the entry's page (or one of its activePages) is open. */
export function useNavActive(item: NavItem): boolean {
  const pages = item.activePages ?? ("page" in item.target ? [item.target.page] : []);
  return useApp((s) => s.view.kind === "page" && pages.includes(s.view.page));
}

export function runNav(item: NavItem) {
  if ("page" in item.target) services.ui.openPage(item.target.page, item.target.params);
  else void item.target.run();
}
