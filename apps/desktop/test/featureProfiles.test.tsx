// @vitest-environment jsdom
// 功能 Profile (cutex feature-profiles, owner 2026-11-25): the contract helpers, main's methods (bodies from known fields,
// the key never echoed), the text-rewrite routes, and Settings → 功能 Profile (add / edit / replace key / delete).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { featureProfileCreateBody, featureProfilePatchBody, featureProfileTestBody, parseFeatureProfileList, parseFeatureProfileReply, parseFeatureProfileTestResult, type FeatureProfile, type FeatureProfileTestResult } from "../src/shared/featureProfiles";
import { textRewriteBody } from "../src/shared/textRewrite";
import { DaemonService } from "../src/main/daemon";

const env = vi.hoisted(() => ({
  rows: [] as FeatureProfile[],
  damaged: [] as string[],
  calls: [] as { method: string; args: unknown[] }[],
  failNext: null as string | null,
  features: ["feature-profiles"] as string[],
  testReply: null as FeatureProfileTestResult | null,
}));
const fakeApi = {
  featureProfiles: async () => ({ profiles: structuredClone(env.rows), damaged: [...env.damaged] }),
  createFeatureProfile: async (input: Record<string, string>) => {
    env.calls.push({ method: "create", args: [input] });
    if (env.failNext) { const m = env.failNext; env.failNext = null; throw new Error(m); }
    const { apiKey: _k, ...meta } = input;
    const p = { id: `fp-new${env.rows.length}`, ...meta, keyPresent: true } as FeatureProfile;
    env.rows.push(p);
    return structuredClone(p);
  },
  patchFeatureProfile: async (id: string, patch: Record<string, string>) => {
    env.calls.push({ method: "patch", args: [id, patch] });
    const { apiKey: _k, ...meta } = patch;
    const i = env.rows.findIndex((p) => p.id === id);
    env.rows[i] = { ...env.rows[i]!, ...meta };
    return structuredClone(env.rows[i]!);
  },
  testFeatureProfile: async (request: unknown) => {
    env.calls.push({ method: "test", args: [request] });
    return env.testReply ?? { ok: true, latencyMs: 640, model: "gpt-6.2-mini-2026-10-01", error: null };
  },
  deleteFeatureProfile: async (id: string) => {
    env.calls.push({ method: "delete", args: [id] });
    env.rows = env.rows.filter((p) => p.id !== id);
    env.damaged = env.damaged.filter((d) => d !== id);
  },
};
vi.mock("../src/renderer/src/bridge", async (importOriginal) => ({ ...(await importOriginal<object>()), apiFor: () => fakeApi }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "local", useTargetApi: () => fakeApi, useTargetFeatures: () => new Set(env.features) }));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({ ...(await importOriginal<object>()), useApp: (select: (s: unknown) => unknown) => select({ openSettings: () => {} }) }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "zh-CN" }),
}));

const { FeatureProfilesSection } = await import("../src/renderer/src/modules/feature-profiles/FeatureProfilesSection");
const { resetFeatureProfilesForTests } = await import("../src/renderer/src/lib/featureProfiles");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row = (id: string, name: string, extra: Partial<FeatureProfile> = {}): FeatureProfile =>
  ({ id, name, protocol: "openaiResponses", baseUrl: "https://api.openai.com/v1", model: "gpt-6.2-mini", quotaType: "payAsYouGo", keyPresent: true, ...extra });

describe("contract helpers", () => {
  it("parses rows tolerantly: unknown fields ignored, unknown protocol / quota kept as text, malformed rows dropped", () => {
    const list = parseFeatureProfileList({ contractVersion: 2, profiles: [
      { id: "fp-a", name: "A", protocol: "openaiResponses", baseUrl: "https://x/v1", model: "m", quotaType: "balance", keyPresent: true, extra: 1 },
      { id: "fp-b", name: "B", protocol: "geminiNative", baseUrl: "https://y", model: "g", quotaType: "credits" },
      { id: "bad id with spaces", name: "C" },
      null,
    ] });
    expect(list.profiles).toEqual([
      { id: "fp-a", name: "A", protocol: "openaiResponses", baseUrl: "https://x/v1", model: "m", quotaType: "balance", keyPresent: true },
      { id: "fp-b", name: "B", protocol: "geminiNative", baseUrl: "https://y", model: "g", quotaType: "credits", keyPresent: false },
    ]);
    expect(list.damaged).toEqual([]);
    // Damaged records (list `errors`): IDs only, any code, deduplicated; readable or malformed IDs ignored.
    expect(parseFeatureProfileList({ contractVersion: 2, profiles: [{ id: "fp-a", name: "A" }], errors: [
      { id: "fp-x", code: "invalid_feature_profile_record" }, { id: "fp-x", code: "other" }, { id: "fp-a", code: "invalid_feature_profile_record" }, { id: "../y" }, "z",
    ] }).damaged).toEqual(["fp-x"]);
    expect(() => parseFeatureProfileList({})).toThrow();
    expect(parseFeatureProfileReply({ profile: { id: "fp-a", name: "A" } }).id).toBe("fp-a");
  });

  it("bodies keep only known fields; create needs them all, a patch needs at least one", () => {
    const full = { name: " A ", protocol: "anthropicMessages", baseUrl: "https://api.anthropic.com", model: "claude-haiku-5-5", quotaType: "balance", apiKey: " sk-1 ", junk: "x" };
    expect(featureProfileCreateBody(full)).toEqual({ name: "A", protocol: "anthropicMessages", baseUrl: "https://api.anthropic.com", model: "claude-haiku-5-5", quotaType: "balance", apiKey: "sk-1" });
    expect(() => featureProfileCreateBody({ ...full, apiKey: "" })).toThrow();
    expect(() => featureProfileCreateBody({ ...full, protocol: "chatCompletions" })).toThrow();
    expect(featureProfilePatchBody({ model: "m2", keyPresent: true })).toEqual({ model: "m2" });
    expect(() => featureProfilePatchBody({})).toThrow();
    expect(() => featureProfilePatchBody({ apiKey: null })).toThrow();
  });
});

describe("测试连接 contract", () => {
  it("the body is a saved row by ID or a draft of known fields with its key", () => {
    expect(featureProfileTestBody({ profileId: "fp-a", junk: 1 })).toEqual({ profileId: "fp-a" });
    expect(featureProfileTestBody({ draft: { protocol: "anthropicMessages", baseUrl: " https://api.anthropic.com ", model: "m", apiKey: " sk-1 ", name: "x" } }))
      .toEqual({ draft: { protocol: "anthropicMessages", baseUrl: "https://api.anthropic.com", model: "m", apiKey: "sk-1" } });
    expect(() => featureProfileTestBody({ profileId: "../x" })).toThrow();
    expect(() => featureProfileTestBody({ draft: { protocol: "openaiResponses", baseUrl: "https://x", model: "m", apiKey: "" } })).toThrow();
    expect(() => featureProfileTestBody({ draft: { protocol: "chatCompletions", baseUrl: "https://x", model: "m", apiKey: "k" } })).toThrow();
  });

  it("the result keeps known fields; an unknown class reads as other; a failure never carries a model", () => {
    expect(parseFeatureProfileTestResult({ contractVersion: 2, ok: true, latencyMs: 812.4, model: "gpt-6.2-mini", error: null, text: "LEAK" }))
      .toEqual({ ok: true, latencyMs: 812, model: "gpt-6.2-mini", error: null });
    expect(parseFeatureProfileTestResult({ ok: false, latencyMs: 15000, model: "m", error: { class: "auth", message: "rejected (401)", raw: "LEAK" } }))
      .toEqual({ ok: false, latencyMs: 15000, model: null, error: { class: "auth", message: "rejected (401)" } });
    expect(parseFeatureProfileTestResult({ ok: false, latencyMs: null, model: null, error: { class: "dnsFailure", message: "x" } }).error!.class).toBe("other");
    expect(parseFeatureProfileTestResult({ ok: false }).error).toEqual({ class: "other", message: "" });
    expect(() => parseFeatureProfileTestResult({ latencyMs: 1 })).toThrow();
  });
});

describe("main", () => {
  it("calls /v2/feature-profiles with rebuilt bodies and returns only the parsed view", async () => {
    const replies: unknown[] = [
      { contractVersion: 2, profiles: [{ id: "fp-a", name: "A", protocol: "openaiResponses", baseUrl: "https://x/v1", model: "m", quotaType: "balance", keyPresent: true }] },
      { contractVersion: 2, profile: { id: "fp-b", name: "B", protocol: "openaiResponses", baseUrl: "https://x/v1", model: "m", quotaType: "balance", keyPresent: true, apiKey: "LEAK" } },
      { contractVersion: 2, profile: { id: "fp-b", name: "B2", protocol: "openaiResponses", baseUrl: "https://x/v1", model: "m", quotaType: "balance", keyPresent: true } },
      { contractVersion: 2, deleted: true },
    ];
    const request = vi.fn(async () => replies.shift());
    const self = { requireClient: () => ({ request }) } as unknown as DaemonService;
    const p = DaemonService.prototype;
    expect((await p.featureProfiles.call(self)).profiles[0]!.id).toBe("fp-a");
    const created = await p.createFeatureProfile.call(self, { name: "B", protocol: "openaiResponses", baseUrl: "https://x/v1", model: "m", quotaType: "balance", apiKey: "sk-secret", keyPresent: true } as never);
    expect(JSON.stringify(created)).not.toContain("LEAK");
    expect(JSON.stringify(created)).not.toContain("sk-secret");
    await p.patchFeatureProfile.call(self, "fp-b", { name: "B2", id: "fp-zzz" } as never);
    await p.deleteFeatureProfile.call(self, "fp-b");
    expect(request.mock.calls).toEqual([
      ["GET", "/v2/feature-profiles"],
      ["POST", "/v2/feature-profiles", { body: { name: "B", protocol: "openaiResponses", baseUrl: "https://x/v1", model: "m", quotaType: "balance", apiKey: "sk-secret" } }],
      ["PATCH", "/v2/feature-profiles/fp-b", { body: { name: "B2" } }],
      ["DELETE", "/v2/feature-profiles/fp-b"],
    ]);
    await expect(p.deleteFeatureProfile.call(self, "../x y")).rejects.toThrow();
  });

  it("测试连接 posts a rebuilt body to /v2/feature-profiles/test and returns only the parsed result", async () => {
    const request = vi.fn(async () => ({ contractVersion: 2, ok: false, latencyMs: 30, model: null, error: { class: "auth", message: "rejected", apiKey: "LEAK" } }));
    const self = { requireClient: () => ({ request }) } as unknown as DaemonService;
    const result = await DaemonService.prototype.testFeatureProfile.call(self, { draft: { protocol: "openaiResponses", baseUrl: "https://x/v1", model: "m", apiKey: "sk-secret", name: "n" } } as never);
    expect(result).toEqual({ ok: false, latencyMs: 30, model: null, error: { class: "auth", message: "rejected" } });
    await DaemonService.prototype.testFeatureProfile.call(self, { profileId: "fp-a" });
    expect(request.mock.calls).toEqual([
      ["POST", "/v2/feature-profiles/test", { body: { draft: { protocol: "openaiResponses", baseUrl: "https://x/v1", model: "m", apiKey: "sk-secret" } } }],
      ["POST", "/v2/feature-profiles/test", { body: { profileId: "fp-a" } }],
    ]);
    await expect(DaemonService.prototype.testFeatureProfile.call(self, { profileId: "x y" })).rejects.toThrow();
  });

  it("text rewrite routes: featureProfiles, and agent with backup 功能 Profiles (never mixed with ordinary backups)", () => {
    const base = { requestId: "req-12345678", text: "fix it" };
    expect(textRewriteBody({ ...base, route: { mode: "featureProfiles", featureProfileIds: ["fp-a", "fp-a", "fp-b"] } }).route).toEqual({ mode: "featureProfiles", featureProfileIds: ["fp-a", "fp-b"] });
    expect(() => textRewriteBody({ ...base, route: { mode: "featureProfiles", featureProfileIds: [] } })).toThrow();
    expect(textRewriteBody({ ...base, route: { mode: "agent", sessionId: "cutex.s", fallbackFeatureProfileIds: ["fp-a", "fp-b", "fp-c", "fp-d"] } }).route)
      .toEqual({ mode: "agent", sessionId: "cutex.s", fallbackFeatureProfileIds: ["fp-a", "fp-b", "fp-c"] });
    expect(() => textRewriteBody({ ...base, route: { mode: "agent", sessionId: "cutex.s", fallbackProfileIds: ["p"], fallbackFeatureProfileIds: ["fp-a"] } })).toThrow();
  });
});

describe("Settings → 功能 Profile", () => {
  let root: Root, node: HTMLDivElement;
  beforeEach(() => {
    resetFeatureProfilesForTests();
    env.rows = [row("fp-a", "便宜的小模型"), row("fp-b", "Haiku 改写", { protocol: "anthropicMessages", baseUrl: "https://api.anthropic.com", model: "claude-haiku-5-5", quotaType: "balance" })];
    env.calls = []; env.failNext = null; env.damaged = []; env.features = ["feature-profiles"]; env.testReply = null;
    node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  });
  afterEach(() => { act(() => root.unmount()); node.remove(); });
  const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
  const type = (el: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = (text: string) => [...node.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text || b.getAttribute("aria-label") === text || b.title === text)!;
  const editor = () => node.querySelector<HTMLElement>("[data-feature-profile-editor]");
  const inputs = () => [...editor()!.querySelectorAll<HTMLInputElement>("input")];

  it("lists the host's rows (name, API type · model · host · quota type), each a host setting no agent reads", async () => {
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    expect([...node.querySelectorAll("[data-feature-profile]")].map((e) => e.textContent)).toEqual(["便宜的小模型", "Haiku 改写"]);
    expect(node.textContent).toContain("OpenAI Responses · gpt-6.2-mini · api.openai.com · feature-profiles.quota.payAsYouGo");
    expect(node.textContent).toContain("feature-profiles.sectionHint");
    // The rows declare host / no agents (the page header's host picker and the card's chips come from them).
    const declared = [...node.querySelectorAll<HTMLElement>("[data-setting-row]")].filter((e) => e.querySelector("[data-feature-profile]"));
    expect(declared.map((e) => [e.dataset.effectTiming, e.dataset.effectSource])).toEqual([["none", "host"], ["none", "host"]]);
    expect(node.querySelector("[data-feature-profile-key-missing]")).toBeNull();
  });

  it("a row without a key says so beside its name, as a Profile card does; an empty list is an EmptyState", async () => {
    env.rows = [row("fp-a", "便宜的小模型", { keyPresent: false })];
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    const missing = node.querySelector("[data-feature-profile-key-missing]")!;
    expect(missing.textContent).toBe("⚠ feature-profiles.key.missing");
    expect(missing.closest("[data-list-row-title]")!.textContent).toContain("便宜的小模型");
    act(() => root.unmount());
    resetFeatureProfilesForTests();
    env.rows = [];
    root = createRoot(node);
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    expect(node.textContent).toContain("feature-profiles.empty");
    expect(node.querySelector("p.py-2")).toBeNull();
  });

  it("add: every field and the key are sent once; the form (and the key in it) is gone after saving", async () => {
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    act(() => button("feature-profiles.add").click());
    const [name, base, model, key] = inputs();
    type(name!, "新的");
    type(base!, "https://gw.example.com/v1");
    type(model!, "gpt-6.2-mini");
    expect(key!.type).toBe("password");
    type(key!, "sk-typed");
    await act(async () => button("feature-profiles.form.create").click());
    await settle();
    expect(env.calls).toEqual([{ method: "create", args: [{ name: "新的", protocol: "openaiResponses", baseUrl: "https://gw.example.com/v1", model: "gpt-6.2-mini", quotaType: "payAsYouGo", apiKey: "sk-typed" }] }]);
    expect(editor()).toBeNull();
    expect(node.innerHTML).not.toContain("sk-typed");
    expect([...node.querySelectorAll("[data-feature-profile]")].map((e) => e.textContent)).toContain("新的");
  });

  it("add: a refused save keeps the form, clears the key and says why", async () => {
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    act(() => button("feature-profiles.add").click());
    const [name, base, model, key] = inputs();
    type(name!, "x"); type(base!, "https://gw.example.com/v1"); type(model!, "m"); type(key!, "sk-1");
    env.failNext = "400 invalid_feature_profile: invalid feature profile";
    await act(async () => button("feature-profiles.form.create").click());
    await settle();
    expect(editor()).not.toBeNull();
    expect(node.querySelector("[data-feature-profile-problem]")!.textContent).toContain("feature-profiles.error.invalid_feature_profile");
    expect(inputs()[3]!.value).toBe("");
  });

  it("add: a loopback address cutex refuses is named as its own control port", async () => {
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    act(() => button("feature-profiles.add").click());
    const [name, base, model, key] = inputs();
    type(name!, "x"); type(base!, "http://127.0.0.1:24270/v1"); type(model!, "m"); type(key!, "sk-1");
    env.failNext = "400 invalid_feature_profile: Invalid Feature Profile settings";
    await act(async () => button("feature-profiles.form.create").click());
    await settle();
    expect(node.querySelector("[data-feature-profile-problem]")!.textContent).toContain("feature-profiles.error.controlPort");
  });

  it("add: a dedicated control-port code (once cutex names one) is shown plainly for any address", async () => {
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    act(() => button("feature-profiles.add").click());
    const [name, base, model, key] = inputs();
    type(name!, "x"); type(base!, "https://cutex.example.net/v1"); type(model!, "m"); type(key!, "sk-1");
    env.failNext = "400 feature_profile_control_port: Feature Profiles cannot connect to local Cutex control ports";
    await act(async () => button("feature-profiles.form.create").click());
    await settle();
    expect(node.querySelector("[data-feature-profile-problem]")!.textContent).toContain("feature-profiles.error.controlPort");
  });

  it("a damaged record shows as unreadable with its ID; delete only, then it is gone", async () => {
    env.damaged = ["fp-broken"];
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    const damaged = () => node.querySelector<HTMLElement>('[data-feature-profile-damaged="fp-broken"]');
    expect(damaged()!.textContent).toBe("feature-profiles.damaged");
    const rowEl = damaged()!.closest("div.-mx-4")!;
    expect(rowEl.textContent).toContain("fp-broken");
    expect(rowEl.querySelector('[aria-label="feature-profiles.edit"]')).toBeNull();
    const remove = () => damaged()!.closest("div.-mx-4")!.querySelector<HTMLButtonElement>('button[title="feature-profiles.remove"], button[aria-label="feature-profiles.remove"]')!;
    act(() => remove().click());
    const armed = [...damaged()!.closest("div.-mx-4")!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b !== remove());
    await act(async () => (armed ?? remove()).click());
    await settle();
    expect(env.calls).toEqual([{ method: "delete", args: ["fp-broken"] }]);
    expect(damaged()).toBeNull();
    expect([...node.querySelectorAll("[data-feature-profile]")].map((e) => e.textContent)).toEqual(["便宜的小模型", "Haiku 改写"]);
  });

  it("add: the desktop checks the address first (https, or http on loopback)", async () => {
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    act(() => button("feature-profiles.add").click());
    const [name, base, model, key] = inputs();
    type(name!, "x"); type(base!, "http://gw.example.com/v1"); type(model!, "m"); type(key!, "sk-1");
    await act(async () => button("feature-profiles.form.create").click());
    expect(node.querySelector("[data-feature-profile-problem]")!.textContent).toContain("feature-profiles.form.badBaseUrl");
    expect(env.calls).toEqual([]);
  });

  it("edit: the key shows only as set; only changed fields are sent; 更换密钥 sends a new one, 不换了 keeps it", async () => {
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    act(() => node.querySelector<HTMLButtonElement>('[aria-label="feature-profiles.edit"]')!.click());
    expect(editor()!.textContent).toContain("feature-profiles.key.set");
    expect(editor()!.querySelector("input[type=password]")).toBeNull();
    type(inputs()[2]!, "gpt-6.2-nano");
    await act(async () => button("settings.save").click());
    await settle();
    expect(env.calls.at(-1)).toEqual({ method: "patch", args: ["fp-a", { model: "gpt-6.2-nano" }] });
    // Replace the key.
    act(() => node.querySelector<HTMLButtonElement>('[aria-label="feature-profiles.edit"]')!.click());
    act(() => button("feature-profiles.key.replace").click());
    type(editor()!.querySelector<HTMLInputElement>("input[type=password]")!, "sk-new");
    await act(async () => button("settings.save").click());
    await settle();
    expect(env.calls.at(-1)).toEqual({ method: "patch", args: ["fp-a", { apiKey: "sk-new" }] });
    expect(node.innerHTML).not.toContain("sk-new");
    // Start replacing, then keep: nothing to send.
    act(() => node.querySelector<HTMLButtonElement>('[aria-label="feature-profiles.edit"]')!.click());
    act(() => button("feature-profiles.key.replace").click());
    act(() => button("feature-profiles.key.keep").click());
    const before = env.calls.length;
    await act(async () => button("settings.save").click());
    await settle();
    expect(env.calls.length).toBe(before);
    expect(editor()).toBeNull();
  });

  it("delete takes a second click", async () => {
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    const remove = () => node.querySelector<HTMLElement>('[data-feature-profile="fp-b"]')!.closest("div.-mx-4")!.querySelector<HTMLButtonElement>('button[title="feature-profiles.remove"], button[aria-label="feature-profiles.remove"]')!;
    act(() => remove().click());
    expect(env.calls).toEqual([]);
    const armed = [...node.querySelectorAll<HTMLButtonElement>("button")].find((b) => b !== remove() && /feature-profiles.remove|settings|confirm|删除|delete/i.test(`${b.title} ${b.getAttribute("aria-label")} ${b.textContent}`) && b.closest("div.-mx-4")?.querySelector('[data-feature-profile="fp-b"]'));
    await act(async () => (armed ?? remove()).click());
    await settle();
    expect(env.calls).toEqual([{ method: "delete", args: ["fp-b"] }]);
    expect(node.querySelector('[data-feature-profile="fp-b"]')).toBeNull();
  });

  const testButtons = () => [...node.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent === "feature-profiles.test.run");
  const outcome = (scope: ParentNode = node) => scope.querySelector<HTMLElement>("[data-feature-profile-test]");

  it("测试连接 is hidden on a host without feature-profile-test-v1", async () => {
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    expect(testButtons()).toEqual([]);
    act(() => button("feature-profiles.add").click());
    expect(node.querySelector("[data-feature-profile-test-form]")).toBeNull();
  });

  it("a saved row tests with its stored key: ✓ 可以连上 · ms · model, or the plain reason of its error class", async () => {
    env.features = ["feature-profiles", "feature-profile-test-v1"];
    env.rows.push(row("fp-c", "无 key", { keyPresent: false }));
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    const [a, b, c] = testButtons();
    expect(c!.disabled).toBe(true);
    expect(c!.title).toBe("feature-profiles.test.noKey");
    await act(async () => a!.click());
    await settle();
    expect(env.calls).toEqual([{ method: "test", args: [{ profileId: "fp-a" }] }]);
    const okRow = node.querySelector<HTMLElement>('[data-feature-profile-test-row="fp-a"]')!;
    expect(outcome(okRow)!.dataset.featureProfileTest).toBe("ok");
    expect(okRow.textContent).toBe('feature-profiles.test.ok · feature-profiles.test.ms {"n":640} · gpt-6.2-mini-2026-10-01');
    env.testReply = { ok: false, latencyMs: 120, model: null, error: { class: "auth", message: "provider rejected the credential (401)" } };
    await act(async () => b!.click());
    await settle();
    const failRow = node.querySelector<HTMLElement>('[data-feature-profile-test-row="fp-b"]')!;
    expect(outcome(failRow)!.dataset.featureProfileTest).toBe("auth");
    expect(failRow.textContent).toBe("feature-profiles.test.fail.auth");
    expect(outcome(failRow)!.title).toBe("provider rejected the credential (401)");
    // Opening the form drops the row's result (it belonged to the saved settings).
    act(() => node.querySelectorAll<HTMLButtonElement>('[aria-label="feature-profiles.edit"]')[0]!.click());
    expect(node.querySelector('[data-feature-profile-test-row="fp-a"]')).toBeNull();
  });

  it("the new-Profile form tests the typed draft with its key (nothing saved); without a key it cannot", async () => {
    env.features = ["feature-profiles", "feature-profile-test-v1"];
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    act(() => button("feature-profiles.add").click());
    const formTest = () => editor()!.querySelector<HTMLButtonElement>("[data-feature-profile-test-form] button")!;
    expect(formTest().disabled).toBe(true);
    const [name, base, model, key] = inputs();
    type(name!, "x"); type(base!, "https://gw.example.com/v1"); type(model!, "gpt-6.2-mini"); type(key!, "sk-typed");
    expect(formTest().disabled).toBe(false);
    env.testReply = { ok: false, latencyMs: 15000, model: null, error: { class: "timeout", message: "no response" } };
    await act(async () => formTest().click());
    await settle();
    expect(env.calls).toEqual([{ method: "test", args: [{ draft: { protocol: "openaiResponses", baseUrl: "https://gw.example.com/v1", model: "gpt-6.2-mini", apiKey: "sk-typed" } }] }]);
    expect(outcome(editor()!)!.dataset.featureProfileTest).toBe("timeout");
    expect(editor()).not.toBeNull();
    // The key stays in its password field only; no result or hint repeats it.
    expect(node.textContent).not.toContain("sk-typed");
    expect([...node.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).join()).not.toContain("sk-typed");
    // Changing a field drops the stale result.
    type(model!, "gpt-6.2-nano");
    expect(outcome(editor()!)).toBeNull();
    // A bad address is caught before anything is sent.
    type(base!, "http://gw.example.com/v1");
    await act(async () => formTest().click());
    expect(node.querySelector("[data-feature-profile-problem]")!.textContent).toContain("feature-profiles.form.badBaseUrl");
    expect(env.calls.length).toBe(1);
  });

  it("edit: unchanged settings test the saved row; a changed endpoint needs the key typed again", async () => {
    env.features = ["feature-profiles", "feature-profile-test-v1"];
    act(() => root.render(h(FeatureProfilesSection)));
    await settle();
    act(() => node.querySelector<HTMLButtonElement>('[aria-label="feature-profiles.edit"]')!.click());
    const formTest = () => editor()!.querySelector<HTMLButtonElement>("[data-feature-profile-test-form] button")!;
    type(inputs()[0]!, "新名字");
    await act(async () => formTest().click());
    await settle();
    expect(env.calls).toEqual([{ method: "test", args: [{ profileId: "fp-a" }] }]);
    type(inputs()[2]!, "gpt-6.2-nano");
    expect(formTest().disabled).toBe(true);
    expect(editor()!.querySelector("[data-feature-profile-test-form]")!.textContent).toContain("feature-profiles.test.needKey");
    act(() => button("feature-profiles.key.replace").click());
    type(editor()!.querySelector<HTMLInputElement>("input[type=password]")!, "sk-new");
    await act(async () => formTest().click());
    await settle();
    expect(env.calls.at(-1)).toEqual({ method: "test", args: [{ draft: { protocol: "openaiResponses", baseUrl: "https://api.openai.com/v1", model: "gpt-6.2-nano", apiKey: "sk-new" } }] });
    expect(env.calls.filter((c) => c.method === "patch")).toEqual([]);
  });
});
