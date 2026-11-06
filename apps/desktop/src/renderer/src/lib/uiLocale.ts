// The UI language for pure code that must not import the i18n module (lib/rosterOrder: many tests mock
// i18n). i18n/index keeps it current; "zh-CN" until it has said otherwise.
let current = "zh-CN";

export function uiLocale(): string {
  return current;
}

export function setUiLocale(locale: string): void {
  current = locale;
}
