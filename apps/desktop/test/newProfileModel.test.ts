// 新建 Profile, provider-first (P1): cards per capability set, login options and where they lead,
// address defaults / relay / restore / required, the requests sent to cutex per provider and login
// method, the summary line — and that an address never changes what a Profile can use (A2).
import { describe, expect, it } from "vitest";
import { addressSpecOf, addressState, choiceFor, choiceForPreset, createPlanOf, defaultChoice, providerCards, relayHost, resolveChoice, type NewProfileForm, type ProviderCard, type Resolved } from "../src/renderer/src/lib/newProfileModel";
import { addressHint, cardChips, cardRuntimes, optionLabel, summaryLine } from "../src/renderer/src/lib/newProfileText";
import { FALLBACK_PRESETS, presetsOf } from "../src/renderer/src/lib/profilePresets";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import type { MessageKey } from "../src/renderer/src/i18n";

const mp = (id: string, label: string, providerId: string, baseUrl: string | null, family: string | null, extra: Record<string, unknown> = {}) => ({ id, aliases: [], label, providerId, baseUrl, baseUrlRequired: baseUrl === null, defaultModel: null, providerFamily: family, providerFamilyLabel: null, ...extra });
/** cutex r266 `GET /v2/profile-presets` (src/profiles/providers.rs), trimmed to what the form reads. */
const R266 = presetsOf([
  mp("deepseek", "DeepSeek", "deepseek", "https://api.deepseek.com/", "deepseek", { defaultModel: "deepseek-v4-flash" }),
  mp("zai", "Z.ai (GLM Coding Plan)", "zai", "https://api.z.ai/api/v1", "zhipu", { aliases: ["glm", "z.ai"] }),
  mp("zhipu", "Zhipu BigModel (GLM Coding Plan)", "zhipu", "https://open.bigmodel.cn/api/v1", "zhipu", { aliases: ["bigmodel"] }),
  mp("moonshot", "Moonshot (Kimi)", "moonshot", "https://api.moonshot.ai/v1", "moonshot", { aliases: ["kimi"] }),
  mp("moonshot-cn", "Moonshot (Kimi, China)", "moonshot", "https://api.moonshot.cn/v1", "moonshot", { aliases: ["kimi-cn"] }),
  mp("kimi-code", "Kimi Code (membership plan)", "kimi-code", "https://api.kimi.ai/coding/v1", "kimi-code", { aliases: ["kimi-for-coding"] }),
  mp("kimi-code-cn", "Kimi Code (membership plan, China)", "kimi-code", "https://api.kimi.com/coding/v1", "kimi-code"),
  mp("minimax", "MiniMax", "minimax", "https://api.minimax.io/v1", "minimax"),
  mp("minimax-cn", "MiniMax (China)", "minimax", "https://api.minimaxi.com/v1", "minimax"),
  mp("xai", "xAI (Grok)", "xai", "https://api.x.ai/v1", "xai", { aliases: ["grok"] }),
  mp("openrouter", "OpenRouter", "openrouter", "https://openrouter.ai/api/v1", "openrouter"),
  mp("openai", "OpenAI API", "openai-api", "https://api.openai.com/v1", "openai-api"),
  mp("gemini", "Gemini (OpenAI-compatible relay)", "gemini", null, null, { aliases: ["google"] }),
  mp("custom", "Custom (OpenAI Responses compatible)", "custom", null, null),
])!;
const NONE = new Set<string>();
const ALL = new Set(["profile-create", "claude-accounts", "dsh-runtime"]);
const t = (key: MessageKey, vars?: Record<string, string | number>) => (zhCN[key] as string).replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`));

const ids = (cards: ProviderCard[]) => Object.fromEntries(cards.map((c) => [c.id, c.options.map((o) => o.id)]));
const card = (cards: ProviderCard[], id: string) => cards.find((c) => c.id === id)!;
function resolve(cards: ProviderCard[], cardId: string, optionId: string, group?: string, preset?: string): Resolved {
  const c = card(cards, cardId);
  const choice = choiceFor(c, c.options.find((o) => o.id === optionId)!, group);
  return resolveChoice(cards, preset ? { ...choice, preset } : choice)!;
}
const form = (patch: Partial<NewProfileForm> = {}): NewProfileForm => ({ name: "p", address: null, apiKey: "", model: "", color: null, ...patch });

describe("provider cards follow the host's presets and capabilities", () => {
  it("r266 with claude-accounts and dsh-runtime: every login method", () => {
    const cards = providerCards(R266, ALL);
    expect(ids(cards)).toEqual({
      openai: ["chatgpt", "apiKey"],
      anthropic: ["claudeSubscription", "anthropicKey"],
      deepseek: ["apiKey", "anthropicCompatible", "dshEnv"],
      kimi: ["apiKey:moonshot", "apiKey:kimi-code", "anthropicCompatible"],
      glm: ["apiKey", "anthropicCompatible"],
      gemini: ["apiKey"],
      more: ["apiKey"],
      custom: ["customOpenai", "customAnthropic"],
    });
    expect(card(cards, "deepseek").options.find((o) => o.id === "dshEnv")?.advanced).toBe(true);
    expect(card(cards, "more").options[0]!.groups.map((g) => [g.key, g.presets.map((p) => p.id)])).toEqual([["minimax", ["minimax", "minimax-cn"]], ["xai", ["xai"]], ["openrouter", ["openrouter"]]]);
    expect(card(cards, "deepseek").runtimes).toEqual(["codex", "claude", "dsh"]);
  });

  it("no claude-accounts: no Anthropic key options; no dsh-runtime: no host variable", () => {
    const cards = providerCards(R266, NONE);
    expect(ids(cards)).toMatchObject({ anthropic: ["claudeSubscription"], deepseek: ["apiKey"], kimi: ["apiKey:moonshot", "apiKey:kimi-code"], glm: ["apiKey"], custom: ["customOpenai"] });
    expect(card(cards, "deepseek").runtimes).toEqual(["codex"]);
  });

  it("an older cutex (built-in preset list): no Gemini card, Kimi = Moonshot only", () => {
    const cards = providerCards(FALLBACK_PRESETS, NONE);
    expect(cards.map((c) => c.id)).toEqual(["openai", "anthropic", "deepseek", "kimi", "glm", "more", "custom"]);
    expect(ids(cards).kimi).toEqual(["apiKey:moonshot"]);
    expect(card(cards, "glm").options[0]!.groups[0]!.presets.map((p) => p.id)).toEqual(["zai", "zhipu"]);
  });

  it("chips and the runtime line", () => {
    const cards = providerCards(R266, ALL);
    expect(cardChips(t, card(cards, "openai"))).toEqual(["ChatGPT 登录", "API key"]);
    expect(cardChips(t, card(cards, "kimi"))).toEqual(["API key", "Anthropic 兼容"]);
    expect(cardChips(t, card(cards, "more"))).toEqual(["MiniMax", "Grok", "OpenRouter"]);
    expect(cardRuntimes(t, card(cards, "gemini"))).toBe("cute-codex · 需填中转地址");
    expect(cardRuntimes(t, card(cards, "deepseek"))).toBe("cute-codex · Claude · DSH");
  });
});

describe("login options lead to one runtime each (P1: one runtime per Profile)", () => {
  it("each option's runtime and label", () => {
    const cards = providerCards(R266, ALL);
    const all = cards.flatMap((c) => c.options.map((o) => [`${c.id}/${o.id}`, o.runtime, optionLabel(t, o)]));
    expect(all).toEqual([
      ["openai/chatgpt", "codex", "ChatGPT 登录"],
      ["openai/apiKey", "codex", "API key"],
      ["anthropic/claudeSubscription", "claude", "Claude 订阅"],
      ["anthropic/anthropicKey", "claude", "API key"],
      ["deepseek/apiKey", "codex", "API key"],
      ["deepseek/anthropicCompatible", "claude", "Anthropic 兼容 key"],
      ["deepseek/dshEnv", "dsh", "主机环境变量"],
      ["kimi/apiKey:moonshot", "codex", "Moonshot 开放平台 API key"],
      ["kimi/apiKey:kimi-code", "codex", "Kimi Code 会员 API key"],
      ["kimi/anthropicCompatible", "claude", "Anthropic 兼容 key"],
      ["glm/apiKey", "codex", "API key"],
      ["glm/anthropicCompatible", "claude", "Anthropic 兼容 key"],
      ["gemini/apiKey", "codex", "API key"],
      ["more/apiKey", "codex", "API key"],
      ["custom/customOpenai", "codex", "OpenAI 兼容"],
      ["custom/customAnthropic", "claude", "Anthropic 兼容"],
    ]);
  });

  it("default choice: the first non-advanced option, its first key kind and region; initialPreset finds its card", () => {
    const cards = providerCards(R266, ALL);
    expect(defaultChoice(card(cards, "glm"))).toEqual({ card: "glm", option: "apiKey", group: "zhipu", preset: "zai" });
    expect(choiceForPreset(cards, "kimi-code-cn")).toEqual({ card: "kimi", option: "apiKey:kimi-code", group: "kimi-code", preset: "kimi-code-cn" });
    expect(choiceForPreset(cards, "grok")).toEqual({ card: "more", option: "apiKey", group: "xai", preset: "xai" });
    expect(choiceForPreset(cards, "nope")).toBeNull();
  });

  it("a choice the host no longer offers falls back to the card's first option", () => {
    const cards = providerCards(R266, NONE);
    expect(resolveChoice(cards, { card: "anthropic", option: "anthropicKey", group: "", preset: "" })?.option.id).toBe("claudeSubscription");
    expect(resolveChoice(cards, { card: "nope" as never, option: "", group: "", preset: "" })).toBeNull();
  });
});

describe("address: official default, relay, restore, required", () => {
  const cards = providerCards(R266, ALL);

  it("API key: the preset's official URL; edited → relay; an official spelling is not a relay; emptied = official", () => {
    const r = resolve(cards, "deepseek", "apiKey");
    const spec = addressSpecOf(r)!;
    expect(spec).toEqual({ interface: "openai", official: "https://api.deepseek.com/", officialAlternates: ["https://api.deepseek.com/v1"], required: false });
    expect(addressState(spec, null)).toEqual({ value: "https://api.deepseek.com/", official: true, relay: false, missing: false, invalid: false });
    expect(addressState(spec, "https://relay.corp/deepseek/v1")).toMatchObject({ official: false, relay: true });
    expect(addressState(spec, "https://api.deepseek.com/v1/")).toMatchObject({ official: true, relay: false });
    expect(addressState(spec, "")).toMatchObject({ official: true, relay: false, missing: false });
    expect(addressState(spec, "relay.corp")).toMatchObject({ invalid: true });
    expect(addressHint(t, r, null)).toEqual({ text: "DeepSeek 官方地址；可以改成你自己的中转", restore: false });
    expect(addressHint(t, r, "https://relay.corp/v1")).toEqual({ text: "已改成中转 · 能用的运行时不变", restore: true });
    expect(addressHint(t, r, "")?.restore).toBe(true);
  });

  it("Gemini and custom have no official default: required", () => {
    for (const r of [resolve(cards, "gemini", "apiKey"), resolve(cards, "custom", "customOpenai"), resolve(cards, "custom", "customAnthropic")]) {
      const spec = addressSpecOf(r)!;
      expect(spec.official).toBeNull();
      expect(addressState(spec, null)).toMatchObject({ value: "", missing: true });
    }
    expect(addressHint(t, resolve(cards, "gemini", "apiKey"), null)?.text).toBe("Gemini 没有官方默认：填一个 OpenAI 兼容 的地址");
    expect(addressHint(t, resolve(cards, "custom", "customAnthropic"), null)?.text).toBe("自定义 没有官方默认：填一个 Anthropic 兼容 的地址");
  });

  it("Anthropic-compatible keys start from the provider's Anthropic address (by region / key kind)", () => {
    expect(addressSpecOf(resolve(cards, "deepseek", "anthropicCompatible"))?.official).toBe("https://api.deepseek.com/anthropic");
    expect(addressSpecOf(resolve(cards, "glm", "anthropicCompatible", "zhipu", "zhipu"))?.official).toBe("https://open.bigmodel.cn/api/anthropic");
    expect(addressSpecOf(resolve(cards, "glm", "anthropicCompatible", "zhipu", "zai"))?.official).toBe("https://api.z.ai/api/anthropic");
    expect(addressSpecOf(resolve(cards, "kimi", "anthropicCompatible", "moonshot", "moonshot-cn"))?.official).toBe("https://api.moonshot.cn/anthropic");
    expect(addressSpecOf(resolve(cards, "kimi", "anthropicCompatible", "kimi-code", "kimi-code-cn"))?.official).toBe("https://api.kimi.com/coding/");
    // No known Anthropic address: the owner fills it in.
    expect(addressSpecOf(resolve(cards, "kimi", "anthropicCompatible", "kimi-code", "kimi-code"))).toMatchObject({ official: null, required: true });
    expect(addressSpecOf(resolve(cards, "anthropic", "anthropicKey"))).toMatchObject({ interface: "anthropic", official: "https://api.anthropic.com", required: false });
  });

  it("logins and the host variable have no address", () => {
    for (const [c, o] of [["openai", "chatgpt"], ["anthropic", "claudeSubscription"], ["deepseek", "dshEnv"]] as const) expect(addressSpecOf(resolve(cards, c, o))).toBeNull();
  });
});

describe("requests sent to cutex, per provider and login method", () => {
  const cards = providerCards(R266, ALL);
  const plan = (r: Resolved, f: Partial<NewProfileForm>, existing: string[] = []) => createPlanOf(r, form(f), existing);

  it("ChatGPT login: the name only (model when typed)", () => {
    expect(plan(resolve(cards, "openai", "chatgpt"), { name: " gpt " })).toEqual({ plan: { account: null, profile: { name: "gpt", kind: "chatgpt" }, color: null } });
    expect(plan(resolve(cards, "openai", "chatgpt"), { name: "gpt", model: "gpt-5.5", color: "#123456" })).toEqual({ plan: { account: null, profile: { name: "gpt", kind: "chatgpt", model: "gpt-5.5" }, color: "#123456" } });
  });

  it("API key on the official address: preset id, key and model; no baseUrl", () => {
    expect(plan(resolve(cards, "deepseek", "apiKey"), { name: "ds", apiKey: " sk-1 ", model: "deepseek-v4-pro" })).toEqual({ plan: { account: null, profile: { name: "ds", kind: "apiKey", preset: "deepseek", apiKey: "sk-1", model: "deepseek-v4-pro" }, color: null } });
    // An official spelling and an emptied field are the official address too.
    expect(plan(resolve(cards, "deepseek", "apiKey"), { name: "ds", address: "https://api.deepseek.com/v1" })).toEqual({ plan: { account: null, profile: { name: "ds", kind: "apiKey", preset: "deepseek" }, color: null } });
    expect(plan(resolve(cards, "deepseek", "apiKey"), { name: "ds", address: "" })).toEqual({ plan: { account: null, profile: { name: "ds", kind: "apiKey", preset: "deepseek" }, color: null } });
  });

  it("API key through a relay (Example: Kimi Code key via relay): the preset stays, baseUrl added", () => {
    const r = resolve(cards, "kimi", "apiKey:kimi-code", "kimi-code", "kimi-code-cn");
    expect(plan(r, { name: "Example", address: "https://relay.example/kimi/v1", apiKey: "org-key" })).toEqual({ plan: { account: null, profile: { name: "Example", kind: "apiKey", preset: "kimi-code-cn", baseUrl: "https://relay.example/kimi/v1", apiKey: "org-key" }, color: null } });
    expect(relayHost(r, "https://relay.example/kimi/v1")).toBe("relay.example");
    expect(summaryLine(t, r, "https://relay.example/kimi/v1")).toBe("Kimi 中国大陆 · Kimi Code 会员 API key · 经 relay.example · 只用 cute-codex");
  });

  it("Gemini: preset + its required relay; custom OpenAI: baseUrl alone", () => {
    expect(plan(resolve(cards, "gemini", "apiKey"), { name: "g" })).toEqual({ error: "baseUrlMissing" });
    expect(plan(resolve(cards, "gemini", "apiKey"), { name: "g", address: "https://gem.example/v1" })).toEqual({ plan: { account: null, profile: { name: "g", kind: "apiKey", preset: "gemini", baseUrl: "https://gem.example/v1" }, color: null } });
    expect(plan(resolve(cards, "custom", "customOpenai"), { name: "c", address: "https://llm.example/v1" })).toEqual({ plan: { account: null, profile: { name: "c", kind: "apiKey", baseUrl: "https://llm.example/v1" }, color: null } });
    expect(plan(resolve(cards, "custom", "customOpenai"), { name: "c", address: "llm.example" })).toEqual({ error: "baseUrlInvalid" });
  });

  it("更多: the chosen provider and region", () => {
    expect(plan(resolve(cards, "more", "apiKey", "minimax", "minimax-cn"), { name: "mm" })).toEqual({ plan: { account: null, profile: { name: "mm", kind: "apiKey", preset: "minimax-cn" }, color: null } });
  });

  it("Anthropic API key: a Claude API account (key inline, x-api-key, no baseUrl on the official address), then the Claude Profile", () => {
    expect(plan(resolve(cards, "anthropic", "anthropicKey"), { name: "claude-api", apiKey: "sk-ant-1" })).toEqual({
      plan: { account: { label: "claude-api", kind: "api", keyEnv: "ANTHROPIC_API_KEY", apiKey: "sk-ant-1" }, profile: { name: "claude-api", kind: "claude" }, color: null },
    });
    expect(plan(resolve(cards, "anthropic", "anthropicKey"), { name: "claude-relay", address: "https://relay.example/anthropic" })).toEqual({
      plan: { account: { label: "claude-relay", kind: "api", keyEnv: "ANTHROPIC_API_KEY", baseUrl: "https://relay.example/anthropic" }, profile: { name: "claude-relay", kind: "claude" }, color: null },
    });
  });

  it("GLM Anthropic-compatible key: a Claude API account on GLM's Anthropic address (Bearer), even when the field was emptied", () => {
    const r = resolve(cards, "glm", "anthropicCompatible", "zhipu", "zhipu");
    const expected = { plan: { account: { label: "glm-claude", kind: "api", keyEnv: "ANTHROPIC_AUTH_TOKEN", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKey: "k" }, profile: { name: "glm-claude", kind: "claude", model: "glm-5.3" }, color: null } };
    expect(plan(r, { name: "glm-claude", apiKey: "k", model: "glm-5.3" })).toEqual(expected);
    expect(plan(r, { name: "glm-claude", apiKey: "k", model: "glm-5.3", address: "" })).toEqual(expected);
    expect(summaryLine(t, r, null)).toBe("智谱 GLM 中国大陆 · Anthropic 兼容 key · 只用 Claude");
    expect(plan(r, { name: "default" })).toEqual({ error: "accountLabelInvalid" });
  });

  it("custom Anthropic-compatible: address required", () => {
    const r = resolve(cards, "custom", "customAnthropic");
    expect(plan(r, { name: "x" })).toEqual({ error: "baseUrlMissing" });
    expect(plan(r, { name: "x", address: "https://relay.example" })).toMatchObject({ plan: { account: { baseUrl: "https://relay.example", keyEnv: "ANTHROPIC_AUTH_TOKEN" }, profile: { kind: "claude" } } });
    expect(summaryLine(t, r, "https://relay.example")).toBe("自定义 · Anthropic 兼容 · 经 relay.example · 只用 Claude");
  });

  it("Claude subscription: the account select (default = left out)", () => {
    const r = resolve(cards, "anthropic", "claudeSubscription");
    expect(plan(r, { name: "c", claudeAccount: "default" })).toEqual({ plan: { account: null, profile: { name: "c", kind: "claude" }, color: null } });
    expect(plan(r, { name: "c", claudeAccount: "ca-work123456" })).toEqual({ plan: { account: null, profile: { name: "c", kind: "claude", claudeAccount: "ca-work123456" }, color: null } });
  });

  it("DeepSeek host variable: the legacy DSH-kind Profile (no key, no address, fixed model)", () => {
    expect(plan(resolve(cards, "deepseek", "dshEnv"), { name: "dsh-team", apiKey: "ignored", model: "ignored" })).toEqual({
      plan: { account: null, profile: { name: "dsh-team", kind: "dsh", options: { dsh: { model: "deepseek-v4-flash", apiKeyEnv: "DEEPSEEK_API_KEY" } } }, color: null },
    });
  });

  it("name errors come first", () => {
    const r = resolve(cards, "openai", "chatgpt");
    expect(plan(r, { name: " " })).toEqual({ error: "nameEmpty" });
    expect(plan(r, { name: "a/b" })).toEqual({ error: "nameInvalid" });
    expect(plan(r, { name: "GPT" }, ["gpt"])).toEqual({ error: "nameTaken" });
  });

  it("a relay never changes the options or the runtime (A2)", () => {
    for (const host of [NONE, ALL]) {
      const before = providerCards(R266, host);
      for (const c of before)
        for (const o of c.options) {
          const r = resolveChoice(before, choiceFor(c, o))!;
          const official = createPlanOf(r, form({ name: "n", address: null }), []);
          const relayed = createPlanOf(r, form({ name: "n", address: "https://relay.example/v1" }), []);
          if ("plan" in official && "plan" in relayed) expect(relayed.plan.profile.kind).toBe(official.plan.profile.kind);
          expect(summaryLine(t, r, "https://relay.example/v1")).toContain(`只用 ${({ codex: "cute-codex", claude: "Claude", dsh: "DSH", kimi: "Kimi" } as const)[o.runtime]}`);
        }
      // The cards don't depend on any address at all.
      expect(providerCards(R266, host)).toEqual(before);
    }
  });
});
