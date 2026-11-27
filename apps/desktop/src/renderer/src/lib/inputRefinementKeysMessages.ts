// The two rebindable commands of 输入优化 (module input-refinement; lib/keybindings.ts COMMANDS stays the host's, so
// these descriptions do too). The rest of the module's words live in modules/input-refinement/i18n.ts.
export const zhCN = {
  "shortcuts.promptEnhance": "输入优化：用上次的模板改写（选中部分或整段草稿；输入框里）",
  "shortcuts.inputRefinementPick": "输入优化：选模板（输入框里）",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "shortcuts.promptEnhance": "Input Refinement: rewrite with the last template (selection or whole draft; in the input)",
  "shortcuts.inputRefinementPick": "Input Refinement: pick a template (in the input)",
};

export const zhHant: Record<keyof typeof zhCN, string> = {
  "shortcuts.promptEnhance": "輸入優化：用上次的模板改寫（選中部分或整段草稿；輸入框裏）",
  "shortcuts.inputRefinementPick": "輸入優化：選模板（輸入框裏）",
};
