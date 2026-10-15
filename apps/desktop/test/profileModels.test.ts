import { describe, expect, it } from "vitest";
import type { CatalogModel, ProfileModelsView } from "../src/shared/ipc";
import { canCreateModelVariant, entryNamePatch, modelDraft, modelNameTaken, modelsSourceText, modelVariantPatch, upstreamSource } from "../src/renderer/src/lib/profileModels";
import { upstreamModelsNotice } from "../src/renderer/src/lib/profileKind";
import { modelLabel } from "../src/renderer/src/lib/modelDisplay";

const astra: CatalogModel = {
  id: "gpt-6-astra", displayName: "GPT-6-Astra", contextWindow: 400_000, maxContextWindow: 1_000_000,
  autoCompactTokenLimit: null, effectiveContextWindowPercent: 95, inputModalities: ["text", "image"],
  supportedReasoningEfforts: ["low", "high"], defaultReasoningEffort: "high", isDefault: true, discovered: false,
  effective: { contextWindow: 400_000, contextWindowSource: "catalog", autoCompactTokenLimit: 360_000, autoCompactTokenLimitSource: "default90Percent" },
};

describe("profile model configurations", () => {
  it("offers creation only when both the API and the profile's runtime support it", () => {
    const capable = new Set(["profile-model-variants"]);
    const view = { catalogSupported: true, modelVariantsSupported: true } as ProfileModelsView;
    expect(canCreateModelVariant(capable, view)).toBe(true);
    expect(canCreateModelVariant(new Set(), view)).toBe(false);
    expect(canCreateModelVariant(capable, { ...view, modelVariantsSupported: undefined })).toBe(false);
    expect(canCreateModelVariant(capable, { ...view, modelVariantsSupported: false })).toBe(false);
    expect(canCreateModelVariant(capable, { ...view, catalogSupported: false })).toBe(false);
  });

  it("keeps two configuration names separate from the same actual request model", () => {
    const a = modelVariantPatch(astra, { ...modelDraft(astra), displayName: "Astra [400K]" });
    const b = modelVariantPatch(astra, { ...modelDraft(astra), displayName: "Astra [285K]", contextWindow: 285_000 });
    expect([a.requestModel, b.requestModel]).toEqual(["gpt-6-astra", "gpt-6-astra"]);
    expect([a.contextWindow, b.contextWindow]).toEqual([400_000, 285_000]);
    expect(b).not.toHaveProperty("effective");
    expect(b.autoCompactTokenLimit).toBeNull(); // No frontend-derived native defaults in the patch.
    expect(modelLabel("Astra [285K]", b.displayName)).toBe("Astra [285K]");
    expect(modelLabel("Astra [285K]", b.displayName, "Astra 285K")).toBe("Astra 285K");
  });

  it("copies a configuration using the underlying model and never aliases another alias", () => {
    const variant = { ...astra, id: "Astra [400K]", requestModel: astra.id, displayName: "Astra [400K]" };
    expect(modelVariantPatch(variant, modelDraft(variant)).requestModel).toBe(astra.id);
    const draft = modelDraft(variant);
    draft.inputModalities!.push("test");
    expect(astra.inputModalities).toEqual(["text", "image"]);
    expect(modelNameTaken(" Astra [400K] ", [astra, variant])).toBe(true);
    expect(modelNameTaken("Astra [285K]", [astra, variant])).toBe(false);
    expect(modelDraft(variant)).not.toHaveProperty("requestModel"); // Editing keeps the binding unchanged.
  });

  it("patches one entry's display name only when it changed; empty removes it", () => {
    expect(entryNamePatch("gpt-5.5", " GPT  5.5 ", null)).toEqual({ "gpt-5.5": "GPT 5.5" });
    expect(entryNamePatch("gpt-5.5", "GPT 5.5", "GPT 5.5")).toBeNull();
    expect(entryNamePatch("gpt-5.5", "", null)).toBeNull();
    expect(entryNamePatch("gpt-5.5", "  ", "GPT 5.5")).toEqual({ "gpt-5.5": null });
    // A single plain entry (no configurations) gets a name the same way.
    expect(entryNamePatch("sonnet", "Sonnet 5", null)).toEqual({ sonnet: "Sonnet 5" });
  });

  it("describes an official overlay by its live upstream source", () => {
    const t = (key: string, args?: Record<string, string | number>) => `${key}${args ? JSON.stringify(args) : ""}`;
    const cache = { kind: "nativeCache", fetchedAt: null, clientVersion: "0.161.0", native: { version: "0.160.0-r50" }, notInBundled: ["gpt-6.1-sol"] };
    const view = { modelsSource: { kind: "overlay", upstream: cache } } as unknown as ProfileModelsView;
    expect(upstreamSource(view.modelsSource)).toBe(cache);
    expect(modelsSourceText(t as never, view)).toBe('agent-config.profile.modelsSource.overlay{"source":"agent-config.profile.modelsSource.nativeCache"}');
    expect(modelsSourceText(t as never, { ...view, modelsSource: { kind: "overlay", upstream: null } })).toBe("agent-config.profile.modelsSource.overlayOnly");
    // The "upstream has newer models" notice still reads the upstream list.
    expect(upstreamModelsNotice(upstreamSource(view.modelsSource))?.missing).toEqual(["gpt-6.1-sol"]);
    expect(upstreamSource({ kind: "nativeBundled" })).toEqual({ kind: "nativeBundled" });
    expect(upstreamSource(null)).toBeNull();
  });
});