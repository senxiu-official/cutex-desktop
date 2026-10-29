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
