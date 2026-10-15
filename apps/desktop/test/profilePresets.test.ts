import { describe, expect, it } from "vitest";
import { profileKindLabel } from "../src/renderer/src/lib/profileCards";
import { createRequestOf } from "../src/renderer/src/lib/profileCreate";
import { baseUrlState, createUrlState, FALLBACK_PRESETS, officialPresetOf, officialPresets, presetById, presetsOf, relayPresets, sameUrl } from "../src/renderer/src/lib/profilePresets";

const presets = FALLBACK_PRESETS;
const id = (url: string | null) => officialPresetOf(url, presets)?.id ?? null;

describe("official or custom: by the base URL host, never the provider name", () => {
  it("knows the official hosts", () => {
    expect(id("https://open.bigmodel.cn/api/coding/paas/v4")).toBe("zhipu");
    expect(id("https://api.z.ai/api/coding/paas/v4")).toBe("zai");
    expect(id("https://api.moonshot.ai/v1")).toBe("moonshot");
    expect(id("https://api.moonshot.cn/v1")).toBe("moonshot"); // China endpoint
    expect(id("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(id("https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(id("https://api.openai.com/v1")).toBe("openai");
    // Another host of the provider's own domain (cutex family_for_host).
    expect(id("https://beta.deepseek.com/v1")).toBe("deepseek");
  });

  it("relays, look-alikes and unknown hosts are custom", () => {
    expect(id("https://api.example-relay.com/v1")).toBeNull();
    expect(id("https://relay.example.net/v1")).toBeNull();
    expect(id("https://evil-z.ai.example.com/v1")).toBeNull();
    expect(id("http://127.0.0.1:8080/v1")).toBeNull();
    expect(id("not a url")).toBeNull();
    expect(id(null)).toBeNull();
  });

  it("a GLM-named profile on a third-party relay is custom with nothing to restore", () => {
    const zeta = baseUrlState("https://api.example-relay.com/v1", presets, { stored: "https://api.example-relay.com/v1", family: "zhipu" });
    expect(zeta).toEqual({ official: false, preset: null, restore: null });
    // Its card says custom too, whatever cutex's family says (unknown host → provider id → zhipu).
    expect(profileKindLabel({ cliKind: "codex", authKind: "apiKey", baseUrl: "https://api.example-relay.com/v1", providerFamily: "zhipu" }, "自定义")).toBe("API Key · 自定义");
  });

  it("official URLs: label, and 恢复官方地址 only when the path is not an official one", () => {
    const zhipu = baseUrlState("https://open.bigmodel.cn/api/coding/paas/v4", presets, { stored: "https://open.bigmodel.cn/api/coding/paas/v4" });
    expect(zhipu.official).toBe(true);
    expect(zhipu.preset?.id).toBe("zhipu");
    expect(zhipu.restore).toBeNull();
    // Moonshot's China endpoint is official as well (no restore to .ai).
    expect(baseUrlState("https://api.moonshot.cn/v1", presets, { stored: "https://api.moonshot.cn/v1" })).toMatchObject({ official: true, restore: null });
    // DeepSeek with or without /v1, trailing slash or not.
    expect(baseUrlState("https://api.deepseek.com", presets).restore).toBeNull();
    // Official host, other path: offer the preset's URL.
    expect(baseUrlState("https://api.z.ai/api/paas/v4", presets, { stored: "https://api.z.ai/api/paas/v4" })).toMatchObject({ official: true, restore: "https://api.z.ai/api/coding/paas/v4" });
    expect(profileKindLabel({ cliKind: "codex", authKind: "apiKey", baseUrl: "https://api.moonshot.cn/v1" }, "自定义")).toBe("API Key · Kimi");
  });

  it("an official profile edited to a relay offers its saved official URL back", () => {
    const edited = baseUrlState("https://api.example-relay.com/v1", presets, { stored: "https://api.moonshot.cn/v1" });
    expect(edited).toMatchObject({ official: false, restore: "https://api.moonshot.cn/v1" });
    expect(edited.preset?.id).toBe("moonshot");
    // Emptied: same.
    expect(baseUrlState("", presets, { stored: "https://api.deepseek.com/" }).restore).toBe("https://api.deepseek.com/");
  });

  it("no URL at all: cutex's family decides (custom families never)", () => {
    expect(baseUrlState(null, presets, { family: "deepseek" })).toMatchObject({ official: false, restore: "https://api.deepseek.com/" });
    expect(baseUrlState(null, presets, { family: "custom:api.example-relay.com" })).toEqual({ official: false, preset: null, restore: null });
    expect(profileKindLabel({ cliKind: "codex", authKind: "apiKey", baseUrl: null, providerFamily: "zhipu" }, "自定义")).toBe("API Key · GLM");
  });
});

describe("create form", () => {
  const existing = ["deepseek"];
  const req = (preset: string, baseUrl: string) => createRequestOf({ name: "p", kind: "apiKey", preset, baseUrl }, existing, presets);

  it("official preset untouched (or emptied): preset only", () => {
    expect(req("zai", "https://api.z.ai/api/coding/paas/v4")).toEqual({ request: { name: "p", kind: "apiKey", preset: "zai" } });
    expect(req("deepseek", "https://api.deepseek.com")).toEqual({ request: { name: "p", kind: "apiKey", preset: "deepseek" } });
    expect(req("zai", "  ")).toEqual({ request: { name: "p", kind: "apiKey", preset: "zai" } });
  });

  it("edited: preset + baseUrl (cutex's URL replaces the preset's)", () => {
    expect(req("moonshot", "https://api.moonshot.cn/v1")).toEqual({ request: { name: "p", kind: "apiKey", preset: "moonshot", baseUrl: "https://api.moonshot.cn/v1" } });
    expect(req("zai", " https://api.example-relay.com/v1 ")).toEqual({ request: { name: "p", kind: "apiKey", preset: "zai", baseUrl: "https://api.example-relay.com/v1" } });
    expect(req("zai", "example-relay.com")).toEqual({ error: "baseUrlInvalid" });
  });

  it("custom: baseUrl required, no preset", () => {
    expect(req("", "")).toEqual({ error: "baseUrlMissing" });
    expect(req("", "api.example-relay.com/v1")).toEqual({ error: "baseUrlInvalid" });
    expect(req("", "https://api.example-relay.com/v1")).toEqual({ request: { name: "p", kind: "apiKey", baseUrl: "https://api.example-relay.com/v1" } });
    // cutex's own `custom` preset (no URL) is custom as well.
    expect(req("custom", "")).toEqual({ error: "baseUrlMissing" });
  });

  it("hint state: official / edited / other official endpoints in one click", () => {
    const moonshot = presetById("kimi", presets)!;
    expect(moonshot.id).toBe("moonshot");
    const fresh = createUrlState(moonshot, "https://api.moonshot.ai/v1", presets);
    expect(fresh).toMatchObject({ official: true, restore: null });
    expect(fresh.choices.map((c) => c.url)).toEqual(["https://api.moonshot.cn/v1"]);
    const cn = createUrlState(moonshot, "https://api.moonshot.cn/v1", presets);
    expect(cn.official).toBe(true);
    expect(cn.choices.map((c) => c.url)).toEqual(["https://api.moonshot.ai/v1"]);
    expect(createUrlState(moonshot, "https://api.example-relay.com/v1", presets)).toMatchObject({ official: false, restore: "https://api.moonshot.ai/v1" });
    // GLM: Z.ai and 智谱 BigModel point at each other.
    const zai = createUrlState(presetById("zai", presets), "https://api.z.ai/api/coding/paas/v4", presets);
    expect(zai.choices.map((c) => [c.preset.id, c.region])).toEqual([["zhipu", "cn"]]);
    // DeepSeek's /v1 spelling is not offered as another endpoint.
    expect(createUrlState(presetById("deepseek", presets), "https://api.deepseek.com/", presets).choices).toEqual([]);
    expect(createUrlState(null, "", presets)).toEqual({ official: false, restore: null, choices: [] });
  });
});

describe("presets from cutex", () => {
  it("keeps well-formed items, falls back when there are none", () => {
    expect(presetsOf(null)).toBeNull();
    expect(presetsOf([{ label: "no id" }])).toBeNull();
    const list = presetsOf([
      { id: "deepseek", aliases: [], label: "DeepSeek", providerId: "deepseek", baseUrl: "https://api.deepseek.com/", baseUrlRequired: false, defaultModel: "deepseek-v4-flash", providerFamily: "deepseek", providerFamilyLabel: "DeepSeek", autoQuota: true },
      { id: "custom", label: "Custom", baseUrl: null, baseUrlRequired: true },
      "junk",
    ])!;
    expect(list.map((p) => p.id)).toEqual(["deepseek", "custom"]);
    expect(officialPresets(list).map((p) => p.id)).toEqual(["deepseek"]);
    expect(list[1]).toMatchObject({ aliases: [], providerId: "custom", baseUrlRequired: true, providerFamily: null });
    // r222 `autoQuota` survives; absent (r221) stays absent, so the form says nothing about quota.
    expect(list[0]!.autoQuota).toBe(true);
    expect("autoQuota" in list[1]!).toBe(false);
    expect(FALLBACK_PRESETS.some((p) => "autoQuota" in p)).toBe(false);
    // profile-generic-switches `quotaReader`: kept (string or null), absent on older cutex.
    const readers = presetsOf([{ id: "a", baseUrl: "https://relay.example/v1", quotaReader: "usage_endpoint" }, { id: "b", baseUrl: "https://relay.example/v2", quotaReader: null }, { id: "c", baseUrl: "https://relay.example/v3" }])!;
    expect(readers.map((p) => p.quotaReader)).toEqual(["usage_endpoint", null, undefined]);
    expect("quotaReader" in readers[2]!).toBe(false);
  });

  it("the built-in list mirrors cutex's ids, aliases and official URLs", () => {
    expect(FALLBACK_PRESETS.map((p) => p.id)).toEqual(["deepseek", "zai", "zhipu", "moonshot", "openrouter", "openai", "custom"]);
    expect(presetById("glm", presets)?.id).toBe("zai");
    expect(presetById("BigModel", presets)?.id).toBe("zhipu");
    expect(officialPresets(presets).every((p) => p.baseUrl?.startsWith("https://"))).toBe(true);
  });

  it("compares endpoints, not spellings", () => {
    expect(sameUrl("https://API.deepseek.com/", "https://api.deepseek.com")).toBe(true);
    expect(sameUrl("https://api.moonshot.ai/v1", "https://api.moonshot.cn/v1")).toBe(false);
    expect(sameUrl("http://x.test/v1", "https://x.test/v1")).toBe(false);
  });
});

describe("relay presets (cutex gemini)", () => {
  const gemini = { id: "gemini", aliases: ["google"], label: "Gemini (OpenAI-compatible relay)", providerId: "gemini", baseUrl: null, baseUrlRequired: true, defaultModel: "gemini-3.8-flash-tiered", providerFamily: null, providerFamilyLabel: null };
  const served = presetsOf([...FALLBACK_PRESETS.slice(0, -1), gemini, FALLBACK_PRESETS[FALLBACK_PRESETS.length - 1]])!;

  it("are listed apart from the official providers and 自定义", () => {
    expect(relayPresets(served).map((p) => p.id)).toEqual(["gemini"]);
    expect(officialPresets(served).some((p) => p.id === "gemini")).toBe(false);
    expect(relayPresets(FALLBACK_PRESETS)).toEqual([]);
  });

  it("create: the preset id plus the relay URL (required)", () => {
    const form = { name: "gem", kind: "apiKey" as const, preset: "gemini" };
    expect(createRequestOf({ ...form, baseUrl: " https://relay.example.com/v1 " }, [], served)).toEqual({ request: { name: "gem", kind: "apiKey", preset: "gemini", baseUrl: "https://relay.example.com/v1" } });
    expect(createRequestOf({ ...form, baseUrl: "" }, [], served)).toEqual({ error: "baseUrlMissing" });
    expect(createRequestOf({ ...form, baseUrl: "relay" }, [], served)).toEqual({ error: "baseUrlInvalid" });
    // 自定义 (explicit `custom` id too) stays a bare base URL.
    expect(createRequestOf({ ...form, preset: "custom", baseUrl: "https://relay.example.com/v1" }, [], served)).toEqual({ request: { name: "gem", kind: "apiKey", baseUrl: "https://relay.example.com/v1" } });
    expect(createUrlState(presetById("gemini", served), "https://relay.example.com/v1", served)).toEqual({ official: false, restore: null, choices: [] });
  });
});

describe("cutex profile-presets-v2 list", () => {
  const raw = [
    { id: "deepseek", label: "DeepSeek", providerId: "deepseek", baseUrl: "https://api.deepseek.com/", defaultModel: "deepseek-flash", providerFamily: "deepseek", autoQuota: true, modelCatalog: true, webSearch: "disabled" },
    { id: "zai", aliases: ["glm"], label: "Z.ai (GLM Coding Plan)", providerId: "zai", baseUrl: "https://api.z.ai/api/v1", defaultModel: "glm-5.3", providerFamily: "zhipu", autoQuota: true, modelCatalog: true, webSearch: null },
    { id: "zhipu", label: "Zhipu BigModel (GLM Coding Plan)", providerId: "zhipu", baseUrl: "https://open.bigmodel.cn/api/v1", providerFamily: "zhipu", modelCatalog: true, webSearch: null },
    { id: "moonshot", aliases: ["kimi"], label: "Moonshot (Kimi)", providerId: "moonshot", baseUrl: "https://api.moonshot.ai/v1", providerFamily: "moonshot", modelCatalog: true },
    { id: "moonshot-cn", aliases: ["kimi-cn"], label: "Moonshot (Kimi, China)", providerId: "moonshot", baseUrl: "https://api.moonshot.cn/v1", providerFamily: "moonshot", modelCatalog: true },
    { id: "minimax", label: "MiniMax", providerId: "minimax", baseUrl: "https://api.minimax.io/v1", providerFamily: "minimax", modelCatalog: true },
    { id: "minimax-cn", label: "MiniMax (China)", providerId: "minimax", baseUrl: "https://api.minimaxi.com/v1", providerFamily: "minimax", modelCatalog: true },
    { id: "xai", label: "xAI (Grok)", providerId: "xai", baseUrl: "https://api.x.ai/v1", providerFamily: "xai", modelCatalog: true, webSearch: "disabled" },
    { id: "custom", label: "Custom", providerId: "custom", baseUrl: null, baseUrlRequired: true },
  ];
  const v2 = presetsOf(raw)!;
  const v2id = (url: string) => officialPresetOf(url, v2)?.id ?? null;

  it("reads modelCatalog / webSearch (absent stays absent)", () => {
    expect(presetById("deepseek", v2)).toMatchObject({ modelCatalog: true, webSearch: "disabled", defaultModel: "deepseek-flash" });
    expect(presetById("zai", v2)).toMatchObject({ modelCatalog: true, webSearch: null });
    expect("webSearch" in presetById("moonshot", v2)!).toBe(false);
    expect("modelCatalog" in presetById("custom", v2)!).toBe(false);
  });

  it("a preset that owns a URL wins over another preset's alternate", () => {
    expect(v2id("https://api.moonshot.cn/v1")).toBe("moonshot-cn");
    expect(v2id("https://api.moonshot.ai/v1")).toBe("moonshot");
    expect(v2id("https://api.minimaxi.com/v1")).toBe("minimax-cn");
    expect(v2id("https://api.minimax.io/v1")).toBe("minimax");
    expect(v2id("https://api.x.ai/v1")).toBe("xai");
    expect(v2id("https://api.z.ai/api/v1")).toBe("zai");
  });

  it("the create form offers each other official endpoint once", () => {
    const moonshot = createUrlState(presetById("moonshot", v2), "", v2);
    expect(moonshot.choices.map((c) => [c.preset.id, c.url])).toEqual([["moonshot-cn", "https://api.moonshot.cn/v1"]]);
    const minimax = createUrlState(presetById("minimax-cn", v2), "", v2);
    expect(minimax.choices.map((c) => [c.preset.id, c.region])).toEqual([["minimax", "intl"]]);
    expect(profileKindLabel({ cliKind: "codex", authKind: "apiKey", baseUrl: "https://api.x.ai/v1" }, "自定义", v2)).toBe("API Key · Grok");
  });
});
