// 复制到其他主机 (cutex profile-transfer): main moves the bundle (main/profileTransfer.ts via HostManager
// copyProfileToHost) and nothing secret reaches the renderer result, the error log or an error text;
// the renderer helpers (targets, suggested name, warning text).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const userData = mkdtempSync(join(tmpdir(), "cutex-profile-transfer-"));
vi.mock("electron", () => ({ app: { getPath: () => userData, getVersion: () => "test" }, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock("@cutex-desktop/cutex-client/node", () => ({ discoverLocalDaemon: () => new Promise(() => {}) }));

const { CutexApiError } = await import("@cutex-desktop/cutex-client");
const { HostManager } = await import("../src/main/hosts");
const { checkTransferRequest, transferProfile } = await import("../src/main/profileTransfer");
const { parseTransferWarnings, redactSecrets, transferName, PROFILE_TRANSFER_FEATURE } = await import("../src/shared/profileTransfer");
const { HOST_METHOD_NAMES } = await import("../src/shared/ipc");
const { transferTargets, transferWarningText } = await import("../src/renderer/src/lib/profileTransfer");
const { en } = await import("../src/renderer/src/i18n/en");

afterAll(() => rmSync(userData, { recursive: true, force: true }));

const KEY = "placeholder-desktop-transfer-key-0001";
const bundle = () => ({ format: "cutex-profile-bundle", schemaVersion: 1, credentialKind: "apiKey", profile: { cli_kind: "codex" }, credentials: { kind: "apiKey", apiKey: KEY } });
const request = { sourceHostId: "local", profile: "GLM", targetHostId: "ssh-aaaa1111", name: " GLM ", includeApiKey: true };

function errorLog(): string {
  try {
    return readFileSync(join(userData, "logs", "errors.jsonl"), "utf8");
  } catch {
    return "";
  }
}

/** HostManager with two fake connections (the daemons' main-only bundle calls). */
function manager(daemons: { source: object; target: object }) {
  const conns = new Map<string, unknown>([
    ["local", { hostId: "local", daemon: daemons.source }],
    ["ssh-aaaa1111", { hostId: "ssh-aaaa1111", daemon: daemons.target }],
  ]);
  return Object.assign(Object.create(HostManager.prototype), { conns }) as InstanceType<typeof HostManager>;
}

describe("main: transferProfile / HostManager.copyProfileToHost", () => {
  it("hands the bundle from the source's export to the target's import and returns a secret-free result", async () => {
    const exportBundle = vi.fn(async () => ({ bundle: bundle(), credentialsIncluded: true, credentialKind: "apiKey" }));
    const importBundle = vi.fn(async (b: unknown, name: string) => ({
      profile: { id: "p-1", name, secretish: KEY },
      credentialsCopied: true,
      credentialKind: "apiKey",
      warnings: [{ code: "proxyCopied", url: `http://u:${KEY}@proxy` }],
    }));
    const log = vi.fn();
    const result = await transferProfile(request, { exportBundle }, { importBundle }, log);
    expect(exportBundle).toHaveBeenCalledWith("GLM", true);
    expect(importBundle).toHaveBeenCalledWith(bundle(), "GLM");
    expect(result).toEqual({ ok: true, profile: { id: "p-1", name: "GLM" }, credentialKind: "apiKey", credentialsCopied: true, warnings: [{ code: "proxyCopied" }] });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(log).not.toHaveBeenCalled();
  });

  it("a target error that echoes the key is redacted in the result and in the error log", async () => {
    const m = manager({
      source: { exportProfileBundle: async () => ({ bundle: bundle(), credentialsIncluded: true }) },
      target: { importProfileBundle: async () => { throw new CutexApiError(400, "invalid_request", `bad key ${KEY}`, false, { echoed: KEY }); } },
    });
    const result = await m.copyProfileToHost(request);
    expect(result).toEqual({ ok: false, stage: "import", error: { code: "invalid_request", status: 400, message: "bad key [redacted]" } });
    const log = errorLog();
    expect(log).toContain("profile-transfer");
    expect(log).toContain("invalid_request");
    expect(log).not.toContain(KEY);
    expect(log).not.toContain("echoed");
  });

  it("a refused export (loopback only) keeps its code; nothing is imported", async () => {
    const importProfileBundle = vi.fn();
    const m = manager({
      source: { exportProfileBundle: async () => { throw new CutexApiError(403, "credentials_loopback_only", "credentials can only be exported over a loopback connection"); } },
      target: { importProfileBundle },
    });
    const result = await m.copyProfileToHost(request);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("export");
    expect(!result.ok && result.error.code).toBe("credentials_loopback_only");
    expect(importProfileBundle).not.toHaveBeenCalled();
  });

  it("a name clash on the target is a result, not a throw; a missing bundle is refused", async () => {
    const m = manager({
      source: { exportProfileBundle: async () => ({ bundle: bundle() }) },
      target: { importProfileBundle: async () => { throw new CutexApiError(409, "profile_name_conflict", "a profile named GLM already exists"); } },
    });
    expect(await m.copyProfileToHost(request)).toMatchObject({ ok: false, stage: "import", error: { code: "profile_name_conflict", status: 409 } });
    const empty = manager({ source: { exportProfileBundle: async () => ({}) }, target: { importProfileBundle: vi.fn() } });
    expect(await empty.copyProfileToHost(request)).toMatchObject({ ok: false, stage: "export", error: { code: "bad_bundle" } });
  });

  it("checks the request and needs both hosts connected", async () => {
    expect(checkTransferRequest({ ...request, targetHostId: "local" })).toBe("source and target are the same host");
    expect(checkTransferRequest({ ...request, name: "  " })).toBe("bad name");
    expect(checkTransferRequest(null)).toBe("bad request");
    expect(checkTransferRequest({ ...request, includeApiKey: "yes" })).toMatchObject({ name: "GLM", includeApiKey: false });
    const m = Object.assign(Object.create(HostManager.prototype), { conns: new Map() }) as InstanceType<typeof HostManager>;
    expect(await m.copyProfileToHost(request)).toMatchObject({ ok: false, stage: "request", error: { code: "host_not_connected" } });
  });

  it("is a HostApi method; the bundle calls are not IPC methods", () => {
    expect(HOST_METHOD_NAMES).toContain("copyProfileToHost");
    for (const file of ["../src/main/index.ts", "../src/preload/index.ts"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(text).toContain('"copyProfileToHost"');
      expect(text).not.toMatch(/exportProfileBundle|importProfileBundle/);
    }
  });
});

describe("shared helpers", () => {
  it("allow-lists warnings and caps their values", () => {
    expect(
      parseTransferWarnings([
        { code: "needsLogin", credential: "chatgpt" },
        { code: "claudeAccountRebound", matched: true, account: "ca-1", accountLabel: "work", loggedIn: false, extra: KEY },
        { code: "runtimeDockerImage", image: "x".repeat(500) },
        { code: "secretFieldsCleared", fields: ["model_providers.zai.http_headers", 3] },
        { code: "brandNew", value: KEY },
        { code: "bad code!" },
        null,
      ]),
    ).toEqual([
      { code: "needsLogin", credential: "chatgpt" },
      { code: "claudeAccountRebound", matched: true, account: "ca-1", accountLabel: "work", sourceLabel: null, loggedIn: false },
      { code: "runtimeDockerImage", image: "x".repeat(200) },
      { code: "secretFieldsCleared", fields: ["model_providers.zai.http_headers"] },
      { code: "other", name: "brandNew" },
    ]);
    expect(parseTransferWarnings("nope")).toEqual([]);
    expect(redactSecrets(`a ${KEY} b ${KEY}`, [KEY])).toBe("a [redacted] b [redacted]");
  });

  it("suggests the source name, else `name (host)`, else numbered", () => {
    expect(transferName("GLM", "box-b", ["Kimi"])).toBe("GLM");
    expect(transferName("GLM", "box-b", ["glm"])).toBe("GLM (box-b)");
    expect(transferName("GLM", "box-b", ["GLM", "GLM (box-b)"])).toBe("GLM (box-b) 2");
  });
});

describe("renderer: targets and warning text", () => {
  const connected = { kind: "connected" } as never;
  const withFeature = new Set([PROFILE_TRANSFER_FEATURE]);
  const hostView = (id: string, epoch: string | null) => ({ id, kind: "ssh", label: id, target: id, remotePort: 1, cutexPath: null, paired: true, lastConnectedAt: null, conn: { epoch, tunnel: null, daemon: connected } });
  const source = (byHost: Record<string, object>) => ({
    hosts: { scope: { kind: "host", id: "local" }, active: "local", startOn: "last", hosts: [hostView("local", "e0"), hostView("a", "e1"), hostView("b", "e2"), hostView("c", null)], groups: [], tunnel: null, weakSecretStorage: false },
    daemon: connected,
    features: withFeature,
    featuresKnown: true,
    sidebar: null,
    approvals: null,
    services: null,
    byHost: byHost as never,
  }) as never;

  it("lists connected hosts other than the source whose cutex has profile-transfer", () => {
    const slice = (features: ReadonlySet<string>) => ({ daemon: connected, features, featuresKnown: true, sidebar: null, approvals: null, services: null });
    expect(transferTargets(source({ a: slice(withFeature), b: slice(new Set()) }), "local")).toEqual(["a"]);
    // A source without the capability offers nothing.
    expect(transferTargets(source({ a: slice(new Set()), b: slice(withFeature) }), "a")).toEqual([]);
  });

  it("says what to do on the target", () => {
    const t = (key: string, vars?: Record<string, string | number>) => (en as Record<string, string>)[key]!.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ""));
    expect(transferWarningText({ code: "needsLogin", credential: "chatgpt" }, t)).toBe("Log in to ChatGPT on the target host");
    expect(transferWarningText({ code: "claudeAccountRebound", matched: true, account: "ca-1", accountLabel: "work", sourceLabel: "work", loggedIn: false }, t)).toBe(
      "Uses the target host's Claude account “work”; That Claude account is not logged in on the target host yet; log in to Claude first",
    );
    expect(transferWarningText({ code: "claudeAccountRebound", matched: false, account: "default", accountLabel: null, sourceLabel: "work", loggedIn: null }, t)).toContain("default account");
    expect(transferWarningText({ code: "secretFieldsCleared", fields: ["a", "b"] }, t)).toContain("a, b");
  });
});
