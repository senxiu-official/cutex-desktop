// Local modules (docs/desktop-modules.md §23.14): main's own dialogs. Nothing here comes from the renderer;
// names and authors come from the file, so they are cleaned before they reach the dialog.
import { dialog, type BrowserWindow, type MessageBoxOptions, type OpenDialogOptions } from "electron";
import type { LocalPackPrompt, LocalPackPrompts } from "./modulePacks";

interface Texts {
  pickTitle: string;
  pickFilter: string;
  allowTitle: string;
  allowMessage: string;
  allowDetail: string;
  allow: string;
  cancel: string;
  installTitle: string;
  installMessage: (name: string) => string;
  power: (name: string) => string;
  colon: string;
  version: string;
  author: string;
  unverified: string;
  file: string;
  digest: string;
  replaces: string;
  internal: string;
  checkbox: (id: string) => string;
  install: string;
}

const ZH: Texts = {
  pickTitle: "选择模块文件",
  pickFilter: "模块包",
  allowTitle: "允许本地模块",
  allowMessage: "允许从文件安装模块？",
  allowDetail: "本地模块没有签名，作者也未验证。它会以 Cutex 本身的权限运行：能看到你在应用里能看到的所有内容，能以你的名义给智能体发消息，能在已连接的主机上运行命令。只装你信任来源的模块。",
  allow: "允许",
  cancel: "取消",
  installTitle: "安装本地模块",
  installMessage: (name) => `安装本地模块「${name}」？`,
  power: (name) => `「${name}」会以 Cutex 本身的权限运行：能看到你在应用里能看到的所有内容，能以你的名义给智能体发消息，能在已连接的主机上运行命令。只装你信任来源的模块。`,
  colon: "：",
  version: "版本",
  author: "作者",
  unverified: "未验证",
  file: "文件位置",
  digest: "sha256 开头",
  replaces: "将替换已安装的版本",
  internal: "使用内部接口，可能随应用更新失效",
  checkbox: (id) => `我信任 ${id}，要安装它`,
  install: "安装",
};

const EN: Texts = {
  pickTitle: "Choose a module file",
  pickFilter: "Module pack",
  allowTitle: "Allow local modules",
  allowMessage: "Allow installing modules from a file?",
  allowDetail: "Local modules are not signed and their authors are not verified. A local module runs with Cutex's own permissions: it can see everything you can see in the app, send messages to agents as you, and run commands on connected hosts. Only install modules from a source you trust.",
  allow: "Allow",
  cancel: "Cancel",
  installTitle: "Install local module",
  installMessage: (name) => `Install the local module "${name}"?`,
  power: (name) => `"${name}" will run with Cutex's own permissions: it can see everything you can see in the app, send messages to agents as you, and run commands on connected hosts. Only install modules from a source you trust.`,
  colon: ": ",
  version: "Version",
  author: "Author",
  unverified: "unverified",
  file: "File",
  digest: "sha256 starts",
  replaces: "Replaces the installed version",
  internal: "Uses internal interfaces; may break with an app update",
  checkbox: (id) => `I trust ${id} and want to install it`,
  install: "Install",
};

const textsFor = (locale: string): Texts => (locale.startsWith("zh") ? ZH : EN);

/** One short line: no line breaks or direction overrides that could rearrange the dialog. */
export function cleanDialogText(text: string, max = 80): string {
  // eslint-disable-next-line no-control-regex
  const line = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** Install only counts with the button and the box together. */
export function installConfirmed(answer: { response: number; checkboxChecked: boolean }): boolean | "ask again" {
  if (answer.response !== 1) return false;
  return answer.checkboxChecked ? true : "ask again";
}

export function installDetail(pack: LocalPackPrompt, locale: string): string {
  const t = textsFor(locale);
  const name = pack.title?.[locale] ?? pack.title?.en ?? pack.id;
  const lines = [
    t.power(cleanDialogText(name)),
    "",
    `${t.version}${t.colon}${pack.version}`,
    `${t.author}${t.colon}${pack.author ? `${cleanDialogText(pack.author)} (${t.unverified})` : t.unverified}`,
    `${t.file}${t.colon}${cleanDialogText(pack.path, 200)}`,
    `${t.digest}${t.colon}${pack.sha256.slice(0, 16)}`,
  ];
  if (pack.replaces) lines.push(`${t.replaces}${t.colon}${pack.replaces}`);
  if (pack.internal) lines.push("", t.internal);
  return lines.join("\n");
}

export function localModulePrompts(window: () => BrowserWindow | null, locale: () => string): LocalPackPrompts {
  const box = (options: MessageBoxOptions) => {
    const win = window();
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  };
  return {
    async pickFile() {
      const t = textsFor(locale());
      const options: OpenDialogOptions = { title: t.pickTitle, properties: ["openFile"], filters: [{ name: t.pickFilter, extensions: ["gz"] }] };
      const win = window();
      const answer = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
      return answer.canceled ? null : (answer.filePaths[0] ?? null);
    },
    async confirmAllow() {
      const t = textsFor(locale());
      const answer = await box({ type: "warning", title: t.allowTitle, message: t.allowMessage, detail: t.allowDetail, buttons: [t.cancel, t.allow], defaultId: 0, cancelId: 0, noLink: true });
      return answer.response === 1;
    },
    async confirmInstall(pack) {
      const here = locale();
      const t = textsFor(here);
      for (;;) {
        const answer = await box({
          type: "warning",
          title: t.installTitle,
          message: t.installMessage(cleanDialogText(pack.title?.[here] ?? pack.title?.en ?? pack.id)),
          detail: installDetail(pack, here),
          checkboxLabel: t.checkbox(pack.id),
          buttons: [t.cancel, t.install],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        const verdict = installConfirmed(answer);
        if (verdict !== "ask again") return verdict;
      }
    },
  };
}
