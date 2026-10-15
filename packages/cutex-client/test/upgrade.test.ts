import { describe, expect, it } from "vitest";
import {
  CutexClient,
  isUpgradeCancellable,
  isUpgradeServicesDown,
  isUpgradeTerminal,
  readHostServiceInfo,
  upgradeApplyBody,
  upgradeEventOf,
  upgradeNoteText,
  upgradeRollbackBody,
  upgradeSettingsBody,
  upgradeStageBody,
} from "../src/index";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A client whose fetch answers from `reply(method, path)` and records every call. */
function stub(reply: (method: string, path: string) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = reply(method, new URL(url).pathname);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { client: new CutexClient({ baseUrl: "http://h:1", token: "tok" }, { fetch, clientId: "c" }), calls };
}

const v2Error = (code: string, message: string, details: unknown = {}) => ({ contractVersion: 2, error: { code, message, retryable: false, details } });

const RUN = { runId: "upg-0123456789ab", kind: "apply", fromRelease: "r240", toRelease: "r241", mode: "reload", class: "rollback-safe", phase: "queued", createdAt: "2026-10-15T00:00:00Z", maxWaitSecs: 3600, packageRun: "after", timeline: [] };

describe("upgrade body builders", () => {
  it("keeps known fields and checks ranges", () => {
    expect(upgradeApplyBody({ release: "r241", mode: "full", maxWaitSecs: 600, confirmOneWay: "r241", packageRun: "during", extra: 1 } as never)).toEqual({ release: "r241", mode: "full", maxWaitSecs: 600, confirmOneWay: "r241", packageRun: "during" });
    expect(upgradeApplyBody()).toEqual({});
    expect(() => upgradeApplyBody({ mode: "fast" as never })).toThrow("bad mode");
    expect(() => upgradeApplyBody({ maxWaitSecs: 86_401 })).toThrow("bad maxWaitSecs");
    expect(() => upgradeApplyBody({ maxWaitSecs: 1.5 })).toThrow("bad maxWaitSecs");
    expect(() => upgradeApplyBody({ release: "r 241" })).toThrow("bad release");
    expect(upgradeStageBody()).toEqual({});
    expect(upgradeStageBody("r241")).toEqual({ release: "r241" });
    expect(upgradeRollbackBody({ dryRun: true, to: "r239" })).toEqual({ dryRun: true, to: "r239" });
    expect(() => upgradeRollbackBody({ dryRun: "yes" as never })).toThrow("bad dryRun");
  });

  it("never sends source and refuses an empty settings patch", () => {
    expect(upgradeSettingsBody({ channel: "main", checkIntervalHours: 0, autoStage: true, autoApply: false, packageRun: "none", packageRunBatch: 5, maxWaitSecs: 0, source: "https://x" } as never)).toEqual({ channel: "main", checkIntervalHours: 0, autoStage: true, autoApply: false, packageRun: "none", packageRunBatch: 5, maxWaitSecs: 0 });
    expect(() => upgradeSettingsBody({})).toThrow("empty");
    expect(() => upgradeSettingsBody({ checkIntervalHours: 169 })).toThrow("checkIntervalHours");
    expect(() => upgradeSettingsBody({ packageRunBatch: 0 })).toThrow("packageRunBatch");
    expect(() => upgradeSettingsBody({ channel: "stable" as never })).toThrow("bad channel");
  });
});

describe("upgrade phases and readers", () => {
  it("classifies phases like cutex", () => {
    expect(isUpgradeTerminal("committed")).toBe(true);
    expect(isUpgradeTerminal("needs-owner")).toBe(true);
    expect(isUpgradeTerminal("verifying")).toBe(false);
    expect(isUpgradeServicesDown("swapping")).toBe(true);
    expect(isUpgradeServicesDown("backing-up")).toBe(false);
    expect(isUpgradeCancellable("waiting-idle")).toBe(true);
    expect(isUpgradeCancellable("stopping")).toBe(false);
  });

  it("reads the /v2/host blocks (older cutex: null each)", () => {
    expect(readHostServiceInfo({ hostId: "h", schema: "cutex/host/v1" })).toEqual({ serviceManager: null, runtimes: null });
    const info = readHostServiceInfo({
      serviceManager: { kind: "systemd", unit: "cutex-management-api.service", managedInstall: true },
      runtimes: { native: { selected: "r53", latest: "r53", inUse: [{ release: "r53", version: "0.162.1-r53", agents: 4, selected: true, missing: false }, { release: 7 }] }, claude: { selected: "claude-r12", inUse: [] }, unpinnedAgents: 2 },
    });
    expect(info.serviceManager).toEqual({ kind: "systemd", unit: "cutex-management-api.service", managedInstall: true });
    expect(info.runtimes?.native.inUse).toEqual([{ release: "r53", version: "0.162.1-r53", agents: 4, selected: true, missing: false }]);
    expect(info.runtimes?.unpinnedAgents).toBe(2);
  });

  it("reads the upgrade event and picks note languages", () => {
    expect(upgradeEventOf({ cutex: { method: "cutex/peers/changed", params: {} } })).toBeNull();
    const e = upgradeEventOf({ cutex: { method: "cutex/upgrade/updated", params: { reason: "startup", hostId: "h", run: { runId: "upg-0123456789ab", kind: "apply", phase: "stopping", fromRelease: "r240", toRelease: "r241", servicesDown: true }, available: "r241", staged: null } } });
    expect(e).toMatchObject({ reason: "startup", run: { phase: "stopping", servicesDown: true }, available: "r241", staged: null });
    expect(upgradeNoteText({ en: "Fixes", "zh-CN": "修复" }, "zh-Hant-CN")).toBe("修复");
    expect(upgradeNoteText({ en: "Fixes", "zh-CN": "修复" }, "en-AU")).toBe("Fixes");
    expect(upgradeNoteText({ "zh-CN": "修复" }, "en")).toBe("修复");
    expect(upgradeNoteText(undefined, "en")).toBeNull();
  });
});

describe("CutexClient upgrade routes", () => {
  it("answers null for the status on an older cutex", async () => {
    const { client } = stub(() => ({ status: 404, body: v2Error("route_not_found", "management v2 route not found") }));
    expect(await client.upgradeStatus()).toBeNull();
  });

  it("returns refusals as values with their details", async () => {
    const { client, calls } = stub((method, path) => {
      if (path === "/v2/upgrade/apply") return { status: 409, body: v2Error("one_way_unconfirmed", "r241 is one-way", { migrations: [{ id: "m1", class: "one-way", since: "r241" }] }) };
      if (path === "/v2/upgrade/stage") return { status: 409, body: v2Error("upgrade_blocked", "not managed", { reason: "unmanaged_install" }) };
      if (path === "/v2/upgrade/check") return { status: 503, body: v2Error("no_trusted_keys", "no key") };
      return { status: 500, body: "boom" };
    });
    expect(await client.upgradeApply({ maxWaitSecs: 60 })).toEqual({ ok: false, error: { code: "one_way_unconfirmed", message: "r241 is one-way", status: 409, migrations: [{ id: "m1", class: "one-way", since: "r241" }] } });
    expect(calls[0]).toMatchObject({ method: "POST", body: { maxWaitSecs: 60 } });
    expect(await client.upgradeStage()).toEqual({ ok: false, error: { code: "upgrade_blocked", message: "not managed", status: 409, reason: "unmanaged_install" } });
    expect(await client.upgradeCheck()).toMatchObject({ ok: false, error: { code: "no_trusted_keys", status: 503 } });
    // An uncoded failure still throws.
    await expect(client.upgradeCancel()).rejects.toThrow();
  });

  it("unwraps run / staging / settings / runs", async () => {
    const { client, calls } = stub((method, path) => {
      if (path === "/v2/upgrade/apply") return { status: 202, body: { run: RUN } };
      if (path === "/v2/upgrade/stage") return { status: 202, body: { staging: { release: "r241", state: "running" } } };
      if (path === "/v2/upgrade/settings") return { status: 200, body: { settings: { channel: "release", source: "https://x", checkIntervalHours: 6, autoStage: true, autoApply: true, packageRun: "after", packageRunBatch: 5, maxWaitSecs: 3600 } } };
      if (path === "/v2/upgrade/runs") return { status: 200, body: { runs: [RUN] } };
      if (path === "/v2/upgrade/rollback") return { status: 200, body: { preview: { from: "r241", to: "r240", class: "rollback-safe", migrations: [], movedAside: [], sessionDataRestored: false } } };
      if (path === "/v2/host") return { status: 200, body: { hostId: "h", serviceManager: { kind: "none", unit: null, managedInstall: false }, runtimes: null } };
      return { status: 404, body: v2Error("route_not_found", "") };
    });
    expect(await client.upgradeApply({ release: "r241" })).toEqual({ ok: true, value: RUN });
    expect(await client.upgradeStage("r241")).toEqual({ ok: true, value: { release: "r241", state: "running" } });
    expect(await client.patchUpgradeSettings({ autoApply: true })).toMatchObject({ ok: true, value: { autoApply: true } });
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", body: { autoApply: true } });
    expect(await client.upgradeRuns(1000)).toEqual({ ok: true, value: [RUN] });
    expect(calls.at(-1)?.url).toContain("limit=200");
    expect(await client.upgradeRollback({ dryRun: true })).toMatchObject({ ok: true, value: { preview: { to: "r240" } } });
    expect(await client.hostServiceInfo()).toEqual({ serviceManager: { kind: "none", unit: null, managedInstall: false }, runtimes: null });
    expect(() => client.upgradeRun("../x")).toThrow("bad upgrade run id");
    expect(await client.upgradeRun("upg-0123456789ab")).toMatchObject({ ok: false, error: { code: "route_not_found", status: 404 } });
  });
});
