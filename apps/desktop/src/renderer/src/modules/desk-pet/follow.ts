// Which pet family the open conversation asks for (pure). Pet folders use short family names; `gpt` is lib/avatarThemes' `openai`.
import type { ModelFamily } from "../../lib/avatarThemes";

const PET_FAMILY: Partial<Record<ModelFamily, string>> = { claude: "claude", openai: "gpt", gemini: "gemini", deepseek: "deepseek", kimi: "kimi", glm: "glm" };

export function petFamilyOf(selected: string | null, familyOf: (session: string) => ModelFamily | null): string | null {
  const family = selected ? familyOf(selected) : null;
  return (family && PET_FAMILY[family]) ?? null;
}
