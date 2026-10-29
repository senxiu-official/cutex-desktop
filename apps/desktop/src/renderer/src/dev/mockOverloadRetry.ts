import type { AutoRetryWait, QueueAdmission, SessionResource } from "@cutex-desktop/protocol";

export const OVERLOAD_RETRY_SCENE = typeof location !== "undefined" && new URLSearchParams(location.search).has("overloadretry");
export const OVERLOAD_RETRY_SESSION = "retry-preview";
const at = new Date().toISOString();
export const overloadRetryWait: AutoRetryWait = {
  attempt: 2, maxAttempts: 3, scheduledAt: at, at: new Date(Date.now() + 45_000).toISOString(),
  turnId: "overload-retry-1", planId: "mock-overload-plan", phase: "pending", holdsAdmission: true,
  threadId: "thread-retry-preview", runtimeGeneration: 3,
};
export function overloadRetryResource(resource: SessionResource): SessionResource {
  if (!OVERLOAD_RETRY_SCENE || resource.cutexSessionId !== OVERLOAD_RETRY_SESSION) return resource;
  return { ...resource, displayName: "自动重试预览", activityStatus: "idle", autoRetry: overloadRetryWait,
    lastActivityAt: at, activitySource: "conversation", activity: { lastConversationAt: at },
    runtime: { ...resource.runtime, activeTurnId: null, activeTurnObservedAt: null, threadStatus: null, lastEventAt: at } };
}
export function overloadRetryAdmission(): QueueAdmission {
  return { revision: 1, orderRevision: 1, items: [], currentTurn: null, autoRetry: overloadRetryWait,
    nextStep: [{ id: "retry-waiting-notice", deliveryKind: "wake", label: "请检查上一轮的结果", from: "Mika", fromCutexSessionId: "mika", enqueuedAt: at, waitReason: "autoRetry" }] };
}
export function overloadRetryThread() {
  const now = Math.floor(Date.now() / 1000);
  return { thread: { id: "thread-retry-preview", turns: [
    { id: "overload-owner", status: "failed", startedAt: now - 60, completedAt: now - 59,
      error: { message: "The model is temporarily overloaded.", codexErrorInfo: "serverOverloaded" }, items: [
        { id: "overload-user", type: "userMessage", content: [{ type: "text", text: "请检查刚才的测试结果。", text_elements: [] }] },
      ] },
    { id: "overload-retry-1", status: "failed", startedAt: now - 40, completedAt: now - 39,
      error: { message: "The model is still temporarily overloaded.", codexErrorInfo: "serverOverloaded" }, items: [
        { id: "overload-continue-1", type: "functionCallOutput", name: "external_event", namespace: "external",
          output: JSON.stringify({ source: { kind: "service", id: "cutex-model-overload-retry" }, type: "model_overload_continue", text: "Continue." }),
          externalInputView: { schema: "cutex.model-overload-retry.v1", data: { failedTurnId: "overload-owner", planId: "mock-overload-plan", attempt: 1, maxAttempts: 3 } } },
      ] },
  ] } };
}
