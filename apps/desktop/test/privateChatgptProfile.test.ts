import { describe, expect, it } from "vitest";
import type { ProfileDetail } from "../src/shared/ipc";
import { privateChatgptProfile } from "../src/renderer/src/lib/privateChatgptProfile";
import { FALLBACK_PRESETS } from "../src/renderer/src/lib/profilePresets";
const detail = (over: Partial<ProfileDetail> = {}) => ({ cliKind: "codex", authKind: "apiKey", baseUrl: "https://api.deepseek.com/v1", detail: { config: { providerBaseUrl: null } }, ...over } as unknown as ProfileDetail);
describe("private ChatGPT login applicability", () => {
  it("offers signed-in and signed-out ChatGPT, and the official OpenAI API", () => {
    expect(privateChatgptProfile(detail({ authKind: "chatgpt" }), {}, FALLBACK_PRESETS)).toEqual({ relevant: true, visible: true, warn: false });
    expect(privateChatgptProfile(detail({ authKind: "none", providerFamily: "openai-chatgpt" }), {}, FALLBACK_PRESETS).visible).toBe(true);
    expect(privateChatgptProfile(detail({ baseUrl: "https://api.openai.com/v1" }), {}, FALLBACK_PRESETS).visible).toBe(true);
  });
  it("hides third-party defaults even when their family/name says OpenAI", () => {
    for (const baseUrl of ["https://api.deepseek.com/v1", "https://open.bigmodel.cn/api/v1", "https://relay.example/v1", "https://api.openai.com.evil.example/v1"]) {
      expect(privateChatgptProfile(detail({ baseUrl, providerFamily: "openai-api" }), {}, FALLBACK_PRESETS)).toEqual({ relevant: false, visible: false, warn: false });
    }
  });
  it("keeps an existing wrong-provider value visible and never mutates it", () => {
    const value = detail({ privateChatgptAuthFile: true });
    expect(privateChatgptProfile(value, {}, FALLBACK_PRESETS)).toEqual({ relevant: false, visible: true, warn: true });
    expect(privateChatgptProfile(value, { privateChatgptAuthFile: false }, FALLBACK_PRESETS).visible).toBe(true);
    expect(value.privateChatgptAuthFile).toBe(true);
    expect(privateChatgptProfile(detail(), { privateChatgptAuthFile: true }, FALLBACK_PRESETS).warn).toBe(true);
  });
});
