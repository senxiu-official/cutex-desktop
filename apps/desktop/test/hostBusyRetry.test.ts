import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { HOST_BUSY_BACKOFF_MS, retryableHostBusy, withHostBusyRetry, withSteerPreflightRetry } from "../src/shared/queueSteerRetry";

const busy = () => new CutexApiError(409,"steer_unavailable","busy",true,{reason:"admissionBusy"});
const deferred = () => new CutexApiError(503,"event_persistence_unavailable","admission_deferred: lifecycle authority fence busy",true);
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());

it.each([busy,deferred])("keeps one in-flight action until admission recovers, using bounded exponential backoff",async error=>{
  const send=vi.fn().mockRejectedValueOnce(error()).mockRejectedValueOnce(error()).mockResolvedValue("accepted");
  const current=vi.fn(), retry=vi.fn();
  const result=withSteerPreflightRetry(send,current,retry);
  await vi.advanceTimersByTimeAsync(299);expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(send).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(599);expect(send).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);await expect(result).resolves.toBe("accepted");
  expect(send).toHaveBeenCalledTimes(3);expect(current).toHaveBeenCalledTimes(2);
  expect(retry.mock.calls.map(c=>c[1])).toEqual([2,3]);
});
it("stops after four retries and returns the actual host-busy refusal",async()=>{
  const error=busy(),send=vi.fn().mockRejectedValue(error);
  const result=expect(withSteerPreflightRetry(send,()=>{})).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(HOST_BUSY_BACKOFF_MS.reduce((a,b)=>a+b,0));await result;
  expect(send).toHaveBeenCalledTimes(5);
});
it.each([
  new Error("timeout"),new CutexApiError(503,"event_persistence_unavailable","disk failed",true),
  new CutexApiError(409,"request_outcome_unknown","uncertain",true,{reason:"admissionBusy"}),
  new CutexApiError(409,"steer_unavailable","busy",true,{reason:"admissionBusy",resyncRequired:true}),
  new CutexApiError(409,"steer_unavailable","native refusal",true,{reason:"admissionBusy",nativeError:{code:-1}}),
  new CutexApiError(409,"steer_unavailable","busy",false,{reason:"admissionBusy"}),
])("never retries ambiguous, native or unrelated failures (%s)",async error=>{
  expect(retryableHostBusy(error)).toBe(false);
  const send=vi.fn().mockRejectedValue(error);
  await expect(withHostBusyRetry(send,()=>{})).rejects.toBe(error);expect(send).toHaveBeenCalledOnce();
});
it("cancels retry if its captured host connection changed during backoff",async()=>{
  const send=vi.fn().mockRejectedValue(busy());
  const result=expect(withSteerPreflightRetry(send,()=>{throw new Error("stale host");})).rejects.toThrow("stale host");
  await vi.advanceTimersByTimeAsync(300);await result;expect(send).toHaveBeenCalledOnce();
});
