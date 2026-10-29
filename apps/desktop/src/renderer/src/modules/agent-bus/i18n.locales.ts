// Settlement strings: character conversion from the module zh-CN catalog.
const zhHantCN = {
  "agent-bus.settlement.unknown": "結果不確定",
  "agent-bus.settlement.closed": "已關閉跟進",
  "agent-bus.settlement.close": "關閉卡住訊息",
  "agent-bus.settlement.disclaimer": "關閉跟進，不代表送達或處理成功",
  "agent-bus.settlement.evidence": "檢視服務端證據",
  "agent-bus.settlement.reason": "關閉原因",
  "agent-bus.settlement.reasonPlaceholder": "說明爲什麼不再跟進此事項",
  "agent-bus.settlement.confirm": "確認關閉跟進",
  "agent-bus.settlement.pending": "正在確認…",
  "agent-bus.settlement.retry": "使用原請求重試",
  "agent-bus.settlement.uncertainWrite": "關閉操作的結果尚未確認。請先重新讀取狀態；重試只使用原請求和原因。",
  "agent-bus.settlement.recheck": "重新讀取狀態",
  "agent-bus.settlement.conflict": "事項的證據或狀態已變化，已刷新。請覈對後重新確認。",
  "agent-bus.settlement.unauthorized": "沒有關閉此事項的權限。",
  "agent-bus.settlement.missing": "服務端未找到此事項，已刷新列表。",
  "agent-bus.settlement.unavailable": "服務暫不可用，請重新讀取狀態。"
};
export const locales = { "zh-Hant-CN": zhHantCN };
declare module "../i18nCatalog" { interface ModuleZhHantMessages extends Record<keyof typeof zhHantCN, string> {} }
