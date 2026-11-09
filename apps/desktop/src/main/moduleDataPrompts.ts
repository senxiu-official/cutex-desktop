// The native dialogs of module data and file pick / save (docs/desktop-modules.md §30.6). The module chooses only the
// file types offered; the title says which module asks, and only the owner's choice produces a path.
import { dialog, type BrowserWindow, type FileFilter } from "electron";
import type { FileFilterInput } from "../shared/moduleData";
import { ModuleDataError, type ModuleDataPrompts } from "./moduleData";

interface Texts {
  pick: (id: string) => string;
  save: (id: string) => string;
  clearTitle: string;
  clearMessage: (id: string) => string;
  clearDetail: (size: string) => string;
  delete: string;
  cancel: string;
  removeTitle: string;
  removeMessage: (id: string) => string;
  removeDetail: (size: string) => string;
  removeNoData: string;
  keep: string;
  removeAndDelete: string;
  remove: string;
}

const ZH: Texts = {
  pick: (id) => `模块「${id}」请你选择一个文件`,
  save: (id) => `模块「${id}」要保存一个文件`,
  clearTitle: "删除模块数据",
  clearMessage: (id) => `删除模块「${id}」的数据？`,
  clearDetail: (size) => `它数据文件夹里的所有文件（${size}）都会删除，不能恢复。`,
  delete: "删除",
  cancel: "取消",
  removeTitle: "移除本地模块",
  removeMessage: (id) => `移除本地模块「${id}」？`,
  removeDetail: (size) => `它在这台设备上存了 ${size} 数据。保留的话，以后再装同一个模块还能用到；也可以以后在 设置 → 模块 → 模块数据 里删除。`,
  removeNoData: "它的代码会删除；它的设置留在这台设备上。",
  keep: "移除，保留数据",
  removeAndDelete: "移除并删除数据",
  remove: "移除",
};

const EN: Texts = {
  pick: (id) => `The module "${id}" asks you to choose a file`,
  save: (id) => `The module "${id}" wants to save a file`,
  clearTitle: "Delete module data",
  clearMessage: (id) => `Delete the data of the module "${id}"?`,
  clearDetail: (size) => `Every file in its data folder (${size}) will be deleted. This cannot be undone.`,
  delete: "Delete",
  cancel: "Cancel",
  removeTitle: "Remove local module",
  removeMessage: (id) => `Remove the local module "${id}"?`,
  removeDetail: (size) => `It keeps ${size} of data on this device. If you keep it, the same module can use it again when installed later. You can also delete it later in Settings → Modules → Module data.`,
  removeNoData: "Its code will be deleted. Its settings stay on this device.",
  keep: "Remove, keep data",
  removeAndDelete: "Remove and delete data",
  remove: "Remove",
};

const textsFor = (locale: string): Texts => (locale.startsWith("zh") ? ZH : EN);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const toFilters = (filters: FileFilterInput[]): FileFilter[] => filters.map((f) => ({ name: f.name, extensions: f.extensions }));

/** What to do with a local module's data when it is removed: the owner's choice, or null = do not remove. */
export type RemoveDataChoice = "keep" | "delete" | null;

export function moduleDataPrompts(window: () => BrowserWindow | null, locale: () => string): ModuleDataPrompts & { confirmRemove(id: string, dataBytes: number | null): Promise<RemoveDataChoice> } {
  /** Only on the owner's visible window: a hidden app never pops a file dialog. */
  const owner = (): BrowserWindow => {
    const win = window();
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) throw new ModuleDataError("unavailable", "the app window is not showing");
    return win;
  };
  return {
    async pickFile(id, filters) {
      const t = textsFor(locale());
      const answer = await dialog.showOpenDialog(owner(), { title: t.pick(id), properties: ["openFile", "dontAddToRecent"], filters: toFilters(filters) });
      return answer.canceled ? null : (answer.filePaths[0] ?? null);
    },
    async saveFile(id, suggestedName, filters) {
      const t = textsFor(locale());
      const answer = await dialog.showSaveDialog(owner(), { title: t.save(id), ...(suggestedName ? { defaultPath: suggestedName } : {}), filters: toFilters(filters), properties: ["showOverwriteConfirmation", "dontAddToRecent"] });
      return answer.canceled ? null : (answer.filePath ?? null);
    },
    async confirmClear(id, bytes) {
      const t = textsFor(locale());
      const answer = await dialog.showMessageBox(owner(), { type: "warning", title: t.clearTitle, message: t.clearMessage(id), detail: t.clearDetail(formatBytes(bytes)), buttons: [t.cancel, t.delete], defaultId: 0, cancelId: 0, noLink: true });
      return answer.response === 1;
    },
    /** `dataBytes` null: the module has no data folder, so only remove / cancel. */
    async confirmRemove(id, dataBytes) {
      const t = textsFor(locale());
      const win = window();
      const options = dataBytes === null
        ? { type: "question" as const, title: t.removeTitle, message: t.removeMessage(id), detail: t.removeNoData, buttons: [t.cancel, t.remove], defaultId: 0, cancelId: 0, noLink: true }
        : { type: "question" as const, title: t.removeTitle, message: t.removeMessage(id), detail: t.removeDetail(formatBytes(dataBytes)), buttons: [t.cancel, t.keep, t.removeAndDelete], defaultId: 0, cancelId: 0, noLink: true };
      const answer = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
      if (answer.response === 0) return null;
      return dataBytes !== null && answer.response === 2 ? "delete" : "keep";
    },
  };
}
