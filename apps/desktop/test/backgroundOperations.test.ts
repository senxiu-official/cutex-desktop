import { beforeEach, expect, it, vi } from "vitest";
import { acknowledgeOperations, activeOperationItem, beginOperation, operationItem, operationsSummary, trackedOperationItem, updateOperationItem, useBackgroundOperations } from "../src/renderer/src/lib/backgroundOperations";
beforeEach(() => useBackgroundOperations.setState({operations:[]}));
it("keeps per-agent receipts independent of the initiating view and retries only the failed captured call", async () => {
  const id=beginOperation("remote","restore.all",[{key:"a",name:"Alpha"},{key:"b",name:"Beta"}]);
  const a=vi.fn().mockResolvedValue("ok"),b=vi.fn().mockRejectedValueOnce(new Error("refused")).mockResolvedValue("ok");
  await trackedOperationItem({operationId:id,key:"a"},a);
  await expect(trackedOperationItem({operationId:id,key:"b"},b)).rejects.toThrow("refused");
  expect(operationsSummary(useBackgroundOperations.getState().operations)).toMatchObject({running:0,unreadFailure:true});
  acknowledgeOperations([id]); expect(useBackgroundOperations.getState().operations[0]!.unreadFailure).toBe(false);
  await operationItem({operationId:id,key:"b"})!.retry!();
  expect(a).toHaveBeenCalledOnce();expect(b).toHaveBeenCalledTimes(2);
  expect(useBackgroundOperations.getState().operations[0]!.items.map(item=>item.state)).toEqual(["done","done"]);
});
it("counts progress across hosts and never aliases equal session ids", async () => {
  const a=beginOperation("local","restore.all",[{key:"same",name:"A"}]);
  const b=beginOperation("remote","restore.all",[{key:"same",name:"B"}]);
  updateOperationItem({operationId:a,key:"same"},{state:"done"});
  expect(operationsSummary(useBackgroundOperations.getState().operations)).toEqual({running:1,done:0,total:1,unreadFailure:false});
  let finish!:()=>void;
  const work=trackedOperationItem({operationId:b,key:"same"},()=>new Promise<void>(resolve=>{finish=resolve}));
  expect(activeOperationItem("remote","same")).toEqual({operationId:b,key:"same"});
  expect(activeOperationItem("local","same")).toBeNull();
  finish();await work;
});
it("keeps running and unread operations when read history is bounded", () => {
  const pending=beginOperation("local","restore.all",[{key:"a",name:"A"}]);
  const failed=beginOperation("remote","restore.all",[{key:"b",name:"B"}]);
  updateOperationItem({operationId:failed,key:"b"},{state:"failed",detail:"refused"});
  for(let i=0;i<40;i++){const id=beginOperation("local","restore.all",[{key:"x",name:"X"}]);updateOperationItem({operationId:id,key:"x"},{state:"done"});}
  expect(operationItem({operationId:pending,key:"a"})!.state).toBe("queued");
  expect(operationItem({operationId:failed,key:"b"})!.state).toBe("failed");
});
it("deduplicates repeated activation of the same captured receipt",async()=>{
  const operationId=beginOperation("remote","restore.all",[{key:"a",name:"A"}]);
  let finish!:()=>void;const run=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}));
  const target={operationId,key:"a"};const first=trackedOperationItem(target,run),second=trackedOperationItem(target,run);
  expect(first).toBe(second);expect(run).toHaveBeenCalledOnce();finish();await first;
});
