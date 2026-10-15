// "Not available for this agent": a Claude agent answers Codex methods it has no equivalent for with
// JSON-RPC -32601 and `data: {unsupported: true, runtime, feature, method}` (cutex claude-adapter
// docs/DESKTOP_PARITY.md). Main turns that into a plain error message with a fixed prefix (error
// codes do not survive the IPC hop); the renderer recognises it and shows a friendly notice.
import { UNSUPPORTED_ERROR_PREFIX } from "./ipc";

/** The feature (else method, else "") of a native `-32601` + `data.unsupported` error; null otherwise. */
export function unsupportedFeatureOf(code: string | number | undefined, details: unknown): string | null {
  const error = details as { code?: unknown; data?: { unsupported?: unknown; feature?: unknown; method?: unknown } | null } | null | undefined;
  const rpcCode = typeof error?.code === "number" ? error.code : code === "native_-32601" || code === -32601 ? -32601 : null;
  if (rpcCode !== -32601 || error?.data?.unsupported !== true) return null;
  const name = typeof error.data.feature === "string" ? error.data.feature : typeof error.data.method === "string" ? error.data.method : "";
  return name.replace(/[^\w:./-]/g, "").slice(0, 64);
}

export function unsupportedMessage(feature: string): string {
  return `${UNSUPPORTED_ERROR_PREFIX}: ${feature}`;
}

/** The feature named by an unsupported error message (after the IPC hop it is wrapped by Electron). */
export function parseUnsupported(message: string): string | null {
  const m = new RegExp(`${UNSUPPORTED_ERROR_PREFIX}: ?([\\w:./-]*)`).exec(message);
  return m ? m[1]! : null;
}
