// First-contact choices (owner 2026-10-23, the 0.2.0 guide): settings with options that the introduction's 「几个选择」
// step and the 0.2.0 tour let you set the first time, each with 「帮我决定」 (the recommended value, said back) and one
// 「都帮我决定」 for all. Every one stays in Settings (`whereKey` says where). The 拟人头像 question is not here: the
// owner decides it himself (lib/tour portraitAnswer). 侧栏布局 (design 040 §4, step 14): 花名册 recommended. Shared by
// components/FirstChoices.
import type { MessageKey } from "../i18n";
import { getAppearance, setAppearance } from "./appearance";
import { getUiPrefs, setUiPref, type AvatarTint, type SidebarLayout } from "./prefs";
import { setTrayPrefs, useTrayPrefs } from "./trayPrefs";
import type { DropPreviewStyle } from "./appearanceModel";

export interface ChoiceOption {
  value: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
}

export interface FirstChoice {
  id: "dropPreview" | "threeColumns" | "avatarTint" | "sidebarLayout";
  titleKey: MessageKey;
  /** Where it lives in Settings afterwards. */
  whereKey: MessageKey;
  options: readonly ChoiceOption[];
  recommended: string;
  get(): string;
  set(value: string): void;
  /** Shown at all (a choice whose feature is not there yet stays out). */
  available(): boolean;
}

export const FIRST_CHOICES: readonly FirstChoice[] = [
  {
    id: "avatarTint",
    titleKey: "onboarding.choice.avatarTint",
    whereKey: "onboarding.choice.avatarTint.where",
    options: [
      { value: "none", labelKey: "onboarding.choice.avatarTint.none", hintKey: "onboarding.choice.avatarTint.noneHint" },
      { value: "provider", labelKey: "onboarding.choice.avatarTint.provider", hintKey: "onboarding.choice.avatarTint.providerHint" },
    ],
    recommended: "none",
    get: () => getUiPrefs().avatarTint,
    set: (v) => setUiPref("avatarTint", v as AvatarTint),
    available: () => true,
  },
  {
    id: "sidebarLayout",
    titleKey: "onboarding.choice.sidebar",
    whereKey: "onboarding.choice.sidebar.where",
    options: [
      { value: "roster", labelKey: "onboarding.choice.sidebar.roster", hintKey: "onboarding.choice.sidebar.rosterHint" },
      { value: "now-all", labelKey: "onboarding.choice.sidebar.nowAll", hintKey: "onboarding.choice.sidebar.nowAllHint" },
    ],
    recommended: "roster",
    get: () => getUiPrefs().sidebarLayout,
    set: (v) => setUiPref("sidebarLayout", v as SidebarLayout),
    available: () => true,
  },
  {
    id: "dropPreview",
    titleKey: "onboarding.choice.drop",
    whereKey: "onboarding.choice.drop.where",
    options: [
      { value: "outline", labelKey: "onboarding.choice.drop.outline", hintKey: "onboarding.choice.drop.outlineHint" },
      { value: "fill", labelKey: "onboarding.choice.drop.fill", hintKey: "onboarding.choice.drop.fillHint" },
    ],
    recommended: "outline",
    get: () => getAppearance().dropPreview,
    set: (v) => setAppearance({ dropPreview: v as DropPreviewStyle }),
    available: () => true,
  },
  {
    id: "threeColumns",
    titleKey: "onboarding.choice.columns",
    whereKey: "onboarding.choice.columns.where",
    options: [
      { value: "two", labelKey: "onboarding.choice.columns.two", hintKey: "onboarding.choice.columns.twoHint" },
      { value: "three", labelKey: "onboarding.choice.columns.three", hintKey: "onboarding.choice.columns.threeHint" },
    ],
    recommended: "two",
    get: () => (useTrayPrefs.getState().allowThreeColumns ? "three" : "two"),
    set: (v) => setTrayPrefs({ allowThreeColumns: v === "three" }),
    available: () => true,
  },
];

/** The choices to show (in order), optionally only some of them. */
export function availableChoices(ids?: readonly FirstChoice["id"][]): FirstChoice[] {
  return FIRST_CHOICES.filter((c) => c.available() && (!ids || ids.includes(c.id)));
}

/** 「帮我决定」 on one choice: its recommended value, applied; returns the option picked. */
export function decideChoice(choice: FirstChoice): ChoiceOption {
  choice.set(choice.recommended);
  return choice.options.find((o) => o.value === choice.recommended)!;
}

/** 「都帮我决定」: every available choice (of `ids`) set to its recommendation; what was picked, in order. */
export function decideAllChoices(ids?: readonly FirstChoice["id"][]): { choice: FirstChoice; option: ChoiceOption }[] {
  return availableChoices(ids).map((choice) => ({ choice, option: decideChoice(choice) }));
}
