import { describe, expect, it } from "vitest";
import type { ClientTokenView, GlobalSettings, ListenEntry } from "../src/shared/ipc";
import {
  checkCorsOrigin,
  checkListenEntry,
  entryAddress,
  entryStatus,
  formatCountdown,
  needsPairingBanner,
  needsRestart,
  newTokens,
  readListenSettings,
  secondsLeft,
  sortTokens,
  tokenName,
} from "../src/renderer/src/lib/remoteAccess";
import { qrPath } from "../src/renderer/src/lib/qr";

const row = (entry: string, kind: string, port = 24270): ListenEntry => ({ entry, kind, port, warning: null });

const base = { secretsPresent: {}, restartRequiredFields: [], newRuntimesOnlyFields: [] } as unknown as GlobalSettings;

describe("readListenSettings", () => {
  it("is null on a cutex without listen-settings", () => {
    expect(readListenSettings(base)).toBeNull();
    expect(readListenSettings(null)).toBeNull();
  });
  it("falls back to the defaults and reports a stored-list error", () => {
    const v = readListenSettings({
      ...base,
      managementListen: null,
      managementListenDefault: ["127.0.0.1"],
      managementListenEntries: { error: "bad" },
      managementCorsOrigins: null,
      managementCorsOriginsDefault: ["http://localhost"],
    })!;
    expect(v.list).toEqual(["127.0.0.1"]);
    expect(v.isDefault).toBe(true);
    expect(v.error).toBe("bad");
    expect(v.rows).toEqual([]);
    expect(v.cors).toEqual(["http://localhost"]);
    expect(v.corsIsDefault).toBe(true);
  });
});

describe("needsRestart", () => {
  it("reads restartRequired as an array of field names", () => {
    expect(needsRestart(["managementListen"])).toBe(true);
    expect(needsRestart(["agentBusPort"])).toBe(false);
    expect(needsRestart([])).toBe(false);
    expect(needsRestart(true)).toBe(false);
    expect(needsRestart(undefined)).toBe(false);
  });
});

describe("needsPairingBanner", () => {
  const rows = [row("127.0.0.1", "loopback"), row("tailscale", "tailscale")];
  it("warns when a remote entry exists and no token does", () => {
    expect(needsPairingBanner({ rows, remoteAccess: { clientTokens: 0, devices: 0 } })).toBe(true);
    expect(needsPairingBanner({ rows, remoteAccess: { clientTokens: 1, devices: 1 } })).toBe(false);
  });
  it("stays quiet for loopback-only lists and unknown counts", () => {
    expect(needsPairingBanner({ rows: [rows[0]!], remoteAccess: { clientTokens: 0, devices: 0 } })).toBe(false);
    expect(needsPairingBanner({ rows, remoteAccess: { clientTokens: null, devices: null } })).toBe(false);
    expect(needsPairingBanner({ rows, remoteAccess: null })).toBe(false);
  });
});

describe("entry formatting and status", () => {
  it("formats addresses with their port", () => {
    expect(entryAddress(row("tailscale", "tailscale"))).toBe("tailscale:24270");
    expect(entryAddress(row("10.0.0.5", "address"))).toBe("10.0.0.5:24270");
    expect(entryAddress(row("10.0.0.5:9000", "address", 9000))).toBe("10.0.0.5:9000");
    expect(entryAddress(row("::", "wildcard"))).toBe("[::]:24270");
    expect(entryAddress(row("[fd7a::1]:24271", "address", 24271))).toBe("[fd7a::1]:24271");
  });
  it("matches active remote listeners", () => {
    const active = ["100.101.102.103:24270", "0.0.0.0:24271", "[fd7a::1]:24270"];
    expect(entryStatus(row("127.0.0.1", "loopback"), active)).toBeNull();
    expect(entryStatus(row("tailscale", "tailscale"), active)).toBe("active");
    expect(entryStatus(row("tailscale:9000", "tailscale", 9000), active)).toBe("inactive");
    expect(entryStatus(row("0.0.0.0:24271", "wildcard", 24271), active)).toBe("active");
    expect(entryStatus(row("[fd7a::1]", "address"), active)).toBe("active");
    expect(entryStatus(row("10.0.0.5", "address"), active)).toBe("inactive");
  });
});

describe("checkListenEntry", () => {
  it("accepts the documented forms", () => {
    for (const e of ["tailscale", "tailscale:24271", "100.64.0.7", "10.0.0.20:24270", "[::1]:24270", "::1", "0.0.0.0", "[fd7a::1]"]) expect(checkListenEntry(e, []).ok).toBe(true);
  });
  it("rejects bad input", () => {
    expect(checkListenEntry(" ", [])).toEqual({ ok: false, problem: "empty" });
    expect(checkListenEntry("example.com", [])).toEqual({ ok: false, problem: "format" });
    expect(checkListenEntry("300.1.1.1", [])).toEqual({ ok: false, problem: "format" });
    expect(checkListenEntry("10.0.0.5:0", [])).toEqual({ ok: false, problem: "port" });
    expect(checkListenEntry("tailscale:99999", [])).toEqual({ ok: false, problem: "port" });
    expect(checkListenEntry("Tailscale", ["tailscale"])).toEqual({ ok: false, problem: "duplicate" });
    expect(checkListenEntry("10.0.0.1", Array.from({ length: 16 }, (_, i) => `10.0.0.${i + 2}`))).toEqual({ ok: false, problem: "tooMany" });
  });
});

describe("checkCorsOrigin", () => {
  it("accepts exact origins and trims a trailing slash", () => {
    expect(checkCorsOrigin("https://app.example.com/", [])).toEqual({ ok: true, origin: "https://app.example.com" });
    expect(checkCorsOrigin("capacitor://localhost", []).ok).toBe(true);
    expect(checkCorsOrigin("http://localhost:5173", []).ok).toBe(true);
  });
  it("rejects paths, credentials and duplicates", () => {
    expect(checkCorsOrigin("http://x/y", [])).toEqual({ ok: false, problem: "format" });
    expect(checkCorsOrigin("http://u:p@x", [])).toEqual({ ok: false, problem: "format" });
    expect(checkCorsOrigin("localhost", [])).toEqual({ ok: false, problem: "format" });
    expect(checkCorsOrigin("http://localhost", ["http://localhost"])).toEqual({ ok: false, problem: "duplicate" });
  });
});

describe("countdown", () => {
  it("counts whole seconds down to zero", () => {
    const now = Date.parse("2026-10-08T10:00:00Z");
    expect(secondsLeft("2026-10-08T10:10:00Z", now)).toBe(600);
    expect(secondsLeft("2026-10-08T10:00:00.400Z", now)).toBe(1);
    expect(secondsLeft("2026-10-08T09:59:00Z", now)).toBe(0);
    expect(secondsLeft("garbage", now)).toBe(0);
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

describe("tokens", () => {
  const tok = (tokenId: string, kind: string, createdAt: string, extra: Partial<ClientTokenView> = {}): ClientTokenView => ({ tokenId, label: tokenId, kind, createdAt, ...extra });
  const list = [tok("mct-a", "client", "2026-10-01T00:00:00Z"), tok("mct-b", "device", "2026-10-02T00:00:00Z", { deviceName: "Pixel 9" }), tok("mct-c", "device", "2026-10-03T00:00:00Z")];
  it("sorts devices first, newest first", () => {
    expect(sortTokens(list).map((t) => t.tokenId)).toEqual(["mct-c", "mct-b", "mct-a"]);
  });
  it("finds tokens that appeared since the code was created", () => {
    expect(newTokens(list, new Set(["mct-a", "mct-b"])).map((t) => t.tokenId)).toEqual(["mct-c"]);
    expect(newTokens(list, new Set(list.map((t) => t.tokenId)))).toEqual([]);
  });
  it("names a token by owner name, device name, friendly desktop label, then label", () => {
    const t = (_key: string, vars: { app: string; host: string }) => `${vars.app} on ${vars.host}`;
    expect(tokenName(list[1]!, t)).toBe("Pixel 9");
    expect(tokenName({ ...list[1]!, ownerName: " Sam's phone " }, t)).toBe("Sam's phone");
    expect(tokenName({ ...list[0]!, label: " " }, t)).toBe("mct-a");
    expect(tokenName({ ...list[0]!, label: "desktop-mhs-087278-Cutex-257920" }, t)).toBe("mhs-087278");
    expect(tokenName({ ...list[0]!, label: "desktop-mhs-087278-side-257920" }, t)).toBe("side on mhs-087278");
  });
});

describe("qrPath", () => {
  it("encodes the pairing payload into a square module grid", () => {
    const { size, d } = qrPath("cutex-pair:v1?h=HOST-A&u=http%3A%2F%2F100.101.102.103%3A24270&c=K7QM2XPA");
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0);
    expect(d.startsWith("M0 0h7")).toBe(true); // finder pattern top row
  });
});
