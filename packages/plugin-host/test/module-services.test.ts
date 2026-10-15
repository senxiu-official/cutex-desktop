import { describe, expect, it, vi } from "vitest";
import { createModuleServiceScope } from "../src/module-services.js";
import { createModulePreferenceStore } from "../src/module-prefs.js";

function fixture() {
  const controller = new AbortController(); const disposers: (() => void)[] = [];
  let live = true;
  const scope = { id: "jobs", generation: 1, host: { id: "a", kind: "local" as const, features: new Set<string>() },
    signal: controller.signal, isCurrent: () => live,
    onDispose(fn: () => void) { disposers.push(fn); } };
  return { scope, api: createModuleServiceScope(scope), stop() { live = false; controller.abort(); for (const fn of disposers.reverse()) fn(); } };
}
describe("module adapter fences", () => {
  it("drops stale subscription callbacks and writes; disposes subscriptions once", () => {
    const f = fixture(), write = vi.fn(), callback = vi.fn(), dispose = vi.fn(); let listener!: (id: string) => void;
    const off = f.api.subscribe<string[]>((fn) => { listener = fn; return dispose; }, callback);
    listener("a-session"); const guardedWrite = f.api.write(write); guardedWrite("a-session"); f.stop();
    listener("late-session"); guardedWrite("late-session"); off();
    expect(callback).toHaveBeenCalledExactlyOnceWith("a-session"); expect(write).toHaveBeenCalledExactlyOnceWith("a-session"); expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => f.api.read(() => "data")()).toThrow(/no longer current/);
  });
  it("reclaims a subscription returned after its synchronous callback stops the owner", () => {
    const f = fixture(), dispose = vi.fn(); f.api.subscribe(fn => { fn(); return dispose; }, () => f.stop());
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("reclaims a provider subscription when its eager initial listener throws", () => {
    const f = fixture(), listeners = new Set<() => void>(), dispose = vi.fn();
    expect(() => f.api.subscribe(fn => {
      listeners.add(fn); fn(); return () => { listeners.delete(fn); dispose(); };
    }, () => { throw new Error("initial render failed"); })).toThrow("initial render failed");
    expect(listeners.size).toBe(0); f.stop(); expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("rejects an in-flight old-host request promptly and never starts stale requests", async () => {
    const f = fixture(); let finish!: (v: string) => void; const transport = vi.fn(() => new Promise<string>(r => { finish = r; }));
    const request = f.api.request(transport); const result = request(); const assertion = expect(result).rejects.toMatchObject({name:"AbortError"});
    f.stop(); await assertion; finish("old host data"); await expect(request()).rejects.toMatchObject({name:"AbortError"}); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("preserves call-time session arguments and observes late transport rejection", async () => {
    const f = fixture(); let reject!: (reason: Error) => void; let selected = "a";
    const transport = vi.fn((_id: string) => new Promise<string>((_, r) => { reject = r; }));
    const pending = f.api.request(transport)(selected); selected = "b"; const assertion = expect(pending).rejects.toMatchObject({name:"AbortError"}); f.stop(); await assertion;
    reject(new Error("late failure")); await Promise.resolve(); expect(transport).toHaveBeenCalledExactlyOnceWith("a");
  });
  it("propagates live transport failures and removes its abort listener", async () => {
    const f = fixture(); await expect(f.api.request(async () => { throw new Error("transport"); })()).rejects.toThrow("transport");
    await expect(f.api.request(async (id: string) => id)("a")).resolves.toBe("a"); f.stop();
  });
});
function storageFixture() {
 const data = new Map<string,string>(); return { data, storage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v:string) => { data.set(k,v); } } };
}
describe("module preference adapter", () => {
 it("isolates namespaces, clones JSON, and handles prototype-like keys as data", () => {
  const f = storageFixture(), store = createModulePreferenceStore(f.storage), a = store.forModule("jobs"), b = store.forModule("remote-access");
  const value = { ids: ["a"] }; a.set("filters",value); value.ids.push("b"); const read = a.get("filters",{ids:[] as string[]}); read.ids.push("c");
  expect(a.get("filters",{ids:[]})).toEqual({ids:["a"]}); expect(b.get("filters",null)).toBeNull(); a.set("__proto__", {safe:true}); expect(a.get("__proto__",null)).toEqual({safe:true});
  expect(store.forModule("jobs")).toBe(a); expect(() => store.forModule("../jobs")).toThrow();
 });
 it("loads device preferences defensively without deleting malformed existing data", () => {
  const f = storageFixture(); f.data.set("cutex-desktop.modules",'{broken'); const store = createModulePreferenceStore(f.storage);
  expect(store.load()).toEqual({v:1,enabled:{},place:{}}); expect(f.data.get("cutex-desktop.modules")).toBe('{broken');
  f.data.set("cutex-desktop.modules",JSON.stringify({v:1,enabled:{jobs:false,bad:2},place:{"conversation.status:jobs.status":"bar",bad:true}}));
  expect(store.load()).toEqual({v:1,enabled:{jobs:false},place:{"conversation.status:jobs.status":"bar"}});
 });
 it("does not notify or change state after a rejected persistent write", () => {
  const f = storageFixture(); const store = createModulePreferenceStore(f.storage), prefs=store.forModule("jobs"), notify=vi.fn(); prefs.set("n",1); prefs.subscribe(notify);
  f.storage.setItem=()=>{throw new Error("quota")}; expect(()=>prefs.set("n",2)).toThrow("quota"); expect(prefs.get("n",0)).toBe(1); expect(notify).not.toHaveBeenCalled();
 });
 it("persists across recreated adapters and rejects non-JSON preferences", () => {
  const f = storageFixture(), store=createModulePreferenceStore(f.storage), prefs=store.forModule("jobs"), notify=vi.fn(); const off=prefs.subscribe(notify);
  prefs.set("mode","compact"); off(); prefs.set("other",true); expect(notify).toHaveBeenCalledTimes(1);
  expect(createModulePreferenceStore(f.storage).forModule("jobs").get("mode","")).toBe("compact");
  for (const bad of [NaN,Infinity,undefined,Array(3),new Date()]) expect(()=>prefs.set("bad",bad as never)).toThrow(TypeError);
  const cyclic: any={};cyclic.self=cyclic;expect(()=>prefs.set("bad",cyclic)).toThrow(TypeError);
 });
});

