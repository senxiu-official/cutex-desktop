// cutex profile-runtime-variants (r265, docs/design/042): request builders main sends, the renderer's plan of the
// new-profile flow (create kind from the ticked variants, cute-codex the default while DSH is not recommended), the
// pre-create compatibility preview, the runtime of a bound agent, the preview mock and the strings.
import { describe, expect, it, vi } from "vitest";
import type { ProfileItem, ProfilePreset } from "../src/shared/ipc";
import { credentialEnvName, credentialSourceBody, profileApiKey, variantAddBody, variantIdOf, variantPatchBody, type RuntimeCompatibility } from "../src/shared/profileVariants";
import { addableRuntimes, boundAgents, defaultVariantOf, initialRuntimes, isDeepseekNative, newProfilePlan, plannedDefault, previewCompatibility, reasonKey, variantCreateRefusalKey, variantsOf, variantsOn, type NewProfileDraft } from "../src/renderer/src/lib/profileVariants";
import { agentFeaturesOf, lacks } from "../src/renderer/src/lib/agentFeatures";
import { runtimeOf } from "../src/renderer/src/lib/agentList";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";

const deepseek = { id: "deepseek", aliases: [], label: "DeepSeek", providerId: "deepseek", baseUrl: "https://api.deepseek.com/", baseUrlRequired: false, defaultModel: "deepseek-flash", providerFamily: "deepseek", providerFamilyLabel: "DeepSeek" } as ProfilePreset;
const glm = { ...deepseek, id: "zai", label: "Z.ai", baseUrl: "https://api.z.ai/api/v1" } as ProfilePreset;
const installed = { dshInstalled: true, claudeInstalled: true };
const draft = (over: Partial<NewProfileDraft>): NewProfileDraft => ({ provider: "apiKey", preset: "deepseek", baseUrl: "", apiKey: "", envName: null, runtimes: ["codex"], defaults: {}, name: "ds", color: null, ...over });

describe("request bodies (main)", () => {
  it("variant ids, add / patch bodies and credential sources are rebuilt from known fields", () => {
    expect(variantIdOf("dsh")).toBe("dsh");
    for (const bad of ["", "DSH", "a/b", "x".repeat(33), 3]) expect(() => variantIdOf(bad)).toThrow("bad variant id");
    expect(variantAddBody({ runtime: "dsh", defaults: { model: " deepseek-v4-pro ", reasoningEffort: "" }, extra: 1 })).toEqual({ runtime: "dsh", defaults: { model: "deepseek-v4-pro", reasoningEffort: null } });
    expect(() => variantAddBody({ runtime: "gemini" })).toThrow("bad runtime");
    expect(variantPatchBody({ model: null })).toEqual({ defaults: { model: null } });
    expect(() => variantPatchBody({})).toThrow("nothing to change");
    expect(credentialSourceBody({ source: "env", envName: " MY_DS_KEY ", apiKey: "x" })).toEqual({ source: "env", envName: "MY_DS_KEY" });
    expect(credentialSourceBody({ source: "stored", envName: "X" })).toEqual({ source: "stored" });
    for (const bad of ["", "1ABC", "CUTEX_KEY", "NODE_OPTIONS", "PATH", "DSH_PROFILE_API_KEY", "A-B"]) expect(credentialEnvName(bad), bad).toBeNull();
    expect(() => credentialSourceBody({ source: "env", envName: "LD_PRELOAD" })).toThrow("bad environment variable name");
  });

  it("a profile key is trimmed and refused without repeating it", () => {
    expect(profileApiKey(" sk-ok ")).toBe("sk-ok");
    for (const bad of ["", "sk bad", "k".repeat(4097), null]) {
      let message = "";
      try { profileApiKey(bad); } catch (e) { message = (e as Error).message; }
      expect(message).toBe("bad API key");
    }
  });
});

describe("new-profile flow", () => {
  it("previews cutex's matrix (contract §2) until the preset carries its own rows", () => {
    const ds = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, deepseek, installed);
    expect(ds.map((r) => [r.runtime, r.status, r.reason])).toEqual([["codex", "supported", null], ["dsh", "supported", null], ["claude", "unsupported", "anthropicRouteNotYetSupported"]]);
    expect(previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, deepseek, { ...installed, dshInstalled: false }).find((r) => r.runtime === "dsh")?.status).toBe("componentNotInstalled");
    // A relay URL or another provider never gets DSH.
    expect(isDeepseekNative(deepseek, "https://relay.example.net/v1")).toBe(false);
    expect(previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, glm, installed).find((r) => r.runtime === "dsh")).toMatchObject({ status: "unsupported", reason: "providerNotDeepseekNative" });
    expect(previewCompatibility({ provider: "chatgpt", envName: null, baseUrl: "" }, null, installed).filter((r) => r.status === "supported").map((r) => r.runtime)).toEqual(["codex"]);
    expect(previewCompatibility({ provider: "claude", envName: null, baseUrl: "" }, null, { ...installed, claudeInstalled: false }).find((r) => r.runtime === "claude")?.status).toBe("componentNotInstalled");
    // A host variable is a DSH source only.
    expect(previewCompatibility({ provider: "apiKey", envName: "", baseUrl: "" }, deepseek, installed).find((r) => r.runtime === "codex")).toMatchObject({ status: "unsupported", reason: "envCredentialDshOnly" });
    // cutex's own rows win when the preset has them.
    const own: RuntimeCompatibility[] = [{ runtime: "codex", status: "supported", reason: null, variantPresent: false }, { runtime: "dsh", status: "unsupported", reason: "platformUnsupported", variantPresent: false }];
    expect(previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, { ...deepseek, runtimeCompatibility: own } as ProfilePreset, installed).find((r) => r.runtime === "dsh")?.reason).toBe("platformUnsupported");
    expect(initialRuntimes(ds)).toEqual(["codex"]);
    expect(plannedDefault(["dsh", "codex"])).toBe("codex");
    expect(plannedDefault(["dsh"])).toBe("dsh");
    // lib/dshNotice: once DSH loses「暂不建议使用」, DSH is the default when checked (owner 2026-10-27).
    expect(plannedDefault(["dsh", "codex"], false)).toBe("dsh");
    expect(plannedDefault(["codex"], false)).toBe("codex");
  });

  it("DeepSeek with cute-codex and DSH: a Codex API-key profile with the key, then a DSH variant; cute-codex stays default", () => {
    const rows = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, deepseek, installed);
    const r = newProfilePlan(draft({ apiKey: " sk-test ", runtimes: ["dsh", "codex"], defaults: { codex: { model: "deepseek-v4-pro", reasoningEffort: "" }, dsh: { model: "deepseek-v4-pro", reasoningEffort: "high" } }, color: "#40c057" }), { name: "ds", preset: "deepseek" }, rows);
    expect(r).toEqual({ plan: { create: { name: "ds", kind: "apiKey", preset: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-test" }, addVariants: [{ runtime: "dsh", defaults: { model: "deepseek-v4-pro", reasoningEffort: "high" } }], defaultVariant: null, color: "#40c057" } });
    // No DSH model picked: the DSH variant gets the model the form showed (DSH's default), not cutex's own default name.
    const plain = newProfilePlan(draft({ runtimes: ["dsh", "codex"] }), { name: "ds", preset: "deepseek" }, rows);
    expect("plan" in plain && plain.plan.addVariants).toEqual([{ runtime: "dsh", defaults: { model: "deepseek-flash" } }]);
  });

  it("DSH alone: a DSH profile with a stored key, or (Advanced) a named variable and no key", () => {
    const rows = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, deepseek, installed);
    expect(newProfilePlan(draft({ apiKey: "sk-test", runtimes: ["dsh"] }), { name: "ds", preset: "deepseek" }, rows)).toEqual({ plan: { create: { name: "ds", kind: "dsh", options: { dsh: { model: "deepseek-flash" } }, credential: { source: "stored" }, apiKey: "sk-test" }, addVariants: [], defaultVariant: null, color: null } });
    // "Save the key here" left empty: still an explicit stored source (no key yet), never the legacy env read (QA 2026-10-27).
    expect(newProfilePlan(draft({ apiKey: "  ", runtimes: ["dsh"] }), { name: "ds", preset: "deepseek" }, rows)).toEqual({ plan: { create: { name: "ds", kind: "dsh", options: { dsh: { model: "deepseek-flash" } }, credential: { source: "stored" } }, addVariants: [], defaultVariant: null, color: null } });
    const envRows = previewCompatibility({ provider: "apiKey", envName: "MY_DS_KEY", baseUrl: "" }, deepseek, installed);
    expect(newProfilePlan(draft({ apiKey: "sk-ignored", envName: "MY_DS_KEY", runtimes: ["dsh"] }), { name: "ds", preset: "deepseek" }, envRows)).toEqual({ plan: { create: { name: "ds", kind: "dsh", options: { dsh: { model: "deepseek-flash" } }, credential: { source: "env", envName: "MY_DS_KEY" } }, addVariants: [], defaultVariant: null, color: null } });
    expect(newProfilePlan(draft({ envName: "1BAD", runtimes: ["dsh"] }), { name: "ds" }, envRows)).toEqual({ error: "envNameInvalid" });
  });

  it("refuses an empty or unsupported choice; ChatGPT / Claude create their own kind", () => {
    const rows = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, glm, installed);
    expect(newProfilePlan(draft({ runtimes: [] }), { name: "g" }, rows)).toEqual({ error: "noRuntime" });
    expect(newProfilePlan(draft({ runtimes: ["codex", "dsh"] }), { name: "g" }, rows)).toEqual({ error: "unsupportedRuntime" });
    const chat = previewCompatibility({ provider: "chatgpt", envName: null, baseUrl: "" }, null, installed);
    expect(newProfilePlan(draft({ provider: "chatgpt", apiKey: "sk-x" }), { name: "c" }, chat)).toEqual({ plan: { create: { name: "c", kind: "chatgpt" }, addVariants: [], defaultVariant: null, color: null } });
    const claude = previewCompatibility({ provider: "claude", envName: null, baseUrl: "" }, null, installed);
    expect(newProfilePlan(draft({ provider: "claude", runtimes: ["claude"] }), { name: "c", claudeAccount: "ca-x" }, claude)).toMatchObject({ plan: { create: { name: "c", kind: "claude", claudeAccount: "ca-x" } } });
  });
});

describe("profile and agent views", () => {
  const p = {
    runtimeVariants: [
      { id: "dsh", runtime: "dsh", primary: false, defaults: { model: "deepseek-flash", reasoningEffort: null }, inUse: 1 },
      { id: "codex", runtime: "codex", primary: true, defaults: { model: "deepseek-flash", reasoningEffort: "high" }, inUse: 4 },
    ],
    defaultVariant: "codex",
    runtimeCompatibility: [
      { runtime: "codex", status: "supported", reason: null, variantPresent: true },
      { runtime: "dsh", status: "supported", reason: null, variantPresent: true },
      { runtime: "claude", status: "unsupported", reason: "anthropicRouteNotYetSupported", variantPresent: false },
    ],
  } as unknown as ProfileItem;
  it("lists variants primary first, finds the default, what can be added and who a credential change reaches", () => {
    expect(variantsOf(p)?.map((v) => v.id)).toEqual(["codex", "dsh"]);
    expect(defaultVariantOf({ ...p, defaultVariant: "dsh" })?.id).toBe("dsh");
    expect(defaultVariantOf({ ...p, defaultVariant: "gone" })?.id).toBe("codex");
    expect(addableRuntimes(p)).toEqual([]);
    expect(addableRuntimes({ ...p, runtimeCompatibility: [{ runtime: "dsh", status: "componentNotInstalled", reason: null, variantPresent: false }] }).map((c) => c.runtime)).toEqual(["dsh"]);
    expect(boundAgents(p)).toBe(5);
    expect(variantsOf({} as ProfileItem)).toBeNull();
    expect(variantsOn(new Set(["profile-runtime-variants"]))).toBe(true);
    expect(reasonKey("anthropicRouteNotYetSupported")).toBe("variants.reason.anthropicRouteNotYetSupported");
    expect(reasonKey("somethingNew")).toBeNull();
  });

  it("a bound agent's runtime is cutex's binding, even before the native reports a schema", () => {
    const bound = { launchBinding: { runtime: "dsh", profileId: "omega", variantId: "dsh" }, runtime: {}, native: { schema: null } } as never;
    expect(runtimeOf(bound)).toBe("dsh");
    expect(agentFeaturesOf(bound).runtime).toBe("dsh");
    expect(lacks(agentFeaturesOf(bound), "turnSteer")).toBe(true);
  });
});

describe("preview mock (?variants)", () => {
  it("binds a new agent to its variant, refuses a missing one and refuses deleting a bound variant", async () => {
    vi.stubGlobal("location", { search: "?variants&dsh=ready" });
    vi.resetModules();
    const m = await import("../src/renderer/src/dev/mockProfileVariants");
    const omega = { name: "omega", authKind: "apiKey" as const, apiKeyPresent: true, config: { model: "deepseek-flash", modelProvider: "deepseek", providerBaseUrl: "https://api.deepseek.com/v1" } };
    const fields = m.variantFields(omega, []);
    expect((fields.runtimeVariants as { id: string }[]).map((v) => v.id)).toEqual(["codex", "dsh"]);
    expect(fields.credential).toMatchObject({ source: "stored", present: true, writable: true });
    expect(JSON.stringify(fields)).not.toContain("sk-");
    expect(m.bindNewSession(omega, "dsh", "s1")).toMatchObject({ profileId: "omega", variantId: "dsh", runtime: "dsh" });
    expect(() => m.bindNewSession(omega, "claude", "s2")).toThrow("unknown_variant");
    const api = m.variantApi(() => omega, () => ({}), () => [{ cutexSessionId: "s1", profile: "omega", displayName: "s1" }]);
    const refused = await api.deleteProfileVariant("omega", "dsh");
    expect(refused).toMatchObject({ ok: false, error: { code: "variant_in_use", count: 2 } });
    expect(await api.deleteProfileVariant("omega", "codex")).toMatchObject({ ok: false, error: { code: "primary_variant_not_removable" } });
    vi.unstubAllGlobals();
  });
});

it("ships the strings in zh-CN, en and zh-Hant-CN", () => {
  for (const key of ["variants.step.runtimes", "variants.status.needsInstall", "variants.credential.title", "variants.list.title", "variants.agent.fixed", "composer.noSteerHint"] as const) {
    expect(zhCN[key], key).toBeTruthy();
    expect(en[key], key).toBeTruthy();
    expect(zhHantCN[key], key).toBeTruthy();
  }
});

describe("create-time variant refusals", () => {
  it("maps cutex's codes (carried in the error message) to plain words, other errors pass through", () => {
    expect(variantCreateRefusalKey("variant_runtime_unavailable: dsh is componentNotInstalled")).toBe("variants.createRefusal.runtimeUnavailable");
    expect(variantCreateRefusalKey("credential_missing: no stored key")).toBe("variants.createRefusal.credentialMissing");
    expect(variantCreateRefusalKey("unknown_variant: no variant x")).toBe("variants.createRefusal.unknownVariant");
    expect(variantCreateRefusalKey("profile_not_found: x")).toBeNull();
  });
});
