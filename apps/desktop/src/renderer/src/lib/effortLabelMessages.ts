// Words for explicit reasoning effort and Claude alias names (owner 2026-11-20; lib/effortDisplay,
// docs/design/024-model-list.md 三). No 「默认」 in an effort label. The two effortLabel.skipped* lines: owner-approved
// 2026-11-20.
export const zhCN = {
  "effortLabel.unreported": "推理强度：未上报",
  "effortLabel.unsupported": "推理强度：不支持",
  "effortLabel.unreportedShort": "未上报",
  "effortLabel.unsupportedShort": "不支持",
  "effortLabel.skippedProfile": "Profile 的「{effort}」此模型不支持",
  "effortLabel.skippedModel": "「{effort}」此模型不支持",
  "effortLabel.unset": "不指定（{effort}）",
  "effortLabel.unsetBare": "不指定",
  "effortLabel.inUse": "使用 {effort}",
  "effortLabel.whenUnset": "不指定时 {effort}",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "effortLabel.unreported": "Reasoning effort: not reported",
  "effortLabel.unsupported": "Reasoning effort: not supported",
  "effortLabel.unreportedShort": "not reported",
  "effortLabel.unsupportedShort": "not supported",
  "effortLabel.skippedProfile": "Profile's {effort} isn't supported by this model",
  "effortLabel.skippedModel": "{effort} isn't supported by this model",
  "effortLabel.unset": "Unset ({effort})",
  "effortLabel.unsetBare": "Unset",
  "effortLabel.inUse": "uses {effort}",
  "effortLabel.whenUnset": "{effort} when unset",
};

// zh-Hant-CN: OpenCC s2t of zhCN (mainland terms kept).
export const zhHant: Record<keyof typeof zhCN, string> = {
  "effortLabel.unreported": "推理強度：未上報",
  "effortLabel.unsupported": "推理強度：不支持",
  "effortLabel.unreportedShort": "未上報",
  "effortLabel.unsupportedShort": "不支持",
  "effortLabel.skippedProfile": "Profile 的「{effort}」此模型不支持",
  "effortLabel.skippedModel": "「{effort}」此模型不支持",
  "effortLabel.unset": "不指定（{effort}）",
  "effortLabel.unsetBare": "不指定",
  "effortLabel.inUse": "使用 {effort}",
  "effortLabel.whenUnset": "不指定時 {effort}",
};
