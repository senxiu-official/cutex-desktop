import { dshLaunchFromForm, dshOnlyLaunch } from "./dshLaunch";
import type { LaunchForm } from "../../../shared/launch";
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { readComponentStatus, readComponentDsh } from "@cutex-desktop/cutex-client";
import { agentFeaturesOf, canRewindFiles, changesSettingsLive, lacks, steerAction } from "./agentFeatures";
import { DSH_DEFAULT_MODEL, DSH_FALLBACK_MODELS, dshEffortOf, dshModelIds } from "./dshModels";
import { createRequestOf } from "./profileCreate";
import { profileKind, profileRuntimeAvailable } from "./profileKind";
import { applyEvent, contextUsageOf, seedContextUsage, timelineFromThreadRead } from "./timeline";
import { readDshContext } from "./dshContext";

const context = { used: 321, size: 1000, observedAt: "2026-10-25T12:00:00Z", source: "acp", billing: "unavailable" };
const native = (params: unknown): EventEnvelope => ({ native: { kind: "notification", message: { method: "dsh/contextUsage/updated", params } } }) as EventEnvelope;

describe("DSH profile and capabilities", () => {
  it("gates only new DSH choices by their host capability without changing stored records", () => {
    const profiles = [{ cliKind: "dsh" }, { cliKind: "codex" }, { cliKind: "claude" }];
    expect(profiles.filter(p => profileRuntimeAvailable(p, new Set()))).toEqual(profiles.slice(1));
    expect(profiles.filter(p => profileRuntimeAvailable(p, new Set(["dsh-runtime"])))).toEqual(profiles);
    expect(profiles).toHaveLength(3);
  });
  it("creates only host environment references, with DSH's default model", () => {
    const result = createRequestOf({ name: " dsh-work ", kind: "dsh", preset: "", baseUrl: "" }, []);
    expect(result).toEqual({ request: { name: "dsh-work", kind: "dsh", options: { dsh: { model: "deepseek-flash", apiKeyEnv: "DEEPSEEK_API_KEY" } } } });
    expect(profileKind({ cliKind: "dsh", authKind: "none" })).toBe("dsh");
  });
  it("maps ACP structural names and keeps the older-host fallback safe", () => {
    for (const features of [undefined, { turnSteer: false, threadFork: false, threadRevert: false, threadDelete: false, contextOccupancy: true, billingUsage: false }]) {
      const agent = agentFeaturesOf({ native: { schema: { protocol: "dsh-acp-subset", capabilities: { features } } } });
      expect(agent.runtime).toBe("dsh");
      for (const key of ["turnSteer", "fork", "historyRevert", "threadDelete", "sideChat"] as const) expect(lacks(agent, key)).toBe(true);
      expect(steerAction("steer", agent)).toBe("queue");
    }
    expect(lacks(agentFeaturesOf({ runtime: { backend: "dsh" } }), "fork")).toBe(true);
    expect(lacks(agentFeaturesOf(null), "fork")).toBe(false);
    expect(lacks(agentFeaturesOf({ native: { schema: { protocol: "claude-app-server-subset" } } }), "fork")).toBe(false);
  });
  it("r265 runtime: fork / revert / delete, live model and effort, images — each only where declared", () => {
    const r265 = { turnSteer: false, threadFork: true, threadRevert: true, threadDelete: true, contextOccupancy: true, billingUsage: false, textInputOnly: false, imageInput: true };
    const agent = agentFeaturesOf({ native: { schema: { protocol: "dsh-acp-subset", capabilities: { features: r265 } } } });
    for (const key of ["fork", "historyRevert", "threadDelete", "imageInput"] as const) expect(lacks(agent, key)).toBe(false);
    expect(lacks(agent, "turnSteer")).toBe(true);
    expect(changesSettingsLive(agent)).toBe(true);
    // Never file rewind for DSH, whatever the host says.
    expect(canRewindFiles({ ...agent, map: { ...r265, fileRewind: true } }, { has: () => true })).toBe(false);
    // C5 withdraws fork / revert per session when its pinned runtime lacks session-ops.
    const pinnedOld = agentFeaturesOf({ native: { schema: { protocol: "dsh-acp-subset", capabilities: { features: { ...r265, threadFork: false, threadRevert: false } } } } });
    expect(lacks(pinnedOld, "fork")).toBe(true);
    expect(lacks(pinnedOld, "historyRevert")).toBe(true);
    expect(lacks(pinnedOld, "threadDelete")).toBe(false);
    // An explicit flag wins over the schema inference.
    expect(changesSettingsLive({ ...agent, map: { ...r265, threadSettingsUpdate: false } })).toBe(false);
    expect(changesSettingsLive({ runtime: "dsh", map: { textInputOnly: true, threadSettingsUpdate: true } })).toBe(true);
  });
  it("older DSH runtime (r264 schema): text only, the creation model fixed", () => {
    const r264 = { turnSteer: false, threadFork: false, threadRevert: false, threadDelete: false, contextOccupancy: true, billingUsage: false, textInputOnly: true, imageInput: false };
    const agent = agentFeaturesOf({ native: { schema: { protocol: "dsh-acp-subset", capabilities: { features: r264 } } } });
    expect(lacks(agent, "imageInput")).toBe(true);
    expect(changesSettingsLive(agent)).toBe(false);
    // No schema yet (bound by launchBinding only): unknown = the older behaviour.
    const bound = agentFeaturesOf({ launchBinding: { runtime: "dsh" } });
    expect(lacks(bound, "imageInput")).toBe(true);
    expect(changesSettingsLive(bound)).toBe(false);
    // Codex / Claude keep their controls.
    expect(changesSettingsLive(agentFeaturesOf(null))).toBe(true);
    expect(changesSettingsLive(agentFeaturesOf({ native: { schema: { protocol: "claude-app-server-subset" } } }))).toBe(true);
  });
  it("model list: cutex's catalog when it has rows, else DSH's own names; the current value is kept", () => {
    expect(DSH_FALLBACK_MODELS).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect(DSH_DEFAULT_MODEL).toBe("deepseek-flash");
    expect(dshModelIds(null)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect(dshModelIds({ models: [] }, "deepseek-v4-flash")).toEqual(["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash"]);
    expect(dshModelIds({ models: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }, { id: "deepseek-next" }] }, "deepseek-flash")).toEqual(["deepseek-flash", "deepseek-v4-pro", "deepseek-next"]);
    expect(dshEffortOf("max")).toBe("max");
    expect(dshEffortOf("medium")).toBeUndefined();
  });
  it("accepts prerequisite metadata and ignores absent or malformed metadata", () => {
    const dsh = { version: "0.2.1-rc.3", node: { minimum: "24.9.0", version: null, ready: false } };
    expect(readComponentStatus({ name: "dsh-runtime", state: "missing", dsh })?.dsh).toEqual(dsh);
    expect(readComponentStatus({ name: "claude-runtime", state: "ready" })?.dsh).toBeUndefined();
    expect(readComponentStatus({ name: "dsh-runtime" })?.dsh).toBeUndefined();
    expect(readComponentDsh({ ...dsh, node: { minimum: "24.9.0", ready: "false" } })).toBeUndefined();
  });
});

describe("ACP context occupancy", () => {
  it("reads history and events without inventing billing tokens", () => {
    const timeline = timelineFromThreadRead({ thread: { id: "dsh-thread", turns: [], dshContext: context } }, []);
    expect(timeline.contextUsage).toEqual({ used: 321, window: 1000, dsh: context });
    expect(applyEvent(timeline, native({ ...context, used: 500, threadId: "dsh-thread" }))).toBe(true);
    expect(timeline.contextUsage?.used).toBe(500);
    expect(timeline.contextUsage?.dsh?.billing).toBe("unavailable");
    expect(applyEvent(timeline, native({ ...context, used: 700, threadId: "other" }))).toBe(false);
    expect(timeline.contextUsage?.used).toBe(500);
    expect(seedContextUsage(timeline, { threadId: "dsh-thread", used: 0, window: 1000 })).toBe(false);
  });
  it("drops incomplete reports and accepts an explicitly observed zero", () => {
    expect(readDshContext({ ...context, used: undefined })).toBeNull();
    expect(readDshContext({ ...context, used: Number.NaN })).toBeNull();
    expect(readDshContext({ ...context, size: 0 })).toBeNull();
    expect(readDshContext({ ...context, billing: 0 })).toBeNull();
    expect(contextUsageOf(native({ ...context, used: 0 }))?.used).toBe(0);
    expect(timelineFromThreadRead({ thread: { id: "legacy", turns: [] } }, []).contextUsage).toBeNull();
  });
});

describe("DSH new-agent launch payload", () => {
  it("drops every permission from a restored Codex form, preserving only chosen model/effort", () => {
    const form: LaunchForm = { model: " deepseek-v4-flash ", reasoningEffort: "max", sandbox: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "auto_review", networkAccess: true, writableRoots: ["/other"] };
    expect(dshLaunchFromForm(form, true)).toEqual({ model: "deepseek-v4-flash", reasoningEffort: "max" });
    expect(dshLaunchFromForm(form, false)).toBeUndefined();
    expect(dshLaunchFromForm({ ...form, model: "", reasoningEffort: "" }, true)).toBeUndefined();
    expect(dshOnlyLaunch({ ...form, claudePermissionMode: "bypassPermissions" })).toEqual({ model: "deepseek-v4-flash", reasoningEffort: "max" });
  });
});
