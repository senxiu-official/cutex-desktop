import { describe, expect, it } from "vitest";
import type { UsagePrices, UsageReport } from "../src/shared/ipc";
import { buildModelMap, manualNames, mapDrafts, mapProblems, mapSuggestions, MAX_MODEL_MAP, pricedAsByName } from "../src/renderer/src/modules/usage/modelMap";
import { withShownModels } from "../src/renderer/src/modules/usage/models";
import { mock } from "../src/renderer/src/modules/usage/mock";

const amounts = { turns: 1, requests: 1, input: 10, cachedInput: 0, cacheWriteInput: 0, output: 1, reasoningOutput: 0, total: 11 };
const prices: UsagePrices = {
  currency: "USD",
  models: { "glm-5.3": { input: 0.6, output: 2.2, aliases: ["GLM-5.3-Turbo"] } },
  modelMap: { "gemini-3.8-flash-tiere": "gemini-3.8-flash" },
};

describe("usage price table: 按另一个模型计价 (usage-model-map)", () => {
  it("round-trips the stored map and drops empty rows on save", () => {
    const rows = mapDrafts(prices);
    expect(rows).toEqual([{ from: "gemini-3.8-flash-tiere", to: "gemini-3.8-flash" }]);
    expect(buildModelMap([...rows, { from: " sonnet ", to: "claude-sonnet-4-5" }, { from: "", to: "" }])).toEqual({
      "gemini-3.8-flash-tiere": "gemini-3.8-flash",
      sonnet: "claude-sonnet-4-5",
    });
    expect(mapDrafts({ currency: "USD", models: {} })).toEqual([]);
  });

  it("flags what cutex would refuse: self, duplicate (ignoring case), chains, priced names, half rows", () => {
    const manual = manualNames(prices.models);
    expect(manual).toEqual(new Set(["glm-5.3", "glm-5.3-turbo"]));
    const problems = mapProblems(
      [
        { from: "a", to: "A" },
        { from: "x", to: "y" },
        { from: "X", to: "z" },
        { from: "y", to: "w" },
        { from: "glm-5.3-turbo", to: "glm-5.3" },
        { from: "sonnet", to: "" },
        { from: "", to: "" },
        { from: "opus", to: "claude-opus-5-5" },
      ],
      manual,
    );
    expect(Object.fromEntries(problems)).toEqual({ 0: "self", 1: "chain", 2: "duplicate", 4: "priced", 5: "empty" });
    const many = Array.from({ length: MAX_MODEL_MAP + 1 }, (_, i) => ({ from: `m${i}`, to: "t" }));
    expect([...mapProblems(many, []).entries()]).toEqual([[MAX_MODEL_MAP, "tooMany"]]);
  });

  it("suggests unpriced models first as sources and priced models as targets", () => {
    const s = mapSuggestions(["gemini-3.8-pro-tiere", "sonnet"], ["gpt-5.5", "sonnet", "gemini-3.8-pro-tiere", "glm-5.3", "gemini-3.8-flash-tiere"], prices, mapDrafts(prices));
    expect(s.from).toEqual(["gemini-3.8-pro-tiere", "sonnet", "gpt-5.5"]);
    expect(s.to).toEqual(["glm-5.3", "gpt-5.5"]);
  });

  it("collects pricedAs per shown model name, also when display names merge ids", () => {
    const report: UsageReport = {
      from: "2026-10-01", to: "2026-10-02", groupBy: ["day", "model"], recordingSince: null, warnings: [], totals: amounts,
      rows: [
        { key: { day: "2026-10-01", model: "gemini-3.8-flash-tiere" }, ...amounts, pricedAs: ["gemini-3.8-flash"] },
        { key: { day: "2026-10-02", model: "Gemini-3.8-Flash-Tiere" }, ...amounts, pricedAs: ["gemini-3.8-flash"] },
        { key: { day: "2026-10-02", model: "gpt-5.5" }, ...amounts },
      ],
    };
    const shown = withShownModels(report, (id) => (id.toLowerCase() === "gemini-3.8-flash-tiere" ? "Gemini Flash (relay)" : id));
    const byName = pricedAsByName(shown.report.rows, (row) => row.key.model ?? "—");
    expect([...byName]).toEqual([["Gemini Flash (relay)", ["gemini-3.8-flash"]]]);
  });

  it("mock: mapped rows carry pricedAs, a PUT without modelMap keeps the map", async () => {
    const api = mock.api!({} as never) as Required<ReturnType<NonNullable<typeof mock.api>>>;
    const r = (await api.usage({ from: "2026-10-01", to: "2026-10-07", groupBy: ["model"] } as never))!;
    const mapped = r.rows.find((row) => row.key.model === "gemini-3.8-flash-tiere");
    expect(mapped?.pricedAs).toEqual(["gemini-3.8-flash"]);
    expect(r.unpricedModels?.map((m) => m.model)).toEqual(["gemini-3.8-pro-tiere"]);
    const stored = await api.usagePrices();
    await api.putUsagePrices({ currency: stored.currency, models: stored.models });
    expect((await api.usagePrices()).modelMap).toEqual(stored.modelMap);
    await api.putUsagePrices({ ...stored, modelMap: { ...stored.modelMap, "gemini-3.8-pro-tiere": "gpt-5.5" } });
    const after = (await api.usage({ from: "2026-10-01", to: "2026-10-07", groupBy: ["model"] } as never))!;
    expect(after.unpricedModels).toEqual([]);
    await api.putUsagePrices(stored);
  });
});

describe("mapSuggestions with names missing", () => {
  it("skips null / empty model names (cutex reports rows without a model as model null)", () => {
    const prices = { currency: "USD", models: { "gpt-5.5": { input: 1, output: 2 } } } as never;
    const s = mapSuggestions([null as unknown as string, "x-tiere"], ["", "gpt-5.5"], prices, [{ from: "", to: "" }]);
    expect(s.from).toEqual(["x-tiere"]);
    expect(s.to).toEqual(["gpt-5.5"]);
  });
});
