// A ModuleServices whose calls do nothing (module host tests that never navigate).
import type { ModuleServices } from "../src/renderer/src/modules/slots";

export function stubServices(): ModuleServices {
  return {
    daemonFor: () => {
      throw new Error("no daemon in this test");
    },
    ui: { notice() {}, openSettings() {}, openPage() {}, closePage() {}, customize() {} },
    side: { open: () => ({ status: "unavailable", reason: "unknown-kind" }), reveal: () => ({ status: "unavailable", reason: "gone" }), close() {}, closePeek() {}, list: () => [], openHeld: () => ({ status: "unavailable", reason: "unknown-kind" }), releaseHold: () => false },
    timeline: { focusTurn: async () => ({ status: "stale" }) },
    refs: { open: async () => ({ status: "stale" }), here: () => [], parse: () => null },
  };
}
