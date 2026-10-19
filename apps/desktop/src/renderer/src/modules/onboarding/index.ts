// Onboarding (owner 2026-10-19): the one-time introduction and the per-version 新功能 dialog
// (components/OnboardingDialog, state in lib/onboarding), and their card on Settings → 关于.
import { defineModule } from "../slots";
import { OnboardingSection } from "./OnboardingSection";

export default defineModule({
  id: "onboarding",
  titleKey: "onboarding.title",
  descriptionKey: "onboarding.description",
  required: true,
  contributes: {
    "settings.section": [
      { id: "onboarding.section", page: "about", order: 50, titleKey: "onboarding.section", keywords: ["onboarding.whatsNewToggle", "onboarding.replayIntro", "onboarding.replayWhatsNew"], Section: OnboardingSection },
    ],
  },
});
