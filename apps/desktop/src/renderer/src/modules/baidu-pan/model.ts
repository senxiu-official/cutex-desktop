// 百度网盘 page: pure helpers (paths, sizes, download rows, error words). No React, no bridge.
import type { MessageKey } from "../../i18n";
import type { PanDownload, PanDownloadState } from "../../../../shared/baiduPan";

export const PAN_PAGE = "baidu-pan.page";

/** `/a/b/c` → [{ name: "", path: "/" }, { name: "a", path: "/a" }, …] (the first is the root). */
export function crumbs(dir: string): { name: string; path: string }[] {
  const parts = dir.split("/").filter(Boolean);
  return [{ name: "", path: "/" }, ...parts.map((name, i) => ({ name, path: "/" + parts.slice(0, i + 1).join("/") }))];
}

export const parentOf = (path: string) => {
  const i = path.replace(/\/+$/, "").lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
};
export const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** Bytes in binary units, one decimal from KiB up (Netdisk files run to many GiB). */
export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}
export const fmtRate = (bps: number) => `${fmtBytes(bps)}/s`;

/** Seconds left, only while the speed means something (downloading, known size, a speed above 0). */
export function etaSeconds(d: PanDownload): number | null {
  if (d.state !== "downloading" || d.totalBytes == null || d.bytesPerSecond <= 0) return null;
  return Math.max(0, Math.ceil((d.totalBytes - d.downloadedBytes) / d.bytesPerSecond));
}
export function fmtEta(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
/** 0–100, or null for an unknown size. */
export const progressOf = (d: PanDownload) => (d.totalBytes ? Math.min(100, (d.downloadedBytes / d.totalBytes) * 100) : d.state === "completed" ? 100 : null);

/** A newer copy of a row replaces the older one (by updatedAt); the list stays newest first. */
export function mergeDownload(list: readonly PanDownload[], d: PanDownload): PanDownload[] {
  const i = list.findIndex((x) => x.id === d.id);
  if (i >= 0 && list[i]!.updatedAt > d.updatedAt) return list as PanDownload[];
  const next = i >= 0 ? list.map((x) => (x.id === d.id ? d : x)) : [d, ...list];
  return next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export const STATE_KEY: Record<PanDownloadState, MessageKey> = {
  queued: "baidu-pan.state.queued",
  downloading: "baidu-pan.state.downloading",
  paused: "baidu-pan.state.paused",
  completed: "baidu-pan.state.completed",
  failed: "baidu-pan.state.failed",
  cancelled: "baidu-pan.state.cancelled",
};
/** Which controls a row offers (contract: paused / failed resume; completed / cancelled stay). */
export function controlsOf(d: PanDownload): { pause: boolean; resume: boolean; cancel: boolean } {
  return {
    pause: d.state === "queued" || d.state === "downloading",
    resume: d.state === "paused" || (d.state === "failed" && d.error?.retryable !== false),
    cancel: d.state === "queued" || d.state === "downloading" || d.state === "paused",
  };
}

const ERROR_KEY: Record<string, MessageKey> = {
  pan_not_configured: "baidu-pan.error.notConfigured",
  pan_needs_auth: "baidu-pan.error.needsAuth",
  pan_connection_busy: "baidu-pan.error.busy",
  pan_request_conflict: "baidu-pan.error.conflict",
  pan_invalid_state: "baidu-pan.error.invalidState",
  pan_not_found: "baidu-pan.error.notFound",
  pan_provider_error: "baidu-pan.error.provider",
  pan_storage_error: "baidu-pan.error.storage",
  pan_network_error: "baidu-pan.error.network",
  pan_rate_limited: "baidu-pan.error.rateLimited",
  pan_permission_denied: "baidu-pan.error.permission",
  invalid_request: "baidu-pan.error.invalid",
  unauthorized: "baidu-pan.error.unauthorized",
  unsupported: "baidu-pan.error.unsupported",
  unreachable: "baidu-pan.error.unreachable",
};
/** Plain words for an error code; unknown codes keep the daemon's own message. */
export function errorText(t: (k: MessageKey) => string, e: { code: string; message: string } | null | undefined): string {
  if (!e) return "";
  const key = ERROR_KEY[e.code];
  return key ? t(key) : e.message || e.code;
}

/** An absolute folder on the daemon's host: `C:\…` / `\\server\share` on Windows, `/…` elsewhere; no `..`. */
export function targetDirProblem(path: string): "empty" | "relative" | "dots" | null {
  const p = path.trim();
  if (!p) return "empty";
  if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]|\/)/.test(p)) return "relative";
  if (p.split(/[\\/]/).some((s) => s === "..")) return "dots";
  return null;
}

/** Baidu `vip_type`: 2 SVIP, 1 VIP. */
export const vipKey = (vip: number): MessageKey | null => (vip === 2 ? "baidu-pan.svip" : vip === 1 ? "baidu-pan.vip" : null);

export const newRequestId = () => `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
