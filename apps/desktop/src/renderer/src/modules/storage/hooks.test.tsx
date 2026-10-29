// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageApi, StorageOverview } from "../../../../shared/storage";
import { storageFixture as mockStorageView } from "./testFixtures";

const environment = vi.hoisted(() => ({
  host: "A", features: new Set(["host-storage"]), connected: true,
  apis: new Map<string, StorageApi>(),
  listeners: new Set<(event: {hostId:string;envelope:{cutex:{method:string}}})=>void>(),
}));
vi.mock("../../bridge", () => ({ apiFor: (id:string) => environment.apis.get(id), bridge: { on: (_:string,listener:(event:{hostId:string;envelope:{cutex:{method:string}}})=>void) => {environment.listeners.add(listener); return () => {environment.listeners.delete(listener);};} } }));
vi.mock("../../lib/targetHost", () => ({ useTargetHostId: () => environment.host, useTargetFeatures: () => environment.features }));
vi.mock("../../lib/useHostScope", () => ({ useHostData: () => ({ daemon: {kind:environment.connected ? "connected":"disconnected"} }) }));
import { useStorage } from "./hooks";

function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>((yes)=>{resolve=yes;}); return {promise,resolve}; }
function api(host:string): StorageApi { return {storage:vi.fn(async()=>mockStorageView(host)),storageRefresh:vi.fn(async()=>({state:"running" as const,startedAt:"now"})),storageItems:vi.fn(async(store)=>({store,items:[],nextCursor:null}))}; }
let root:Root, container:HTMLDivElement, current:ReturnType<typeof useStorage>;
function Harness() { current=useStorage(); return <span>{current.view?.host ?? "empty"}</span>; }
async function render() { await act(async()=>{root.render(<Harness/>);}); }
beforeEach(()=>{
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  environment.host="A"; environment.features=new Set(["host-storage"]); environment.connected=true; environment.apis.clear(); environment.apis.set("A",api("A")); environment.apis.set("B",api("B")); environment.listeners.clear();
  container=document.createElement("div"); document.body.append(container); root=createRoot(container);
});
afterEach(async()=>{ await act(async()=>{root.unmount();}); container.remove(); vi.useRealTimers(); });

describe("storage host binding",()=>{
  it("never lets a late old-host read paint over the new settings target",async()=>{
    const pending=deferred<StorageOverview|null>(); environment.apis.get("A")!.storage=vi.fn(()=>pending.promise);
    await render(); expect(container.textContent).toBe("empty"); environment.host="B"; await render(); expect(container.textContent).toBe("B");
    await act(async()=>{pending.resolve(mockStorageView("A")); await pending.promise;}); expect(container.textContent).toBe("B");
  });
  it("re-reads only this host's walk events and disposes its subscription",async()=>{
    await render(); const read=environment.apis.get("A")!.storage; expect(read).toHaveBeenCalledTimes(1);
    const emit=(hostId:string,method:string)=>environment.listeners.forEach((fn)=>fn({hostId,envelope:{cutex:{method}}}));
    await act(async()=>{emit("B","cutex/storage/walkChanged");emit("A","cutex/users/changed");}); expect(read).toHaveBeenCalledTimes(1);
    await act(async()=>{emit("A","cutex/storage/walkChanged");}); expect(read).toHaveBeenCalledTimes(2);
    await act(async()=>{root.unmount();}); expect(environment.listeners.size).toBe(0); root=createRoot(container);
  });
  it("does not replace a slow in-flight poll with another poll",async()=>{
    vi.useFakeTimers();
    const view=mockStorageView("A"); view.walk.state="running";
    const pending=deferred<StorageOverview|null>();
    const read=vi.fn().mockResolvedValueOnce(view).mockReturnValueOnce(pending.promise);
    environment.apis.get("A")!.storage=read;
    await render();
    await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
    expect(read).toHaveBeenCalledTimes(2);
    await act(async()=>{pending.resolve(view);await pending.promise;});
    expect(current.view?.host).toBe("A");
  });
  it("does not call a legacy backend or a disconnected host",async()=>{
    environment.features=new Set(); await render(); expect(current.supported).toBe(false); expect(environment.apis.get("A")!.storage).not.toHaveBeenCalled();
    environment.features=new Set(["host-storage"]); environment.connected=false; await render(); expect(environment.apis.get("A")!.storage).not.toHaveBeenCalled();
  });
});
