import type { ProfileItem } from "../../../shared/ipc";
import { profileProvider, type Provider } from "./provider";

export const PORTRAIT_ORDER = ["glm", "kimi", "gemini", "codex", "claude", "deepseek"] as const;
export type PortraitProvider = typeof PORTRAIT_ORDER[number];
export function portraitProvider(provider: Provider | null | undefined): PortraitProvider | null {
  if (provider === "zai") return "glm";
  return PORTRAIT_ORDER.includes(provider as PortraitProvider) ? provider as PortraitProvider : null;
}

/** Preserve host profile order within each provider; the artwork always represents the provider. */
export function portraitChoices(profiles: readonly ProfileItem[]) {
  return PORTRAIT_ORDER.flatMap((provider) => {
    const group = profiles.filter((p) => portraitProvider(profileProvider(p)) === provider);
    const profile = group[0];
    return profile ? [{ provider, profile, profiles: group }] : [];
  });
}
