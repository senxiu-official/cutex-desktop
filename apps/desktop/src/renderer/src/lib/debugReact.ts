// First entry import for previews; native preload installs before ANY renderer bundle.
import { installDebugReactHook } from "../../../shared/debugReactHook";
import type { DebugEntry } from "../../../shared/debug";
const global = window as unknown as { __cutexDebugReact?: { configure(enabled: boolean): boolean; drain(): DebugEntry[] } };
export function configureDebugReact(enabled: boolean): boolean {
  if (enabled && !global.__cutexDebugReact) installDebugReactHook();
  return global.__cutexDebugReact?.configure(enabled) ?? false;
}
export function drainDebugReact(): DebugEntry[] { return global.__cutexDebugReact?.drain() ?? []; }
let initial = window.cutex?.debug?.initiallyEnabled === true;
if (!window.cutex) try { initial = localStorage.getItem("cutex-desktop.debugMode") === "true"; } catch { /* storage unavailable */ }
if (initial && !global.__cutexDebugReact) installDebugReactHook();
