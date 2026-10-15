import { describe, expect, it, vi } from "vitest";
import { browserTabIdentityStorage, createBrowserTabIdentity } from "../src/main/browser/tabIdentity";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const id="00000000-0000-4000-8000-000000000001";
describe("main-only browser pool provenance",()=>{
  it("LRU-evicts only owner rows and persists recency across restart", () => {
    const tab = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
    let raw = JSON.stringify({ version: 2, strict: true, agent: [["remote", id]],
      owner: Array.from({ length: 4096 }, (_, n) => ["local", tab(n)]) });
    const storage = { read: () => raw, write: (content: string) => { raw = content; } };
    const store = createBrowserTabIdentity(storage);
    store.registerOwner("local", tab(0)); // Restoring a proven owner refreshes its recency.
    const restarted = createBrowserTabIdentity(storage);
    restarted.registerOwner("local", tab(4096));
    expect(JSON.parse(raw).owner).toHaveLength(4096);
    const next = createBrowserTabIdentity(storage);
    expect(next.agent("local", tab(0))).toBe(false);
    expect(next.agent("local", tab(4096))).toBe(false);
    expect(next.unproven("local", tab(1))).toBe(true);
    expect(next.agent("local", tab(1))).toBe(true);
    expect(next.agent("remote", id)).toBe(true);
    expect(() => next.registerOwner("remote", id)).toThrow("permission_denied");
  });
  it("reset bounds live owner rows without rejecting recovery or pruning agent tombstones", () => {
    let raw = "broken";
    const storage = { read: () => raw, write: (content: string) => { raw = content; }, reset: (content: string) => { raw = content; } };
    const store = createBrowserTabIdentity(storage);
    const known = Array.from({ length: 4097 }, (_, n) => ({ hostId: "local",
      tabKey: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`, pool: "owner" as const }));
    store.reset([...known, { hostId: "remote", tabKey: id, pool: "agent" }]);
    expect(JSON.parse(raw).owner).toHaveLength(4096);
    expect(store.unproven("local", known[0]!.tabKey)).toBe(true);
    expect(store.agent("local", known[4096]!.tabKey)).toBe(false);
    expect(store.agent("remote", id)).toBe(true);
  });
  it("failed owner eviction leaves persisted and in-memory provenance unchanged", () => {
    const rows = Array.from({ length: 4096 }, (_, n) => ["local", `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`]);
    const raw = JSON.stringify({ version: 2, strict: true, agent: [], owner: rows });
    const store = createBrowserTabIdentity({ read: () => raw, write: () => { throw Error("disk"); } });
    const fresh = "00000000-0000-4000-8000-000000001000";
    expect(() => store.registerOwner("local", fresh)).toThrow("browser_identity_unavailable");
    expect(store.agent("local", rows[0]![1]!)).toBe(false);
    expect(store.unproven("local", fresh)).toBe(true);
  });
  it("owner registration never rewrites unchanged legacy agent files", () => {
    const write = vi.fn(), store = createBrowserTabIdentity({ read: () => "[]", write });
    store.registerOwner("local", id); store.registerOwner("local", id);
    expect(write).not.toHaveBeenCalled(); expect(store.agent("local", id)).toBe(false);
    expect(() => store.register("local", id)).toThrow("permission_denied");
  });
  it("a fresh main-issued owner remains owner while corrupt unknown keys stay isolated", () => {
    const write = vi.fn(), store = createBrowserTabIdentity({ read: () => "broken", write });
    const fresh = "00000000-0000-4000-8000-000000000002";
    store.registerOwner("local", fresh);
    expect(store.agent("local", fresh)).toBe(false); expect(store.unproven("local", fresh)).toBe(false);
    expect(store.agent("local", id)).toBe(true); expect(store.unproven("local", id)).toBe(true);
    expect(write).not.toHaveBeenCalled(); expect(store.degraded()).toBe(true);
  });
  it("reset is explicit and atomic at the injected storage boundary; failure cannot promote any unknown key", () => {
    let raw = "broken"; const reset = vi.fn((_content: string): void => { throw Error("archive failed"); });
    const storage = { read: () => raw, write: (content: string) => { raw = content; }, reset };
    const store = createBrowserTabIdentity(storage);
    expect(() => store.reset([])).toThrow("browser_identity_unavailable");
    expect(raw).toBe("broken"); expect(store.degraded()).toBe(true); expect(store.agent("local", id)).toBe(true);
    reset.mockImplementation(content => { raw = content; }); store.reset([]);
    expect(store.degraded()).toBe(false); expect(store.agent("local", id)).toBe(true);
    expect(createBrowserTabIdentity(storage).agent("local", id)).toBe(true);
    const fresh = "00000000-0000-4000-8000-000000000002";
    store.registerOwner("local", fresh); expect(createBrowserTabIdentity(storage).agent("local", fresh)).toBe(false);
    const times = reset.mock.calls.length; store.reset([]); expect(reset).toHaveBeenCalledTimes(times);
  });
  it("reset preserves proven live pools without converting a restored agent tab into owner", () => {
    let raw = "broken"; const storage = {read:()=>raw,write:(content:string)=>{raw=content;},reset:(content:string)=>{raw=content;}};
    const store=createBrowserTabIdentity(storage), owner="00000000-0000-4000-8000-000000000002";
    store.registerOwner("local",owner); store.reset([{hostId:"local",tabKey:id,pool:"agent"},{hostId:"local",tabKey:owner,pool:"owner"}]);
    const next=createBrowserTabIdentity(storage); expect(next.agent("local",id)).toBe(true); expect(next.agent("local",owner)).toBe(false);
    expect(()=>next.registerOwner("local",id)).toThrow("permission_denied");
  });
  it("archives exact corrupt bytes and creates a restrictive fresh file in the same temporary directory", () => {
    const directory=mkdtempSync(join(tmpdir(),"browser-origins-test-"));
    try {
      const file=join(directory,"browser-tab-origins.json"), original="{ corrupt bytes\n"; writeFileSync(file,original);
      const storage=browserTabIdentityStorage(directory), store=createBrowserTabIdentity(storage);
      expect(store.degraded()).toBe(true); store.reset([]);
      const archived=readdirSync(directory).filter(name=>name.startsWith("browser-tab-origins.corrupt-"));
      expect(archived).toHaveLength(1); expect(readFileSync(join(directory,archived[0]!),"utf8")).toBe(original);
      expect(JSON.parse(readFileSync(file,"utf8"))).toEqual({version:2,strict:true,agent:[],owner:[]});
      rmSync(file); // A failed/missing replacement with an archive is never treated as a first install.
      expect(createBrowserTabIdentity(storage).degraded()).toBe(true);
    } finally { rmSync(directory,{recursive:true,force:true}); }
  });
  it("persists only host and tab identity, without URL/session/key or lease",()=>{
    let raw:string|undefined;const storage={read:()=>raw,write:vi.fn((v:string)=>{raw=v})};
    const first=createBrowserTabIdentity(storage);expect(first.agent("local",id)).toBe(false);first.register("local",id);first.register("local",id);
    expect(storage.write).toHaveBeenCalledOnce();expect(JSON.parse(raw!)).toEqual([["local",id]]);
    expect(createBrowserTabIdentity(storage).agent("local",id)).toBe(true);expect(first.agent("remote",id)).toBe(false);
  });
  it.each(["{}", "null", '[["local","not-uuid"]]', '[["local","00000000-0000-4000-8000-000000000001","credential"]]'])("fails closed for malformed origin store %s",raw=>{
    const write = vi.fn(), store = createBrowserTabIdentity({read:()=>raw,write});
    expect(store.agent("local",id)).toBe(true); expect(store.degraded()).toBe(true);
    store.register("local", id); store.rollback("local", id);
    expect(write).not.toHaveBeenCalled(); // preserve corrupt source, isolate every unknown key
  });
  it("failed persistence does not create in-memory provenance",()=>{
    const x=createBrowserTabIdentity({read:()=>undefined,write:()=>{throw Error("disk")}});expect(()=>x.register("local",id)).toThrow("browser_identity_unavailable");expect(x.agent("local",id)).toBe(false);
  });
  it("rolls back only explicitly unconfirmed entries and keeps memory on failed rollback", () => {
    let raw: string | undefined; const write = vi.fn((v: string) => {raw=v;});
    const store = createBrowserTabIdentity({read:()=>raw,write}); expect(store.register("local",id)).toBe(true);
    expect(store.register("local",id)).toBe(false); write.mockImplementationOnce(()=>{throw Error("disk")});
    expect(()=>store.rollback("local",id)).toThrow("browser_identity_unavailable"); expect(store.agent("local",id)).toBe(true);
    store.rollback("local",id); expect(store.agent("local",id)).toBe(false); expect(raw).toBe("[]");
  });
});
