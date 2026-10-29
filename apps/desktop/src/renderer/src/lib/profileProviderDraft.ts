import type { ProfileDetail, ProfilePatch, ProfilePreset, WebSearchMode } from "../../../shared/ipc";
import { fieldEditable, fieldOffered } from "./profileKind";

/** Apply only defaults declared by the target host, retaining its provider entry and catalog. */
export function providerPresetDraft(preset: ProfilePreset, detail: ProfileDetail, current: ProfilePatch = {}): ProfilePatch {
  const patch: ProfilePatch = {};
  // Provider IDs also select daemon-specific rules. PATCH is not a full preset migration.
  if (detail.detail?.config?.modelProvider !== preset.providerId) return patch;
  if (fieldEditable(detail, "providerOptions")) {
    if (preset.baseUrl && fieldEditable(detail, "providerBaseUrl")) patch.providerBaseUrl = preset.baseUrl;
    if (fieldEditable(detail, "providerName")) patch.providerName = preset.label;
    if (fieldEditable(detail, "requiresOpenaiAuth")) patch.requiresOpenaiAuth = false;
    if (fieldEditable(detail, "providerWireApi")) patch.providerWireApi = "responses";
  }
  if (fieldEditable(detail, "model")) patch.model = preset.defaultModel;
  if (fieldEditable(detail, "modelReasoningEffort")) patch.modelReasoningEffort = null;
  if (fieldOffered(detail, "webSearch") && (preset.webSearch === null || ["disabled", "cached", "indexed", "live"].includes(preset.webSearch ?? ""))) {
    patch.webSearch = preset.webSearch as WebSearchMode | null;
    if (patch.webSearch !== "disabled" && fieldOffered(detail, "searchTool") && (current.searchTool ?? detail.searchTool)) patch.searchTool = false;
  }
  if (fieldOffered(detail, "toolSchemaCompat") && preset.toolSchemaCompat !== undefined) patch.toolSchemaCompat = preset.toolSchemaCompat;
  return patch;
}
