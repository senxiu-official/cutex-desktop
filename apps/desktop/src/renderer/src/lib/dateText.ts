// Dates as text for the desktop (widgets, the clock): `Intl.DateTimeFormat` with one fix-up. Some ICU builds (Node
// / Electron versions differ) write Chinese and Japanese dates with spaces around the numbers — 「10 月 22 日」 —
// where the page wants 「10月22日」; `formatDate` removes those, and in Chinese puts one space before the weekday
// (「10月22日 周四」). Other languages are left as the locale writes them (Korean 「10월 22일」 keeps its spaces).

/** The machine's own time zone ("here"); tests fake it with test/helpers/timeZone.ts. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Spaces next to the numbers of a zh / ja date removed; in zh one space before the weekday. Others unchanged. */
export function normalizeDateText(text: string, locale: string): string {
  const lang = locale.toLowerCase();
  if (!lang.startsWith("zh") && !lang.startsWith("ja")) return text;
  const tight = text.replace(/(?<=[\d年月日時时])\s+|\s+(?=[年月日時时分秒])/g, "");
  return lang.startsWith("zh") ? tight.replace(/日(?=[周週星])/g, "日 ") : tight;
}

/** `Intl.DateTimeFormat(locale, options).format(at)`, normalised (`normalizeDateText`). */
export function formatDate(at: number | Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  return normalizeDateText(new Intl.DateTimeFormat(locale, options).format(at), locale);
}
