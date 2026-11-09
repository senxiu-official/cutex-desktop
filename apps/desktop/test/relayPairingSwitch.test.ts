// 公网扫码配对 switch (cutex contract rev 9.4): what the row says, when 添加设备 offers it, and whether a QR's
// relay route is live now.
import { describe, expect, it } from "vitest";
import type { RelayPairingStatusView } from "../src/shared/ipc";
import { offerInAddDevice, relayPairingKind, relayPairingReasonKey, relayRouteNow } from "../src/renderer/src/lib/relayPairingModel";
import { zhCN } from "../src/renderer/src/modules/users/i18n";
import { en } from "../src/renderer/src/modules/users/i18n.en";

const ON: RelayPairingStatusView = { configured: true, enabled: true, listening: true, reason: null, bootstrapBind: "0.0.0.0:8443", bootstrapServerName: "eva-pair.example.love" };
const OFF: RelayPairingStatusView = { ...ON, enabled: false, listening: false, reason: "disabled" };
const NONE: RelayPairingStatusView = { configured: false, enabled: false, listening: false, reason: "not_configured", bootstrapBind: null, bootstrapServerName: null };
const STUCK: RelayPairingStatusView = { ...ON, listening: false, reason: "bind_unavailable" };

describe("relay pairing switch model", () => {
  it("one state per status: listening, off, not configured, on but not listening", () => {
    expect(relayPairingKind(ON)).toBe("listening");
    expect(relayPairingKind(OFF)).toBe("off");
    expect(relayPairingKind(NONE)).toBe("notConfigured");
    expect(relayPairingKind(STUCK)).toBe("failed");
  });

  it("names the listener failure; an unknown reason falls back to the generic text", () => {
    expect(relayPairingReasonKey("bind_unavailable")).toBe("users.relayPairing.reason.bind_unavailable");
    expect(relayPairingReasonKey("something_new")).toBe("users.relayPairing.reason.other");
    expect(relayPairingReasonKey(null)).toBe("users.relayPairing.reason.other");
  });

  it("添加设备 offers the switch when a relay is configured but not taking requests", () => {
    expect(offerInAddDevice(OFF)).toBe(true);
    expect(offerInAddDevice(STUCK)).toBe(true);
    expect(offerInAddDevice(ON)).toBe(false);
    expect(offerInAddDevice(NONE)).toBe(false);
    expect(offerInAddDevice(null)).toBe(false);
  });

  it("a QR's relay route is live only while the switch listens; an older cutex keeps what the invite said", () => {
    expect(relayRouteNow(true, ON)).toBe(true);
    expect(relayRouteNow(true, OFF)).toBe(false);
    expect(relayRouteNow(true, STUCK)).toBe(false);
    expect(relayRouteNow(false, OFF)).toBe(false);
    expect(relayRouteNow(true, null)).toBe(true);
  });

  it("zh-CN and en strings exist for the row, the states and the 添加设备 offer", () => {
    for (const table of [zhCN, en] as Record<string, string>[]) {
      for (const key of ["users.relayPairing.title", "users.relayPairing.hint", "users.relayPairing.state.listening", "users.relayPairing.state.off", "users.relayPairing.state.notConfigured", "users.relayPairing.state.failed", "users.relayPairing.offer", "users.relayPairing.turnOn", "users.relayPairing.reason.bind_unavailable", "users.relayPairing.reason.other"] as const) {
        expect(table[key], key).toBeTruthy();
      }
    }
    expect((zhCN as Record<string, string>)["users.relayPairing.title"]).toBe("公网扫码配对");
    expect((zhCN as Record<string, string>)["users.relayPairing.state.listening"]).toBe("已开启，正在监听");
    expect((zhCN as Record<string, string>)["users.relayPairing.hint"]).toContain("已配对的设备不受影响");
  });
});
