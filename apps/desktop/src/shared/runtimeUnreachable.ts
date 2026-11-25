// cutex r295 (claude-runtime-diagnostics-v1): bringing a runtime online can fail with `runtime_unreachable`,
// `details.diagnosticCode: "unreachable"`. Main turns it into a fixed wire message (no daemon text crosses IPC);
// the renderer reads it back and says 连接不上运行时, next to the existing 启动 retry. Without that
// classification the refusal keeps the existing error presentation.
export const RUNTIME_UNREACHABLE_CODE = "runtime_unreachable";
const WIRE = "runtime_unreachable:diagnostic";

/** Main / store: the classified refusal as the fixed wire message, else null. */
export function runtimeUnreachableWire(error: unknown): string | null {
  const e = error as { code?: unknown; details?: unknown } | null;
  if (!e || typeof e !== "object" || e.code !== RUNTIME_UNREACHABLE_CODE) return null;
  const details = e.details as { diagnosticCode?: unknown } | null | undefined;
  return details && typeof details === "object" && details.diagnosticCode === "unreachable" ? WIRE : null;
}

/** Renderer: whether an IPC error (or a saved start error) is that refusal. */
export function isRuntimeUnreachable(error: unknown): boolean {
  if (runtimeUnreachableWire(error)) return true;
  const message = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  return message === WIRE;
}
