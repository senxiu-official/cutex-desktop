import type { Provider } from "./provider";

export const PORTRAIT_ORDER = ["glm", "kimi", "gemini", "codex", "claude", "deepseek"] as const;
export type PortraitProvider = typeof PORTRAIT_ORDER[number];
export function portraitProvider(provider: Provider | null | undefined): PortraitProvider | null {
  if (provider === "zai") return "glm";
  return PORTRAIT_ORDER.includes(provider as PortraitProvider) ? provider as PortraitProvider : null;
}
