import type { zhCN } from "./i18n";
import { browserIdentityZhHantCN } from "./identityMessages";
const zhHantCN = {
  ...(browserIdentityZhHantCN as Record<keyof typeof import("./identityMessages").browserIdentityZhCN, string>),
  "browser.blockedNav.notice": "已攔下一次自動跳轉：{host}",
  "browser.blockedNav.open": "仍然打開",
  "browser.blockedNav.opening": "正在打開…",
  "browser.blockedNav.openDesktop": "仍然在本機打開",
  "browser.blockedNav.desktopLoopbackHint": "這個地址指向本機（這臺電腦），不是遠程主機：{url}",
  "browser.blockedNav.dismiss": "隱藏提示",
  "browser.ownerNotice.certificate": "證書不受信任：{host}",
  "browser.ownerNotice.certificateOpen": "仍然打開",
  "browser.ownerNotice.certificateHint": "證書是自簽名、已過期或不屬於這個地址。「仍然打開」只信任這一張證書，只用於這個局域網 / 本機地址；證書變了會再問你。\nSHA-256：{fingerprint}\n{url}",
  "browser.ownerNotice.download": "網頁自己開始下載 {file}，已暫停",
  "browser.ownerNotice.downloadOpen": "下載…",
  "browser.ownerNotice.downloadHint": "彈出保存窗口，由你選擇存到哪裏：{url}",
  "browser.ownerNotice.popup": "網頁想打開新窗口：{host}",
  "browser.ownerNotice.popupOpen": "打開",
  "browser.ownerNotice.popupHint": "在新標籤頁打開：{url}",
  "browser.sitePermission.held": "{origin} 想使用{permissions}：Cutex 窗口已最小化或隱藏。恢復窗口後會彈出系統對話框讓你選擇，網頁會等你回答；2 分鐘內沒恢復按阻止處理（不記住）。",
  "browser.blocked.permissionHeld": "{origin} 想使用{permissions}：恢復 Cutex 窗口後會彈出詢問（2 分鐘內有效）。",
  "browser.carrierFrameRate": "後臺網頁幀率",
  "browser.carrierFrameRateHint": "{{agent}}在後臺操作的網頁（遊戲、動畫、錄屏）用 30 fps 更流暢，但更佔 CPU 和 GPU；卡片上的畫面仍是每秒一張",
  "browser.carrierFrameRate15": "省 CPU 和 GPU（預設）",
  "browser.carrierFrameRate30": "後臺網頁更流暢",
  "browser.media.tray": "正在播放",
  "browser.media.title": "正在播放",
  "browser.media.mute": "靜音",
  "browser.media.unmute": "取消靜音",
  "browser.media.stop": "停止",
  "browser.media.go": "前往",
  "browser.media.muted": "已靜音",
  "browser.media.hint": "播放聲音的標籤切走後仍在後臺運行；停止後，看不見時會像平常一樣關掉。",
  "browser.copyServiceLink": "複製 cutex 鏈接",
  "browser.error.serviceManuallyStopped": "這個服務已被手動停止。請到「服務」頁選擇「啓動」；重新加載不會啓動它。",
  "browser.error.serviceWakeFailed": "服務未能完成喚醒。請到「服務」頁查看日誌，再選擇「喚醒」重試；不會自動重試啓動。",
};
declare module "../i18nCatalog" { interface ModuleZhHantMessages extends Record<keyof typeof zhHantCN, string> {} }

/** Precise idle-wake/manual-stop errors; older service error wording is unchanged. */
export const locales: Record<string, Partial<Record<keyof typeof zhCN, string>>> = { "zh-Hant-CN": zhHantCN };
