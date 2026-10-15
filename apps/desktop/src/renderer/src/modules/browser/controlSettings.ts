import { DEFAULT_BROWSER_CONTROL_SETTINGS, normalizeBrowserControlSettings, type BrowserControlSettings } from "../../../../shared/browser";
import { useModulePref } from "../react";
import type { Json } from "../types";

// Preferences contain settings only, never a grant, guest identity, receipt or credentials.
const DEFAULT_PREF: Json = { hiddenTarget: DEFAULT_BROWSER_CONTROL_SETTINGS.hiddenTarget,
  viewport: { ...DEFAULT_BROWSER_CONTROL_SETTINGS.viewport }, idleDetachSeconds: DEFAULT_BROWSER_CONTROL_SETTINGS.idleDetachSeconds };

export function useBrowserControlSettings(): [BrowserControlSettings, (value: BrowserControlSettings) => void] {
  const [value, save] = useModulePref<Json>("browser", "control", DEFAULT_PREF);
  return [normalizeBrowserControlSettings(value), (next) => {
    const normalized = normalizeBrowserControlSettings(next);
    save({ hiddenTarget: normalized.hiddenTarget, viewport: { ...normalized.viewport }, idleDetachSeconds: normalized.idleDetachSeconds });
  }];
}
