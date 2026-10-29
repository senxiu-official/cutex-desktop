// Regional Traditional Chinese (zh-Hant-TW / HK / MO) in the strings that live outside the renderer
// catalogs: the main-process shell (tray, edit menu, Linux close notice), native browser / page prompts,
// the owner-alert page, alarm day labels and known-issue text. A regional locale must never fall to
// Simplified (or English) just because a table only knows zh-Hant-CN; HK / MO inherit Taiwan wording.
import { describe, expect, it } from "vitest";
import { browserDownloadDialogTitle, browserPermissionPromptText } from "../src/main/browser/promptText";
import { alarmClock } from "../src/renderer/src/modules/alarms/model";
import { alertStrings, timeLabel } from "../src/renderer/src/ownerAlert/model";
import { localizedText, type LocalizedText } from "../src/shared/knownIssues";
import { APP_LOCALES, type AppLocale } from "../src/shared/locales";
import { pageSubmitMessage, pageSubmitPromptText } from "../src/shared/pagePromptText";
import { editMenuLabels, overlayDescription, parsePrefs, resolveLocale, trayMenuLabels, trayNoticeText, trayTooltip } from "../src/shared/shell";

const REGIONAL = ["zh-Hant-TW", "zh-Hant-HK", "zh-Hant-MO"] as AppLocale[];
const SIMPLIFIED_ONLY = /[显启动体处贴页发内这标权来设备连该]/; // characters that only appear in Simplified text

describe("every shipped locale in the shell", () => {
  it("ships the three regional ids and each one is a valid Intl tag", () => {
    for (const id of REGIONAL) expect(APP_LOCALES).toContain(id);
    expect(APP_LOCALES).toHaveLength(15);
    for (const id of APP_LOCALES) {
      expect(() => new Intl.Locale(id)).not.toThrow();
      expect(() => new Intl.DateTimeFormat(id).format(0)).not.toThrow();
    }
  });

  it("has tray, overlay, edit-menu and close-notice text for all 15 locales", () => {
    for (const id of APP_LOCALES) {
      const tray = trayMenuLabels(id);
      expect(tray.show && tray.newChat && tray.quit).toBeTruthy();
      expect(trayTooltip(2, id)).toContain("2");
      expect(overlayDescription(2, id)).toContain("2");
      expect(Object.values(editMenuLabels(id)).every(Boolean)).toBe(true);
      expect(trayNoticeText(id).message).toBeTruthy();
    }
  });

  it("keeps a stored regional locale and the zh-Hant-CN / zh-CN defaults unchanged", () => {
    for (const id of REGIONAL) expect(parsePrefs({ locale: id }).locale).toBe(id);
    expect(trayMenuLabels("zh-CN")).toEqual({ show: "显示窗口", newChat: "快速启动", quit: "退出" });
    expect(trayMenuLabels("zh-Hant-CN")).toEqual({ show: "顯示視窗", newChat: "快速啟動", quit: "退出" });
    expect(editMenuLabels("zh-Hant-CN").paste).toBe("粘貼");
    expect(trayNoticeText("zh-Hant-CN").message).toBe("Cutex 仍在系統托盤中運行");
    expect(resolveLocale(null, "zh-CN")).toBe("zh-CN");
    expect(resolveLocale("zh-Hant-TW", "en-US")).toBe("zh-Hant-TW");
  });

  it("uses Taiwan words for TW and lets HK / MO inherit them", () => {
    for (const id of REGIONAL) {
      expect(trayMenuLabels(id)).toEqual({ show: "顯示視窗", newChat: "快速啟動", quit: "結束" });
      expect(editMenuLabels(id)).toMatchObject({ undo: "復原", cut: "剪下", paste: "貼上", addToDictionary: "加入字典" });
      expect(trayNoticeText(id).message).toBe("Cutex 仍在系統匣中執行");
      expect(trayNoticeText(id).detail).toContain("設定 → 通用 → 關閉視窗時");
      expect(trayTooltip(3, id)).toBe(`Cutex — 3 個${id === "zh-Hant-TW" ? "智慧體" : "智能體"}等待處理`);
      expect(trayTooltip(3, id, { locale: id, terms: { agent: { one: "代理", many: "代理" }, subagent: { one: "子代理", many: "子代理" }, director: { one: "主管", many: "主管" }, owner: { one: "主人", many: "主人" } } })).toBe("Cutex — 3 個代理等待處理");
    }
  });
});

describe("native prompts in regional Traditional Chinese", () => {
  const permission = { origin: "https://example.com", permissions: ["camera", "clipboard-read"] as const, pool: "agent" as const, agentActing: true, agentName: "" };
  const page = { name: "表單", version: 2, agent: "profileDawn", text: "hello" };

  it("browser permission and download dialogs stay Traditional, with Taiwan words", () => {
    for (const id of REGIONAL) {
      const p = browserPermissionPromptText(id, permission);
      expect(p.message).toBe("https://example.com 想使用：相機、讀取剪貼簿");
      expect(p.detail).toContain(`這個分頁在${id === "zh-Hant-TW" ? "智慧體" : "智能體"}專用的登入池裡。`);
      expect(p.allow).toBe("允許");
      expect(browserDownloadDialogTitle(id, undefined)).toBe("儲存下載");
      expect(browserDownloadDialogTitle(id, "")).toBe(`${id === "zh-Hant-TW" ? "智慧體" : "智能體"}想下載一個檔案——選擇儲存位置，或取消`);
      expect(`${p.title}${p.message}${p.detail}`).not.toMatch(SIMPLIFIED_ONLY);
    }
    // zh-Hant-CN keeps its own wording.
    expect(browserPermissionPromptText("zh-Hant-CN", permission).message).toBe("https://example.com 想使用：攝像頭、讀取剪貼板");
    expect(browserDownloadDialogTitle("zh-CN", undefined)).toBe("保存下载");
  });

  it("page submit dialog and message stay Traditional", () => {
    for (const id of REGIONAL) {
      const p = pageSubmitPromptText(id, page);
      expect(p.title).toBe("頁面想傳送內容");
      expect(p.send).toBe("傳送");
      expect(`${p.title}${p.message}${p.detail}`).not.toMatch(SIMPLIFIED_ONLY);
      expect(pageSubmitMessage(id, { artifactId: "af-1", name: "表單", version: 2, format: "text", text: "x" })).toMatch(/^來自成果頁面「表單」v2/);
    }
    expect(pageSubmitPromptText("zh-Hant-CN", page).send).toBe("發送");
    expect(pageSubmitPromptText("zh-CN", page).send).toBe("发送");
  });
});

describe("renderer helpers outside the catalogs", () => {
  it("owner alert page and alarm labels resolve regional locales to Traditional", () => {
    for (const id of REGIONAL) {
      expect(alertStrings(id)).toBe(alertStrings("zh-Hant-CN"));
      expect(timeLabel(new Date(Date.now() - 5 * 60_000).toISOString(), Date.now(), id)).toBe("5 分鐘前");
    }
    expect(alertStrings("zh-CN").send).toBe("发送");
    const now = new Date(2026, 9, 11, 12, 0, 0).getTime();
    const tomorrow = new Date(2026, 9, 12, 9, 5).getTime();
    for (const id of REGIONAL) expect(alarmClock(tomorrow, now, id)).toBe("明天 09:05");
    expect(alarmClock(tomorrow, now, "en-AU")).toBe("Tomorrow 09:05");
  });

  it("known-issue text follows MO → HK → TW, then zh-Hant-CN, then zh-CN; never English for Chinese", () => {
    const base: LocalizedText = { "zh-CN": "简体", en: "English" };
    expect(localizedText(base, "zh-Hant-MO")).toBe("简体");
    expect(localizedText({ ...base, "zh-Hant-CN": "繁體" }, "zh-Hant-HK")).toBe("繁體");
    const tw = { ...base, "zh-Hant-CN": "繁體", "zh-Hant-TW": "臺灣" } as LocalizedText;
    expect(localizedText(tw, "zh-Hant-TW")).toBe("臺灣");
    expect(localizedText(tw, "zh-Hant-HK")).toBe("臺灣");
    expect(localizedText(tw, "zh-Hant-MO")).toBe("臺灣");
    expect(localizedText(tw, "zh-Hant-CN")).toBe("繁體");
    const hk = { ...tw, "zh-Hant-HK": "香港" } as LocalizedText;
    expect(localizedText(hk, "zh-Hant-MO")).toBe("香港");
    expect(localizedText(hk, "zh-Hant-TW")).toBe("臺灣");
    expect(localizedText(hk, "zh-CN")).toBe("简体");
    expect(localizedText(hk, "en-AU")).toBe("English");
    expect(localizedText({ ...base, "zh-Hant-CN": "繁體" }, "zh-Hant-CN")).toBe("繁體");
    expect(localizedText(base, "zh-Hant-CN")).toBe("简体");
  });
});
