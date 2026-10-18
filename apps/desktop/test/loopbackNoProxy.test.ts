import { describe, expect, it } from "vitest";
import { applyLoopbackNoProxy, withLoopbackNoProxy } from "../src/shared/loopbackNoProxy";
import { failedStartStatus, offlineRuntime } from "../src/renderer/src/lib/runtimeStart";

describe("loopback NO_PROXY (desktop → cutex never through a proxy)", () => {
  it("adds the loopback names once and keeps what is there", () => {
    expect(withLoopbackNoProxy(undefined)).toBe("127.0.0.1,localhost,::1,[::1]");
    expect(withLoopbackNoProxy(" corp.example , LOCALHOST")).toBe("corp.example,LOCALHOST,127.0.0.1,::1,[::1]");
    expect(withLoopbackNoProxy("127.0.0.1,localhost,::1,[::1]")).toBe("127.0.0.1,localhost,::1,[::1]");
    expect(withLoopbackNoProxy("*")).toBe("*");
  });

  it("sets both spellings off Windows and one variable on Windows", () => {
    const env: Record<string, string | undefined> = { HTTPS_PROXY: "http://proxy.example:3128", no_proxy: "corp.example" };
    applyLoopbackNoProxy(env, "linux");
    expect(env.NO_PROXY).toBe("corp.example,127.0.0.1,localhost,::1,[::1]");
    expect(env.no_proxy).toBe("corp.example,127.0.0.1,localhost,::1,[::1]");
    const win: Record<string, string | undefined> = {};
    applyLoopbackNoProxy(win, "win32");
    expect(win).toEqual({ NO_PROXY: "127.0.0.1,localhost,::1,[::1]" });
  });
});

describe("runtime start outcome", () => {
  it("only online / starting count as a start", () => {
    expect(failedStartStatus({ status: "online", runtimeGeneration: 3 })).toBeNull();
    expect(failedStartStatus({ status: "starting" })).toBeNull();
    expect(failedStartStatus(null)).toBeNull();
    expect(failedStartStatus({ status: "error" })).toBe("error");
    expect(failedStartStatus({ status: "offline" })).toBe("offline");
  });

  it("offline runtimes have no native to ask", () => {
    for (const s of ["offline", "closed", "closing", "error"]) expect(offlineRuntime(s)).toBe(true);
    for (const s of ["online", "starting", null, undefined]) expect(offlineRuntime(s)).toBe(false);
  });
});
