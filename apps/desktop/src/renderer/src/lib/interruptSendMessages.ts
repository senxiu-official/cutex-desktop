// Words for 打断并发送 with several 插话 (lib/inputLedger/interruptSelection; cutex interrupt-send-many-v1). Tips and
// notices only: no new Next Up state, label or button. Owner-approved 2026-11-20 (zh-CN / en / zh-Hant); the record is
// docs/design/next-up-registry.md 三之四 (change log 2.4).
export const zhCN = {
  "interruptSend.manyTip": "停下当前这一轮，马上发这 {n} 条插话",
  "interruptSend.manyUnsupported": "对方运行时还不能一次发多条插话，没有打断",
  "interruptSend.oneAtATime": "这台主机一次只能打断并发送一条插话，请在行上选",
  "interruptSend.notSubmitted": "这批未发出，原因见各行",
  "interruptBatch.waitBusy": "这批等对方空下来后一起发",
  "interruptBatch.waitPlan": "这批等对方退出计划模式后一起发",
  "interruptBatch.groupIncomplete": "同批有消息已不在，其余未发出，可逐条重发",
  "interruptBatch.historyUnavailable": "读不到对方历史，这批未发出",
  "interruptBatch.recoveryRequired": "对方需先恢复，这批未发出",
  "interruptBatch.hookBlocked": "被对方的钩子拦下，这批未发出",
  "interruptBatch.notSentOther": "这批未发出：{reason}",
  "interruptBatch.retryBlocked": "可能已收下，不能重发，只能放弃",
  "interruptBatch.retryTip": "确定没发出过，用原消息再发一次",
  "interruptSend.tooMany": "未读插话太多（超过 {max} 条），没有打断",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "interruptSend.manyTip": "Stop the current turn and send these {n} steers now",
  "interruptSend.manyUnsupported": "The runtime can't send several steers at once yet; nothing was interrupted",
  "interruptSend.oneAtATime": "This host interrupts and sends one steer at a time; pick it on its row",
  "interruptSend.notSubmitted": "The batch wasn't sent; see each row",
  "interruptBatch.waitBusy": "This batch goes together once the {{agent}} is free",
  "interruptBatch.waitPlan": "This batch goes together once the {{agent}} leaves plan mode",
  "interruptBatch.groupIncomplete": "Part of the batch is gone; the rest weren't sent — resend each",
  "interruptBatch.historyUnavailable": "Couldn't read the {{agent}}'s history; the batch wasn't sent",
  "interruptBatch.recoveryRequired": "The {{agent}} needs recovery first; the batch wasn't sent",
  "interruptBatch.hookBlocked": "Stopped by the {{agent}}'s hook; the batch wasn't sent",
  "interruptBatch.notSentOther": "The batch wasn't sent: {reason}",
  "interruptBatch.retryBlocked": "May already be taken; can't resend, only dismiss",
  "interruptBatch.retryTip": "Definitely not sent; sends the original once",
  "interruptSend.tooMany": "Too many unread steers (over {max}); nothing was interrupted",
};

// zh-Hant-CN: OpenCC s2t of zhCN (mainland terms kept).
export const zhHant: Record<keyof typeof zhCN, string> = {
  "interruptSend.manyTip": "停下當前這一輪，馬上發這 {n} 條插話",
  "interruptSend.manyUnsupported": "對方運行時還不能一次發多條插話，沒有打斷",
  "interruptSend.oneAtATime": "這臺主機一次只能打斷並發送一條插話，請在行上選",
  "interruptSend.notSubmitted": "這批未發出，原因見各行",
  "interruptBatch.waitBusy": "這批等對方空下來後一起發",
  "interruptBatch.waitPlan": "這批等對方退出計劃模式後一起發",
  "interruptBatch.groupIncomplete": "同批有消息已不在，其餘未發出，可逐條重發",
  "interruptBatch.historyUnavailable": "讀不到對方歷史，這批未發出",
  "interruptBatch.recoveryRequired": "對方需先恢復，這批未發出",
  "interruptBatch.hookBlocked": "被對方的鉤子攔下，這批未發出",
  "interruptBatch.notSentOther": "這批未發出：{reason}",
  "interruptBatch.retryBlocked": "可能已收下，不能重發，只能放棄",
  "interruptBatch.retryTip": "確定沒發出過，用原消息再發一次",
  "interruptSend.tooMany": "未讀插話太多（超過 {max} 條），沒有打斷",
};
