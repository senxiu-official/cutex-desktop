// r266 Kimi Code runtime in the desktop (docs/design/049): one ACP-runtime table (lib/acpRuntimes) drives DSH and Kimi
// alike — feature gating, steer delivery, revert wording, approval source, profile kinds — and the Profile variants
// flow gains the kimi column, the Kimi-account provider and Kimi's model / effort choices.
import { describe, expect, it } from "vitest";
import { ACP_RUNTIME_INFO, acpNotRecommended, acpRuntimeAvailable, acpRuntimeOf, acpRuntimeShown, isAcpRuntime } from "../src/renderer/src/lib/acpRuntimes";
import { readComponentKimi } from "@cutex-desktop/cutex-client";
import { agentFeaturesOf, changesSettingsLive, isAcpAgent, lacks, skillSource } from "../src/renderer/src/lib/agentFeatures";
import { revertTexts } from "../src/renderer/src/lib/runtimeWording";
import { approvalSourceKeys } from "../src/renderer/src/components/ApprovalSource";
import { steerDelivery } from "../src/renderer/src/lib/legacyDelivery/pendingSteers";
import { profileKind, profileRuntimeAvailable } from "../src/renderer/src/lib/profileKind";
import { initialRuntimes, isKimiNative, newProfilePlan, plannedDefault, previewCompatibility, reasonKey, RUNTIME_LABEL } from "../src/renderer/src/lib/profileVariants";
import { runtimeEfforts, runtimeModelChoices, variantCatalogModels, variantCatalogView } from "../src/renderer/src/lib/runtimeChoices";
import { KIMI_NOT_RECOMMENDED } from "../src/renderer/src/lib/kimiNotice";
import { chatModelAndEffort } from "../src/renderer/src/lib/dshModels";
import { readAcpContext } from "../src/renderer/src/lib/dshContext";
import { applyEvent, contextUsageOf, emptyTimeline, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import type { ProfilePreset } from "../src/shared/ipc";

const kimiSession = (features: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  native: { schema: { protocol: "kimi-acp-subset", capabilities: features ? { features } : {} } },
  runtime: { backend: "kimi" },
  ...extra,
});

describe("ACP runtime table", () => {
  it("names Kimi's protocol, backend, capability, component and label", () => {
    expect(ACP_RUNTIME_INFO.kimi).toMatchObject({ protocol: "kimi-acp-subset", backend: "kimi", capability: "kimi-runtime", component: "kimi-runtime", label: "Kimi" });
    expect(isAcpRuntime("kimi")).toBe(true);
    expect(isAcpRuntime("codex")).toBe(false);
    expect(acpRuntimeOf({ backend: "kimi" })).toBe("kimi");
    expect(acpRuntimeOf({ bound: "kimi" })).toBe("kimi");
    expect(acpRuntimeOf({ protocol: "dsh-acp-subset" })).toBe("dsh");
    expect(acpRuntimeOf({ protocol: "codex-app-server", backend: "app_server" })).toBeNull();
  });

  it("the not-recommended switch is one constant per runtime", () => {
    expect(acpNotRecommended("kimi")).toBe(KIMI_NOT_RECOMMENDED);
    expect(ACP_RUNTIME_INFO.kimi.notRecommendedText).toBe("kimi.notRecommended");
    expect(acpNotRecommended("codex")).toBe(false);
  });

  it("availability follows the host capability (the installed component)", () => {
    expect(acpRuntimeAvailable("kimi", new Set(["dsh-runtime"]))).toBe(false);
    expect(acpRuntimeAvailable("kimi", new Set(["kimi-runtime"]))).toBe(true);
  });
});

describe("runtime page group and component facts", () => {
  it("Kimi shows when installed, or when cutex knows Kimi and can install components; DSH only when installed", () => {
    expect(acpRuntimeShown("kimi", new Set(["kimi-runtime"]))).toBe(true);
    expect(acpRuntimeShown("kimi", new Set(["kimi-runtime-profiles", "components"]))).toBe(true);
    expect(acpRuntimeShown("kimi", new Set(["kimi-runtime-profiles"]))).toBe(false);
    expect(acpRuntimeShown("kimi", new Set(["components"]))).toBe(false);
    expect(acpRuntimeShown("dsh", new Set(["components"]))).toBe(false);
    expect(acpRuntimeShown("dsh", new Set(["dsh-runtime"]))).toBe(true);
  });

  it("reads the pinned Kimi Code version and an optional Node block (DSH's shape)", () => {
    expect(readComponentKimi({ version: "2.3.3" })).toEqual({ version: "2.3.3" });
    expect(readComponentKimi({ version: "2.3.3", node: { minimum: "22.19.0", version: null, ready: false } })).toEqual({ version: "2.3.3", node: { minimum: "22.19.0", version: null, ready: false } });
    expect(readComponentKimi({ version: "2.3.3", node: { minimum: 22 } })).toEqual({ version: "2.3.3" });
    expect(readComponentKimi({ version: "" })).toBeUndefined();
    expect(readComponentKimi(null)).toBeUndefined();
  });
});

describe("Kimi agent features", () => {
  it("a Kimi session is the kimi runtime by protocol, backend or launch binding", () => {
    expect(agentFeaturesOf(kimiSession(null)).runtime).toBe("kimi");
    expect(agentFeaturesOf({ launchBinding: { runtime: "kimi" } }).runtime).toBe("kimi");
    expect(agentFeaturesOf({ runtime: { backend: "kimi" } }).runtime).toBe("kimi");
    expect(isAcpAgent(agentFeaturesOf(kimiSession(null)))).toBe(true);
  });

  it("structural actions and steer need explicit support; old / unknown hosts stay off", () => {
    const none = agentFeaturesOf(kimiSession(null));
    for (const f of ["turnSteer", "fork", "historyRevert", "threadDelete", "sideChat", "imageInput"] as const) expect(lacks(none, f)).toBe(true);
    const on = agentFeaturesOf(kimiSession({ turnSteer: false, threadFork: true, threadRevert: true, threadDelete: true, imageInput: true, textInputOnly: false }));
    expect(lacks(on, "turnSteer")).toBe(true);
    expect(lacks(on, "fork")).toBe(false);
    expect(lacks(on, "historyRevert")).toBe(false);
    expect(lacks(on, "threadDelete")).toBe(false);
    expect(lacks(on, "imageInput")).toBe(false);
    expect(skillSource(on, new Set())).toBeNull();
  });

  it("live model / effort follow threadSettingsUpdate", () => {
    expect(changesSettingsLive(agentFeaturesOf(kimiSession({ threadSettingsUpdate: true })))).toBe(true);
    expect(changesSettingsLive(agentFeaturesOf(kimiSession({ threadSettingsUpdate: false })))).toBe(false);
    expect(changesSettingsLive(agentFeaturesOf(kimiSession(null)))).toBe(false);
  });

  it("billing hint only on an explicit billingUsage: false", () => {
    expect(lacks(agentFeaturesOf(kimiSession({ billingUsage: false })), "billingUsage")).toBe(true);
    expect(lacks(agentFeaturesOf(kimiSession({})), "billingUsage")).toBe(false);
  });

  it("a waiting message goes to the next turn; revert says files stay; approvals are Kimi's", () => {
    expect(steerDelivery({ imageCount: 0, extra: [] }, "kimi")).toBe("nextTurn");
    expect(revertTexts("kimi")).toEqual({ revertHint: "kimi.revertHint", revertConfirm: "kimi.revertConfirm", editResendHint: "kimi.editResendHint", editResendConfirm: "kimi.editResendConfirm" });
    expect(revertTexts("dsh").revertHint).toBe("dsh.revertHint");
    expect(revertTexts("codex").revertHint).toBe("reply.revertHint");
    expect(approvalSourceKeys("native", "kimi")).toEqual({ label: "kimi.approvalSource", hint: "kimi.approvalSource.hint" });
    expect(approvalSourceKeys("cutex", "kimi").label).toBe("approvalSource.cutex");
  });

  it("the footer falls back to the session defaults like DSH", () => {
    expect(chatModelAndEffort(null, "kimi", { model: "kimi-code/kimi-for-coding", reasoningEffort: "high" })).toEqual({ model: "kimi-code/kimi-for-coding", effort: "high" });
    expect(chatModelAndEffort(null, "codex", { model: "x" })).toEqual({ model: null, effort: null });
  });

  it("a live kimi/contextUsage/updated reaches the timeline state", () => {
    const state = emptyTimeline();
    const changed = applyEvent(state, { native: { kind: "notification", message: { method: "kimi/contextUsage/updated", params: { threadId: null, used: 9, size: 90, observedAt: "2026-10-27T10:00:00Z", source: "acp" } } } } as never);
    expect(changed).toBe(true);
    expect(state.contextUsage).toMatchObject({ used: 9, window: 90 });
  });

  it("occupancy: thread.kimiContext and kimi/contextUsage/updated (observedAt may be null)", () => {
    expect(readAcpContext({ used: 10, size: 100, observedAt: null, source: "acp" })?.used).toBe(10);
    expect(readAcpContext({ used: 10, size: 0, observedAt: null, source: "acp" })).toBeNull();
    const t = timelineFromThreadRead({ thread: { id: "th", turns: [], kimiContext: { used: 5, size: 50, observedAt: "2026-10-27T00:00:00Z", source: "acp" } } });
    expect(t.contextUsage).toMatchObject({ used: 5, window: 50 });
    const live = contextUsageOf({ native: { kind: "notification", message: { method: "kimi/contextUsage/updated", params: { threadId: "th", used: 7, size: 70, observedAt: null, source: "acp" } } } } as never);
    expect(live).toMatchObject({ threadId: "th", used: 7, window: 70 });
  });
});

describe("Kimi-kind profiles", () => {
  it("profileKind / availability", () => {
    expect(profileKind({ cliKind: "kimi", authKind: "none" })).toBe("kimi");
    expect(profileRuntimeAvailable({ cliKind: "kimi" }, new Set())).toBe(false);
    expect(profileRuntimeAvailable({ cliKind: "kimi" }, new Set(["kimi-runtime"]))).toBe(true);
    expect(profileRuntimeAvailable({ cliKind: "codex" }, new Set())).toBe(true);
  });
});

const preset = (id: string, baseUrl: string, providerId = id): ProfilePreset => ({ id, aliases: [], label: id, providerId, baseUrl, baseUrlRequired: false } as unknown as ProfilePreset);
const opts = { dshInstalled: false, claudeInstalled: true, kimiProfiles: true, kimiInstalled: false };

describe("new Profile: the kimi column", () => {
  it("Kimi-native = a Moonshot / Kimi Code preset on an official https host", () => {
    expect(isKimiNative(preset("moonshot", "https://api.moonshot.ai/v1"), "")).toBe(true);
    expect(isKimiNative(preset("kimi-code", "https://api.kimi.com/coding/v1"), "")).toBe(true);
    expect(isKimiNative(preset("moonshot", "https://api.moonshot.ai/v1"), "https://relay.example.com/v1")).toBe(false);
    expect(isKimiNative(preset("zai", "https://api.moonshot.ai/v1"), "")).toBe(false);
  });

  it("Moonshot API key: codex + kimi (needs install); a relay: providerNotKimiNative; old hosts: no kimi row", () => {
    const rows = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, preset("moonshot", "https://api.moonshot.ai/v1"), opts);
    expect(rows.find((r) => r.runtime === "kimi")).toMatchObject({ status: "componentNotInstalled" });
    expect(rows.find((r) => r.runtime === "codex")?.status).toBe("supported");
    const relay = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "https://relay.example.com/v1" }, preset("moonshot", "https://api.moonshot.ai/v1"), opts);
    expect(relay.find((r) => r.runtime === "kimi")).toMatchObject({ status: "unsupported", reason: "providerNotKimiNative" });
    const old = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, preset("moonshot", "https://api.moonshot.ai/v1"), { ...opts, kimiProfiles: false });
    expect(old.some((r) => r.runtime === "kimi")).toBe(false);
    expect(reasonKey("providerNotKimiNative")).toBe("variants.reason.providerNotKimiNative");
  });

  it("cute-codex stays checked and the default; Kimi is added by ticking", () => {
    const rows = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, preset("moonshot", "https://api.moonshot.ai/v1"), { ...opts, kimiInstalled: true });
    expect(initialRuntimes(rows)).toEqual(["codex"]);
    expect(plannedDefault(["codex", "kimi"])).toBe("codex");
    expect(plannedDefault(["codex", "kimi"], false)).toBe("codex");
  });

  it("a Kimi-account Profile: only kimi, checked even before the component is installed", () => {
    const rows = previewCompatibility({ provider: "kimi", envName: null, baseUrl: "" }, null, opts);
    expect(rows.filter((r) => r.status !== "unsupported").map((r) => r.runtime)).toEqual(["kimi"]);
    expect(rows.find((r) => r.runtime === "codex")?.reason).toBe("kimiAccountKimiOnly");
    expect(initialRuntimes(rows)).toEqual(["kimi"]);
  });

  it("plans a Kimi-kind create with the account and the primary's defaults", () => {
    const rows = previewCompatibility({ provider: "kimi", envName: null, baseUrl: "" }, null, opts);
    const draft = { provider: "kimi" as const, preset: "", baseUrl: "", apiKey: "", envName: null, kimiAccount: "ka-work7k2m9q", runtimes: ["kimi" as const], defaults: { kimi: { model: "kimi-code/kimi-k3", reasoningEffort: "medium" } }, name: "kimi", color: null };
    const r = newProfilePlan(draft, { name: "kimi" }, rows);
    expect("plan" in r && r.plan.create).toEqual({ name: "kimi", kind: "kimi", kimiAccount: "ka-work7k2m9q" });
    expect("plan" in r && r.plan.primaryDefaults).toEqual({ variantId: "kimi", defaults: { model: "kimi-code/kimi-k3", reasoningEffort: "medium" } });
    expect("plan" in r && r.plan.addVariants).toEqual([]);
    expect(newProfilePlan({ ...draft, kimiAccount: "" }, { name: "kimi" }, rows)).toEqual({ error: "kimiAccountMissing" });
  });

  it("plans a Moonshot API-key Profile with a kimi variant; the key stays on the Profile", () => {
    const rows = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, preset("moonshot", "https://api.moonshot.ai/v1"), { ...opts, kimiInstalled: true });
    const draft = { provider: "apiKey" as const, preset: "moonshot", baseUrl: "", apiKey: "sk-test", envName: null, runtimes: ["codex" as const, "kimi" as const], defaults: { kimi: { model: "", reasoningEffort: "high" } }, name: "moon", color: null };
    const r = newProfilePlan(draft, { name: "moon", preset: "moonshot" }, rows);
    expect("plan" in r && r.plan.create).toMatchObject({ kind: "apiKey", preset: "moonshot", apiKey: "sk-test" });
    expect("plan" in r && r.plan.addVariants).toEqual([{ runtime: "kimi", defaults: { reasoningEffort: "high" } }]);
    expect("plan" in r && r.plan.defaultVariant).toBeNull();
    expect(RUNTIME_LABEL.kimi).toBe("Kimi");
  });

  it("a host variable credential is DSH-only, so it rules out kimi too", () => {
    const rows = previewCompatibility({ provider: "apiKey", envName: "X", baseUrl: "" }, preset("moonshot", "https://api.moonshot.ai/v1"), { ...opts, kimiInstalled: true });
    expect(rows.find((r) => r.runtime === "kimi")).toMatchObject({ status: "unsupported", reason: "envCredentialDshOnly" });
  });
});

describe("Kimi model / effort choices", () => {
  it("five efforts; a catalog when cutex sends one, else free text", () => {
    expect(runtimeEfforts("kimi")).toEqual(["off", "low", "medium", "high", "max"]);
    expect(runtimeEfforts("dsh")).toEqual(["off", "low", "high", "max"]);
    expect(runtimeEfforts("codex")).toBeNull();
    expect(runtimeModelChoices("kimi", { models: null })).toBeNull();
    expect(runtimeModelChoices("kimi", { models: [{ id: "a" }] }, "b")).toEqual(["a", "b"]);
    expect(runtimeModelChoices("dsh", null)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  });

  it("a variant's catalog becomes read-only model rows for the new-agent panel", () => {
    const v = { defaults: { model: null, reasoningEffort: null }, models: [{ id: "kimi-code/kimi-for-coding", inputModalities: ["text", "image"], supportedReasoningEfforts: ["low", "high"], defaultReasoningEffort: "high", isDefault: true }] };
    expect(variantCatalogModels(v)[0]).toMatchObject({ id: "kimi-code/kimi-for-coding", inputModalities: ["text", "image"], isDefault: true });
    expect(variantCatalogView({ id: "k", name: "k" }, v)?.selectedModel).toBe("kimi-code/kimi-for-coding");
    expect(variantCatalogView({ id: "k", name: "k" }, { ...v, models: [] })).toBeNull();
  });
});
