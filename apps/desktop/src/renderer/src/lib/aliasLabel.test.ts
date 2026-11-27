// Owner 2026-11-23: Claude alias labels are 「Opus 5.5」 (family + version), no 「最新」 / 「(alias)」; version from the SDK
// handshake, else the catalog name of the model that last answered, else 「Opus」. Menus tag alias rows 「跟随最新」.
import { describe, expect, it } from "vitest";
import { aliasLabel, catalogRowFor, claudeCatalogChoices, claudePickerItems, claudeShortName, observedVersionFor } from "./claudeModels";
import { answeringModelShown } from "./composerShown";

const t = ((key: string, vars?: Record<string, string | number>) => (vars ? `${key}${JSON.stringify(vars)}` : key)) as never;
const CATALOG = [
  { id: "opus", displayName: "Opus (alias)" }, { id: "opus[1m]", displayName: "Opus 1M (alias)" },
  { id: "claude-opus-5-5", displayName: "Opus 5.5" }, { id: "claude-opus-4-8", displayName: "Opus 4.8" }, { id: "sonnet", displayName: "Sonnet (alias)" },
];
const HANDSHAKE = { resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake", resolvedDisplayName: "Opus 5.5", resolvedDisplayVersion: "5.5" };
const withAlias = (fields: object) => CATALOG.map((r) => (r.id === "opus" ? { ...r, ...fields } : r));

describe("alias label = family + version", () => {
  it("the same text in every language; no 「最新」, no 「(alias)」", () => {
    expect(aliasLabel("Opus", "5.5")).toBe("Opus 5.5");
    expect(aliasLabel("Opus", null)).toBe("Opus");
  });
  it("1. handshake display version", () => {
    expect(claudeShortName(withAlias(HANDSHAKE), "opus", t)).toBe("Opus 5.5");
  });
  it("2. handshake without a display version, an answer from claude-opus-4-8: its catalog name gives 4.8", () => {
    const version = observedVersionFor("claude-opus-4-8-20261101", "opus", CATALOG);
    expect(version).toBe("4.8");
    expect(claudeShortName(withAlias({ resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake", observedVersion: version }), "opus", t)).toBe("Opus 4.8");
  });
  it("the handshake version wins over a last-answer version", () => {
    expect(claudeShortName(withAlias({ ...HANDSHAKE, observedVersion: "4.8" }), "opus", t)).toBe("Opus 5.5");
  });
  it("3. only the last answer (no handshake)", () => {
    expect(claudeShortName(withAlias({ observedVersion: observedVersionFor("claude-opus-5-5", "opus", CATALOG) }), "opus", t)).toBe("Opus 5.5");
  });
  it("4. neither: 「Opus」 — never the catalog's newest version", () => {
    expect(claudeShortName(CATALOG, "opus", t)).toBe("Opus");
  });
  it("a last answer from another family, an unlisted model or without a catalog name gives no version (never the raw id)", () => {
    expect(observedVersionFor("claude-sonnet-5-5", "opus", CATALOG)).toBeNull();
    expect(observedVersionFor("claude-opus-9", "opus", CATALOG)).toBeNull();
    expect(observedVersionFor("claude-opus-5-5", "opus", [{ id: "claude-opus-5-5", displayName: null }])).toBeNull();
    expect(observedVersionFor("my-proxy", "opus", CATALOG)).toBeNull();
    expect(catalogRowFor(CATALOG, "claude-opus-5-5[1m]")?.id).toBe("claude-opus-5-5");
  });
  it("the [1m] alias takes the plain alias's version", () => {
    expect(claudeShortName(withAlias(HANDSHAKE), "opus[1m]", t)).toBe(`claudeModels.oneMName${JSON.stringify({ model: "Opus 5.5" })}`);
  });
});

describe("menus keep an alias and its fixed model apart", () => {
  it("picker: alias rows carry the 「跟随最新」 tag; the fixed model of the same version none", () => {
    const items = claudePickerItems(withAlias(HANDSHAKE).map((r) => ({ ...r, model: r.id, displayName: r.displayName ?? "", description: "" })), "claude-opus-5-5", t);
    const alias = items.find((i) => i.model === "opus")!, pinned = items.find((i) => i.model === "claude-opus-5-5")!;
    expect([alias.displayName, alias.tag]).toEqual(["Opus 5.5", "claudeModels.latestTag"]);
    expect([pinned.displayName, pinned.tag]).toEqual(["Opus 5.5", undefined]);
  });
  it("plain selects: 「 · 跟随最新」 only where the two would read the same", () => {
    const both = claudeCatalogChoices(withAlias(HANDSHAKE), "claude-opus-5-5", t);
    expect(both.find((c) => c.id === "opus")!.option).toBe("Opus 5.5 · claudeModels.latestTag");
    expect(both.find((c) => c.id === "claude-opus-5-5")!.option).toBe("Opus 5.5");
    // The alias selected: its fixed model is still listed (2026-11-28), so the two are still told apart.
    const aliasSelected = claudeCatalogChoices(withAlias(HANDSHAKE), "opus", t);
    expect(aliasSelected.find((c) => c.id === "opus")!.option).toBe("Opus 5.5 · claudeModels.latestTag");
    expect(aliasSelected.find((c) => c.id === "claude-opus-5-5")).toMatchObject({ option: "Opus 5.5", primary: false });
    // No fixed model of that version in the list: nothing to tell apart.
    const one = claudeCatalogChoices(withAlias(HANDSHAKE).filter((r) => r.id !== "claude-opus-5-5"), "opus", t);
    expect(one.find((c) => c.id === "opus")!.option).toBe("Opus 5.5");
  });
});

describe("fixed 5.5 models stay pinnable while the aliases follow them (2026-11-28)", () => {
  const LIST = ["opus", "sonnet", "haiku", "opus[1m]", "sonnet[1m]", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-sonnet-5-5", "claude-sonnet-4-6", "claude-haiku-5-5", "claude-haiku-4-5-20251001"];
  const res = (family: string) => ({ resolvedModel: `claude-${family}-5-5`, resolvedModelSource: "sdkHandshake", resolvedDisplayVersion: "5.5" });
  const items = (current: string) => claudePickerItems(LIST.map((id) => ({ model: id, displayName: "", description: "", ...(id === "opus" || id === "sonnet" || id === "haiku" ? res(id) : {}) })), current, t);
  it("an alias selected: 更多 lists Opus / Sonnet / Haiku 5.5 fixed, newest first; the top keeps the alias rows with 跟随最新", () => {
    for (const current of ["opus", "sonnet", "haiku"]) {
      const rows = items(current);
      expect(rows.filter((r) => r.primary).map((r) => [r.model, r.displayName, r.tag])).toEqual([["opus", "Opus 5.5", "claudeModels.latestTag"], ["sonnet", "Sonnet 5.5", "claudeModels.latestTag"], ["haiku", "Haiku 5.5", "claudeModels.latestTag"]]);
      const more = rows.filter((r) => !r.primary);
      for (const fixed of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
        expect(more.some((r) => r.model === fixed)).toBe(true);
        expect(more.find((r) => r.model === fixed)?.tag).toBeUndefined();
      }
      expect(more.slice(0, 3).map((r) => r.model)).toEqual(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);
    }
  });
  it("picking the fixed row selects the concrete id; picking it makes it the selection the menu keeps on top", () => {
    const fixed = items("opus").find((r) => r.model === "claude-opus-5-5")!;
    expect(fixed.model).toBe("claude-opus-5-5");
    const after = items(fixed.model);
    expect(after.find((r) => r.model === "claude-opus-5-5")!.primary).toBe(true);
    expect(after.find((r) => r.model === "opus")!.tag).toBe("claudeModels.latestTag");
  });
});

describe("the answering model: tooltip only on a mismatch", () => {
  it("a version taken from this answer, or the same handshake version: nothing", () => {
    expect(answeringModelShown("claude-opus-5-5", "opus", null)).toBe(false);
    expect(answeringModelShown("claude-opus-5-5", "opus", { resolvedModel: "claude-opus-5-5", version: "5.5" })).toBe(false);
  });
  it("another version than the handshake label, or another family: named", () => {
    expect(answeringModelShown("claude-opus-4-8", "opus", { resolvedModel: "claude-opus-5-5", version: "5.5" })).toBe(true);
    expect(answeringModelShown("claude-sonnet-5-5", "opus", null)).toBe(true);
    expect(answeringModelShown("claude-opus-4-8", "claude-opus-5-5", null)).toBe(true);
  });
});
