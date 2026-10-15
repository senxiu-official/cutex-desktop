import { describe, expect, it, vi } from "vitest";
import { reserveNewOwnerTab } from "../src/renderer/src/modules/browser/newOwnerTab";
const key="00000000-0000-4000-8000-000000000001";
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
describe("new owner reservation lifecycle",()=>{
  it("does not pass a renderer key and hands off exactly the freshly returned main key",async()=>{
    const api={reserveOwnerTab:vi.fn(async()=>({tabKey:key})),close:vi.fn(async()=>{})},accepted=vi.fn(),failed=vi.fn();
    const release=reserveNewOwnerTab(api,()=>true,accepted,failed); await flush(); release();
    expect(api.reserveOwnerTab).toHaveBeenCalledExactlyOnceWith(); expect(accepted).toHaveBeenCalledExactlyOnceWith(key); expect(api.close).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });
  it.each(["unmount","epoch"])("closes only its own late allocated key after %s, never attaches it",async why=>{
    const result=deferred<{tabKey:string}>(),api={reserveOwnerTab:vi.fn(()=>result.promise),close:vi.fn(async()=>{})},accepted=vi.fn(),failed=vi.fn();let current=true;
    const release=reserveNewOwnerTab(api,()=>current,accepted,failed);await flush();if(why==="unmount")release();else current=false;
    result.resolve({tabKey:key});await flush(); expect(api.close).toHaveBeenCalledExactlyOnceWith(key);expect(accepted).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();
  });
  it("a synchronous StrictMode teardown never allocates and failures do not fall back to a renderer-selected key",async()=>{
    const api={reserveOwnerTab:vi.fn(async()=>{throw Error("browser_identity_unavailable");}),close:vi.fn(async()=>{})},accepted=vi.fn(),failed=vi.fn();
    reserveNewOwnerTab(api,()=>true,accepted,failed)();await flush();expect(api.reserveOwnerTab).not.toHaveBeenCalled();
    reserveNewOwnerTab(api,()=>true,accepted,failed);await flush();expect(api.reserveOwnerTab).toHaveBeenCalledOnce();expect(failed).toHaveBeenCalledOnce();expect(accepted).not.toHaveBeenCalled();
  });
});
