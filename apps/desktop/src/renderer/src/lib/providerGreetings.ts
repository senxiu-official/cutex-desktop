import type { Provider } from "./provider";
import type { TermLocale } from "./terms";
import greetings from "./launchGreetings.json";

type GreetingEntry = { zh: string; en: string; window?: number[] };
const pools: Record<string, readonly GreetingEntry[]> = greetings;
const all = Object.values(pools).flat();

/** User-supplied copy, filtered in local time. Unknown providers share the combined pool. */
export function providerGreetings(provider: Provider | null, locale: TermLocale, minute: number): string[] {
  const entries = pools[provider === "zai" ? "glm" : provider ?? ""] ?? all;
  return entries.filter(({ window }) => {
    if (!window) return true;
    const [start, end] = window as [number, number];
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }).map((entry) => entry[locale.startsWith("zh") ? "zh" : "en"]);
}
