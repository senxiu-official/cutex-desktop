import type { MessageKey } from "../../i18n";
/**
 * The launch a stock-tmp candidate belongs to. cutex (storage/stock-tmp-reclaim) states it only in the reason text,
 * "<cutexSessionId> · generation <n> · …"; anything else (legacy, unknown ownership) has none.
 */
export function stockTempOwner(reason: string | null | undefined): { sessionId: string; generation: number } | null {
  const match = /^(\S+) · generation (\d+) · /.exec(reason ?? "");
  return match ? { sessionId: match[1]!, generation: Number(match[2]) } : null;
}
import { zhCN } from "./i18n";
export function cleanupReason(code: string | null | undefined, fallback: string | null, t: (key: MessageKey) => string): string {
  if (code && ["changed", "recent", "unreadable"].includes(code)) return t(`storage.cleanup.${code}` as MessageKey);
  if (code === "too_recent" || code === "recent_write") return t("storage.cleanup.recent");
  const key = `storage.cleanup.reason.${code}`;
  return key in zhCN ? t(key as MessageKey) : fallback ?? "";
}
