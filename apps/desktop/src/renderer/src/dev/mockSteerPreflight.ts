import { CutexApiError } from "@cutex-desktop/cutex-client";
import type { DesktopApi } from "../../../shared/ipc";
import { retryableSteerPreflight, withSteerPreflightRetry } from "../../../shared/queueSteerRetry";
import { queueSteerErrorKind, queueSteerErrorMessage } from "../../../shared/queueSteer";

/** Controlled reproduction of cutex's failed Claude capability query before any native send.
 * Uses the same retry helper as main; the plain browser mock otherwise bypasses main entirely. */
export function installSteerPreflightMock(api: DesktopApi): void {
  const query = new URLSearchParams(location.search);
  const mode = query.get("insertpreflight");
  if (!mode) return;
  const original = api.queuePromote;
  const counts = new Map<string, number>();
  const trace: { sessionId: string; attempt: number; refused: boolean; native: boolean }[] = [];
  (window as unknown as { __cutexInsertPreflight: typeof trace }).__cutexInsertPreflight = trace;
  api.queuePromote = async (...args) => {
    if (!args[3]) return original.apply(api, args);
    const send = async () => {
      const attempt = (counts.get(args[0]) ?? 0) + 1;
      counts.set(args[0], attempt);
      const refused = mode !== "once" || attempt === 1;
      trace.push({ sessionId: args[0], attempt, refused, native: mode === "native" });
      if (refused) throw new CutexApiError(409, "steer_unavailable", "kept", true, {
        reason: "runtimeNoSteer", ...(mode === "native" ? { nativeError: { code: -32601, message: "steering unsupported" } } : {}),
      });
      return original.apply(api, args);
    };
    try { return await (query.has("noInsertRetry") ? send() : withSteerPreflightRetry(send, () => {})); }
    catch (error) {
      const kind = error instanceof CutexApiError ? !query.has("noInsertRetry") && retryableSteerPreflight(error) ? "runtimeNotReady" : queueSteerErrorKind(error.code, error.details) : null;
      if (kind) throw new Error(queueSteerErrorMessage(kind));
      throw error;
    }
  };
}
