// Turn-error surface (cutex `turn-error-surface`; components/TurnErrorSurface): the agent list badge and
// the conversation header banner for a session whose last turn failed (`activity.lastTurnError`).
export const zhCN = {
  "turnError.title": "上一回合失败",
  "turnError.withReason": "上一回合失败：{reason}",
  "turnError.repeatedWithReason": "连续 {n} 个回合失败：{reason}",
  "turnError.refreshTokenReused": "并发刷新冲突；下一条消息会自动重试",
  "turnError.unauthorized": "登录未通过验证；如果再次出现，可能需要重新登录",
  "turnError.unauthorizedRepeated": "登录未通过验证，可能需要重新登录",
  "turnError.view": "查看",
  "turnError.viewHint": "跳到失败的回合",
  "turnError.relogin": "重新登录",
  "turnError.reloginHint": "打开 Profile「{profile}」的账户设置",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "turnError.title": "The last turn failed",
  "turnError.withReason": "The last turn failed: {reason}",
  "turnError.repeatedWithReason": "{n} turns in a row failed: {reason}",
  "turnError.refreshTokenReused": "a concurrent refresh clash; the next message retries automatically",
  "turnError.unauthorized": "the sign-in was not accepted; if it repeats, the login may need renewing",
  "turnError.unauthorizedRepeated": "the sign-in was not accepted; the login may need renewing",
  "turnError.view": "View",
  "turnError.viewHint": "Jump to the failed turn",
  "turnError.relogin": "Sign in again",
  "turnError.reloginHint": "Open the account settings of Profile “{profile}”",
};

/** zh-Hant-CN (character-level conversion of zh-CN, terminology unchanged). */
export const zhHant: Record<keyof typeof zhCN, string> = {
  "turnError.title": "上一回合失敗",
  "turnError.withReason": "上一回合失敗：{reason}",
  "turnError.repeatedWithReason": "連續 {n} 個回合失敗：{reason}",
  "turnError.refreshTokenReused": "併發刷新衝突；下一條消息會自動重試",
  "turnError.unauthorized": "登錄未通過驗證；如果再次出現，可能需要重新登錄",
  "turnError.unauthorizedRepeated": "登錄未通過驗證，可能需要重新登錄",
  "turnError.view": "查看",
  "turnError.viewHint": "跳到失敗的回合",
  "turnError.relogin": "重新登錄",
  "turnError.reloginHint": "打開 Profile「{profile}」的賬戶設置",
};
