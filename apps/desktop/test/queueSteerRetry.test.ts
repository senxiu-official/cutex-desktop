import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { withSteerPreflightRetry } from "../src/shared/queueSteerRetry";

const cold = () => new CutexApiError(409, "steer_unavailable", "kept", true, { reason: "runtimeNoSteer" });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("finishes one owner action after a transient pre-send capability refusal, without exposing that refusal", async () => {
  const send = vi.fn().mockRejectedValueOnce(cold()).mockResolvedValue({ disposition: "steered" });
  const current = vi.fn();
  const result = withSteerPreflightRetry(send, current);
  await vi.advanceTimersByTimeAsync(149);
  expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ disposition: "steered" });
  expect(send).toHaveBeenCalledTimes(2);
  expect(current).toHaveBeenCalledOnce();
});

it("stops after one retry and preserves a continuing capability-gate refusal for the caller", async () => {
  const error = cold();
  const send = vi.fn().mockRejectedValue(error);
  const result = expect(withSteerPreflightRetry(send, () => {})).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(150);
  await result;
  expect(send).toHaveBeenCalledTimes(2);
});

it.each([
  new Error("connection reset"),
  new CutexApiError(409, "steer_unavailable", "kept", false, { reason: "runtimeNoSteer" }),
  new CutexApiError(409, "steer_unavailable", "native unsupported", true, { reason: "runtimeNoSteer", nativeError: { code: -32601 } }),
  new CutexApiError(409, "steer_unavailable", "kept", true, { reason: "runtimeNoSteer", resyncRequired: true }),
  new CutexApiError(409, "steer_unavailable", "kept", true, { reason: "runtimeRefused" }),
  new CutexApiError(409, "steer_unavailable", "kept", true, { reason: "delegationTurn" }),
  new CutexApiError(409, "request_outcome_unknown", "may have landed", true),
  new CutexApiError(409, "turn_conflict", "changed", true),
])("never resubmits after a native, transport, unknown-outcome or unrelated refusal: %s", async (error) => {
  const send = vi.fn().mockRejectedValue(error);
  await expect(withSteerPreflightRetry(send, () => {})).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledOnce();
});

it("does not send again after the connection changes during its bounded wait", async () => {
  const stale = new Error("host connection changed");
  const send = vi.fn().mockRejectedValue(cold());
  const result = expect(withSteerPreflightRetry(send, () => { throw stale; })).rejects.toBe(stale);
  await vi.advanceTimersByTimeAsync(150);
  await result;
  expect(send).toHaveBeenCalledOnce();
});
