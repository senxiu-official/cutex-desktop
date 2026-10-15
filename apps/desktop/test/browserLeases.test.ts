import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserLeases } from "../src/main/browser/leases";
import { DEFAULT_BROWSER_CONTROL_SETTINGS } from "../src/shared/browser";
import type { RelayGrant, RelayLease } from "../src/main/browser/relayTypes";
const settings = { ...DEFAULT_BROWSER_CONTROL_SETTINGS };
const lease: RelayLease = { leaseId: "l1", cutexSessionId: "s1", target: { hostId: "h1", deviceId: "d1", guestId: "g1" }, state: "pending", title: "Browser", url: "http://localhost/", origin: "owner", agentName: "Agent" };
const input: RelayGrant = { deviceId: "d1", guestId: "g1", cutexSessionId: "s1", title: "Browser", url: "http://localhost/", source: { kind: "owner" } };
function deferred<T>() { let resolve!: (v:T)=>void, reject!: (e:unknown)=>void; const promise = new Promise<T>((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject}; }
const flush = async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function fixture() {
  const options = { current: vi.fn(()=>true), prepare: vi.fn(async()=>{}), releaseProvider: vi.fn(), changed: vi.fn(), timeoutMs: 100 };
  const peer = { grantLease: vi.fn(async():Promise<RelayLease>=>structuredClone(lease)), activateLease: vi.fn(async():Promise<RelayLease>=>({...lease,state:"active"})), revokeLease: vi.fn(async()=>{}) };
  const manager = new BrowserLeases(options); return { manager, options, peer };
}
afterEach(()=>vi.useRealTimers());
describe("browser main hold/provider/daemon two-phase grants",()=>{
  it.each(["grant-response", "before-hold", "prepare", "activate"])("consent identity change at %s revokes before a successful grant", async stage => {
    const f = fixture(); let current = true;
    const grantReply = deferred<RelayLease>(), preparing = deferred<void>(), activating = deferred<RelayLease>();
    if (stage === "grant-response") f.peer.grantLease.mockReturnValue(grantReply.promise);
    if (stage === "prepare") f.options.prepare.mockReturnValue(preparing.promise);
    if (stage === "activate") f.peer.activateLease.mockReturnValue(activating.promise);
    const grant = f.manager.grant(f.peer, input, settings, () => current), rejected = expect(grant).rejects.toBeDefined();
    await flush();
    if (stage === "grant-response") { current = false; grantReply.resolve(lease); }
    else {
      if (stage === "before-hold") current = false;
      const held = f.manager.held("g1", "l1", true), refused = expect(held).rejects.toBeDefined();
      await flush(); current = false;
      if (stage === "prepare") preparing.resolve();
      if (stage === "activate") activating.resolve({ ...lease, state: "active" });
      await refused;
    }
    await rejected; expect(f.manager.list()).toEqual([]); expect(f.peer.revokeLease).toHaveBeenCalledWith("l1");
  });
  it("refused initial keep-mounted capacity is lease_limit, not a successful or active lease", async () => {
    const f = fixture(), grant = f.manager.grant(f.peer, input, settings);
    const rejected = expect(grant).rejects.toMatchObject({ code: "lease_limit" });
    await flush(); await f.manager.held("g1", "l1", false); await rejected;
    expect(f.options.prepare).not.toHaveBeenCalled(); expect(f.peer.activateLease).not.toHaveBeenCalled();
    expect(f.manager.list()).toEqual([]);
  });
  it("does not activate until exact guest hold and provider are ready",async()=>{
    const f=fixture(), grant=f.manager.grant(f.peer,input,settings); await flush();
    expect(f.manager.view("g1")?.state).toBe("pending"); expect(f.peer.activateLease).not.toHaveBeenCalled();
    await expect(f.manager.held("g2","l1",true)).rejects.toMatchObject({code:"lease_revoked"});
    await f.manager.held("g1","l1",true); await grant;
    expect(f.options.prepare).toHaveBeenCalledOnce(); expect(f.manager.view("g1")?.state).toBe("active");
    await f.manager.held("g1","l1",true); expect(f.options.prepare).toHaveBeenCalledOnce(); f.manager.dispose();
  });
  it("queues activation-racing commands without execution until HTTP and consent both confirm",async()=>{
    const f=fixture(), ack=deferred<RelayLease>(); f.peer.activateLease.mockReturnValue(ack.promise);
    const grant=f.manager.grant(f.peer,input,settings); await flush();
    const execute=vi.fn(), waiting=f.manager.waitActive("l1").then(execute);
    await flush(); expect(execute).not.toHaveBeenCalled();
    const held=f.manager.held("g1","l1",true); await flush();
    expect(f.manager.list()[0]?.state).toBe("active"); expect(f.manager.view("g1")?.state).toBe("pending");
    expect(execute).not.toHaveBeenCalled();
    ack.resolve({...lease,state:"active"}); await held; await grant; await waiting;
    expect(execute).toHaveBeenCalledExactlyOnceWith({...lease,state:"active"});
    expect(f.manager.view("g1")?.state).toBe("active"); f.manager.dispose();
  });
  it("does not execute a waiting command when consent changes before activation confirms",async()=>{
    const f=fixture(), ack=deferred<RelayLease>(); let consent=true;
    f.peer.activateLease.mockReturnValue(ack.promise);
    const grant=f.manager.grant(f.peer,input,settings,()=>consent), rejected=expect(grant).rejects.toMatchObject({code:"lease_revoked"});
    await flush(); const execute=vi.fn(), waiting=f.manager.waitActive("l1").then(execute), refused=expect(waiting).rejects.toMatchObject({code:"lease_revoked"});
    const held=f.manager.held("g1","l1",true), failed=expect(held).rejects.toMatchObject({code:"lease_revoked"}); await flush();
    consent=false; ack.resolve({...lease,state:"active"}); await rejected; await refused; await failed;
    expect(execute).not.toHaveBeenCalled(); expect(f.manager.list()).toEqual([]); expect(f.peer.activateLease).toHaveBeenCalledOnce();
  });
  it("legitimate navigation after activation does not retain the owner's old document fence",async()=>{
    const f=fixture(); let consent=true;
    const grant=f.manager.grant(f.peer,input,settings,()=>consent); await flush(); await f.manager.held("g1","l1",true); await grant;
    const execute=vi.fn(async()=>{consent=false;}); await f.manager.waitActive("l1").then(execute);
    await expect(f.manager.waitActive("l1")).resolves.toMatchObject({leaseId:"l1",state:"active"});
    expect(execute).toHaveBeenCalledOnce(); expect(f.peer.revokeLease).not.toHaveBeenCalled(); f.manager.dispose();
  });
  it.each(["refusal", "timeout", "revoke"])("activation %s rejects queued execution without replay",async(mode)=>{
    vi.useFakeTimers(); const f=fixture(), ack=deferred<RelayLease>(); f.peer.activateLease.mockReturnValue(ack.promise);
    const grant=f.manager.grant(f.peer,input,settings), rejected=expect(grant).rejects.toMatchObject({code:"lease_revoked"}); await flush();
    const execute=vi.fn(), waiting=f.manager.waitActive("l1").then(execute), refused=expect(waiting).rejects.toMatchObject({code:"lease_revoked"});
    const held=f.manager.held("g1","l1",true), failed=expect(held).rejects.toBeDefined(); await flush();
    if(mode==="refusal")ack.reject(Error("activation refused"));
    else { if(mode==="timeout")await vi.advanceTimersByTimeAsync(101);else f.manager.revoke("l1","lease_revoked"); }
    await rejected; await refused; expect(execute).not.toHaveBeenCalled();
    if(mode!=="refusal")ack.resolve({...lease,state:"active"}); await failed;
    expect(f.peer.grantLease).toHaveBeenCalledOnce(); expect(f.peer.activateLease).toHaveBeenCalledOnce(); expect(f.manager.list()).toEqual([]);
    await expect(f.manager.waitActive("l1")).rejects.toMatchObject({code:"lease_revoked"});
  });
  it("checks current host and exact live entry even for an already active lease",async()=>{
    const f=fixture(); await expect(f.manager.waitActive("missing")).rejects.toMatchObject({code:"lease_revoked"});
    const grant=f.manager.grant(f.peer,input,settings); await flush(); await f.manager.held("g1","l1",true); await grant;
    const waiting=f.manager.waitActive("l1"), refused=expect(waiting).rejects.toMatchObject({code:"lease_revoked"});
    f.manager.revoke("l1","lease_revoked"); await refused;
    const replacement=f.manager.grant(f.peer,input,settings); await flush(); await f.manager.held("g1","l1",true); await replacement;
    f.options.current.mockReturnValue(false);
    await expect(f.manager.waitActive("l1")).rejects.toMatchObject({code:"lease_revoked"}); expect(f.manager.list()).toEqual([]);
  });
  it.each(["false", "timeout", "dispose"])("%s revokes pending without activating or retrying",async(mode)=>{
    vi.useFakeTimers(); const f=fixture(), grant=f.manager.grant(f.peer,input,settings); const rejected=expect(grant).rejects.toBeDefined(); await flush();
    if(mode==="false")await f.manager.held("g1","l1",false); else if(mode==="timeout")await vi.advanceTimersByTimeAsync(101);else f.manager.dispose();
    await rejected; expect(f.manager.list()).toEqual([]); expect(f.peer.activateLease).not.toHaveBeenCalled(); expect(f.peer.grantLease).toHaveBeenCalledOnce();
  });
  it("late activate cannot revive a revoked grant",async()=>{
    const f=fixture(), ack=deferred<RelayLease>();f.peer.activateLease.mockReturnValue(ack.promise);
    const grant=f.manager.grant(f.peer,input,settings), rejected=expect(grant).rejects.toBeDefined();await flush();
    const held=f.manager.held("g1","l1",true), failed=expect(held).rejects.toBeDefined();await flush();
    f.manager.revoke("l1","lease_revoked");ack.resolve({...lease,state:"active"});await rejected;await failed;expect(f.manager.list()).toEqual([]);
  });
  it("close during the grant HTTP revokes its late pending lease",async()=>{
    const f=fixture(), reply=deferred<RelayLease>(); f.peer.grantLease.mockReturnValue(reply.promise);
    const grant=f.manager.grant(f.peer,input,settings), rejected=expect(grant).rejects.toMatchObject({code:"stale_connection"});
    f.manager.revokeGuest("g1");reply.resolve(lease);await rejected;expect(f.peer.revokeLease).toHaveBeenCalledWith("l1");expect(f.manager.list()).toEqual([]);
  });
  it("host change and provider failure revoke admission before cleanup",async()=>{
    const f=fixture(), prepare=deferred<void>();f.options.prepare.mockReturnValue(prepare.promise);
    const grant=f.manager.grant(f.peer,input,settings), rejected=expect(grant).rejects.toBeDefined();await flush();
    const held=f.manager.held("g1","l1",true), failed=expect(held).rejects.toBeDefined();await flush(); f.options.current.mockReturnValue(false);prepare.resolve();await rejected;await failed;
    expect(f.peer.activateLease).not.toHaveBeenCalled();expect(f.manager.list()).toEqual([]);expect(f.options.releaseProvider).toHaveBeenCalledWith("g1","l1");
  });
  it("duplicate owner grant cannot silently take over a live lease",async()=>{
    const f=fixture(), grant=f.manager.grant(f.peer,input,settings);await flush(); await expect(f.manager.grant(f.peer,input,settings)).rejects.toMatchObject({code:"lease_conflict"});
    await f.manager.held("g1","l1",true);await grant;f.manager.dispose();
  });
});
