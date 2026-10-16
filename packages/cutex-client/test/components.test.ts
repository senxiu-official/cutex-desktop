import { describe, expect, it } from "vitest";
import { componentEventOf, componentName, CutexClient, isComponentRefusalCode, isOperationRunning, readComponentsList, COMPONENTS_UPDATED_EVENT } from "../src/index";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

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

// The spec v2 §4 example shape.
const LIST = {
  managed: true,
  installFrom: "release",
  components: [
    { name: "job-service", supported: true, state: "missing", selected: null, available: "0.1.2", origin: null, versions: [{ version: "0.1.0", pinnedBy: 3, sizeBytes: 1024 }], error: null },
    { name: "claude-runtime", supported: true, state: "needsUser", selected: "claude-r10", available: "claude-r10", origin: "signed", versions: [], error: null, steps: ["claude login"] },
  ],
};

describe("components readers", () => {
  it("reads the spec shape and drops malformed parts", () => {
    const list = readComponentsList({ ...LIST, components: [...LIST.components, { state: "ready" }, null], operation: { id: "op1", name: "job-service", action: "install", state: "running", step: "download", error: null } });
    expect(list.managed).toBe(true);
    expect(list.installFrom).toBe("release");
    expect(list.components.map((c) => c.name)).toEqual(["job-service", "claude-runtime"]);
    expect(list.components[0]).toEqual({ name: "job-service", supported: true, state: "missing", selected: null, available: "0.1.2", origin: null, versions: [{ version: "0.1.0", pinnedBy: 3, sizeBytes: 1024 }], error: null, steps: [] });
    expect(list.components[1]!.steps).toEqual(["claude login"]);
    expect(list.operation).toEqual({ id: "op1", name: "job-service", action: "install", state: "running", step: "download", error: null });
    // No guessed fallbacks: `detail.steps`, `kind`, `operationId` are not read.
    const loose = readComponentsList({ components: [{ name: "x", state: "needsUser", detail: { steps: ["a"] } }], operation: { operationId: "o", kind: "install", state: "running" } });
    expect(loose.components[0]!.steps).toEqual([]);
    expect(loose.operation).toMatchObject({ id: null, action: null, state: "running" });
  });

  it("defaults: not managed, installFrom none, unknown states pass through", () => {
    expect(readComponentsList(null)).toEqual({ managed: false, installFrom: "none", components: [], operation: null });
    const list = readComponentsList({ managed: true, installFrom: "release", components: [{ name: "x", state: "brandNew", supported: false, steps: ["a", 3, " "] }] });
    expect(list.components[0]).toMatchObject({ state: "brandNew", supported: false, steps: ["a"] });
  });

  it("recognises the updated event only", () => {
    expect(componentEventOf({ cutex: { method: COMPONENTS_UPDATED_EVENT, params: { name: "job-service", reason: "operation", state: "installing", operation: { id: "op1", name: "job-service", action: "install", state: "running", step: "verify", error: null } } } })).toEqual({ name: "job-service", reason: "operation", state: "installing", operation: { id: "op1", name: "job-service", action: "install", state: "running", step: "verify", error: null } });
    expect(componentEventOf({ cutex: { method: COMPONENTS_UPDATED_EVENT, params: { name: "job-service", reason: "startup", state: "ready", operation: null } } })).toMatchObject({ reason: "startup", state: "ready", operation: null });
    expect(componentEventOf({ cutex: { method: "cutex/upgrade/updated", params: {} } })).toBeNull();
    expect(componentEventOf(null)).toBeNull();
  });

  it("running = state running; refusal codes are the pinned set", () => {
    expect(isOperationRunning({ id: null, name: "x", action: "install", state: "running", step: null, error: null })).toBe(true);
    expect(isOperationRunning({ id: null, name: "x", action: "install", state: "done", step: null, error: null })).toBe(false);
    expect(isOperationRunning(null)).toBe(false);
    expect(isComponentRefusalCode("jobs_running")).toBe(true);
    expect(isComponentRefusalCode("component_busy")).toBe(false);
  });

  it("only builds paths from kebab-case names", () => {
    expect(componentName("job-service")).toBe("job-service");
    expect(() => componentName("../x")).toThrow("bad component name");
    expect(() => componentName("Job")).toThrow("bad component name");
  });
});

describe("components client", () => {
  it("GET /v2/components; null on an older cutex", async () => {
    const { client, calls } = stub(() => ({ status: 200, body: LIST }));
    expect((await client.components())!.components).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: "GET", url: "http://h:1/v2/components" });
    const old = stub(() => ({ status: 404, body: v2Error("not_found", "no route") }));
    expect(await old.client.components()).toBeNull();
  });

  it("POST install / remove with an empty body → the operation", async () => {
    const { client, calls } = stub(() => ({ status: 202, body: { operation: { id: "op1", name: "job-service", action: "install", state: "running", step: null, error: null } } }));
    const r = await client.componentAction("job-service", "install");
    expect(r).toEqual({ ok: true, value: { id: "op1", name: "job-service", action: "install", state: "running", step: null, error: null } });
    expect(calls[0]).toMatchObject({ method: "POST", url: "http://h:1/v2/components/job-service/install", body: {} });
    await client.componentAction("job-service", "remove");
    expect(calls[1]!.url).toBe("http://h:1/v2/components/job-service/remove");
    await expect(client.componentAction("../etc", "install")).rejects.toThrow("bad component name");
  });

  it("returns refusals as values", async () => {
    const { client } = stub(() => ({ status: 409, body: v2Error("upgrade_blocked", "busy", { reason: "run_in_progress" }) }));
    const r = await client.componentAction("job-service", "install");
    expect(r).toEqual({ ok: false, error: { code: "upgrade_blocked", message: "busy", status: 409, reason: "run_in_progress" } });
  });
});
