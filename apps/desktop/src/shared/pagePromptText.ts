// Owner-facing text of an agent page's submit (channel B, docs/design/004-artifact-page-bridge.md): main's
// own native confirm dialog and the label of the message it sends. Main has no renderer catalog; these
// follow the app locale: zh-CN / Traditional Chinese (every zh-Hant-* locale), else en (as main/browser/promptText.ts). Shared only so the
// browser preview (dev/mockFrames.ts) shows the same words.
import { artifactRef } from "./artifactStore";
import { isTraditionalLocale } from "./locales";

// "tw": zh-Hant-TW and the HK / MO locales that inherit it — the zh-Hant-CN text with Taiwan words.
type Lang = "zh" | "hant" | "tw" | "en";
const lang = (locale: string | undefined): Lang => (locale === "zh-Hant-CN" ? "hant" : isTraditionalLocale(locale) ? "tw" : locale?.startsWith("zh") ? "zh" : "en");
/** How much of the content the dialog shows. */
export const PAGE_SUBMIT_PREVIEW_CHARS = 1200;

export interface PageSubmitPromptInput {
  name: string;
  version: number;
  agent: string;
  text: string;
}
export interface PageSubmitPromptText {
  title: string;
  message: string;
  detail: string;
  send: string;
  cancel: string;
}

export function pageSubmitPromptText(locale: string | undefined, input: PageSubmitPromptInput): PageSubmitPromptText {
  const l = lang(locale);
  const chars = [...input.text];
  const cut = chars.length > PAGE_SUBMIT_PREVIEW_CHARS;
  const preview = cut ? chars.slice(0, PAGE_SUBMIT_PREVIEW_CHARS).join("") : input.text;
  if (l === "en")
    return {
      title: "Send from a page",
      message: `The page “${input.name}” v${input.version} wants to send this to ${input.agent} as your message`,
      detail: `${preview}${cut ? `\n… (${chars.length} characters in all)` : ""}\n\nIt is sent only if you click Send. The page cannot see or answer this dialog.`,
      send: "Send",
      cancel: "Cancel",
    };
  const zh = l === "zh";
  return {
    title: zh ? "页面想发送内容" : l === "tw" ? "頁面想傳送內容" : "頁面想發送內容",
    message: zh ? `页面「${input.name}」v${input.version} 想以你的名义把下面的内容发给 ${input.agent}` : `頁面「${input.name}」v${input.version} 想以你的名義把下面的內容${l === "tw" ? "傳給" : "發給"} ${input.agent}`,
    detail: `${preview}${cut ? (zh ? `\n……（共 ${chars.length} 字）` : `\n……（共 ${chars.length} 字）`) : ""}\n\n${zh ? "只有你点「发送」才会发出。页面看不到、也点不了这个对话框。" : l === "tw" ? "只有你點「傳送」才會送出。頁面看不到、也點不了這個對話框。" : "只有你點「發送」才會發出。頁面看不到、也點不了這個對話框。"}`,
    send: zh ? "发送" : l === "tw" ? "傳送" : "發送",
    cancel: "取消",
  };
}

/**
 * The owner message the agent gets: labelled with the page and its exact version ref (`af-…@n`, which the
 * agent can read with its artifact tools) in plain text — owner messages are shown as typed, not as
 * markdown — then the content.
 */
export function pageSubmitMessage(locale: string | undefined, input: { artifactId: string; name: string; version: number; format: "text" | "json"; text: string }): string {
  const l = lang(locale);
  const ref = artifactRef(input.artifactId, input.version);
  const head = l === "en" ? `From the artifact page “${input.name}” v${input.version} (${ref}):` : l === "zh" ? `来自成果页面「${input.name}」v${input.version}（${ref}）：` : `來自成果頁面「${input.name}」v${input.version}（${ref}）：`; // hant and tw alike
  // A fence longer than any backtick run inside, so the JSON cannot close it.
  const fence = "`".repeat(Math.max(3, ...[...input.text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  const body = input.format === "json" ? `${fence}json\n${input.text}\n${fence}` : input.text;
  return `${head}\n\n${body}`;
}
