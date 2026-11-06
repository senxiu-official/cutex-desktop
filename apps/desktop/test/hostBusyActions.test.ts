import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {CutexApiError} from "@cutex-desktop/cutex-client";
import {HOST_BUSY_ACTION_CONTRACT,hostBusyActionError,hostBusyActionWire} from "../src/shared/hostBusyAction";
import {hostBusyRetryDelay} from "../src/shared/queueSteerRetry";
import {HostBusyActionCancelled,HostBusyActionExhausted,HostBusyActionUncertain,runHostBusyAction,useHostBusyActions} from "../src/renderer/src/lib/hostBusyActions";
import {INVOKE_CHANNEL} from "../src/shared/ipc";
import {beginOperation,operationItem,trackedOperationItem,useBackgroundOperations} from "../src/renderer/src/lib/backgroundOperations";

const busy=()=>new CutexApiError(503,"admission_busy","busy",true,{reason:"hostBusy",retryAfterMs:1000});
const options=()=>({key:crypto.randomUUID(),hostId:"local",sessionId:"s1",name:"Alpha",kind:"delete" as const,current:()=>true,onError:vi.fn()});
beforeEach(()=>{vi.useFakeTimers();useHostBusyActions.setState({rows:[]});useBackgroundOperations.setState({operations:[]});});
afterEach(()=>vi.useRealTimers());
it("keeps host-busy feedback in its batch receipt and retries only the original captured call",async()=>{
  const operationId=beginOperation("local","restore.all",[{key:"s1",name:"Alpha"}]);
  const run=vi.fn().mockRejectedValue(busy()),opts=options();
  const task=expect(trackedOperationItem({operationId,key:"s1"},()=>runHostBusyAction(opts,run))).rejects.toBeInstanceOf(HostBusyActionExhausted);
  await vi.advanceTimersByTimeAsync(5200);await task;
  expect(useBackgroundOperations.getState().operations).toHaveLength(1);
  expect(operationItem({operationId,key:"s1"})).toMatchObject({state:"failed",busyOwned:true});
  run.mockResolvedValue("accepted");operationItem({operationId,key:"s1"})!.retry!();await vi.advanceTimersByTimeAsync(0);
  expect(operationItem({operationId,key:"s1"})).toMatchObject({state:"done",retry:undefined});
  expect(run).toHaveBeenCalledTimes(6);
});
it.each(HOST_BUSY_ACTION_CONTRACT)("recognizes $route/$operation in its wire family",entry=>{
  // r271.1 2507559d: both route families wrap error; only session RPCs carry requestId.
  const shape={source:"cutex",code:"admission_busy",message:"variable diagnostic text",retryable:true,details:{reason:"hostBusy",retryAfterMs:1000},diagnosticId:"test-diagnostic"};
  const error=CutexApiError.fromBody(503,entry.route.includes("agent-management")?{error:shape}:{contractVersion:2,requestId:"test-request",error:shape});
  const wire=hostBusyActionWire(error)!;expect(wire).toBeTruthy();
  expect(hostBusyActionError(new Error(`Error invoking remote method '${INVOKE_CHANNEL}': Error: ${wire}`))).toMatchObject({code:"admission_busy",retryable:true,details:{reason:"hostBusy",retryAfterMs:1000}});
});
it.each(["admission_busy: host_busy: the launch claim check waits for the host authority fence; retry shortly: admission_deferred: lifecycle authority fence busy", "admission_busy: hostBusy: lock held", "hostBusy: retry later"])("normalizes the typed r271 mislabel: %s",message=>{
  const error=CutexApiError.fromBody(500,{contractVersion:2,error:{code:"runtime_mutation_failed",message,retryable:true,details:{}}});
  expect(hostBusyActionError(error)).toMatchObject({status:503,code:"admission_busy",retryable:true,details:{reason:"hostBusy",retryAfterMs:1000}});
  expect(hostBusyActionError(new Error(hostBusyActionWire(error)!))).not.toBeNull();
});
it.each([
  new Error("runtime_mutation_failed: admission_busy: hostBusy"),
  new CutexApiError(500,"native_request_failed","admission_busy: hostBusy",true),
  new CutexApiError(500,"runtime_mutation_failed","runtime refused: admission_busy: hostBusy",true),
  new CutexApiError(500,"runtime_mutation_failed","admission_busy: hostBusy",true,{resyncRequired:true}),
  new CutexApiError(500,"runtime_mutation_failed","admission_busy: hostBusy",true,{nativeError:{}}),
])("does not authorize legacy replay from an embedded/native/uncertain error %#",error=>{
  expect(hostBusyActionWire(error)).toBeNull();expect(hostBusyActionError(error)).toBeNull();
});
it("does not claim nonexecution when a dispatched request becomes uncertain after the connection changes",async()=>{
  let current=true,reject!: (error:Error)=>void;
  const original=new Error("request_outcome_unknown: connection dropped after dispatch");
  const run=vi.fn(()=>new Promise((_yes,no)=>{reject=no;}));
  const operation=runHostBusyAction({...options(),current:()=>current},run);
  const result=expect(operation).rejects.toMatchObject({cause:original});
  await vi.advanceTimersByTimeAsync(0);current=false;reject(original);await result;
  await expect(operation).rejects.toBeInstanceOf(HostBusyActionUncertain);
  expect(useHostBusyActions.getState().rows).toMatchObject([{state:"uncertain",detail:original.message}]);
  expect(run).toHaveBeenCalledOnce();
});
it("manual retry after a reconnect remains visibly cancelled without a new request",async()=>{
  let current=true;const run=vi.fn().mockRejectedValue(busy());
  const result=expect(runHostBusyAction({...options(),current:()=>current},run)).rejects.toBeInstanceOf(HostBusyActionExhausted);
  await vi.advanceTimersByTimeAsync(5200);await result;current=false;
  useHostBusyActions.getState().rows[0]!.retry();await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(5);expect(useHostBusyActions.getState().rows).toMatchObject([{state:"cancelled"}]);
});
it("honours retryAfterMs and keeps the action pending until the server accepts",async()=>{
  const run=vi.fn().mockRejectedValueOnce(new Error(hostBusyActionWire(busy())!)).mockResolvedValue("deleted");
  let completed=false;const result=runHostBusyAction(options(),run).then(v=>{completed=true;return v;});
  await vi.advanceTimersByTimeAsync(999);expect(run).toHaveBeenCalledOnce();expect(completed).toBe(false);
  expect(useHostBusyActions.getState().rows).toMatchObject([{state:"retrying"}]);
  await vi.advanceTimersByTimeAsync(1);await expect(result).resolves.toBe("deleted");
  expect(run).toHaveBeenCalledTimes(2);expect(useHostBusyActions.getState().rows).toEqual([]);
});
it("keeps a retry button after exhaustion and reuses the captured operation without double dispatch",async()=>{
  const run=vi.fn().mockRejectedValue(busy());const opts=options();
  const result=expect(runHostBusyAction(opts,run)).rejects.toBeInstanceOf(HostBusyActionExhausted);
  await vi.advanceTimersByTimeAsync(5200);await result;expect(run).toHaveBeenCalledTimes(5);
  const row=useHostBusyActions.getState().rows[0]!;expect(row.state).toBe("exhausted");
  run.mockResolvedValue("accepted");row.retry();row.retry();await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(6);expect(useHostBusyActions.getState().rows).toEqual([]);
});
it("never retries after a host switch or an ambiguous write outcome",async()=>{
  let current=true;const run=vi.fn().mockRejectedValue(busy());const result=expect(runHostBusyAction({...options(),current:()=>current},run)).rejects.toBeInstanceOf(HostBusyActionCancelled);
  await vi.advanceTimersByTimeAsync(1);current=false;await vi.advanceTimersByTimeAsync(1000);await result;
  expect(run).toHaveBeenCalledOnce();expect(useHostBusyActions.getState().rows).toMatchObject([{state:"cancelled"}]);
  const uncertain=new CutexApiError(503,"admission_busy","uncertain",true,{reason:"hostBusy",resyncRequired:true});
  expect(hostBusyActionWire(uncertain)).toBeNull();const send=vi.fn().mockRejectedValue(uncertain);
  await expect(runHostBusyAction(options(),send)).rejects.toBe(uncertain);expect(send).toHaveBeenCalledOnce();
});
it.each([
  "request_outcome_unknown: host_action_busy:{}",
  "native_request_failed: host_action_busy:{}",
  'host_action_busy:{"resyncRequired":true}',
  'host_action_busy:{"retryAfterMs":"1000"}',
  "prefix host_action_busy:{} suffix",
])("does not infer safe replay from an embedded or malformed envelope: %s",message=>{
  expect(hostBusyActionError(new Error(message))).toBeNull();
});
it("uses valid hints as minimum delays and ignores invalid timer values",()=>{
  expect(hostBusyRetryDelay(busy(),0)).toBe(1000);
  expect(hostBusyRetryDelay(busy(),3)).toBe(2000);
  expect(hostBusyRetryDelay(new CutexApiError(503,"admission_busy","",true,{retryAfterMs:5000}),0)).toBe(5000);
  expect(hostBusyRetryDelay(new CutexApiError(503,"admission_busy","",true,{retryAfterMs:NaN}),0)).toBe(300);
});
