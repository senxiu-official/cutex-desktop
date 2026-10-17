// Provider of a profile / model, for the LobeHub logos (assets/providers/NOTICE.md).
// cutex owns the answer (`profile-provider-category-v2`: kimi / glm / zai / claude / deepseek /
// codex / other, with an effective value inferred by cutex); until a host has it, guess from the fields
// older cutex already returns. Display only — nothing is stored. Qwen / Gemini / OpenRouter are not
// cutex categories: they come from the base URL or the model name only.
import type { ProfileItem } from "../../../shared/ipc";
import claude from "../assets/providers/claude-color.svg?raw";
import codex from "../assets/providers/codex-color.svg?raw";
import deepseek from "../assets/providers/deepseek-color.svg?raw";
import gemini from "../assets/providers/gemini-color.svg?raw";
import kimi from "../assets/providers/kimi-color.svg?raw";
import openrouter from "../assets/providers/openrouter.svg?raw";
import qwen from "../assets/providers/qwen-color.svg?raw";
import zai from "../assets/providers/zai.svg?raw";
import glm from "../assets/providers/zhipu-color.svg?raw";

export type Provider = "kimi" | "glm" | "zai" | "claude" | "deepseek" | "codex" | "qwen" | "gemini" | "openrouter";
export const PROVIDER_SVG: Record<Provider, string> = { kimi, glm, zai, claude, deepseek, codex, qwen, gemini, openrouter };
export const PROVIDER_LABEL: Record<Provider, string> = { kimi: "Kimi", glm: "GLM", zai: "Z.ai", claude: "Claude", deepseek: "DeepSeek", codex: "Codex", qwen: "Qwen", gemini: "Gemini", openrouter: "OpenRouter" };

/** cutex categories (profile-provider-category-v2) this build has a logo for. */
const KNOWN = new Set<string>(["kimi", "glm", "zai", "claude", "deepseek", "codex"]);
const HOSTS: [RegExp, Provider][] = [
  [/(^|\.)bigmodel\.cn$/, "glm"],
  [/(^|\.)z\.ai$/, "zai"],
  [/(^|\.)(moonshot\.(cn|ai)|kimi\.(com|ai))$/, "kimi"],
  [/(^|\.)deepseek\.com$/, "deepseek"],
  [/(^|\.)anthropic\.com$/, "claude"],
  [/(^|\.)(dashscope(-intl)?\.aliyuncs\.com|qwen\.ai)$/, "qwen"],
  [/(^|\.)generativelanguage\.googleapis\.com$/, "gemini"],
  [/(^|\.)openrouter\.ai$/, "openrouter"],
];
const NAMES: [RegExp, Provider][] = [
  [/glm|zhipu|bigmodel/i, "glm"],
  [/kimi|moonshot/i, "kimi"],
  // Kimi Code's K3 model ids (`k3`, `k3-256k`).
  [/^k3($|-)/i, "kimi"],
  [/deepseek/i, "deepseek"],
  [/claude|anthropic/i, "claude"],
  [/codex|chatgpt|openai|gpt-/i, "codex"],
  [/qwen|qwq|dashscope/i, "qwen"],
  [/gemini|gemma/i, "gemini"],
  [/openrouter/i, "openrouter"],
];

function category(v: unknown): Provider | null {
  if (v === "chatgpt") return "codex";
  return typeof v === "string" && KNOWN.has(v) ? (v as Provider) : null;
}

export function profileProvider(p: Pick<ProfileItem, "name" | "authKind" | "cliKind" | "baseUrl" | "appearance"> & Partial<Pick<ProfileItem, "model" | "modelProvider">>): Provider | null {
  // cutex (profile-provider-category-v2) puts the effective value on the profile and under appearance.
  const effective = (p as { effectiveProviderCategory?: unknown }).effectiveProviderCategory ?? (p.appearance as { effectiveProviderCategory?: unknown } | undefined)?.effectiveProviderCategory;
  // A value from cutex is the answer, even one this build has no logo for (a provider added
  // later): it then shows the name's initial instead of a guess.
  const fromCutex = effective ?? p.appearance?.providerCategory;
  // cutex "other" may still be one of the logos cutex has no category for (Qwen / Gemini / OpenRouter).
  if (typeof fromCutex === "string" && fromCutex) {
    const guess = fromCutex === "other" ? guessFromFields(p) : null;
    return guess && EXTRA.has(guess) ? guess : category(fromCutex);
  }
  return guessFromFields(p);
}

/** Logos only this build knows (not cutex provider categories). */
const EXTRA = new Set<Provider>(["qwen", "gemini", "openrouter"]);

function guessFromFields(p: Pick<ProfileItem, "name" | "authKind" | "cliKind" | "baseUrl"> & Partial<Pick<ProfileItem, "model" | "modelProvider">>): Provider | null {
  if (p.authKind === "chatgpt") return "codex";
  if (p.cliKind === "claude" || p.authKind === "claude") return "claude";
  if (p.baseUrl) {
    try {
      const host = new URL(p.baseUrl).hostname;
      const hit = HOSTS.find(([re]) => re.test(host));
      if (hit) return hit[1];
    } catch {
      // not a URL: fall through to the name
    }
  }
  // Then the name, the provider id and the default model: a relay profile named after its owner
  // (no provider in the name, a relay host) still serves gemini-… models.
  for (const text of [p.name, p.modelProvider, p.model]) {
    const hit = text ? NAMES.find(([re]) => re.test(text))?.[1] : undefined;
    if (hit) return hit;
  }
  return null;
}

/** Model ids carry their family in the name (glm-5, deepseek-v4-flash, gpt-5.5, claude-…, kimi-k3). */
export function modelProvider(model: string): Provider | null {
  if (/^z(ai)?[-/]/i.test(model)) return "zai";
  return NAMES.find(([re]) => re.test(model))?.[1] ?? null;
}
