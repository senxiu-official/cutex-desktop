// Tray / taskbar text follows the owner's terms (Settings → 通用 → 称呼): main keeps a transport
// copy of the resolved terms in the desktop prefs (this push); localStorage (lib/terms) stays the
// only store. Without it the tray could never follow a custom word (audit 2026-10-13 §problem 2).
import { useEffect } from "react";
import { bridge } from "../bridge";
import { useI18n } from "../i18n";
import { resolveTerms, useTermOverrides } from "./terms";

/** Pushes the current UI locale's resolved terms to main whenever they or the language change. */
export function useTermsSync(): void {
  const overrides = useTermOverrides();
  const { locale } = useI18n();
  useEffect(() => {
    // The push carries the locale it was resolved for: main uses the mirror only while its tag
    // matches the current prefs locale, so a language switch (or a lost push) falls back to that
    // language's built-in words instead of mixing sentences.
    void bridge.shell?.setTerms?.({ locale, terms: resolveTerms(overrides, locale) }).catch(() => {});
  }, [overrides, locale]);
}
