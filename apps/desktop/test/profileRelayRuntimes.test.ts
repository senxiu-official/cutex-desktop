import { describe, expect, it } from "vitest";
import type { ProfilePreset } from "../src/shared/ipc";
import { variantAddBody, type RuntimeCompatibility } from "../src/shared/profileVariants";
import { newProfilePlan, previewCompatibility, type NewProfileDraft } from "../src/renderer/src/lib/profileVariants";

const deepseek: ProfilePreset = {
  id: "deepseek", providerId: "deepseek", aliases: [], label: "DeepSeek",
  baseUrl: "https://api.deepseek.com/", baseUrlRequired: false,
  defaultModel: "deepseek-flash", providerFamily: "deepseek", providerFamilyLabel: "DeepSeek",
};
const kimi: ProfilePreset = { ...deepseek, id: "moonshot", providerId: "moonshot", baseUrl: "https://api.moonshot.ai/v1" };
const relay = "https://relay.example/v1";
const dshAddress = "https://relay.example/anthropic";
const installed = { dshInstalled: true, claudeInstalled: true, kimiProfiles: true, kimiInstalled: true };
const draft = (over: Partial<NewProfileDraft> = {}): NewProfileDraft => ({
  provider: "apiKey", preset: "deepseek", baseUrl: relay, apiKey: "", envName: null,
  runtimes: ["codex", "dsh"], defaults: {}, name: "relay", color: null, ...over,
});
const rowsFor = (d: NewProfileDraft, preset = deepseek) => previewCompatibility(d, preset, { ...installed, relayRuntimes: true });

describe("profile-relay-runtimes additive contract", () => {
  it("preserves a DSH address and rebuilds only the supported wire fields", () => {
    expect(variantAddBody({ runtime: "dsh", baseUrl: ` ${dshAddress} `, apiKey: "ignored", unknown: 1 })).toEqual({ runtime: "dsh", baseUrl: dshAddress });
    expect(variantAddBody({ runtime: "dsh" })).toEqual({ runtime: "dsh" });
    expect(variantAddBody({ runtime: "dsh", baseUrl: "http://127.0.0.1:8080/anthropic/" }).baseUrl).toBe("http://127.0.0.1:8080/anthropic/");
  });

  it.each([
    null, 12, "", "  ", "relay.example", "ftp://relay.example", "https://",
    "https://user:password@relay.example", "https://user@relay.example",
    "https://relay.example?token=secret", "https://relay.example?", "https://relay.example#fragment", "https://relay.example#",
    "https://relay.example/has space", "https://relay.example/\npath", "https://relay.example/\u0000",
  ])("rejects invalid DSH addresses without echoing input (%#)", (baseUrl) => {
    expect(() => variantAddBody({ runtime: "dsh", baseUrl })).toThrow("bad variant base URL");
  });

  it.each(["codex", "claude", "kimi"])("does not accept a separate address for %s", (runtime) => {
    expect(() => variantAddBody({ runtime, baseUrl: dshAddress })).toThrow("only DSH has a variant base URL");
  });

  it("gates provider-based relay previews on the capability, retaining old host rules", () => {
    const d = draft();
    expect(previewCompatibility(d, deepseek, installed).find((r) => r.runtime === "dsh")?.status).toBe("unsupported");
    expect(previewCompatibility(d, deepseek, { ...installed, relayRuntimes: false }).find((r) => r.runtime === "dsh")?.status).toBe("unsupported");
    expect(rowsFor(d).find((r) => r.runtime === "dsh")?.status).toBe("supported");
    expect(previewCompatibility(d, deepseek, { ...installed, relayRuntimes: true, dshInstalled: false }).find((r) => r.runtime === "dsh")?.status).toBe("componentNotInstalled");
    expect(previewCompatibility(draft({ baseUrl: "" }), deepseek, installed).find((r) => r.runtime === "dsh")?.status).toBe("supported");
    const custom = { ...deepseek, id: "custom", providerId: "custom" };
    expect(rowsFor(d, custom).find((r) => r.runtime === "dsh")?.status).toBe("unsupported");
  });

  it.each(["moonshot", "kimi", "kimi-code"])("permits %s relay Kimi variants only with the new capability", (providerId) => {
    const preset = { ...kimi, providerId };
    const d = draft({ preset: preset.id });
    expect(previewCompatibility(d, preset, installed).find((r) => r.runtime === "kimi")?.status).toBe("unsupported");
    expect(rowsFor(d, preset).find((r) => r.runtime === "kimi")?.status).toBe("supported");
    expect(previewCompatibility(d, preset, { ...installed, relayRuntimes: true, kimiInstalled: false }).find((r) => r.runtime === "kimi")?.status).toBe("componentNotInstalled");
  });

  it("keeps backend compatibility authoritative, including unsupported and uninstalled rows", () => {
    const own: RuntimeCompatibility[] = [
      { runtime: "codex", status: "supported", reason: null, variantPresent: true },
      { runtime: "dsh", status: "unsupported", reason: "platformUnsupported", variantPresent: false },
      { runtime: "kimi", status: "componentNotInstalled", reason: null, variantPresent: false },
    ];
    const result = rowsFor(draft(), { ...deepseek, runtimeCompatibility: own });
    expect(result.find((r) => r.runtime === "dsh")).toEqual(own[1]);
    expect(result.find((r) => r.runtime === "kimi")).toEqual(own[2]);
    expect(result.find((r) => r.runtime === "codex")?.variantPresent).toBe(false);
    expect(own[0]?.variantPresent).toBe(true);
  });

  it("retains login, environment credential and Kimi capability restrictions", () => {
    const opts = { ...installed, relayRuntimes: true };
    expect(previewCompatibility(draft({ provider: "chatgpt" }), deepseek, opts).find((r) => r.runtime === "dsh")?.status).toBe("unsupported");
    expect(previewCompatibility(draft({ provider: "claude" }), kimi, opts).find((r) => r.runtime === "kimi")?.status).toBe("unsupported");
    expect(rowsFor(draft({ envName: "MY_KEY" }), kimi).find((r) => r.runtime === "kimi")?.reason).toBe("envCredentialDshOnly");
    expect(previewCompatibility(draft(), kimi, { ...opts, kimiProfiles: false }).some((r) => r.runtime === "kimi")).toBe(false);
  });

  it("passes the explicit DSH address to the secondary variant, without inventing one", () => {
    const d = draft({ variantBaseUrls: { dsh: ` ${dshAddress} ` } });
    const result = newProfilePlan(d, { name: d.name, preset: "deepseek", baseUrl: relay }, rowsFor(d));
    expect(result).toMatchObject({ plan: { create: { kind: "apiKey", baseUrl: relay }, addVariants: [{ runtime: "dsh", baseUrl: dshAddress }] } });
    const absent = newProfilePlan(draft(), { name: "relay", preset: "deepseek", baseUrl: relay }, rowsFor(draft()));
    expect("plan" in absent && absent.plan.addVariants[0]).not.toHaveProperty("baseUrl");
  });

  it("creates a DSH primary using the backend's interfaceBaseUrls contract", () => {
    const d = draft({ runtimes: ["dsh"], variantBaseUrls: { dsh: dshAddress } });
    const result = newProfilePlan(d, { name: d.name, preset: "deepseek", baseUrl: relay }, rowsFor(d));
    expect(result).toMatchObject({ plan: { create: { kind: "dsh", interfaceBaseUrls: { deepseekNative: dshAddress } }, addVariants: [] } });
    if (!("plan" in result)) throw new Error("plan missing");
    expect(result.plan.create).not.toHaveProperty("baseUrl");
    expect(result.plan.create.options?.dsh).not.toHaveProperty("baseUrl");
  });

  it("uses the Profile main URL for Kimi, with no per-variant URL", () => {
    const d = draft({ runtimes: ["codex", "kimi"], variantBaseUrls: { kimi: "https://ignored.example" } });
    const result = newProfilePlan(d, { name: d.name, preset: "moonshot", baseUrl: relay }, rowsFor(d, kimi));
    expect(result).toMatchObject({ plan: { create: { kind: "apiKey", baseUrl: relay }, addVariants: [{ runtime: "kimi" }] } });
    if (!("plan" in result)) throw new Error("plan missing");
    expect(result.plan.addVariants[0]).not.toHaveProperty("baseUrl");
    expect(result.plan.create).not.toHaveProperty("interfaceBaseUrls");
  });

  it("keeps a Kimi-only API selection on an API-key profile with the required Codex primary", () => {
    const d = draft({ runtimes: ["kimi"], apiKey: "sk-test" });
    const result = newProfilePlan(d, { name: d.name, preset: "moonshot", baseUrl: relay }, rowsFor(d, kimi));
    expect(result).toMatchObject({ plan: {
      create: { kind: "apiKey", preset: "moonshot", baseUrl: relay, apiKey: "sk-test" },
      addVariants: [{ runtime: "kimi" }], defaultVariant: "kimi",
    } });
  });

  it.each([["codex", "dsh"], ["dsh"]] as const)("preflights missing DSH relay addresses for %j before returning a create plan", (...runtimes) => {
    const d = draft({ runtimes: [...runtimes] });
    expect(newProfilePlan(d, { name: d.name, preset: "deepseek", baseUrl: relay }, rowsFor(d), { dshBaseUrlRequired: true })).toEqual({ error: "variantBaseUrlMissing" });
    const blank = { ...d, variantBaseUrls: { dsh: "  " } };
    expect(newProfilePlan(blank, { name: d.name }, rowsFor(d), { dshBaseUrlRequired: true })).toEqual({ error: "variantBaseUrlMissing" });
  });

  it.each(["not a URL", "ftp://relay.example", "https://secret@relay.example", "https://relay.example?key=secret"])("preflights malformed supplied DSH addresses (%#)", (address) => {
    for (const runtimes of [["codex", "dsh"], ["dsh"]] as const) {
      const d = draft({ runtimes: [...runtimes], variantBaseUrls: { dsh: address } });
      expect(newProfilePlan(d, { name: d.name }, rowsFor(d))).toEqual({ error: "variantBaseUrlInvalid" });
    }
  });

  it("does not require an unused DSH address, and accepts a validated explicit address", () => {
    const d = draft({ runtimes: ["codex"], variantBaseUrls: { dsh: "invalid" } });
    expect(newProfilePlan(d, { name: d.name }, rowsFor(d), { dshBaseUrlRequired: true })).toHaveProperty("plan");
    const explicit = draft({ variantBaseUrls: { dsh: dshAddress } });
    expect(newProfilePlan(explicit, { name: d.name }, rowsFor(explicit), { dshBaseUrlRequired: true })).toHaveProperty("plan");
  });
});
