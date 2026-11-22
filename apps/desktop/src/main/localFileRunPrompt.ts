// 运行… of a local script or program (a file menu's entry; 打开 refuses these, shared/localFiles.ts): main's own
// native dialog, very high risk, so it names the full real path and the type, defaults to Cancel and offers no
// "remember". The renderer only asks for it; it cannot answer or skip it (main/localFiles.ts localFileAction).
// Main has no renderer catalog: zh-CN, Traditional Chinese (zh-Hant-CN; the TW / HK / MO locales), else en.
import { dialog, type BrowserWindow, type MessageBoxOptions } from "electron";
import { basename, extname } from "node:path";
import { isTraditionalLocale } from "../shared/locales";
import type { ConfirmRun } from "./localFiles";

type Lang = "zh" | "hant" | "tw" | "en";
const lang = (locale: string | undefined): Lang => (locale === "zh-Hant-CN" ? "hant" : isTraditionalLocale(locale) ? "tw" : locale?.startsWith("zh") ? "zh" : "en");

export interface RunPromptText {
  title: string;
  message: string;
  detail: string;
  run: string;
  cancel: string;
}

/** The dialog's words for `path` (the real target) of `kind`. */
export function runFilePromptText(locale: string | undefined, file: { path: string; kind: "script" | "program" }): RunPromptText {
  const suffix = extname(file.path).slice(1).toLowerCase();
  const name = basename(file.path);
  switch (lang(locale)) {
    case "zh": {
      const type = `${file.kind === "script" ? "脚本" : "可执行程序或快捷方式"}${suffix ? `（.${suffix}）` : ""}`;
      return {
        title: "运行文件",
        message: `运行「${name}」？`,
        detail: `完整路径：${file.path}\n类型：${type}\n\n它会以你的身份在这台电脑上运行，能读写你的文件、访问网络。只运行你确认来源可信的文件。`,
        run: "运行",
        cancel: "取消",
      };
    }
    case "hant":
    case "tw": {
      const tw = lang(locale) === "tw";
      const type = `${file.kind === "script" ? "腳本" : tw ? "可執行程式或捷徑" : "可執行程序或快捷方式"}${suffix ? `（.${suffix}）` : ""}`;
      return {
        title: tw ? "執行檔案" : "運行文件",
        message: `${tw ? "執行" : "運行"}「${name}」？`,
        detail: `完整路徑：${file.path}\n類型：${type}\n\n它會以你的身份在這臺${tw ? "電腦上執行，能讀寫你的檔案、存取網路" : "電腦上運行，能讀寫你的文件、訪問網絡"}。只${tw ? "執行" : "運行"}你確認來源可信的${tw ? "檔案" : "文件"}。`,
        run: tw ? "執行" : "運行",
        cancel: "取消",
      };
    }
    default: {
      const type = `${file.kind === "script" ? "Script" : "Program or shortcut"}${suffix ? ` (.${suffix})` : ""}`;
      return {
        title: "Run file",
        message: `Run “${name}”?`,
        detail: `Full path: ${file.path}\nType: ${type}\n\nIt runs on this computer as you: it can read and change your files and use the network. Only run files whose source you trust.`,
        run: "Run",
        cancel: "Cancel",
      };
    }
  }
}

/** The dialog options: a warning, Cancel first and default (Enter / Esc cancel), no checkbox, no link buttons. */
export function runFileDialogOptions(text: RunPromptText): MessageBoxOptions {
  return { type: "warning", title: text.title, message: text.message, detail: text.detail, buttons: [text.cancel, text.run], defaultId: 0, cancelId: 0, noLink: true };
}

/** ConfirmRun for main/localFiles.ts: the dialog over `window()` (the asking window), true only for 运行. */
export function runFileConfirm(window: () => BrowserWindow | null, locale: () => string | undefined): ConfirmRun {
  return async (file) => {
    const options = runFileDialogOptions(runFilePromptText(locale(), file));
    const win = window();
    const answer = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return answer.response === 1;
  };
}
