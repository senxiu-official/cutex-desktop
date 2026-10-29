import type { MessageKey } from "../../i18n";
import { zhCN } from "./i18n";
export function cleanupReason(code: string | null | undefined, fallback: string | null, t: (key: MessageKey) => string): string {
  if (code && ["changed", "recent", "unreadable"].includes(code)) return t(`storage.cleanup.${code}` as MessageKey);
  if (code === "too_recent" || code === "recent_write") return t("storage.cleanup.recent");
  const key = `storage.cleanup.reason.${code}`;
  return key in zhCN ? t(key as MessageKey) : fallback ?? "";
}
