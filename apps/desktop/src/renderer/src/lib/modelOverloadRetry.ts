import type { MessageKey } from "../i18n";
import type { AutoRetryWait } from "@cutex-desktop/protocol";

export const MODEL_OVERLOAD_RETRY_VISIBLE_FEATURE = "model-overload-retry-visible";

/** Validated server projection; never synthesized from errors or elapsed time. */
export type ModelOverloadRetryWait = AutoRetryWait;

export function validatedAutoRetryWait(value: unknown): ModelOverloadRetryWait | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.attempt) || !Number.isSafeInteger(v.maxAttempts)
    || (v.attempt as number) < 1 || (v.maxAttempts as number) < (v.attempt as number)
    || typeof v.scheduledAt !== "string" || !Number.isFinite(Date.parse(v.scheduledAt))
    || typeof v.turnId !== "string" || !v.turnId.trim()
    || typeof v.planId !== "string" || !v.planId.trim()
    || !["pending", "firing", "binding", "uncertain"].includes(v.phase as string)
    || typeof v.holdsAdmission !== "boolean"
    || (v.runtimeGeneration !== undefined && (!Number.isSafeInteger(v.runtimeGeneration) || (v.runtimeGeneration as number) < 0))
    || (v.threadId !== undefined && (typeof v.threadId !== "string" || !v.threadId.trim()))) return null;
  return value as ModelOverloadRetryWait;
}

type RetrySource = { autoRetry?: unknown };
export interface AutoRetryPresence {
  features: ReadonlySet<string>;
  resource?: RetrySource & { runtime: { status: string; runtimeGeneration: number; appServerConnected?: boolean | null } };
  view?: { runtimeGeneration: number; admission?: unknown; timeline?: { threadId: string | null } };
}

/** A queue snapshot belongs to the view's generation; the resource carries its own generation. */
export function modelOverloadRetryOf({ features, resource, view }: AutoRetryPresence): ModelOverloadRetryWait | null {
  if (!features.has(MODEL_OVERLOAD_RETRY_VISIBLE_FEATURE) || !resource
    || resource.runtime.status !== "online" || resource.runtime.appServerConnected === false) return null;
  if (view && view.runtimeGeneration > resource.runtime.runtimeGeneration) return null;
  const fromQueue = view?.runtimeGeneration === resource.runtime.runtimeGeneration && view.admission
    && typeof view.admission === "object" && Object.prototype.hasOwnProperty.call(view.admission, "autoRetry");
  const resourceWait = validatedAutoRetryWait(resource.autoRetry);
  const queueWait = fromQueue ? (view!.admission as RetrySource).autoRetry : undefined;
  // A null queue projection means no matching admission lease, not necessarily no retry plan.
  const wait = fromQueue ? queueWait === null && resourceWait?.holdsAdmission === false ? resourceWait : validatedAutoRetryWait(queueWait) : resourceWait;
  if (wait?.runtimeGeneration !== undefined && wait.runtimeGeneration !== resource.runtime.runtimeGeneration) return null;
  if (wait?.threadId && view?.runtimeGeneration === resource.runtime.runtimeGeneration && view.timeline?.threadId && wait.threadId !== view.timeline.threadId) return null;
  return wait;
}

export type AutoRetryLabel = "agentStatus.autoRetryWaiting" | "queue.autoRetryWaiting" | "queue.autoRetryOwnerOrder";
export function formatAutoRetryWait(t: (key: MessageKey, vars?: Record<string, string | number>) => string, wait: ModelOverloadRetryWait, key: AutoRetryLabel = "agentStatus.autoRetryWaiting"): string {
  return t(key as MessageKey, { attempt: wait.attempt, maxAttempts: wait.maxAttempts });
}
