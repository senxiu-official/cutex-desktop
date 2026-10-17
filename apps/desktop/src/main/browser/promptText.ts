// Owner-facing text of main's native browser dialogs (site permission prompt, download save
// dialog). Main has no renderer catalog; these follow the app locale: zh-CN / zh-Hant-CN, else en.
import type { BrowserSitePermission } from "../../shared/browser";

type Lang = "zh" | "hant" | "en";
const lang = (locale: string | undefined): Lang => locale === "zh-Hant-CN" ? "hant" : locale?.startsWith("zh") ? "zh" : "en";
const LABELS: Record<Lang, Record<BrowserSitePermission, string>> = {
  zh: { camera: "摄像头", microphone: "麦克风", geolocation: "位置", notifications: "通知", "clipboard-read": "读取剪贴板", midi: "MIDI 设备", "midi-sysex": "MIDI 设备（完全控制）",
    "pointer-lock": "锁定鼠标指针", "keyboard-lock": "捕获键盘快捷键", "idle-detection": "检测你是否在使用电脑", "window-management": "管理窗口与屏幕", "storage-access": "跨站点 Cookie",
    "speaker-selection": "选择扬声器", "protected-media": "受保护内容（DRM）" },
  hant: { camera: "攝像頭", microphone: "麥克風", geolocation: "位置", notifications: "通知", "clipboard-read": "讀取剪貼板", midi: "MIDI 設備", "midi-sysex": "MIDI 設備（完全控制）",
    "pointer-lock": "鎖定鼠標指針", "keyboard-lock": "捕獲鍵盤快捷鍵", "idle-detection": "檢測你是否在使用電腦", "window-management": "管理窗口與屏幕", "storage-access": "跨站點 Cookie",
    "speaker-selection": "選擇揚聲器", "protected-media": "受保護內容（DRM）" },
  en: { camera: "camera", microphone: "microphone", geolocation: "location", notifications: "notifications", "clipboard-read": "read the clipboard", midi: "MIDI devices", "midi-sysex": "MIDI devices (full control)",
    "pointer-lock": "lock the mouse pointer", "keyboard-lock": "capture keyboard shortcuts", "idle-detection": "know when you're using the computer", "window-management": "manage windows and screens",
    "storage-access": "cross-site cookies", "speaker-selection": "choose speakers", "protected-media": "protected content (DRM)" },
};

export interface BrowserPermissionPromptText { title: string; message: string; detail: string; allow: string; deny: string; remember: string }
export function browserPermissionPromptText(locale: string | undefined, input: { origin: string; permissions: readonly BrowserSitePermission[]; pool: "owner" | "agent"; agentName?: string; agentActing: boolean }): BrowserPermissionPromptText {
  const l = lang(locale), list = input.permissions.map(permission => LABELS[l][permission]);
  const agent = input.agentName || (l === "en" ? "The agent" : l === "zh" ? "智能体" : "智能體");
  if (l === "en") return { title: "Site permission", message: `${input.origin} wants to use: ${list.join(", ")}`,
    detail: [input.agentActing ? `${agent} is operating this tab right now — it asked through the page; only you can answer.` : "",
      input.pool === "agent" ? "This tab is in the agents' separate login pool." : "", "Only this site (this exact origin) gets it; other sites still ask."].filter(Boolean).join("\n"),
    allow: "Allow", deny: "Block", remember: "Remember for this site" };
  const zh = l === "zh";
  return { title: zh ? "网站权限" : "網站權限", message: `${input.origin} ${zh ? "想使用" : "想使用"}：${list.join("、")}`,
    detail: [input.agentActing ? (zh ? `${agent}正在操作这个标签——请求来自网页，只有你能决定。` : `${agent}正在操作這個標籤——請求來自網頁，只有你能決定。`) : "",
      input.pool === "agent" ? (zh ? "这个标签在智能体专用的登录池里。" : "這個標籤在智能體專用的登錄池裏。") : "",
      zh ? "只授予这个网站（这个确切来源），其他网站仍会询问。" : "只授予這個網站（這個確切來源），其他網站仍會詢問。"].filter(Boolean).join("\n"),
    allow: zh ? "允许" : "允許", deny: zh ? "阻止" : "阻止", remember: zh ? "对这个网站记住我的选择" : "對這個網站記住我的選擇" };
}
export function browserDownloadDialogTitle(locale: string | undefined, agentName: string | undefined): string {
  const l = lang(locale);
  if (agentName === undefined) return l === "en" ? "Save download" : l === "zh" ? "保存下载" : "保存下載";
  const agent = agentName || (l === "en" ? "The agent" : l === "zh" ? "智能体" : "智能體");
  return l === "en" ? `${agent} wants to download a file — choose where to save it, or cancel`
    : l === "zh" ? `${agent}想下载一个文件——选择保存位置，或取消` : `${agent}想下載一個文件——選擇保存位置，或取消`;
}
