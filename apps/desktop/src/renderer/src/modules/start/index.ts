// 开始使用 (onboarding v3, owner 2026-11-26; built-in, required): what replaces the first-run tour.
// - The three steps (connect a host → a Profile that runs → the first message): ./StartCard, shown in the empty main
//   area on a first run (components/Conversation) and as the page `start.page` (帮助 → 开始使用).
// - 接下来可以试试 on the agent the first message went to: ./TryNext (`conversation.overlay`).
// - 自定义桌面 (./CustomizePanel): the look choices, as the card's optional step 4 and an item of 接下来可以试试 — part of
//   the guide, not a Settings page (owner 2026-11-26; docs/desktop-modules.md §5.1). The old page id lands on 外观.
// - Settings → 帮助 → 开始使用, 自定义桌面 and the sample project (./HelpSection).
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";
import { pageTitle } from "../react";
import { START_PAGE } from "./pages";
import { TryNextOverlay } from "./TryNext";

const StartPage = lazyPage(() => import("./StartCard").then((m) => m.StartPage));
const StartHelpSection = lazyPage(() => import("./HelpSection").then((m) => m.StartHelpSection));

export default defineModule({
  id: "start",
  titleKey: "start.title",
  descriptionKey: "start.description",
  required: true,
  contributes: {
    "main.page": [{ id: START_PAGE, Page: StartPage, useTitle: pageTitle("start.card.title") }],
    "conversation.overlay": [{ id: "start.tryNext", order: 50, Overlay: TryNextOverlay }],
    "settings.section": [
      { id: "start.help", page: "help", order: 5, titleKey: "start.help.start", keywords: ["start.sample.title", "start.customize.title"], Section: StartHelpSection },
    ],
  },
});

