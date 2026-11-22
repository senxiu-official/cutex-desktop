// r290 P14 yielded wait (continuationWait): the handler ended its turn and continues this delegation later.
// Owner complaint 2026-11-18: such a delegation read 运行中. Director-approved label 「等待中 · 约{时间}继续」.
export const zhCN = {
  "delegation.status.continuationWait": "等待中",
  "delegation.status.continuationReady": "等待继续",
  "delegation.status.continuationLimited": "续接已达上限",
  "delegation.cont.inMinutes": "约 {n} 分钟后继续",
  "delegation.cont.at": "约 {time} 继续",
  "delegation.cont.soon": "即将继续",
  "delegation.cont.children": "等子委托完成",
  "delegation.cont.jobs": "等作业完成",
  "delegation.cont.hintAfter": "处理者已结束本轮，到时自动继续；期间不运行",
  "delegation.cont.hintChildren": "处理者已结束本轮，它发出的委托都完成后自动继续；期间不运行",
  "delegation.cont.hintJobs": "处理者已结束本轮，它的作业结束后自动继续；期间不运行",
  "delegation.cont.hintReady": "等待的条件已满足，处理者即将继续",
  "delegation.cont.hintLimited": "自动续接次数已用完，不会再自动继续",
  "delegation.cont.wakeAt": "预计继续：{time}",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "delegation.status.continuationWait": "Waiting",
  "delegation.status.continuationReady": "Ready to continue",
  "delegation.status.continuationLimited": "Continuation limit reached",
  "delegation.cont.inMinutes": "continues in ~{n} min",
  "delegation.cont.at": "continues ~{time}",
  "delegation.cont.soon": "continues shortly",
  "delegation.cont.children": "until its delegations finish",
  "delegation.cont.jobs": "until its jobs finish",
  "delegation.cont.hintAfter": "The handler ended its turn and continues automatically at the time shown; nothing runs meanwhile",
  "delegation.cont.hintChildren": "The handler ended its turn and continues automatically once its own delegations finish; nothing runs meanwhile",
  "delegation.cont.hintJobs": "The handler ended its turn and continues automatically once its jobs end; nothing runs meanwhile",
  "delegation.cont.hintReady": "What it waited for has happened; the handler continues shortly",
  "delegation.cont.hintLimited": "Automatic continuations are used up; it will not continue on its own",
  "delegation.cont.wakeAt": "Expected to continue: {time}",
};

// zh-Hant-CN: OpenCC s2t of zhCN (mainland terms kept).
export const zhHant: Record<keyof typeof zhCN, string> = {
  "delegation.status.continuationWait": "等待中",
  "delegation.status.continuationReady": "等待繼續",
  "delegation.status.continuationLimited": "續接已達上限",
  "delegation.cont.inMinutes": "約 {n} 分鐘後繼續",
  "delegation.cont.at": "約 {time} 繼續",
  "delegation.cont.soon": "即將繼續",
  "delegation.cont.children": "等子委託完成",
  "delegation.cont.jobs": "等作業完成",
  "delegation.cont.hintAfter": "處理者已結束本輪，到時自動繼續；期間不運行",
  "delegation.cont.hintChildren": "處理者已結束本輪，它發出的委託都完成後自動繼續；期間不運行",
  "delegation.cont.hintJobs": "處理者已結束本輪，它的作業結束後自動繼續；期間不運行",
  "delegation.cont.hintReady": "等待的條件已滿足，處理者即將繼續",
  "delegation.cont.hintLimited": "自動續接次數已用完，不會再自動繼續",
  "delegation.cont.wakeAt": "預計繼續：{time}",
};
