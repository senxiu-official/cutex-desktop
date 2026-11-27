// Ids and links of module `start` (kept out of its component files so they stay Fast Refresh boundaries).
import type { SettingsTab } from "../../store";

/** The 开始使用 page (main.page). `params.customize`: open with 自定义桌面 (step 4) unfolded. */
export const START_PAGE = "start.page";

/** The parts of 自定义桌面 (./CustomizePanel). */
export type CustomizePart = "theme" | "zoom" | "perf" | "terms" | "layout" | "portraits";

/** Where each part's setting lives in Settings (「在设置里改更多」): the page and the card. */
export const CUSTOMIZE_SETTINGS: Readonly<Record<CustomizePart, { tab: SettingsTab; anchor: string }>> = {
  theme: { tab: "appearance", anchor: "colors" },
  zoom: { tab: "appearance", anchor: "layout" },
  perf: { tab: "general", anchor: "performance" },
  terms: { tab: "general", anchor: "terms" },
  layout: { tab: "sidebar", anchor: "agentRows" },
  portraits: { tab: "appearance", anchor: "portraits" },
};

const REPO = "https://github.com/senxiu-official/cutex-desktop";
/** Installing Cutex on an iPad and connecting it the first time. */
export const IPAD_GUIDE_URL = `${REPO}/blob/release/docs/deploy/IPAD-FIRST-RUN.md`;
