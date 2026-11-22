// State surfaces W11: 运行中 only says the process is alive (background program) or the port answers (web service).
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
import { serviceHealthHint, serviceHealthTitle } from "../src/renderer/src/lib/services";
import { zhCN, en } from "../src/renderer/src/lib/backgroundOpsMessages";

describe("service 运行中 hover", () => {
  it("depends on the runtime kind, only for 运行中", () => {
    expect(serviceHealthHint({ runtime: "worker", health: "reachable" })).toBe("services.health.reachable.workerTip");
    for (const runtime of ["managed", "external", "static"] as const) expect(serviceHealthHint({ runtime, health: "reachable" })).toBe("services.health.reachable.webTip");
    for (const health of ["unreachable", "starting", "stopped", "stoppedIdle", "crashLooped"] as const) expect(serviceHealthHint({ runtime: "managed", health })).toBeNull();
  });
  it("uses the approved words exactly", () => {
    expect(zhCN["services.health.reachable.workerTip"]).toBe("进程在运行；不代表功能正常。");
    expect(zhCN["services.health.reachable.webTip"]).toBe("端口能连上；不代表功能正常。");
    expect(en["services.health.reachable.workerTip"]).toBe("The process is running; this doesn't mean it works correctly.");
    expect(en["services.health.reachable.webTip"]).toBe("The port answers; this doesn't mean it works correctly.");
  });
  it("the hover is the word, then the caveat (reachable only)", () => {
    const t = ((k: string) => k) as never;
    expect(serviceHealthTitle("运行中", { runtime: "worker", health: "reachable" }, t)).toBe("运行中\nservices.health.reachable.workerTip");
    expect(serviceHealthTitle("运行中", { runtime: "static", health: "reachable" }, t)).toBe("运行中\nservices.health.reachable.webTip");
    expect(serviceHealthTitle("已停止", { runtime: "worker", health: "stopped" }, t)).toBe("已停止");
  });
});
