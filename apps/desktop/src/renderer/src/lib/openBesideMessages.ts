// 并排打开 without room for a second column (lib/workspaceEffects agentPlan `narrow`; owner 2026-11-27 「不生效」).
// New keys fall back to English in other locales.
export const zhCN = {
  "foretell.besideNoRoom": "窗口放不下第二栏，会替换{name}。把窗口拉宽或收起{{shelf}}后才能并排",
  "ws.besideNoRoom": "窗口放不下第二栏，已在这一栏打开。把窗口拉宽或收起{{shelf}}后再并排打开",
};

export const en: Record<keyof typeof zhCN, string> = {
  "foretell.besideNoRoom": "No room for a second column, so this replaces {name}. Widen the window or hide the {{shelf}} to open side by side",
  "ws.besideNoRoom": "No room for a second column, so it opened here. Widen the window or hide the {{shelf}} to open side by side",
};

export const zhHant: Record<keyof typeof zhCN, string> = {
  "foretell.besideNoRoom": "窗口放不下第二欄，會替換{name}。把窗口拉寬或收起{{shelf}}後才能並排",
  "ws.besideNoRoom": "窗口放不下第二欄，已在這一欄打開。把窗口拉寬或收起{{shelf}}後再並排打開",
};
