// Per-module preview mocks (dev/mockTypes.ts): every modules/<id>/mock.ts is collected, merges into
// the core mock bridge without clashes, and stays out of non-dev code (production bundles).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreloadBridge } from "../src/shared/ipc";
import { accountState, claudeAccountOptions } from "../src/renderer/src/lib/claudeAccounts";

const SRC = join(__dirname, "../src/renderer/src");
const MODULES_DIR = join(SRC, "modules");

async function install(search: string): Promise<PreloadBridge> {
  vi.resetModules();
  vi.useFakeTimers();
  const win: { cutex?: PreloadBridge } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { search });
  vi.stubGlobal("document", { title: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
  installMockBridge();
  return win.cutex!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("module mocks", () => {
  it("every modules/<id>/mock.ts is collected and exports `mock`", async () => {
    const dirs = readdirSync(MODULES_DIR).filter((d) => statSync(join(MODULES_DIR, d)).isDirectory() && readdirSync(join(MODULES_DIR, d)).includes("mock.ts"));
    const { MODULE_MOCKS } = await import("../src/renderer/src/dev/mockModules");
    expect(MODULE_MOCKS.map((m) => m.id).sort()).toEqual(dirs.sort());
    for (const m of MODULE_MOCKS) expect(typeof m.mock, m.id).toBe("object");
    expect(dirs).toEqual(expect.arrayContaining(["delegations", "jobs", "owner-notify", "runtime-packages", "codex-config"]));
  });

  it("mock code is only imported from dev/ (never from app code, so never bundled)", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
    for (const file of files(SRC)) {
      const rel = relative(SRC, file).replaceAll("\\", "/");
      if (rel.startsWith("dev/")) continue;
      const code = readFileSync(file, "utf8");
      const isMock = /^modules\/[^/]+\/mock\.ts$/.test(rel);
      for (const m of code.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
        const spec = m[1]!;
        if (isMock) {
          // A module mock reaches the core only through MockCore: shared types / helpers and dev/mockTypes.
          expect(spec.startsWith("../../../../shared/") || spec.startsWith("@cutex-desktop/") || spec === "../../dev/mockTypes", `${rel} imports ${spec}`).toBe(true);
        } else {
          const devOrMock = /(^|\/)mock$/.test(spec) || /(^|\/)dev\//.test(spec);
          expect(devOrMock, `${rel} imports ${spec}`).toBe(rel === "bridge.ts" && spec === "./dev/mockBridge");
        }
      }
    }
  });

  it("new cutex: module api methods, threads, bootstrap state and settings merge into the bridge", async () => {
    const bridge = await install("");
    const api = bridge.api;
    for (const name of ["asks", "jobs", "ownerNotifications", "runtimePackages", "codexRequest", "experimentalFeatures", "services", "approvals", "usage", "usagePrices", "threadGoal", "backgroundTerminals", "subAgentThread", "clientTokens", "createPairingCode"] as const) {
      expect(typeof api[name], name).toBe("function");
    }
    const lead = await api.bootstrap("lead");
    expect((lead.native as { result: { thread: { turns: unknown[] } } }).result.thread.turns.length).toBeGreaterThan(0);
    const eva = await api.bootstrap("eva");
    expect((eva.cutexState as Record<string, unknown>).ownerNotifications).toBeInstanceOf(Array);
    const settings = (await api.getSettings()) as unknown as Record<string, unknown>;
    expect(settings.ownerNotify).toBeTruthy();
    expect(settings.managementListenEntries).toBeInstanceOf(Array);
    expect(await api.approvals("pending")).not.toBeNull();
    expect((await api.capabilities())!.featureList).toContain("job-service");
  });

  it("?legacy: module data follows the old cutex", async () => {
    const bridge = await install("?legacy");
    const api = bridge.api;
    const eva = await api.bootstrap("eva");
    expect((eva.cutexState as Record<string, unknown>).ownerNotifications).toBeUndefined();
    const settings = (await api.getSettings()) as unknown as Record<string, unknown>;
    expect(settings.ownerNotify).toBeUndefined();
    expect(settings.managementListenEntries).toBeUndefined();
    expect(await api.approvals("pending")).toBeNull();
    expect((await api.capabilities())!.featureList).not.toContain("job-service");
  });

  it("module-owned profile fields: claude-accounts binds Claude profiles (PATCH like cutex)", async () => {
    const api = (await install("")).api;
    const settle = async <T>(p: Promise<T>) => (await vi.advanceTimersByTimeAsync(500), p);
    const profiles = (await api.listProfiles())!.profiles;
    expect(profiles.find((p) => p.name === "claude")!.claudeAccount).toBe("default");
    expect(profiles.find((p) => p.name === "omega")!.claudeAccount).toBeNull();
    // Rebind: the profile reports it, the account lists the profile, nothing leaks into the config.
    const bound = await api.patchProfile("claude", { claudeAccount: "ca-work7k2m9q" });
    expect(bound.claudeAccount).toBe("ca-work7k2m9q");
    expect(bound.detail.config).toBeNull();
    const work = (await settle(api.claudeAccounts()))!.accounts.find((a) => a.id === "ca-work7k2m9q")!;
    expect(work.profiles.map((p) => p.name)).toContain("claude");
    // Refusals: unknown id (400), Codex profile; a refused PATCH changes nothing.
    await expect(api.patchProfile("claude", { claudeAccount: "ca-gone00000", color: "#000000" })).rejects.toThrow("claudeAccount: no Claude account ca-gone00000 on this host");
    expect((await api.getProfile("claude")).appearance.color).not.toBe("#000000");
    await expect(api.patchProfile("omega", { claudeAccount: "ca-work7k2m9q" })).rejects.toThrow("Claude profiles only");
    expect((await api.patchProfile("claude", { claudeAccount: null })).claudeAccount).toBe("default");
  });

  it("claude-accounts: 添加 Claude 订阅 end to end — needs a login, then binds a new Claude profile (POST like cutex)", async () => {
    const api = (await install("")).api;
    const settle = async <T>(p: Promise<T>) => (await vi.advanceTimersByTimeAsync(1000), p);
    const created = await settle(api.createClaudeAccount({ label: "Team", kind: "subscription" }));
    if (!created.ok) throw new Error(created.error.message);
    const added = (await settle(api.claudeAccounts()))!.accounts.find((a) => a.id === created.account.id)!;
    expect(added).toMatchObject({ label: "Team", kind: "subscription", profiles: [] });
    expect(accountState(added)).toBe("needsLogin");
    expect(added.loginCommand?.cutex).toBe(`cutex human claude account login ${added.id}`);
    // The select's options name it with its state.
    expect(claudeAccountOptions([added], added.id).find((o) => o.id === added.id)).toMatchObject({ label: "Team", state: "needsLogin", missing: false });
    // 添加 profile with the account: the profile reports it, the account lists the profile.
    const profile = await api.createProfile({ name: "claude-team", kind: "claude", claudeAccount: added.id });
    expect(profile.claudeAccount).toBe(added.id);
    expect((await settle(api.claudeAccounts()))!.accounts.find((a) => a.id === added.id)!.profiles.map((p) => p.name)).toEqual(["claude-team"]);
    // Refused like cutex (another kind, an unknown id): nothing is created.
    await expect(api.createProfile({ name: "codex-team", kind: "chatgpt", claudeAccount: added.id })).rejects.toThrow("Claude profiles only");
    await expect(api.createProfile({ name: "claude-gone", kind: "claude", claudeAccount: "ca-gone00000" })).rejects.toThrow("no Claude account ca-gone00000");
    const names = (await api.listProfiles())!.profiles.map((p) => p.name);
    expect(names).toContain("claude-team");
    expect(names).not.toContain("codex-team");
    expect(names).not.toContain("claude-gone");
  });

  it("?legacy: no claudeAccount on profiles", async () => {
    const api = (await install("?legacy")).api;
    expect((await api.listProfiles())!.profiles.every((p) => !("claudeAccount" in p))).toBe(true);
  });
});
