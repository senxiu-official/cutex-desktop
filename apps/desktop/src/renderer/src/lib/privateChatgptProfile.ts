import type { ProfileDetail, ProfilePatch, ProfilePreset } from "../../../shared/ipc";
import { profileKind } from "./profileKind";
import { officialPresetOf } from "./profilePresets";

/** Relay names/families do not prove an OpenAI endpoint. Never clear an existing setting here. */
export function privateChatgptProfile(detail: ProfileDetail, patch: ProfilePatch, presets: readonly ProfilePreset[]): { relevant: boolean; visible: boolean; warn: boolean } {
  const kind = profileKind(detail);
  const endpoint = patch.providerBaseUrl !== undefined ? patch.providerBaseUrl : (detail.detail?.config?.providerBaseUrl ?? detail.baseUrl);
  const preset = officialPresetOf(endpoint, presets);
  const relevant = kind === "chatgpt" || (kind === "apiKey" && preset?.providerId === "openai-api");
  const existing = detail.privateChatgptAuthFile === true || patch.privateChatgptAuthFile === true;
  return { relevant, visible: relevant || existing, warn: !relevant && existing };
}
