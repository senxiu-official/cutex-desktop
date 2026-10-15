import { describe, expect, it } from "vitest";
import { copyName, createRequestOf, profileNameError, refusalText, switchTargets } from "../src/renderer/src/lib/profileCreate";

describe("createRequestOf", () => {
  const existing = ["deepseek", "GLM"];
  it("validates the name", () => {
    expect(profileNameError("  ", existing)).toBe("nameEmpty");
    expect(profileNameError("a/b", existing)).toBe("nameInvalid");
    expect(profileNameError("glm", existing)).toBe("nameTaken");
    expect(profileNameError("work", existing)).toBeNull();
  });
  it("API key: preset, or custom base URL", () => {
    expect(createRequestOf({ name: " kimi ", kind: "apiKey", preset: "moonshot", baseUrl: "" }, existing)).toEqual({ request: { name: "kimi", kind: "apiKey", preset: "moonshot" } });
    expect(createRequestOf({ name: "relay", kind: "apiKey", preset: "", baseUrl: "" }, existing)).toEqual({ error: "baseUrlMissing" });
    expect(createRequestOf({ name: "relay", kind: "apiKey", preset: "", baseUrl: "relay.example" }, existing)).toEqual({ error: "baseUrlInvalid" });
    expect(createRequestOf({ name: "relay", kind: "apiKey", preset: "", baseUrl: " https://relay.example/v1 " }, existing)).toEqual({ request: { name: "relay", kind: "apiKey", baseUrl: "https://relay.example/v1" } });
  });
  it("official logins send only name + kind", () => {
    expect(createRequestOf({ name: "plus", kind: "chatgpt", preset: "deepseek", baseUrl: "x" }, existing)).toEqual({ request: { name: "plus", kind: "chatgpt" } });
  });
  it("Claude account (claude-accounts): only a Claude profile on another account than the shared one", () => {
    const form = { name: "work", preset: "", baseUrl: "" };
    expect(createRequestOf({ ...form, kind: "claude", claudeAccount: "ca-work1" }, existing)).toEqual({ request: { name: "work", kind: "claude", claudeAccount: "ca-work1" } });
    expect(createRequestOf({ ...form, kind: "claude", claudeAccount: "default" }, existing)).toEqual({ request: { name: "work", kind: "claude" } });
    expect(createRequestOf({ ...form, kind: "claude" }, existing)).toEqual({ request: { name: "work", kind: "claude" } });
    // Switching the kind away drops the choice (cutex: 400 for another kind).
    expect(createRequestOf({ ...form, kind: "chatgpt", claudeAccount: "ca-work1" }, existing)).toEqual({ request: { name: "work", kind: "chatgpt" } });
  });
});

describe("copyName", () => {
  it("first free -copy name", () => {
    expect(copyName("glm", [])).toBe("glm-copy");
    expect(copyName("glm", ["GLM-copy", "glm-copy-2"])).toBe("glm-copy-3");
  });
});

describe("switchTargets", () => {
  const profiles = [
    { name: "deepseek", cliKind: "codex", providerFamily: "responses-api" },
    { name: "GLM", cliKind: "codex", providerFamily: "responses-api" },
    { name: "gamma", cliKind: "codex", providerFamily: "openai-chatgpt" },
    { name: "claude", cliKind: "claude", providerFamily: "claude" },
  ];
  it("same family with profile-switch-family", () => {
    expect(switchTargets("deepseek", profiles, true).map((p) => p.name)).toEqual(["GLM"]);
  });
  it("falls back to same CLI kind without it (or without family data)", () => {
    expect(switchTargets("deepseek", profiles, false).map((p) => p.name)).toEqual(["GLM", "gamma"]);
    const old = profiles.map(({ providerFamily: _f, ...p }) => p);
    expect(switchTargets("deepseek", old, true).map((p) => p.name)).toEqual(["GLM", "gamma"]);
  });
});

describe("refusalText", () => {
  const t = (key: string, vars?: Record<string, string | number>) => `${key}|${vars?.names}|${vars?.n}`;
  it("known codes → translated with the agent names; unknown → cutex message", () => {
    expect(refusalText({ code: "profile_in_use", message: "", sessions: [{ cutexSessionId: "a", displayName: "Eva" }, { cutexSessionId: "b", displayName: "Mika" }] }, t as never)).toBe("refusal.profile_in_use|Eva、Mika|2");
    expect(refusalText({ code: "weird", message: "nope" }, t as never)).toBe("nope (weird)");
  });
});
