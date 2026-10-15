import type { DaemonApi, PreloadBridge } from "../../shared/ipc";
import { installMockBridge } from "./dev/mockBridge";

declare global {
  interface Window {
    cutex: PreloadBridge;
  }
}

// Inside Electron the preload provides window.cutex. In a plain browser (vite dev server preview)
// fall back to canned data so the UI can be developed and screenshotted without a daemon.
if (!window.cutex && import.meta.env.DEV) installMockBridge();

export const bridge = window.cutex;
/** Electron wraps errors thrown in main as "Error invoking remote method '…': Error: <message>";
 *  keep only <message> (main has already logged the full error, see main/errorLog.ts). */
export function cleanIpcMessage(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, "");
}

// The proxy target is an empty object, not the bridge's api: contextBridge exposes read-only,
// non-configurable properties, and a Proxy must return those unchanged (the wrapper would throw).
function cleaned<T extends object>(source: () => T): T {
  return new Proxy({} as T, {
    get(_target, key) {
      const target = source();
      const value = Reflect.get(target, key) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args)).catch((error: unknown) => {
          if (error instanceof Error && error.message.startsWith("Error invoking remote method")) error.message = cleanIpcMessage(error.message);
          throw error;
        });
    },
  });
}

/** Calls to the focus host (the host the app shows; multi-host RFC §6.2). */
export const api: typeof bridge.api = cleaned(() => bridge.api);

const hostApis = new Map<string, DaemonApi>();
/**
 * Daemon calls bound to one host's current connection (background work of a connected host outside
 * the scope: counts, notifications). Without a per-host bridge (older preload): the focus host's api.
 */
export function apiFor(hostId: string): DaemonApi {
  let hostApi = hostApis.get(hostId);
  if (!hostApi) {
    hostApi = cleaned<DaemonApi>(() => bridge.apiFor?.(hostId) ?? bridge.api);
    hostApis.set(hostId, hostApi);
  }
  return hostApi;
}
