// Component store (lib/componentStore.ts): install requests go to cutex, refusals stay on the card,
// the pending request ends when the list settles, a host reset fences reads in flight.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readComponentsList } from "../src/shared/components";

const env = vi.hoisted(() => ({ components: vi.fn(), componentAction: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: undefined, api: {}, apiFor: () => ({ components: env.components, componentAction: env.componentAction }) }));
const { componentUsableNow, hostComponents, loadComponents, requestComponent, resetHostComponents, useComponentStore } = await import("../src/renderer/src/lib/componentStore");

const list = (state: string, operation: unknown = null) => readComponentsList({ managed: true, installFrom: "release", components: [{ name: "job-service", supported: true, state }], operation });

beforeEach(() => {
  useComponentStore.setState({ byHost: {} });
  env.components.mockReset();
  env.componentAction.mockReset();
});

describe("component store", () => {
  it("an accepted install stays pending until the list shows it settled", async () => {
    env.componentAction.mockResolvedValue({ ok: true, value: { id: "op", name: "job-service", action: "install", state: "running", step: null, error: null } });
    env.components.mockResolvedValueOnce(list("installing", { id: "op", name: "job-service", action: "install", state: "running", step: "download", error: null }));
    await requestComponent("h", "job-service", "install");
    expect(env.componentAction).toHaveBeenCalledWith("job-service", "install");
    expect(hostComponents("h").pending).toMatchObject({ name: "job-service", action: "install" });
    // The operation is done (the list may still carry it): no longer pending.
    env.components.mockResolvedValueOnce(list("ready", { id: "op", name: "job-service", action: "install", state: "done", step: null, error: null }));
    await loadComponents("h");
    expect(hostComponents("h").pending).toBeNull();
    expect(hostComponents("h").list?.components[0]?.state).toBe("ready");
  });

  it("a refusal is kept for the card and ends the pending request", async () => {
    env.componentAction.mockResolvedValue({ ok: false, error: { code: "component_external", message: "already running", status: 409 } });
    env.components.mockResolvedValue(list("missing"));
    await requestComponent("h", "job-service", "install");
    expect(hostComponents("h").pending).toBeNull();
    expect(hostComponents("h").refusal).toEqual({ name: "job-service", action: "install", error: { code: "component_external", message: "already running", status: 409 } });
  });

  it("an operation cutex finished at once is not pending", async () => {
    env.componentAction.mockResolvedValue({ ok: true, value: { id: "op", name: "job-service", action: "install", state: "failed", step: "prepare", error: "boom" } });
    env.components.mockResolvedValue(list("degraded"));
    await requestComponent("h", "job-service", "install");
    expect(hostComponents("h").pending).toBeNull();
  });

  it("componentUsableNow: older cutex yes; unread no (and starts a read); ready yes", async () => {
    expect(componentUsableNow("h", "job-service", new Set(["job-service"]))).toBe(true);
    expect(env.components).not.toHaveBeenCalled();
    env.components.mockResolvedValue(list("ready"));
    const caps = new Set(["job-service", "components"]);
    expect(componentUsableNow("h", "job-service", caps)).toBe(false);
    expect(env.components).toHaveBeenCalledTimes(1);
    await loadComponents("h");
    expect(componentUsableNow("h", "job-service", caps)).toBe(true);
  });

  it("a host reset fences a read in flight", async () => {
    let resolve!: (v: unknown) => void;
    env.components.mockReturnValue(new Promise((r) => (resolve = r)));
    const p = loadComponents("h");
    resetHostComponents("h");
    resolve(list("ready"));
    await p;
    expect(hostComponents("h").list).toBeUndefined();
  });
});
