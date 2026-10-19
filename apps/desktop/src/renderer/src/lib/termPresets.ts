// Wording presets for the display terms (lib/terms; Settings → 通用 → 术语): one click sets every term of
// the UI language at once. Used by the onboarding's wording step (components/OnboardingDialog) and offered
// to the 术语 settings page. A preset is a full set of overrides for one language: applying it first
// clears that language's overrides, so 「默认」 is the empty preset. The Maid set is the owner's own wording,
// offered as a small easter egg after the plain ones.
import { DEFAULT_TERMS, TERM_IDS, getTermOverrides, resetTerm, setTerm, type TermForms, type TermId, type TermLocale, type TermOverrides } from "./terms";

export type TermPresetId = "default" | "daili" | "english" | "maid";

export interface TermPreset {
  id: TermPresetId;
  /** Shown smaller, after the plain presets. */
  easterEgg?: boolean;
  /** Forms per term; a term not listed keeps the language's default. Empty = the default wording. */
  terms: Partial<Record<TermId, TermForms>>;
}

const same = (word: string): TermForms => ({ one: word, many: word });
const MAID: Partial<Record<TermId, TermForms>> = {
  agent: { one: "Maid", many: "Maids" },
  subagent: { one: "Maidling", many: "Maidlings" },
  parentagent: { one: "Head Maid", many: "Head Maids" },
  director: { one: "Chief Maid", many: "Chief Maids" },
  owner: { one: "Master", many: "Masters" },
};
// Chinese has no plural: the Maid words are kept as written.
const MAID_ZH: Partial<Record<TermId, TermForms>> = Object.fromEntries(Object.entries(MAID).map(([id, f]) => [id, same(f!.one)]));

// In Chinese the English words do not take a plural either (「3 个 agent」).
const EN_AGENT_ZH: Partial<Record<TermId, TermForms>> = { agent: same("agent"), subagent: same("subagent"), parentagent: same("parent agent") };

const ZH_PRESETS: TermPreset[] = [
  { id: "default", terms: {} },
  { id: "daili", terms: { agent: same("代理"), subagent: same("子代理"), parentagent: same("父代理") } },
  { id: "english", terms: EN_AGENT_ZH },
  { id: "maid", easterEgg: true, terms: MAID_ZH },
];
const ZH_HANT_PRESETS: TermPreset[] = [
  { id: "default", terms: {} },
  { id: "daili", terms: { agent: same("代理"), subagent: same("子代理"), parentagent: same("父代理") } },
  { id: "english", terms: EN_AGENT_ZH },
  { id: "maid", easterEgg: true, terms: MAID_ZH },
];
const OTHER_PRESETS: TermPreset[] = [
  { id: "default", terms: {} },
  { id: "maid", easterEgg: true, terms: MAID },
];

/** The presets offered for a UI language (Chinese: 智能体 / 代理 / agent + Maid; others: default + Maid). */
export function termPresets(locale: TermLocale): readonly TermPreset[] {
  if (locale === "zh-CN") return ZH_PRESETS;
  if (locale === "zh-Hant-CN") return ZH_HANT_PRESETS;
  return OTHER_PRESETS;
}

/** The full term set a preset gives in a language (for previews). */
export function presetOverrides(locale: TermLocale, preset: TermPreset): TermOverrides {
  return { [locale]: { ...preset.terms } };
}

/** Applies a preset to one language: clears its overrides, then sets the preset's forms. */
export function applyTermPreset(locale: TermLocale, id: TermPresetId): void {
  const preset = termPresets(locale).find((p) => p.id === id);
  if (!preset) return;
  for (const term of TERM_IDS) resetTerm(locale, term);
  for (const [term, forms] of Object.entries(preset.terms) as [TermId, TermForms][]) {
    if (forms.one !== DEFAULT_TERMS[locale][term].one) setTerm(locale, term, "one", forms.one);
    if (forms.many !== DEFAULT_TERMS[locale][term].many) setTerm(locale, term, "many", forms.many);
  }
}

/** Which preset the language's saved overrides are exactly (null = a custom wording). */
export function currentTermPreset(locale: TermLocale, overrides: TermOverrides = getTermOverrides()): TermPresetId | null {
  const saved = overrides[locale] ?? {};
  const effective = (term: TermId): TermForms => ({
    one: saved[term]?.one || DEFAULT_TERMS[locale][term].one,
    many: saved[term]?.many || DEFAULT_TERMS[locale][term].many,
  });
  for (const preset of termPresets(locale)) {
    const match = TERM_IDS.every((term) => {
      const want = preset.terms[term] ?? DEFAULT_TERMS[locale][term];
      const have = effective(term);
      return have.one === want.one && have.many === want.many;
    });
    if (match) return preset.id;
  }
  return null;
}
