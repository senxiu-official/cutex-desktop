import type { StorageOverview, StorageRetention } from "../../../../shared/storage";

export type StorageTranslate = (key: string, vars?: Record<string, string | number>) => string;
export function formatBytes(bytes: number, locale = "en"): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const index = bytes > 0 ? Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`;
}
export function measuredAgo(iso: string | null, now: number, t: StorageTranslate): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return t("storage.unmeasured");
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return t("storage.justNow");
  if (minutes < 60) return t("storage.minutesAgo", { n: minutes });
  if (minutes < 1440) return t("storage.hoursAgo", { n: Math.floor(minutes / 60) });
  return t("storage.daysAgo", { n: Math.floor(minutes / 1440) });
}
export function needsRefresh(view: StorageOverview, now = Date.now()): boolean {
  if (view.walk.state === "running") return false;
  const walked = view.stores.filter((s) => s.measure === "walk");
  return walked.some((s) => !s.measuredAt || !Number.isFinite(Date.parse(s.measuredAt)) || now - Date.parse(s.measuredAt) > 6 * 3600_000);
}
export function retentionText(retention: StorageRetention, t: StorageTranslate, locale = "en"): string {
  if (retention.rule === "forever") return t(retention.keepReferenced ? "storage.retention.referenced" : "storage.retention.forever");
  if (retention.rule === "age") return t(retention.keepReferenced ? "storage.retention.ageReferenced" : "storage.retention.age", { n: retention.days ?? 0 });
  if (retention.rule === "archive") return retention.days == null ? t("storage.retention.archive") : t("storage.retention.archiveDays", { n: retention.days });
  if (retention.rule === "rotate" && retention.minHours) return t("storage.retention.rotateHours", { n: retention.minHours });
  if (retention.rule === "size" && retention.maxBytes != null) return t("storage.retention.sizeLimit", { bytes: formatBytes(retention.maxBytes, locale) });
  const known = ["count", "size", "rotate", "internal", "derived", "native", "none"];
  return t(known.includes(retention.rule) ? `storage.retention.${retention.rule}` : "storage.retention.unknown");
}
