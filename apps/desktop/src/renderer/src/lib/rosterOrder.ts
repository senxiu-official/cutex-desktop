// The order names are listed in (design 060 §5.1): the shared order in @cutex-desktop/cutex-client/nameOrder,
// set in Settings → Appearance (名字分组 `nameGrouping`, 汉字读法 `nameReading`); each defaults from the UI
// language until the owner picks one. Rosters: online before offline, then name, then id.
import { defaultNameOrder, nameComparer, type NameOrder } from "@cutex-desktop/cutex-client/nameOrder";
import { useI18n } from "../i18n";
import { uiLocale } from "./uiLocale";
import { getUiPrefs, useUiPrefs, type UiPrefs } from "./prefs";

/** The name order in effect: the owner's choices, else the UI language's defaults. */
export function nameOrderOf(locale: string, prefs: Pick<UiPrefs, "nameGrouping" | "nameReading">): NameOrder {
  const d = defaultNameOrder(locale);
  return { grouping: prefs.nameGrouping ?? d.grouping, reading: prefs.nameReading ?? d.reading };
}

/** Compares two names in the current order (UI language and settings read at call time). */
export function compareNames(a: string, b: string): number {
  const locale = uiLocale();
  return nameComparer(nameOrderOf(locale, getUiPrefs()), locale)(a, b);
}

/** By name (`nameOf`), then `id` (stable): pickers and lists of people / projects. */
export function byNameThenId<T>(nameOf: (item: T) => string, idOf: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const r = compareNames(nameOf(a), nameOf(b));
    if (r) return r;
    const x = idOf(a);
    const y = idOf(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

/** Online before offline, then name (`nameOf`: the name shown), then `id` (stable). */
export function compareRoster<T extends { id: string; name: string }>(online: (row: T) => boolean, nameOf: (row: T) => string = (r) => r.name): (a: T, b: T) => number {
  const byName = byNameThenId<T>(nameOf, (r) => r.id);
  return (a, b) => Number(online(b)) - Number(online(a)) || byName(a, b);
}

/** Changes when the order does (UI language or a setting): a memo dependency for sorted lists. */
export function useNameOrderKey(): string {
  // (useI18n's locale; a test's i18n mock may not have one.)
  const locale = useI18n().locale ?? uiLocale();
  const prefs = useUiPrefs();
  const o = nameOrderOf(locale, prefs);
  return `${o.grouping}|${o.reading}|${locale}`;
}
