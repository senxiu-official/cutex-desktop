// 输入优化 · Input Refinement (owner 2026-11-26: 「整个 prompt rewrite 作为一个模块，里面可以配提示词，以及可能有的错题本。
// 不应该把提示词增强写进输入框代码。」; name: 输入优化, optional, 设置 → 模块). One `composer.action` (§31): the wand
// button and ▾ template menu in the input footer, the panel (a float above the input box), Ctrl+Shift+E (the last template)
// and the template-picker command. Hosts with text-rewrite-v2 offer their templates (提示词增强, 纠错学习 and the
// owner's copies); hosts with only text-rewrite-v1 keep today's 提示词增强 and its routing on this desktop.
// Settings (owner 2026-11-26, docs/desktop-modules.md §5.1): a card 「输入优化」 in 面板 → 会话 → 输入 (the button, the
// two keys, a row to the templates / Profiles), and a detail page under 会话 without a nav row (lib/inputRefinementNav);
// the old page id `input-refinement` lands on the card. 错题本 is a placeholder (the corrections array is its record shape; nothing is stored).
import { WandSparkles } from "lucide-react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";
import { RewriteAction } from "./RewriteAction";
import { INPUT_REFINEMENT_SECTION } from "../../lib/inputRefinementNav";
import { SETTINGS_PAGE, TEMPLATE_SUB } from "./templates";

const Card = lazyPage(() => import("./RewriteSettings").then((m) => m.InputRefinementCard));
const Settings = lazyPage(() => import("./RewriteSettings").then((m) => m.InputRefinementSettings));
const Template = lazyPage(() => import("./TemplateSettings").then((m) => m.TemplateSettings));

export default defineModule({
  id: "input-refinement",
  titleKey: "input-refinement.title",
  descriptionKey: "input-refinement.description",
  contributes: {
    "composer.action": [
      // Shown on every host; the action itself renders nothing where the host has neither text-rewrite capability.
      { id: "input-refinement.action", commands: ["promptEnhance", "inputRefinementPick"], Action: RewriteAction },
    ],
    "settings.section": [
      // 会话 → 输入, right after 输入区 (shell.composer, 200).
      { id: INPUT_REFINEMENT_SECTION, page: "conversation", order: 210, titleKey: "input-refinement.page", keywords: ["input-refinement.settings.button", "input-refinement.settings.key", "input-refinement.settings.pickKey", "input-refinement.settings.templatesTitle"], Section: Card },
    ],
    "settings.page": [
      {
        id: "input-refinement.settings",
        page: SETTINGS_PAGE,
        // A detail page under 会话 (no nav row); its module group stays 工具 (a host page: the header picks the host).
        group: "tools",
        order: 450,
        navParent: "conversation",
        icon: WandSparkles,
        titleKey: "input-refinement.page",
        hintKey: "input-refinement.pageHint",
        source: "host",
        Page: Settings,
        keywords: ["input-refinement.settings.templatesTitle", "input-refinement.template.enhance", "input-refinement.template.correction", "input-refinement.settings.route.title"],
        sections: [
          { anchor: "input-refinement-templates", titleKey: "input-refinement.settings.templatesTitle", keywords: ["input-refinement.template.enhance", "input-refinement.template.correction", "input-refinement.settings.copy"] },
          { anchor: "input-refinement-route", titleKey: "input-refinement.settings.route.title", keywords: ["input-refinement.settings.fallback", "input-refinement.settings.profiles"] },
        ],
        subPages: { [TEMPLATE_SUB]: { titleKey: "input-refinement.template.page", Page: Template } },
      },
    ],
  },
});
