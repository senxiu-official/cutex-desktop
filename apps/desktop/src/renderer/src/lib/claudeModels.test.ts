import { describe, expect, it } from "vitest";
import { claudeCatalogChoices, claudeIdInfo, claudeShortName, foldClaudeModels, foldedRowFor, looksClaude } from "./claudeModels";

// The adapter's reference list (model_catalog.json 2026-10-18), in its order.
const REFERENCE = [
  "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-haiku-5-5", "claude-opus-5", "claude-sonnet-5", "claude-fable-5",
  "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-5-20251101",
  "claude-sonnet-4-5-20250929", "sonnet", "opus", "haiku", "fable", "best", "opusplan", "sonnet[1m]", "opus[1m]", "default",
];
const NAMES: Record<string, string> = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-fable-5-1": "Fable 5.1", "claude-haiku-5-5": "Haiku 5.5", sonnet: "Sonnet (alias)", opus: "Opus (alias)" };
const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}${JSON.stringify(vars)}` : key);
const ids = (rows: { item: string }[]) => rows.map((r) => r.item);

describe("claude model ids", () => {
  it("tells aliases, fixed ids, [1m] forms and modes apart", () => {
    expect(claudeIdInfo("opus")).toMatchObject({ kind: "alias", family: "opus", oneM: false });
    expect(claudeIdInfo("sonnet[1m]")).toMatchObject({ kind: "alias", family: "sonnet", oneM: true });
    expect(claudeIdInfo("claude-haiku-4-5-20251001")).toMatchObject({ kind: "pinned", family: "haiku", version: [4, 5] });
    expect(claudeIdInfo("claude-opus-5")).toMatchObject({ kind: "pinned", version: [5, 0] });
    expect(claudeIdInfo("claude-sonnet-4-6[1m]")).toMatchObject({ kind: "pinned", oneM: true });
    expect(claudeIdInfo("opusplan")).toMatchObject({ kind: "mode", mode: "opusplan" });
    expect(claudeIdInfo("gpt-5.6-sol").kind).toBe("other");
    expect(looksClaude(["gpt-5.5"])).toBe(false);
    expect(looksClaude(REFERENCE)).toBe(true);
  });
});

describe("foldClaudeModels", () => {
  const rows = foldClaudeModels(REFERENCE, (id) => id, (id) => NAMES[id], "sonnet");

  it("keeps one row per real model: the family aliases stand for their newest model", () => {
    const primary = rows.filter((r) => r.primary);
    expect(ids(primary)).toEqual(["opus", "sonnet", "fable", "haiku"]);
    expect(primary.map((r) => r.name)).toEqual(["Opus 5.5", "Sonnet 5.5", "Fable 5.1", "Haiku 5.5"]);
    expect(rows.find((r) => r.item === "opus")!.folded).toEqual(["claude-opus-5-5", "opus[1m]"]);
    // 23 ids → 23 − 4 newest fixed ids − 2 [1m] aliases.
    expect(rows).toHaveLength(17);
    for (const gone of ["claude-opus-5-5", "claude-sonnet-5-5", "opus[1m]", "sonnet[1m]"]) expect(ids(rows)).not.toContain(gone);
  });

  it("lists older models newest first per family, then the modes", () => {
    const more = ids(rows.filter((r) => !r.primary));
    expect(more.slice(0, 5)).toEqual(["claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5-20251101"]);
    expect(more.slice(-3)).toEqual(["best", "opusplan", "default"]);
  });

  it("never folds away the current selection; it moves up among the primaries", () => {
    const pinned = foldClaudeModels(REFERENCE, (id) => id, (id) => NAMES[id], "claude-opus-5-5");
    const row = pinned.find((r) => r.item === "claude-opus-5-5")!;
    expect(row.primary).toBe(true);
    expect(pinned.find((r) => r.item === "opus")!.folded).toEqual(["opus[1m]"]);
    const old = foldClaudeModels(REFERENCE, (id) => id, () => null, "claude-sonnet-4-6");
    expect(old.filter((r) => r.primary).map((r) => r.item)).toContain("claude-sonnet-4-6");
  });

  it("labels [1m] forms of fixed ids and keeps unknown ids", () => {
    const extra = foldClaudeModels([...REFERENCE, "claude-sonnet-4-6[1m]", "my-proxy-model"], (id) => id, (id) => NAMES[id], "sonnet");
    const oneM = extra.find((r) => r.item === "claude-sonnet-4-6[1m]")!;
    expect(oneM).toMatchObject({ name: "Sonnet 4.6", tag: "oneM", primary: false });
    expect(extra.at(-1)).toMatchObject({ item: "my-proxy-model", name: "my-proxy-model" });
  });

  it("without fixed ids (old adapters' alias list) the aliases stay, named by family", () => {
    const legacy = foldClaudeModels(["opus", "sonnet", "haiku", "opus[1m]", "sonnet[1m]"], (id) => id, () => null, "sonnet");
    expect(legacy.map((r) => [r.item, r.name])).toEqual([["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]]);
  });

  it("finds the row an id folded into, and short names for the chip", () => {
    expect(foldedRowFor(rows, (id) => id, "opus[1m]")!.item).toBe("opus");
    const list = REFERENCE.map((id) => ({ id, displayName: NAMES[id] ?? null }));
    expect(claudeShortName(list, "sonnet", t as never)).toBe("Sonnet 5.5");
    expect(claudeShortName(list, "opus[1m]", t as never)).toBe('claudeModels.oneMName{"model":"Opus 5.5"}');
    expect(claudeShortName(list, "default", t as never)).toBe("claudeModels.default");
    const choices = claudeCatalogChoices(list, "sonnet", t as never);
    expect(choices[0]).toMatchObject({ id: "opus", name: "Opus 5.5", primary: true });
    expect(choices[0]!.description).toContain("claudeModels.latest");
  });
});
