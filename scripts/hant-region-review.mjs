// Reviewed UI terminology after OpenCC conversion. Applied only to prose: placeholders,
// code spans, links, paths and ASCII product/API names are protected by the generator.
// Keep regional wording here, rather than editing generated catalogs.
export const reviewed = {
  TW: {
    // Convert reload before OpenCC's ambiguous 重載→過載 mapping. Real 过载 stays 過載.
    sourcePhrases: [["重载", "重新加载"]],
    phrases: [
      ["配置檔案", "設定檔"], ["配置", "設定"],
      ["標籤頁", "分頁"], ["頁籤", "分頁"],
      ["賬號", "帳號"], ["賬戶", "帳戶"],
      // OpenCC twp distinguishes 程序 (process) from 程式 (program).
      ["程序", "行程"], ["文字框", "文字方塊"],
      ["日誌", "記錄"], ["文本", "文字"],
      ["網絡卡", "網路卡"], ["攝像頭", "攝影機"], ["全屏", "全螢幕"],
      ["許可權", "權限"], ["賬本", "帳本"],
    ],
    patterns: [
      ["終端(?!機)", "終端機"],
      ["桌面應用(?!程式)", "桌面應用程式"],
      ["應用外殼", "應用程式外殼"],
      // Apply is a verb here. Never replace 應用 globally: 應用程式 is a noun.
      ["應用(?=設定|變更|更改|更新|修改|選擇|此|這|到|於|後|前|時|中|成功|失敗|完成|結果)", "套用"],
      ["(?<=重載時|啟動時|重新啟動時|重啟時)應用", "套用"],
      ["(?<=時|已)應用", "套用"],
      ["應用(?=專用密碼|內|介面|重啟|會|可能|附帶|即|另成)", "應用程式"],
      ["隻(?=影響|有|能|讀|在|對|會|允許|需|用|顯示|保留|接受)", "只"],
    ],
    keys: {
      "settings.group.app": "應用程式",
      "projects.root.apply": "套用",
      "project-view.stream.includeOwnerTurns": "包含我發起的回合",
      "project-view.stream.emptyAutonomous": "目前沒有其他動態。可在「回合」中包含你發起的回合。",
      "tray.seg.apps": "應用程式",
      "shortcuts.conflict.composer": "輸入框和文字方塊要用這個按鍵（傳送、換行、編輯）。",
      "shortcuts.conflict.reserved": "這是系統保留的按鍵，應用程式收不到或會誤觸。",
    },
  },
  HK: {
    phrases: [
      ["用户", "用戶"], ["賬號", "帳號"], ["賬戶", "帳戶"],
      ["設置", "設定"], ["登錄", "登入"],
      ["應用程序", "應用程式"],
    ],
    patterns: [
      ["應用(?=設定|變更|更改|更新|修改|選擇|此|這|到|於|後|前|時|中|成功|失敗|完成|結果)", "套用"],
      ["(?<=時|已)應用", "套用"],
      ["隻(?=影響|有|能|讀|在|對|會|允許|需|用|顯示|保留|接受)", "只"],
    ],
    keys: { "settings.group.app": "應用程式", "projects.root.apply": "套用" },
  },
  // Macau currently shares Hong Kong UI terminology. Add only reviewed differences.
  MO: { keys: {} },
};
