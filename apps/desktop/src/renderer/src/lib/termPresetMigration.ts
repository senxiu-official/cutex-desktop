import type { TermId, TermOverrides } from "./terms";

/** Old presets were saved by value. Match the complete legacy signature, never a lone custom word. */
export function migrateMaidTerms(overrides: TermOverrides): TermOverrides {
  let result = overrides;
  const old = { agent: ["Maid", "Maids"], subagent: ["Maidling", "Maidlings"], parentagent: ["Head Maid", "Head Maids"], director: ["Chief Maid", "Chief Maids"], owner: ["Master", "Masters"] };
  for (const [locale, saved] of Object.entries(overrides)) {
    if (!saved) continue;
    const zh = locale.startsWith("zh");
    if (!Object.entries(old).every(([id, [one, many]]) => saved[id as TermId]?.one === one && saved[id as TermId]?.many === (zh ? one : many))) continue;
    if (result === overrides) result = { ...overrides };
    result[locale as keyof TermOverrides] = {
      ...saved,
      parentagent: { one: "Mentor Maid", many: zh ? "Mentor Maid" : "Mentor Maids" },
      operator: { one: "Deputy Maid", many: zh ? "Deputy Maid" : "Deputy Maids", ...saved.operator },
    };
  }
  return result;
}

/**
 * The Maid preset gained the 个人助理 term (Lady's Maid, 2026-11-26). Wording saved as the complete Maid set before it
 * keeps reading as that preset: the new term is added — only when the whole current Maid signature matches and the
 * assistant term was never set.
 */
export function migrateAssistantTerm(overrides: TermOverrides): TermOverrides {
  let result = overrides;
  const maid = { agent: ["Maid", "Maids"], subagent: ["Maidling", "Maidlings"], parentagent: ["Mentor Maid", "Mentor Maids"], director: ["Chief Maid", "Chief Maids"], operator: ["Deputy Maid", "Deputy Maids"], owner: ["Master", "Masters"] };
  for (const [locale, saved] of Object.entries(overrides)) {
    if (!saved || saved.assistant?.one || saved.assistant?.many) continue;
    const zh = locale.startsWith("zh");
    if (!Object.entries(maid).every(([id, [one, many]]) => saved[id as TermId]?.one === one && saved[id as TermId]?.many === (zh ? one : many))) continue;
    if (result === overrides) result = { ...overrides };
    result[locale as keyof TermOverrides] = { ...saved, assistant: { ...saved.assistant, one: "Lady's Maid", many: zh ? "Lady's Maid" : "Lady's Maids" } };
  }
  return result;
}
