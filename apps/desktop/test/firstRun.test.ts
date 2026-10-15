import { describe, expect, it } from "vitest";
import { firstRunView } from "../src/renderer/src/lib/firstRun";
import { localDaemonSetup } from "../src/shared/hosts";

describe("first run on this machine", () => {
  const down = (setup?: "notInstalled" | "notRunning") => ({ kind: "unreachable" as const, baseUrl: "http://127.0.0.1:24270", message: "ECONNREFUSED", ...(setup ? { setup } : {}) });

  it("tells not installed from not running by the discovered token", () => {
    expect(localDaemonSetup({ token: null })).toBe("notInstalled");
    expect(localDaemonSetup({ token: "t" })).toBe("notRunning");
  });

  it("shows the setup panel for this machine only", () => {
    expect(firstRunView(down("notInstalled"), false, null)).toBe("notInstalled");
    expect(firstRunView(down("notRunning"), false, 3)).toBe("notRunning");
    expect(firstRunView(down("notInstalled"), true, null)).toBeNull();
    expect(firstRunView(down(), false, null)).toBeNull();
    expect(firstRunView({ kind: "error", baseUrl: "", message: "401", status: 401 }, false, 0)).toBeNull();
  });

  it("points at creating the first agent once connected and empty", () => {
    expect(firstRunView({ kind: "connected", baseUrl: "x", hostId: "h" }, false, 0)).toBe("empty");
    expect(firstRunView({ kind: "connected", baseUrl: "x", hostId: "h" }, false, 2)).toBeNull();
    expect(firstRunView({ kind: "connected", baseUrl: "x", hostId: "h" }, false, null)).toBeNull();
    expect(firstRunView({ kind: "connecting", baseUrl: "x" }, false, 0)).toBeNull();
  });
});
