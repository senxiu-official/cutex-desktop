// 百度网盘 (cutex capability `baidu-pan`, Management v2 `/v2/pan/*`, contract v1 2026-11-11): one Baidu
// account per host, owned by that host's daemon. The daemon holds the app secret and the tokens and
// downloads to its own disk; the desktop only sees the shapes below (no secret, token or dlink ever).
// Owner-only routes; renderer → main (main/panApi.ts) → the host's daemon. No upload / delete.

export const BAIDU_PAN_FEATURE = "baidu-pan";

export type PanConnectionState = "disconnected" | "needsAuth" | "connected";

export interface PanAccount {
  id: string;
  name: string;
  /** Baidu's own value: 2 = SVIP, 1 = VIP, 0 = ordinary. */
  vipType: number;
}

export interface PanConnection {
  /** An app (AppId / AppKey / SecretKey) is saved on the host. */
  configured: boolean;
  state: PanConnectionState;
  appId: string | null;
  clientId: string | null;
  account: PanAccount | null;
  /** UTC ISO 8601. */
  expiresAt: string | null;
}

export interface PanFile {
  /** Baidu fs_id as a string (uint64). */
  id: string;
  /** Absolute Netdisk path. */
  path: string;
  name: string;
  isDir: boolean;
  /** Bytes. */
  size: number;
  /** Unix seconds. */
  modifiedAt: number;
}

export interface PanError {
  code: string;
  message: string;
  retryable: boolean;
}

export type PanDownloadState = "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";

export interface PanDownload {
  id: string;
  requestId: string;
  remote: string;
  targetDir: string;
  targetPath: string;
  state: PanDownloadState;
  downloadedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number;
  caller: { kind: "owner" | "agent"; id: string | null };
  createdAt: string;
  updatedAt: string;
  error: PanError | null;
}

/** `POST /v2/pan/auth`: the device-code flow the owner finishes on Baidu's page. */
export interface PanAuthStart {
  id: string;
  state: "pending";
  verificationUrl: string;
  userCode: string;
  expiresAt: string;
  intervalSeconds: number;
}

export interface PanAuthPoll {
  id: string;
  state: "pending" | "connected" | "expired" | "failed";
  connection?: PanConnection;
  error?: PanError;
}

export interface PanFilesPage {
  files: PanFile[];
  hasMore: boolean;
  nextStart: number | null;
}

export interface PanSearchResult {
  files: PanFile[];
  /** Baidu caps a search; true = there may be more matches than shown (no paging). */
  hasMore: boolean;
}

export interface PanAppInput {
  appId: string;
  clientId: string;
  clientSecret: string;
}

export interface PanDownloadRequest {
  /** Idempotency key: the same id + input replays the same task. */
  requestId: string;
  /** Absolute Netdisk file path. */
  remote: string;
  /** Absolute folder on the daemon's host. */
  targetDir: string;
}

export type PanDownloadAction = "pause" | "resume" | "cancel";

/** A call's outcome: `unsupported` = the host has no `/v2/pan` routes; `unreachable` = no answer. */
export type PanResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string; retryable: boolean };

/** `panEvents` bridge messages of one `watchPan` watch (main follows `GET /v2/pan/events`). */
export type PanEventsMessage =
  | { watchId: string; kind: "download"; download: PanDownload }
  | { watchId: string; kind: "status"; status: "connecting" | "live" | "retrying" };

export const PAN_PAGE_SIZE = 100;
/** Baidu's keyword limit (UTF-8 characters). */
export const PAN_SEARCH_MAX = 30;
/** A download that is still moving. */
export const panActive = (d: PanDownload) => d.state === "queued" || d.state === "downloading";
