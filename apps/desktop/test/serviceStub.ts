// A ModuleServices whose calls do nothing (module host tests that never navigate).
import type { ModuleServices } from "../src/renderer/src/modules/slots";

export function stubServices(): ModuleServices {
  return {
    activity: { subscribe: () => () => {}, subscribeUsage: () => () => {}, subscribeOwnerWaiting: () => () => {} },
    daemonFor: () => {
      throw new Error("no daemon in this test");
    },
    agents: { list: () => [], get: () => null, subscribe: () => () => {}, open() {} },
    ui: { toast() {}, notice() {}, confirm: async () => false, openSettings() {}, openPage() {}, closePage() {}, customize() {} },
    panes: { open: () => ({ status: "unavailable", reason: "unknown-kind" }) },
    side: { open: () => ({ status: "unavailable", reason: "unknown-kind" }), reveal: () => ({ status: "unavailable", reason: "gone" }), close() {}, closePeek() {}, list: () => [], openHeld: () => ({ status: "unavailable", reason: "unknown-kind" }), releaseHold: () => false },
    timeline: { focusTurn: async () => ({ status: "stale" }) },
    data: { read: async () => null, readText: async () => null, write: async () => {}, remove: async () => {}, list: async () => [], usage: async () => ({ used: 0, limit: 0, fileLimit: 0 }) },
    files: { pick: async () => null, save: async () => null },
    refs: { open: async () => ({ status: "stale" }), here: () => [], parse: () => null },
  };
}
