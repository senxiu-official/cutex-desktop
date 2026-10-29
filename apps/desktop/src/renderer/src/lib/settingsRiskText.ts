import { translate, type MessageKey } from "../i18n";
import type { en } from "./settingsRiskMessages";

export function settingsRiskText(key: keyof typeof en, vars: Record<string, string | number> = {}): string {
  return translate(key as MessageKey, vars);
}
