// Opt-in ?turnerror (cutex turn-error-surface, 2026-11-04): two agents whose last turn failed — 「刷新冲突」
// (refresh_token_reused, twice in a row: the banner offers 重新登录) and 「连接失败」 (httpConnectionFailed, once:
// the generic summary with the message). The host advertises `turn-error-surface` (dev/mockFeatures);
// `?turnerror&legacy` or `?turnerror&no-turn-error-surface` shows an older host: no badge, no banner.
import type { SessionResource } from "@cutex-desktop/protocol";

export const TURN_ERROR_SCENE = typeof location !== "undefined" && new URLSearchParams(location.search).has("turnerror");
export const TURN_ERROR_SESSIONS = ["turnerr-refresh", "turnerr-http"] as const;

const REFRESH_MESSAGE = "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.";
const HTTP_MESSAGE = "stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)";

function lastTurnError(id: string, at: string) {
  return id === "turnerr-refresh"
    ? { turnId: "turnerr-refresh-t2", message: REFRESH_MESSAGE, code: "refresh_token_reused", codexErrorInfo: "unauthorized", at, consecutive: 2 }
    : { turnId: "turnerr-http-t1", message: HTTP_MESSAGE, code: "httpConnectionFailed", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } }, at, consecutive: 1 };
}

/** The scene's session resource: the base one with `activity.lastTurnError`. */
export function turnErrorResource(base: SessionResource): SessionResource {
  const at = new Date(Date.now() - 2 * 60_000).toISOString();
  return { ...base, activity: { ...(base.activity ?? {}), lastConversationAt: at, lastTurnError: lastTurnError(base.cutexSessionId, at) } };
}

/** The failed turns' thread (the timeline's red TurnErrorRow stays; 查看 in the banner jumps to it). */
export function turnErrorThread(id: string) {
  const now = Math.floor(Date.now() / 1000);
  const user = (turn: string, text: string) => ({ id: `${turn}-u`, type: "userMessage", content: [{ type: "text", text, text_elements: [] }] });
  const done = (turn: string, ask: string, answer: string, ago: number) => ({ id: turn, status: "completed", startedAt: now - ago, completedAt: now - ago + 20, items: [user(turn, ask), { id: `${turn}-a`, type: "agentMessage", text: answer }] });
  const failed = (turn: string, ask: string, message: string, codexErrorInfo: unknown, ago: number) => ({ id: turn, status: "failed", startedAt: now - ago, completedAt: now - ago + 2, error: { message, codexErrorInfo }, items: [user(turn, ask)] });
  const turns = id === "turnerr-refresh"
    ? [done("turnerr-refresh-t0", "看一下 CI 为什么挂了。", "是 lint 的问题，已修好。", 900), failed("turnerr-refresh-t1", "再跑一遍测试。", REFRESH_MESSAGE, "unauthorized", 300), failed("turnerr-refresh-t2", "继续。", REFRESH_MESSAGE, "unauthorized", 120)]
    : [done("turnerr-http-t0", "整理一下发布说明。", "发布说明写好了。", 900), failed("turnerr-http-t1", "再补一段升级提示。", HTTP_MESSAGE, { httpConnectionFailed: { httpStatusCode: 502 } }, 120)];
  return { thread: { id: `thread-${id}`, turns } };
}
