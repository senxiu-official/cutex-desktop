// 结束跟进 (End follow-up) and the words around it, shared by every surface that offers it: delegations, jobs, the
// cleanup page's messages, background operations (owner-approved wording 2026-11-17,
// .claude/agent-artifacts/state-surfaces-wording-proposal.md N1–N3, N11, N12). 结束跟进 always means "I stop waiting
// for this": it never claims the other side stopped, finished or received anything, and a late result does not bring
// the row back.
export const zhCN = {
  "followUp.end": "结束跟进",
  "followUp.ending": "结束跟进中…",
  "followUp.confirm": "不再等待这件事的结果。不会停止或撤回已经发送的操作；结果记为「未确认」，以后迟到的结果也不会让它重新出现。",
  "followUp.confirmButton": "再左键点击一次，结束跟进",
  "followUp.oldHost": "这台主机的 cutex 版本较旧，不能结束跟进。",
  "followUp.actionConflict": "这次操作已经用不同的内容提交过。刷新后再看。",
  "followUp.endedDelegation": "已结束跟进 · 结果未确认",
  "followUp.endedJob": "已结束跟进 · 进程可能仍在运行",
  "followUp.endedMessage": "已结束跟进 · 送达未确认",
};

export const en: Record<keyof typeof zhCN, string> = {
  "followUp.end": "End follow-up",
  "followUp.ending": "Ending follow-up…",
  "followUp.confirm": "Stop waiting for this. Nothing already sent is stopped or withdrawn; the outcome is recorded as unconfirmed, and a late result won't bring it back.",
  "followUp.confirmButton": "Left-click again to end follow-up",
  "followUp.oldHost": "This host's cutex is too old to end follow-up.",
  "followUp.actionConflict": "This action was already sent with different details. Refresh and check.",
  "followUp.endedDelegation": "Follow-up ended · outcome unconfirmed",
  "followUp.endedJob": "Follow-up ended · the process may still be running",
  "followUp.endedMessage": "Follow-up ended · delivery unconfirmed",
};

// zh-Hant-CN: OpenCC s2t of zhCN (mainland terms kept).
export const zhHant: Record<keyof typeof zhCN, string> = {
  "followUp.end": "結束跟進",
  "followUp.ending": "結束跟進中…",
  "followUp.confirm": "不再等待這件事的結果。不會停止或撤回已經發送的操作；結果記爲「未確認」，以後遲到的結果也不會讓它重新出現。",
  "followUp.confirmButton": "再左鍵點擊一次，結束跟進",
  "followUp.oldHost": "這臺主機的 cutex 版本較舊，不能結束跟進。",
  "followUp.actionConflict": "這次操作已經用不同的內容提交過。刷新後再看。",
  "followUp.endedDelegation": "已結束跟進 · 結果未確認",
  "followUp.endedJob": "已結束跟進 · 進程可能仍在運行",
  "followUp.endedMessage": "已結束跟進 · 送達未確認",
};
