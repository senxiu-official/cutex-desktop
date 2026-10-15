// Model display names (lib/modelDisplay): per profile, per model entry (cutex
// profile-model-display-names). Resolution: the profile's entry name → the catalog display name → a
// catalog name seen before for the id (UI review #16) → id.
import { beforeEach, describe, expect, it, vi } from "vitest";

const md = await import("../src/renderer/src/lib/modelDisplay");
const { entryName, forgetCatalogNames, modelControlTitle, modelLabel, modelMatchesQuery, modelName, noteCatalogNames, rawIdTitle, setProfileModelNames, setProfileNamesLoader, updateProfileModelNames } = md;

beforeEach(() => forgetCatalogNames());

const gamma = { id: "p-1", name: "gamma", modelDisplayNames: { "gpt-5.5": "GPT 5.5", "Astra [400K]": "Astra 400K" } };
const glm = { id: "p-2", name: "GLM", modelDisplayNames: { "glm-5.3": "GLM 5.3" } };

describe("modelLabel", () => {
  it("prefers the entry name, then the catalog name, then the id", () => {
    expect(modelLabel("gpt-5.5", "GPT-5.5", "GPT 5.5")).toBe("GPT 5.5");
    expect(modelLabel("gpt-5.5", "GPT-5.5", null)).toBe("GPT-5.5");
    forgetCatalogNames();
    expect(modelLabel("gpt-5.5", null, null)).toBe("gpt-5.5");
    expect(modelLabel("gpt-5.5", "  ", " ")).toBe("gpt-5.5");
    expect(modelLabel(null, null, null)).toBe("");
    expect(modelLabel(undefined, "GLM-6")).toBe("GLM-6");
  });

  it("falls back to a catalog name seen before when the caller has only the id", () => {
    expect(modelLabel("m-flash", null)).toBe("m-flash");
    noteCatalogNames([{ id: "m-flash", displayName: "M Flash" }]);
    expect(modelLabel("m-flash", null)).toBe("M Flash");
    expect(modelLabel("m-flash", null, "Mine")).toBe("Mine");
  });

  it("remembers a catalog name a caller passed; names equal to the id are ignored", () => {
    expect(modelLabel("m-pro", "M Pro")).toBe("M Pro");
    expect(modelLabel("m-pro", null)).toBe("M Pro");
    noteCatalogNames([{ id: "m-raw", displayName: "m-raw" }]);
    expect(modelLabel("m-raw", null)).toBe("m-raw");
  });
});

describe("profile entry names", () => {
  beforeEach(() => setProfileModelNames([gamma, glm]));

  it("resolves by profile id or name; another profile's names never apply", () => {
    expect(modelName("gpt-5.5", "GPT-5.5", "gamma")).toBe("GPT 5.5");
    expect(modelName("gpt-5.5", "GPT-5.5", "p-1")).toBe("GPT 5.5");
    expect(modelName("gpt-5.5", "GPT-5.5", "GLM")).toBe("GPT-5.5");
    expect(modelName("glm-5.3", null, "GLM")).toBe("GLM 5.3");
    expect(modelName("glm-5.3", null, "gamma")).toBe("glm-5.3");
  });

  it("without a profile only the catalog name and the id apply", () => {
    expect(modelName("gpt-5.5")).toBe("gpt-5.5");
    expect(modelName("gpt-5.5", "GPT-5.5")).toBe("GPT-5.5");
    // Seen once, the catalog name also applies where only the id is known.
    expect(modelName("gpt-5.5")).toBe("GPT-5.5");
    expect(entryName(null, "gpt-5.5")).toBeNull();
    expect(entryName("missing", "gpt-5.5")).toBeNull();
  });

  it("named configurations of one real model keep separate names", () => {
    expect(modelName("Astra [400K]", "Astra [400K]", "gamma")).toBe("Astra 400K");
    expect(modelName("Astra [285K]", "Astra [285K]", "gamma")).toBe("Astra [285K]");
  });

  it("an edited profile replaces its names, also under a new profile name", () => {
    updateProfileModelNames({ id: "p-1", name: "gamma-2", modelDisplayNames: { "gpt-5.5": "Five" } });
    expect(modelName("gpt-5.5", null, "gamma-2")).toBe("Five");
    expect(modelName("gpt-5.5", null, "p-1")).toBe("Five");
    expect(modelName("gpt-5.5", null, "gamma")).toBe("gpt-5.5");
    expect(modelName("glm-5.3", null, "GLM")).toBe("GLM 5.3");
    updateProfileModelNames({ id: "p-2", name: "GLM" });
    expect(modelName("glm-5.3", null, "GLM")).toBe("glm-5.3");
  });

  it("an older cutex without modelDisplayNames shows catalog names", () => {
    setProfileModelNames([{ id: "p-3", name: "old" }]);
    expect(modelName("gpt-5.5", "GPT-5.5", "old")).toBe("GPT-5.5");
  });

  it("the loader can be registered (the first hook use calls it once)", () => {
    const load = vi.fn();
    setProfileNamesLoader(load);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("rawIdTitle shows the id only when it differs from the shown name", () => {
    expect(rawIdTitle("gpt-5.5", "GPT 5.5")).toBe("gpt-5.5");
    expect(rawIdTitle("gpt-5.5", "gpt-5.5")).toBeUndefined();
    expect(rawIdTitle(null, "x")).toBeUndefined();
  });

  it("modelControlTitle adds the raw id only when the shown name differs", () => {
    expect(modelControlTitle("模型", "m-flash", "M Flash")).toBe("模型 · m-flash");
    expect(modelControlTitle("模型", "m-raw", "m-raw")).toBe("模型");
  });

  it("modelMatchesQuery searches the id and the shown name", () => {
    expect(modelMatchesQuery("glm-5.3", "GLM 5.3", "glm 5")).toBe(true);
    expect(modelMatchesQuery("glm-5.3", "GLM 5.3", "5.3")).toBe(true);
    expect(modelMatchesQuery("glm-5.3", "GLM 5.3", "gpt")).toBe(false);
    expect(modelMatchesQuery("glm-5.3", "GLM 5.3", "")).toBe(true);
  });
});
