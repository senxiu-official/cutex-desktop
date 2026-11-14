// Onboarding (owner 2026-10-19): the one-time introduction and the per-version 新功能 dialog
// (components/OnboardingDialog, state in lib/onboarding), the permanent feature directory and replays in About.
import { ListChecks, LifeBuoy, Sparkles } from "lucide-react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const OnboardingSection = lazyPage(() => import("./OnboardingSection").then((m) => m.OnboardingSection));

const HelpPage = lazyPage(() => import("./HelpPage").then((m) => m.HelpPage));

// 帮助与文档 → 接下来里的状态 (Next Up registry §六), generated from lib/inputLedger/nextUpRegistry.
const NextUpStatesPage = lazyPage(() => import("./NextUpStatesPage").then((m) => m.NextUpStatesPage));

const NewFeaturesPage = lazyPage(() => import("./NewFeaturesPage").then((m) => m.NewFeaturesPage));

export default defineModule({
  id: "onboarding",
  titleKey: "onboarding.title",
  descriptionKey: "onboarding.description",
  required: true,
  contributes: {
    "settings.page": [
      { id: "onboarding.newFeatures", page: "whats-new", group: "system", order: 450, icon: Sparkles, titleKey: "onboarding.features.title", hintKey: "settings.pageHint.whats-new", source: "local", Page: NewFeaturesPage },
      { id: "onboarding.help", page: "help", group: "system", order: 460, icon: LifeBuoy, titleKey: "onboarding.guide.help.title", hintKey: "settings.pageHint.help", source: null, Page: HelpPage },
      { id: "onboarding.nextUpStates", page: "next-up-states", group: "system", order: 461, icon: ListChecks, titleKey: "nextUp.help.title", hintKey: "nextUp.help.hint", source: "local", Page: NextUpStatesPage },
    ],
    "settings.section": [
      { id: "onboarding.section", page: "about", order: 50, titleKey: "onboarding.section", keywords: ["onboarding.whatsNewToggle", "onboarding.helpLink", "onboarding.replayWhatsNew"], Section: OnboardingSection },
    ],
  },
});
