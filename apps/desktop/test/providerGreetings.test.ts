import { expect, it } from "vitest";
import { providerGreetings } from "../src/renderer/src/lib/providerGreetings";
import greetings from "../src/renderer/src/lib/launchGreetings.json";
import { profileProvider, type Provider } from "../src/renderer/src/lib/provider";

it("imports all six bilingual sources and keeps each known provider in its own pool", () => {
  expect(Object.values(greetings).map((rows) => rows.length)).toEqual([40, 40, 40, 40, 40, 40]);
  for (const provider of ["kimi", "deepseek", "glm", "codex", "claude", "gemini"] as const) {
    for (let minute = 0; minute < 1440; minute++) {
      const zh = providerGreetings(provider, "zh-CN", minute);
      expect(zh.length).toBeGreaterThan(0);
      expect(zh.every((text) => greetings[provider].some((row) => row.zh === text) && text.includes("{name}"))).toBe(true);
    }
    expect(providerGreetings(provider, "en", 900).every((text) => text.includes("{name}") && !/[\u4e00-\u9fff]/.test(text))).toBe(true);
  }
});

it("uses GLM for Z.ai and the combined eligible pool for other providers", () => {
  expect(providerGreetings("zai", "en", 900)).toEqual(providerGreetings("glm", "en", 900));
  const combined = (["kimi", "deepseek", "glm", "codex", "claude", "gemini"] as Provider[]).flatMap((p) => providerGreetings(p, "zh-CN", 900));
  expect(providerGreetings(null, "zh-CN", 900)).toEqual(combined);
  expect(providerGreetings("openrouter", "zh-CN", 900)).toEqual(combined);
});

it("honors cutex's explicit other category even when the profile name looks like a known provider", () => {
  const provider = profileProvider({ name: "deepseek", cliKind: "codex", authKind: "apiKey", baseUrl: "https://api.deepseek.com/v1", appearance: { providerCategory: "other", color: null, effectiveColor: null } });
  expect(provider).toBeNull();
  expect(providerGreetings(provider, "zh-CN", 900)).toEqual(providerGreetings(null, "zh-CN", 900));
});

it("honors inclusive source minute endings and cross-midnight ranges", () => {
  const late = greetings.codex[39]!.zh;
  const early = greetings.codex[20]!.zh;
  expect(providerGreetings("codex", "zh-CN", 299)).toContain(late);
  expect(providerGreetings("codex", "zh-CN", 300)).not.toContain(late);
  expect(providerGreetings("codex", "zh-CN", 300)).toContain(early);
  expect(providerGreetings("codex", "zh-CN", 599)).toContain(early);
  expect(providerGreetings("codex", "zh-CN", 600)).not.toContain(early);
  expect(providerGreetings("codex", "zh-CN", 1320)).toContain(late);
});

it("finds Gemini on a relay profile by its model when cutex says other", () => {
  const relay: Parameters<typeof profileProvider>[0] = { name: "My Relay", cliKind: "codex", authKind: "apiKey", baseUrl: "https://relay.example.com/v1", appearance: { providerCategory: null, effectiveProviderCategory: "other", color: null, effectiveColor: null } };
  expect(profileProvider({ ...relay, model: "gemini-3.8-flash", modelProvider: "custom" })).toBe("gemini");
  expect(profileProvider({ ...relay, model: null, modelProvider: "gemini" })).toBe("gemini");
  // A cutex category stays the answer; "other" only admits the logos cutex has no category for.
  expect(profileProvider({ ...relay, model: "deepseek-v4-flash", modelProvider: null })).toBeNull();
  expect(profileProvider({ ...relay, model: "qwen3-coder", modelProvider: null })).toBe("qwen");
});
