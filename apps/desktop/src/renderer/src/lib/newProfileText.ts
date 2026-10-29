// Labels of the provider-first 新建 Profile form (lib/newProfileModel), kept out of the components so
// they are unit-testable and Fast Refresh keeps working.
import type { MessageKey } from "../i18n";
import { addressSpecOf, addressState, relayHost, RUNTIME_LABEL, type AuthOption, type KeyGroup, type ProviderCard, type Resolved } from "./newProfileModel";
import { urlRegion } from "./profilePresets";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Group keys with their own option copy (Kimi's two key kinds). */
const OWN_GROUP_COPY = new Set(["kimi-code", "moonshot"]);

export function cardLabel(t: T, card: ProviderCard | ProviderCard["id"]): string {
  return t(`newProfile.card.${typeof card === "string" ? card : card.id}` as MessageKey);
}

/** The radio label of a login option. */
export function optionLabel(t: T, option: AuthOption): string {
  if (option.auth === "kimiAccount") return t("agent-config.profiles.new.kind.kimi");
  if (option.auth === "apiKey" && option.id.startsWith("apiKey:")) {
    const group = option.id.slice("apiKey:".length);
    if (OWN_GROUP_COPY.has(group)) return t(`newProfile.auth.apiKey.${group}` as MessageKey);
  }
  if (option.auth === "apiKey" && option.id === "customOpenai") return t("newProfile.auth.customOpenai");
  return t(`newProfile.auth.${option.auth}` as MessageKey);
}

/** The short chip on a provider card (login options deduplicated; 更多 lists its providers instead). */
export function cardChips(t: T, card: ProviderCard): string[] {
  if (card.id === "more") return card.options.flatMap((o) => o.groups.map((g) => g.label));
  const chip = (o: AuthOption) =>
    o.auth === "kimiAccount" ? optionLabel(t, o) : o.auth === "apiKey" && o.id === "customOpenai" ? t("newProfile.auth.customOpenai") : o.auth === "anthropicCompatible" || o.auth === "customAnthropic" ? t("newProfile.auth.customAnthropic") : o.auth === "apiKey" || o.auth === "anthropicKey" ? t("newProfile.auth.apiKey") : t(`newProfile.auth.${o.auth}` as MessageKey);
  return [...new Set(card.options.filter((o) => !o.advanced).map(chip))];
}

/** The card's runtime line: cute-codex · Claude (Gemini: · 需填中转地址). */
export function cardRuntimes(t: T, card: ProviderCard): string {
  const relayOnly = card.id === "gemini" && card.options.every((o) => o.groups.every((g) => g.presets.every((p) => !p.baseUrl)));
  return [...card.runtimes.map((r) => RUNTIME_LABEL[r]), ...(relayOnly ? [t("newProfile.card.relayRequired")] : [])].join(" · ");
}

/** The provider as the owner knows it: the card, or (更多 / several key kinds) the chosen provider. */
export function providerName(t: T, r: Resolved): string {
  return r.card.id === "more" && r.group ? r.group.label : cardLabel(t, r.card);
}

export function regionLabel(t: T, region: "cn" | "intl" | null, fallback: string): string {
  return region ? t(`newProfile.region.${region}`) : fallback;
}

/** What the login option is, one line under its label. */
export function optionDescription(t: T, card: ProviderCard, option: AuthOption): string {
  switch (option.auth) {
    case "kimiAccount":
      return t("variants.credential.kimiNote");
    case "apiKey": {
      if (option.id === "customOpenai") return t("newProfile.authDesc.customOpenai");
      const group = option.id.startsWith("apiKey:") ? option.id.slice("apiKey:".length) : null;
      if (group && OWN_GROUP_COPY.has(group)) return t(`newProfile.authDesc.apiKey.${group}` as MessageKey);
      const first: KeyGroup | undefined = option.groups[0];
      if (first && first.presets.every((p) => !p.baseUrl)) return t("newProfile.authDesc.relayPreset", { provider: cardLabel(t, card) });
      return t("newProfile.authDesc.apiKey");
    }
    case "anthropicCompatible":
      return t("newProfile.auth.anthropicCompatible.hint", { provider: cardLabel(t, card) });
    case "dshEnv":
      return t("newProfile.authDesc.dshEnv", { env: "DEEPSEEK_API_KEY" });
    default:
      return t(`newProfile.authDesc.${option.auth}` as MessageKey);
  }
}

/** 「<Provider> · <auth> [· 经 <host>] · 只用 <runtime>」 (design §3). */
export function summaryLine(t: T, r: Resolved, address: string | null): string {
  const region = r.preset && r.group && r.group.presets.length > 1 ? urlRegion(r.preset.baseUrl) : null;
  const via = relayHost(r, address);
  return [
    [providerName(t, r), region ? t(`newProfile.region.${region}`) : null].filter(Boolean).join(" "),
    optionLabel(t, r.option),
    via ? t("newProfile.summary.via", { host: via }) : null,
    t("newProfile.summary.only", { runtime: RUNTIME_LABEL[r.option.runtime] }),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The address row's hint (official / relay / required); null when the row has nothing to say. */
export function addressHint(t: T, r: Resolved, typed: string | null): { text: string; restore: boolean } | null {
  const spec = addressSpecOf(r);
  if (!spec) return null;
  const state = addressState(spec, typed);
  const provider = providerName(t, r);
  if (state.invalid) return { text: t("newProfile.address.invalid"), restore: !!spec.official };
  if (!spec.official) return { text: t("newProfile.address.required", { provider, interface: t(`newProfile.address.interface.${spec.interface}`) }), restore: false };
  if (state.relay) return { text: t("newProfile.address.relay"), restore: true };
  // Emptied: cutex would use the official address anyway; offer to put it back into the field.
  return { text: t("newProfile.address.official", { provider }), restore: !state.value.trim() };
}
