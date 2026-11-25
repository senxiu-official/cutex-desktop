// Byte sizes on the 浏览器身份 page (B / KB / MB / GB, one decimal from MB on).
import type { MessageKey } from "../../i18n";

export function formatBytes(n: number, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  if (n < 1024) return t("browser.identity.size.b", { n });
  if (n < 1024 ** 2) return t("browser.identity.size.kb", { n: Math.round(n / 1024) });
  if (n < 1024 ** 3) return t("browser.identity.size.mb", { n: (n / 1024 ** 2).toFixed(1) });
  return t("browser.identity.size.gb", { n: (n / 1024 ** 3).toFixed(1) });
}
