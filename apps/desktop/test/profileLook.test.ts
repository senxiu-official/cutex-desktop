import { describe, expect, it } from "vitest";
import { profileKindLabel } from "../src/renderer/src/lib/profileCards";
import { inkOn, profileColor } from "../src/renderer/src/lib/profileLook";
import { modelProvider, profileProvider } from "../src/renderer/src/lib/provider";

describe("profile look", () => {
  it("picks ink that reads on the colour", () => {
    expect(inkOn("#fab005")).toBe("#111"); // yellow
    expect(inkOn("#ffffff")).toBe("#111");
    expect(inkOn("#7950f2")).toBe("#fff"); // violet
    expect(inkOn("#000")).toBe("#fff");
    expect(inkOn("not a colour")).toBe("#fff");
  });

  it("uses the profile's own colour, then cutex's effective one, then a stable hash", () => {
    expect(profileColor({ name: "a", appearance: { color: "#123456", effectiveColor: "#654321" } })).toBe("#123456");
    expect(profileColor({ name: "a", appearance: { color: null, effectiveColor: "#654321" } })).toBe("#654321");
    expect(profileColor({ name: "GLM", appearance: null })).toBe(profileColor({ name: "GLM", appearance: { color: null, effectiveColor: null } }));
  });

  it("labels the kind without repeating the provider logo's job", () => {
    const base = { cliKind: "codex", baseUrl: null } as const;
    expect(profileKindLabel({ ...base, authKind: "chatgpt" }, "自定义")).toBe("ChatGPT");
    expect(profileKindLabel({ ...base, cliKind: "claude", authKind: "claude" }, "自定义")).toBe("Claude");
    expect(profileKindLabel({ ...base, authKind: "apiKey" }, "自定义")).toBe("API Key · 自定义");
  });

  it("knows Qwen / Gemini / OpenRouter by model and base URL, even when cutex says other", () => {
    expect(modelProvider("qwen3-coder")).toBe("qwen");
    expect(modelProvider("gemini-3-pro")).toBe("gemini");
    expect(modelProvider("openrouter/auto")).toBe("openrouter");
    const p = { name: "relay", authKind: "apiKey" as const, cliKind: "codex", baseUrl: "https://openrouter.ai/api/v1" };
    expect(profileProvider({ ...p, appearance: { color: null, effectiveColor: null, providerCategory: null, effectiveProviderCategory: "other" } })).toBe("openrouter");
    expect(profileProvider({ ...p, baseUrl: "https://relay.example.com/v1", appearance: { color: null, effectiveColor: null, providerCategory: null, effectiveProviderCategory: "other" } })).toBeNull();
    expect(profileProvider({ ...p, appearance: { color: null, effectiveColor: null, providerCategory: "glm", effectiveProviderCategory: "glm" } })).toBe("glm");
  });
});
