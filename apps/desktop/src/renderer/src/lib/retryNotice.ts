// A model request native is retrying (app-server `error` notification with `willRetry: true`, from
// core's StreamError: "Reconnecting... 3/5", "Reconnecting... waiting for network"). Shown as a quiet
// line under the running turn and as the sidebar row's activity line, so minutes of retries do not
// look like a stuck agent. Pure.
//
// Only safe facts are kept: the attempt counter, the HTTP status and the request host. Never the
// raw message / details text, the URL path or query, or response ids such as cf-ray: a relay URL or
// an error body can carry tokens.
import type { TurnError } from "@cutex-desktop/protocol/codex/v2";

export interface RetryNotice {
  /** Attempt n of `max` (null when native did not say, e.g. waiting for network). */
  attempt: number | null;
  max: number | null;
  /** "Reconnecting... waiting for network": native waits for connectivity before retrying. */
  waitingForNetwork: boolean;
  /** Upstream HTTP status (codexErrorInfo.httpStatusCode, else "status NNN" in additionalDetails). */
  status: number | null;
  /** Host of the failing request URL (from additionalDetails "url: …"), truncated. */
  host: string | null;
  /** When the next attempt starts (epoch ms, the notification's outer `nextRetryAt`); null when absent / invalid. */
  nextAt?: number | null;
  /** The runtime keeps the input and retries it until it goes through (outer `retryableInput: true`): it can be
   *  retried now. */
  retryableInput?: boolean;
}

const HOST_MAX = 48;

function statusFromInfo(info: unknown): number | null {
  if (!info || typeof info !== "object") return null;
  for (const value of Object.values(info as Record<string, unknown>)) {
    const code = (value as { httpStatusCode?: unknown } | null)?.httpStatusCode;
    if (typeof code === "number" && Number.isInteger(code) && code >= 100 && code <= 599) return code;
  }
  return null;
}

function statusFromDetails(details: string): number | null {
  const m = /\bstatus(?:\s+code)?[:\s]+(\d{3})\b/i.exec(details);
  if (!m) return null;
  const code = Number(m[1]);
  return code >= 100 && code <= 599 ? code : null;
}

function hostFromDetails(details: string): string | null {
  const m = /\burl:\s*(https?:\/\/[^\s,;"'<>]+)/i.exec(details);
  if (!m) return null;
  let host: string;
  try {
    host = new URL(m[1]!).hostname;
  } catch {
    return null;
  }
  // A hostname only (no userinfo / port / path / query); anything odd is dropped.
  if (!/^[a-z0-9.-]+$/i.test(host) && !/^\[[0-9a-f:]+\]$/i.test(host)) return null;
  return host.length > HOST_MAX ? `${host.slice(0, HOST_MAX - 1)}…` : host;
}

/** A plausible epoch-ms time (a finite integer within 2001..2286), else null. */
function epochMs(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 1e12 && value < 1e13 ? value : null;
}

/** The notice for an `error` notification's `error` (null when it is not an object). `params`: the notification's
 *  own fields — only `nextRetryAt` (epoch ms), `retryableInput` (=== true) and `message` (waiting for network) are read. */
export function retryNoticeOf(error: unknown, params?: unknown): RetryNotice | null {
  if (!error || typeof error !== "object") return null;
  const e = error as Partial<TurnError>;
  const outer = params && typeof params === "object" ? params as { nextRetryAt?: unknown; retryableInput?: unknown; message?: unknown } : {};
  const message = typeof e.message === "string" ? e.message : "";
  const outerMessage = typeof outer.message === "string" ? outer.message : "";
  const details = typeof e.additionalDetails === "string" ? e.additionalDetails : "";
  const nextAt = epochMs(outer.nextRetryAt);
  const counter = /(\d{1,4})\s*\/\s*(\d{1,4})/.exec(message);
  return {
    attempt: counter ? Number(counter[1]) : null,
    max: counter ? Number(counter[2]) : null,
    waitingForNetwork: /waiting for network/i.test(message) || /waiting for network/i.test(outerMessage),
    status: statusFromInfo(e.codexErrorInfo) ?? statusFromDetails(details),
    host: hostFromDetails(details),
    // Present only when the runtime sent them.
    ...(nextAt !== null ? { nextAt } : {}),
    ...(outer.retryableInput === true ? { retryableInput: true } : {}),
  };
}

/** "m:ss" until the next attempt (0:00 once due); null without a next time. */
export function retryCountdown(notice: RetryNotice, now: number): string | null {
  if (notice.nextAt === null || notice.nextAt === undefined) return null;
  const secs = Math.max(0, Math.ceil((notice.nextAt - now) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** "HTTP 524 · example.invalid" (empty when neither is known). */
export function retryReason(notice: RetryNotice): string {
  return [notice.status !== null ? `HTTP ${notice.status}` : null, notice.host].filter(Boolean).join(" · ");
}

type Translate = (key: "turn.retry.attempt" | "turn.retry.network" | "turn.retry.generic" | "turn.retry.retained", vars?: Record<string, string | number>) => string;

/** One line: "正在重连 3/5 · HTTP 524 · example.invalid". */
export function retryNoticeText(notice: RetryNotice, t: Translate): string {
  // An input the runtime keeps and retries until it goes through: plainly "connection interrupted, retrying".
  const head = notice.retryableInput
    ? t("turn.retry.retained")
    : notice.attempt !== null && notice.max !== null
      ? t("turn.retry.attempt", { n: notice.attempt, max: notice.max })
      : notice.waitingForNetwork
        ? t("turn.retry.network")
        : t("turn.retry.generic");
  const reason = retryReason(notice);
  return reason ? `${head} · ${reason}` : head;
}
