// Perf baseline hooks (scripts/qa-perf-baseline.mjs), started by dev/mockBridge.ts with `?perf`: the
// shell's store, pane actions and module host on `window.__cutexPerfApp`, so the measuring script can
// drive the preview the same way in a dev server and in a production-mode preview build (no module URLs).
import * as store from "../store";
import * as paneActions from "../lib/paneActions";
import * as paneStore from "../lib/paneStore";
import { appModules, services } from "../modules/app";

export function installDevPerf(): void {
  // mockBridge's dynamic import can settle after a node-env test tore its window stub down; then there is
  // nothing to install on (the preview always has a window).
  if (typeof window === "undefined") return;
  (window as unknown as { __cutexPerfApp: unknown }).__cutexPerfApp = { store, paneActions, paneStore, appModules, services };
}
