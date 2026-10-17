// End-to-end 复制到其他主机 against TWO isolated debug cutex daemons on private homes (never the live
// 24270 / 25370 ones): main's DaemonService export on A → import on B through transferProfile, as
// HostManager.copyProfileToHost runs it. Skipped unless CUTEX_PT_IT=1. Each home's `.cutex/config.json`
// holds its management token; the profiles on A are fakes with placeholder keys.
//   CUTEX_PT_IT=1 CUTEX_PT_A_HOME=<home a> CUTEX_PT_A_URL=http://127.0.0.1:24870 \
//   CUTEX_PT_B_HOME=<home b> CUTEX_PT_B_URL=http://127.0.0.1:24880 \
//   CUTEX_PT_KEY=<A's placeholder key> pnpm exec vitest run test/profileTransfer.integration.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { openExternal: async () => {} } }));

const { DaemonService } = await import("../src/main/daemon");
const { transferProfile } = await import("../src/main/profileTransfer");
const { discoverLocalDaemon } = await import("@cutex-desktop/cutex-client/node");

const env = process.env;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

describe.skipIf(!env.CUTEX_PT_IT)("profile transfer between two dev daemons", () => {
  const a = new DaemonService(() => {});
  const b = new DaemonService(() => {});
  const key = env.CUTEX_PT_KEY ?? "";
  const log = vi.fn();
  const via = (name: string, includeApiKey: boolean, profile = "GLM e2e") =>
    transferProfile(
      { sourceHostId: "dev-a", profile, targetHostId: "dev-b", name, includeApiKey },
      { exportBundle: (p, c) => a.exportProfileBundle(p, c) },
      { importBundle: (bundle, n) => b.importProfileBundle(bundle, n) },
      log,
    );

  beforeAll(async () => {
    a.useEndpoint(await discoverLocalDaemon({ home: env.CUTEX_PT_A_HOME!, baseUrl: env.CUTEX_PT_A_URL!, env: {} }), { remote: false });
    b.useEndpoint(await discoverLocalDaemon({ home: env.CUTEX_PT_B_HOME!, baseUrl: env.CUTEX_PT_B_URL!, env: {} }), { remote: false });
    await vi.waitFor(() => expect([a.currentState.kind, b.currentState.kind]).toEqual(["connected", "connected"]), { timeout: 20_000, interval: 200 });
  }, 30_000);
  afterAll(() => (a.stop(), b.stop()));

  it("both hosts advertise profile-transfer", async () => {
    expect((await a.capabilities())?.featureList).toContain("profile-transfer");
    expect((await b.capabilities())?.featureList).toContain("profile-transfer");
  });

  it("refuses to overwrite a profile of the same name on the target", async () => {
    const r = await via("GLM e2e", true);
    expect(r).toMatchObject({ ok: false, stage: "import", error: { code: "profile_name_conflict", status: 409 } });
    expect(JSON.stringify(r)).not.toContain(key);
  });

  it("copies an API-key profile with its key (loopback), secret-free result", async () => {
    const r = await via("GLM e2e (a)", true);
    expect(r).toMatchObject({ ok: true, profile: { name: "GLM e2e (a)" }, credentialKind: "apiKey", credentialsCopied: true, warnings: [] });
    expect(JSON.stringify(r)).not.toContain(key);
    const copy = await b.getProfile("GLM e2e (a)");
    expect(copy.authPresent).toBe(true);
    expect(copy.modelProvider).toBe("zai");
  });

  it("without the key: the copy needs the key entered on the target", async () => {
    const r = await via("GLM e2e (no key)", false);
    expect(r).toMatchObject({ ok: true, credentialsCopied: false, warnings: [{ code: "needsLogin", credential: "apiKey" }] });
    expect((await b.getProfile("GLM e2e (no key)")).authPresent).toBe(false);
  });

  it("a ChatGPT profile is copied without a login; a Claude profile is rebound", async () => {
    expect(await via("Work e2e", true, "Work e2e")).toMatchObject({ ok: true, credentialKind: "chatgpt", credentialsCopied: false, warnings: [{ code: "needsLogin", credential: "chatgpt" }] });
    const claude = await via("Claude e2e", true, "Claude e2e");
    expect(claude).toMatchObject({ ok: true, credentialKind: "claude", warnings: [{ code: "claudeAccountRebound", account: "default", matched: true }] });
  });

  it("nothing secret in the transfer log or either host's audit / error logs", () => {
    expect(JSON.stringify(log.mock.calls)).not.toContain(key);
    expect(log.mock.calls.every(([record]) => (record as { source: string }).source === "profile-transfer")).toBe(true);
    for (const home of [env.CUTEX_PT_A_HOME!, env.CUTEX_PT_B_HOME!]) {
      const logs = filesUnder(join(home, ".cutex")).filter((f) => /profile-transfer[\\/]audit\.jsonl$|management-errors\.jsonl$/.test(f));
      expect(logs.length).toBeGreaterThan(0);
      for (const file of logs) expect(readFileSync(file, "utf8")).not.toContain(key);
    }
    const audit = filesUnder(join(env.CUTEX_PT_A_HOME!, ".cutex")).find((f) => f.endsWith(join("profile-transfer", "audit.jsonl")))!;
    expect(readFileSync(audit, "utf8")).toContain('"credentialsIncluded":true');
  });
});
