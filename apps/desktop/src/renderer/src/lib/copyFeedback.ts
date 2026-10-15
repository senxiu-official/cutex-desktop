// Copy feedback: every clipboard write in the app (markdown code / table copy buttons, context-menu
// 复制, …) shows "已复制 N 个字符", except buttons that show their own check mark (copyQuietly).
import { translate } from "../i18n";
import { useApp } from "../store";

let quiet = 0;

/** Copy without the notice: the caller shows its own confirmation (e.g. a check mark). */
export async function copyQuietly(text: string): Promise<void> {
  quiet++;
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    failed();
    throw error;
  } finally {
    quiet--;
  }
}

function failed(): void {
  useApp.getState().notify(translate("copy.failed"), "error");
}

function announce(chars: number): void {
  useApp.getState().notify(translate("copy.done", { n: chars }));
}

/** Wrap navigator.clipboard.writeText / write once at startup. */
export function installCopyFeedback(): void {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!clipboard) return;
  const writeText = clipboard.writeText.bind(clipboard);
  const write = clipboard.write.bind(clipboard);
  clipboard.writeText = async (text: string) => {
    const silent = quiet > 0;
    try {
      await writeText(text);
    } catch (error) {
      if (!silent) failed();
      throw error;
    }
    if (!silent) announce(text.length);
  };
  clipboard.write = async (items: ClipboardItems) => {
    const silent = quiet > 0;
    try {
      await write(items);
    } catch (error) {
      if (!silent) failed();
      throw error;
    }
    if (silent) return;
    let chars = 0;
    for (const item of items) {
      if (item.types.includes("text/plain")) chars += (await (await item.getType("text/plain")).text()).length;
    }
    announce(chars);
  };
}
