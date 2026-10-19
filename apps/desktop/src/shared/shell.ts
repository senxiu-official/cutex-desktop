// Pure desktop-shell logic (tray labels, close decision, prefs parsing) — used by the main process,
// kept free of Electron imports so it is unit-testable.
import { parseUpdateProxyPref } from "./proxy";
import type { CloseBehavior, DesktopPrefs, ShellLocale } from "./ipc";
import type { ShellTermForms, ShellTerms, ShellTermsPref } from "./ipc";
import { DEVICE_OFF_NONE, parseDeviceOff } from "./notificationLevels";
import { isAppLocale, matchAppLocale } from "./locales";
import { parseUpdateRemote, parseUpdateRemotes } from "./update";

export const DEFAULT_PREFS: DesktopPrefs = { closeBehavior: "tray", locale: null, terms: null, updateCheckMinutes: 10, notifyOff: DEVICE_OFF_NONE };

/**
 * The mirrored resolved terms (ShellTermsPref): valid when the locale tag is a shipped locale and
 * all four terms carry non-empty strings (trimmed, ≤ 40 chars — the renderer caps its own fields
 * harder). Anything else falls back to null = the built-in per-locale words.
 */
export function parseTerms(value: unknown): ShellTermsPref | null {
  if (!value || typeof value !== "object") return null;
  const locale = (value as Record<string, unknown>).locale;
  if (!isShellLocale(locale)) return null;
  const set = (value as Record<string, unknown>).terms;
  const out: Partial<Record<"agent" | "subagent" | "director" | "owner", ShellTermForms>> = {};
  for (const id of ["agent", "subagent", "director", "owner"] as const) {
    const forms = (set as Record<string, unknown> | undefined)?.[id];
    if (!forms || typeof forms !== "object") return null;
    const one = typeof (forms as Record<string, unknown>).one === "string" ? ((forms as Record<string, unknown>).one as string).trim().slice(0, 40) : "";
    const many = typeof (forms as Record<string, unknown>).many === "string" ? ((forms as Record<string, unknown>).many as string).trim().slice(0, 40) : "";
    if (!one || !many) return null;
    out[id] = { one, many };
  }
  return { locale, terms: out as ShellTerms };
}

/** Parse the stored prefs JSON; anything unknown or malformed falls back to the defaults. */
export function parsePrefs(raw: unknown): DesktopPrefs {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    closeBehavior: isCloseBehavior(value.closeBehavior) ? value.closeBehavior : DEFAULT_PREFS.closeBehavior,
    locale: isShellLocale(value.locale) ? value.locale : null,
    terms: parseTerms(value.terms),
    updateCheckMinutes: isUpdateCheckMinutes(value.updateCheckMinutes) ? value.updateCheckMinutes : DEFAULT_PREFS.updateCheckMinutes,
    notifyOff: parseDeviceOff(value.notifyOff),
    ...(value.closeBehaviorChosen === true ? { closeBehaviorChosen: true } : {}),
    ...(value.trayNoticeShown === true ? { trayNoticeShown: true } : {}),
    ...(value.allowRemoteClose === false ? { allowRemoteClose: false } : {}),
    ...(parseUpdateRemote(value.updateRemote) ? { updateRemote: parseUpdateRemote(value.updateRemote)! } : {}),
    ...(parseUpdateRemotes(value.updateRemotes) ? { updateRemotes: parseUpdateRemotes(value.updateRemotes)! } : {}),
    ...(parseUpdateProxyPref(value.updateProxy) ? { updateProxy: parseUpdateProxyPref(value.updateProxy)! } : {}),
    ...(parseUpdateProxyPref(value.updateProxy)?.hasCredentials && typeof value.updateProxyAuth === "string" && value.updateProxyAuth ? { updateProxyAuth: value.updateProxyAuth } : {}),
  };
}

export function isCloseBehavior(value: unknown): value is CloseBehavior {
  return value === "tray" || value === "quit";
}

export function isUpdateCheckMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 24 * 60;
}

export function isShellLocale(value: unknown): value is ShellLocale {
  return isAppLocale(value);
}

/** Locale for main-process strings: the renderer's choice, else the OS locale. */
export function resolveLocale(pref: ShellLocale | null, osLocale: string): ShellLocale {
  return pref ?? matchAppLocale(osLocale) ?? "en";
}

/**
 * Window `close` event: hide to the tray instead of closing? Never while the app is quitting
 * (tray 退出, app menu, OS shutdown) and never without a working tray (the window would be lost).
 */
export function shouldHideOnClose(state: { quitting: boolean; trayAvailable: boolean; closeBehavior: CloseBehavior }): boolean {
  return !state.quitting && state.trayAvailable && state.closeBehavior === "tray";
}

/** Whether a StatusNotifier host (the tray icon's home on Linux) is on the session bus. */
export type TrayHost = "present" | "absent" | "unknown";

/**
 * Parse `gdbus call … NameHasOwner org.kde.StatusNotifierWatcher` (`(true,)`) or the `dbus-send
 * --print-reply` form (`boolean true`). Anything else is "unknown".
 */
export function parseNameHasOwner(stdout: string): TrayHost {
  if (/\(\s*true\s*,?\s*\)|\bboolean\s+true\b/.test(stdout)) return "present";
  if (/\(\s*false\s*,?\s*\)|\bboolean\s+false\b/.test(stdout)) return "absent";
  return "unknown";
}

/**
 * Window `close` event: "hide" to the tray, "close" (quit with the last window), or "ask" once
 * (show the first-close notice, then act on the choice). Linux fresh-install fallback (2026-10-15):
 * a tray can be created and still be invisible (stock GNOME without the AppIndicator extension), so
 * while the owner has not picked 关闭窗口时 explicitly, Linux closes when no StatusNotifier host is
 * on the session bus and otherwise asks once on the first close. An explicit choice always wins;
 * no tray object at all always closes.
 */
export function closeAction(state: {
  quitting: boolean;
  trayAvailable: boolean;
  closeBehavior: CloseBehavior;
  closeBehaviorChosen: boolean;
  platform: string;
  trayHost: TrayHost;
  trayNoticeShown: boolean;
}): "hide" | "close" | "ask" {
  if (!shouldHideOnClose(state)) return "close";
  if (state.closeBehaviorChosen || state.platform !== "linux") return "hide";
  if (state.trayHost === "absent") return "close";
  return state.trayNoticeShown ? "hide" : "ask";
}

/** The 关闭窗口时 value in effect (what Settings shows): Linux without a tray host quits until chosen. */
export function effectiveCloseBehavior(prefs: Pick<DesktopPrefs, "closeBehavior" | "closeBehaviorChosen">, platform: string, trayHost: TrayHost): CloseBehavior {
  return !prefs.closeBehaviorChosen && platform === "linux" && trayHost === "absent" ? "quit" : prefs.closeBehavior;
}

/** Sanitize a renderer-reported attention count. */
export function attentionCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 999) : 0;
}

const TEXT = {
  "zh-CN": {
    show: "显示窗口",
    newChat: "快速启动",
    quit: "退出",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${n} 个${w?.many ?? "智能体"}等待处理`,
    overlay: (n: number, w?: ShellTermForms) => `${n} 个${w?.many ?? "智能体"}等待处理`,
  },
  en: {
    show: "Show window",
    newChat: "Quick launch",
    quit: "Quit",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${n} ${n === 1 ? (w?.one ?? "agent") : (w?.many ?? "agents")} waiting`,
    overlay: (n: number, w?: ShellTermForms) => `${n} ${n === 1 ? (w?.one ?? "agent") : (w?.many ?? "agents")} waiting`,
  },
  "zh-Hant-CN": {
    show: "顯示視窗",
    newChat: "快速啟動",
    quit: "退出",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${n} 個${w?.many ?? "智能體"}等待處理`,
    overlay: (n: number, w?: ShellTermForms) => `${n} 個${w?.many ?? "智能體"}等待處理`,
  },
  "en-AU": {
    show: "Show window",
    newChat: "Quick launch",
    quit: "Quit",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${n} ${n === 1 ? (w?.one ?? "agent") : (w?.many ?? "agents")} waiting`,
    overlay: (n: number, w?: ShellTermForms) => `${n} ${n === 1 ? (w?.one ?? "agent") : (w?.many ?? "agents")} waiting`,
  },
  "ru-RU": {
    show: "Показать окно",
    newChat: "Быстрый запуск",
    quit: "Выход",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${w ? (n === 1 ? w.one : w.many) : "агент(ов)"} в ожидании: ${n}`,
    overlay: (n: number, w?: ShellTermForms) => `${w ? (n === 1 ? w.one : w.many) : "агент(ов)"} в ожидании: ${n}`,
  },
  "fr-FR": {
    show: "Afficher la fenêtre",
    newChat: "Lancement rapide",
    quit: "Quitter",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${n} ${n === 1 ? (w?.one ?? "agent") : (w?.many ?? "agents")} en attente`,
    overlay: (n: number, w?: ShellTermForms) => `${n} ${n === 1 ? (w?.one ?? "agent") : (w?.many ?? "agents")} en attente`,
  },
  "es-ES": {
    show: "Mostrar ventana",
    newChat: "Inicio rápido",
    quit: "Salir",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${n} ${w ? (n === 1 ? w.one : w.many) : "agente(s)"} en espera`,
    overlay: (n: number, w?: ShellTermForms) => `${n} ${w ? (n === 1 ? w.one : w.many) : "agente(s)"} en espera`,
  },
  "pt-BR": {
    show: "Mostrar janela",
    newChat: "Início rápido",
    quit: "Sair",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${n} ${w ? (n === 1 ? w.one : w.many) : "agente(s)"} aguardando`,
    overlay: (n: number, w?: ShellTermForms) => `${n} ${w ? (n === 1 ? w.one : w.many) : "agente(s)"} aguardando`,
  },
  "it-IT": {
    show: "Mostra finestra",
    newChat: "Avvio rapido",
    quit: "Esci",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${n} ${w ? (n === 1 ? w.one : w.many) : n === 1 ? "agente" : "agenti"} in attesa`,
    overlay: (n: number, w?: ShellTermForms) => `${n} ${w ? (n === 1 ? w.one : w.many) : n === 1 ? "agente" : "agenti"} in attesa`,
  },
  "de-DE": {
    show: "Fenster anzeigen",
    newChat: "Schnellstart",
    quit: "Beenden",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — ${n} ${w ? (n === 1 ? w.one : w.many) : `Agent${n === 1 ? "" : "en"}`} warten`,
    overlay: (n: number, w?: ShellTermForms) => `${n} ${w ? (n === 1 ? w.one : w.many) : `Agent${n === 1 ? "" : "en"}`} warten`,
  },
  "ja-JP": {
    show: "ウィンドウを表示",
    newChat: "クイック起動",
    quit: "終了",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — 待機中の${w?.many ?? "エージェント"}: ${n}`,
    overlay: (n: number, w?: ShellTermForms) => `待機中の${w?.many ?? "エージェント"}: ${n}`,
  },
  "ko-KR": {
    show: "창 표시",
    newChat: "빠른 시작",
    quit: "종료",
    waiting: (n: number, w?: ShellTermForms) => `Cutex — 대기 중 ${w?.many ?? "에이전트"}: ${n}`,
    overlay: (n: number, w?: ShellTermForms) => `대기 중 ${w?.many ?? "에이전트"}: ${n}`,
  },
} as const;

export function trayMenuLabels(locale: ShellLocale): { show: string; newChat: string; quit: string } {
  const t = TEXT[locale];
  return { show: t.show, newChat: t.newChat, quit: t.quit };
}

export function trayTooltip(count: number, locale: ShellLocale, terms?: ShellTermsPref | null): string {
  return count > 0 ? TEXT[locale].waiting(count, terms?.locale === locale ? terms.terms.agent : undefined) : "Cutex";
}

/** Accessible description for the Windows taskbar overlay icon. */
export function overlayDescription(count: number, locale: ShellLocale, terms?: ShellTermsPref | null): string {
  return TEXT[locale].overlay(count, terms?.locale === locale ? terms.terms.agent : undefined);
}

/** Context-menu labels for text inputs (main process), in the UI locale. */
export function editMenuLabels(locale: ShellLocale) {
  const table: Record<ShellLocale, { addToDictionary: string; undo: string; redo: string; cut: string; copy: string; paste: string; selectAll: string }> = {
    "zh-CN": { addToDictionary: "添加到词典", undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选" },
    en: { addToDictionary: "Add to dictionary", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all" },
    "zh-Hant-CN": { addToDictionary: "添加到詞典", undo: "撤銷", redo: "重做", cut: "剪切", copy: "複製", paste: "粘貼", selectAll: "全選" },
    "en-AU": { addToDictionary: "Add to dictionary", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all" },
    "ru-RU": { addToDictionary: "Добавить в словарь", undo: "Отменить", redo: "Повторить", cut: "Вырезать", copy: "Копировать", paste: "Вставить", selectAll: "Выделить всё" },
    "fr-FR": { addToDictionary: "Ajouter au dictionnaire", undo: "Annuler", redo: "Rétablir", cut: "Couper", copy: "Copier", paste: "Coller", selectAll: "Tout sélectionner" },
    "es-ES": { addToDictionary: "Añadir al diccionario", undo: "Deshacer", redo: "Rehacer", cut: "Cortar", copy: "Copiar", paste: "Pegar", selectAll: "Seleccionar todo" },
    "pt-BR": { addToDictionary: "Adicionar ao dicionário", undo: "Desfazer", redo: "Refazer", cut: "Recortar", copy: "Copiar", paste: "Colar", selectAll: "Selecionar tudo" },
    "it-IT": { addToDictionary: "Aggiungi al dizionario", undo: "Annulla", redo: "Ripristina", cut: "Taglia", copy: "Copia", paste: "Incolla", selectAll: "Seleziona tutto" },
    "de-DE": { addToDictionary: "Zum Wörterbuch hinzufügen", undo: "Rückgängig", redo: "Wiederholen", cut: "Ausschneiden", copy: "Kopieren", paste: "Einfügen", selectAll: "Alles auswählen" },
    "ja-JP": { addToDictionary: "辞書に追加", undo: "取り消す", redo: "やり直す", cut: "切り取り", copy: "コピー", paste: "貼り付け", selectAll: "すべて選択" },
    "ko-KR": { addToDictionary: "사전에 추가", undo: "실행 취소", redo: "다시 실행", cut: "잘라내기", copy: "복사", paste: "붙여넣기", selectAll: "모두 선택" },
  };
  return table[locale];
}

/** The one-time Linux first-close notice (main dialog). Other locales fall back to English. */
export function trayNoticeText(locale: ShellLocale, terms?: ShellTermsPref | null): { title: string; message: string; detail: string; keep: string; quit: string } {
  const words = terms?.locale === locale ? terms.terms.agent : undefined;
  const table: Partial<Record<ShellLocale, { title: string; message: string; detail: string; keep: string; quit: string }>> = {
    "zh-CN": {
      title: "Cutex",
      message: "Cutex 仍在系统托盘中运行",
      detail: `关闭窗口后 Cutex 继续在后台运行，以便${words?.one ?? "智能体"}需要你时提醒你；从托盘图标的菜单可以重新打开或退出。\n\n如果在顶栏或系统托盘里看不到 Cutex 图标（例如 GNOME 未安装 AppIndicator 扩展），请选「关闭窗口时退出」。以后可在 设置 → 通用 → 关闭窗口时 修改`,
      keep: "继续在托盘中运行",
      quit: "关闭窗口时退出",
    },
    "zh-Hant-CN": {
      title: "Cutex",
      message: "Cutex 仍在系統托盤中運行",
      detail: `關閉窗口後 Cutex 繼續在後臺運行，以便${words?.one ?? "智能體"}需要你時提醒你；從托盤圖標的菜單可以重新打開或退出。\n\n如果在頂欄或系統托盤裏看不到 Cutex 圖標（例如 GNOME 未安裝 AppIndicator 擴展），請選「關閉窗口時退出」。以後可在 設置 → 通用 → 關閉窗口時 修改`,
      keep: "繼續在托盤中運行",
      quit: "關閉窗口時退出",
    },
    en: {
      title: "Cutex",
      message: "Cutex is still running in the system tray",
      detail: `After the window closes, Cutex keeps running so ${words?.many ?? "agents"} can alert you; reopen or quit it from the tray icon's menu.\n\nIf you can't see a Cutex icon in the top bar or system tray (for example GNOME without the AppIndicator extension), choose \u201cQuit when closing\u201d. You can change this later in Settings \u2192 General \u2192 When closing the window.`,
      keep: "Keep running in the tray",
      quit: "Quit when closing",
    },
  };
  if (locale === "en-AU") return table.en!;
  return table[locale] ?? table.en!;
}
