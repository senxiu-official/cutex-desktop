// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionForkPreview, SessionForkPreviewRequest } from "../src/shared/sessionFork";
const env=vi.hoisted(()=>({features:new Set(["session-fork-profile","session-fork-preview","profile-auto-pick"]),live:true,preview:vi.fn(),profiles:vi.fn(),quota:vi.fn(),fork:vi.fn(),choose:vi.fn(),close:vi.fn(),resets:new Set<(host:string)=>void>()}));
vi.mock("../src/renderer/src/bridge",()=>({apiFor:()=>({forkPreview:env.preview,profileAutoPick:env.quota})}));
vi.mock("../src/renderer/src/store",()=>({featuresOf:()=>env.features,useApp:Object.assign((selector:(v:object)=>unknown)=>selector({}),{getState:()=>({forkSession:env.fork})})}));
vi.mock("../src/renderer/src/lib/profileSnapshot",()=>({loadProfileList:env.profiles}));
vi.mock("../src/renderer/src/lib/contextMenu",()=>({closeDialog:env.close,forkProfileDialog:env.choose}));
vi.mock("../src/renderer/src/lib/hostSwitch",()=>({captureHostAction:()=>()=>env.live,onHostReset:(fn:(host:string)=>void)=>{env.resets.add(fn);return()=>env.resets.delete(fn);}}));
vi.mock("../src/renderer/src/i18n",()=>({useI18n:()=>({t:(k:string,v?:Record<string,unknown>)=>v?`${k} ${Object.values(v).join(" ")}`:k})}));
import { ForkProfileDialog } from "../src/renderer/src/components/ForkProfileDialog";
import { requestFork } from "../src/renderer/src/lib/requestFork";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement; const resolve=vi.fn();
function preview(request:SessionForkPreviewRequest={}):SessionForkPreview{return {contractVersion:2,cutexSessionId:"source",afterTurnId:request.afterTurnId??null,profile:request.profile??null,sourceProfile:"locked-source",sourceCliKind:"claude",sourceProviderFamily:"anthropic",targets:[
 {id:"b",name:"target-b",cliKind:"claude",providerFamily:"anthropic",eligible:true,reason:null},
 {id:"c",name:"target-c",cliKind:"claude",providerFamily:"anthropic",eligible:true,reason:null},
 {id:"wrong",name:"other-provider",cliKind:"codex",providerFamily:"openai-chatgpt",eligible:false,reason:{code:"provider_family_mismatch",message:"Different"}},
],eligible:true,reason:null,historyBytes:8*1024**2,historyBytesEstimate:"upperBound",historyBytesMeaning:"Includes later turns",coldCache:!!request.profile,boundaryNote:"Source obligations stay with source"};}
async function mount(){await act(async()=>root.render(h(ForkProfileDialog,{sessionId:"source",hostId:"host-A",afterTurnId:"turn-1",resolve})));}
async function select(value:string){await act(async()=>{const el=host.querySelector("select")!;el.value=value;el.dispatchEvent(new Event("change",{bubbles:true}));});}
async function submit(){await act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});}
const submitButton=()=>host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
beforeEach(()=>{env.features=new Set(["session-fork-profile","session-fork-preview","profile-auto-pick"]);env.live=true;env.preview.mockReset().mockImplementation(async(_id:string,request:SessionForkPreviewRequest)=>preview(request));env.profiles.mockReset().mockResolvedValue({profiles:[]});env.quota.mockReset().mockResolvedValue({providers:[{pick:{candidates:[{profile:"target-b",remainingPercent:42}]}}]});env.fork.mockReset().mockResolvedValue(undefined);env.choose.mockReset().mockResolvedValue(undefined);env.close.mockReset();resolve.mockReset();env.resets.clear();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
describe("fork profile choice",()=>{
 it("refreshes profile facts before preview and defaults to the unchanged-profile operation",async()=>{
  await mount();expect(env.profiles.mock.invocationCallOrder[0]).toBeLessThan(env.preview.mock.invocationCallOrder[0]!);
  expect(host.querySelector("select")!.value).toBe("");expect([...host.querySelectorAll("option")].map(o=>o.value)).toEqual(["","target-b","target-c"]);
  await submit();expect(env.fork).toHaveBeenCalledWith("source","turn-1","host-A",undefined);expect(env.close).toHaveBeenCalledOnce();
 });
 it("shows size, cold cache and available quota, and requires an inline second click before cross-profile mutation",async()=>{
  await mount();await select("target-b");expect(host.textContent).toContain("8 MiB");expect(host.textContent).toContain("fork.profile.coldCache");expect(host.textContent).toContain("42");expect(host.textContent).toContain("fork.profile.sizeEstimate");
  await submit();expect(env.fork).not.toHaveBeenCalled();expect(submitButton().textContent).toBe("fork.profile.confirm");
  await submit();expect(env.fork).toHaveBeenCalledWith("source","turn-1","host-A","target-b");
 });
 it("changing selection disarms the confirm",async()=>{await mount();await select("target-b");await submit();await select("target-c");expect(submitButton().textContent).toBe("fork.profile.create");expect(env.fork).not.toHaveBeenCalled();});
 it("allows an eligible target with unknown size but never bypasses an authoritative refusal",async()=>{
  await mount();env.preview.mockImplementation(async(_id:string,req:SessionForkPreviewRequest)=>({...preview(req),historyBytes:null,historyBytesEstimate:"unavailable"}));await select("target-b");expect(host.textContent).toContain("fork.profile.historyUnknown");expect(submitButton().disabled).toBe(false);await submit();expect(env.fork).not.toHaveBeenCalled();await submit();expect(env.fork).toHaveBeenCalledTimes(1);
  env.preview.mockImplementation(async(_id:string,req:SessionForkPreviewRequest)=>({...preview(req),eligible:false,reason:{code:"profile_fork_disallowed",message:"disabled"}}));await select("target-c");expect(submitButton().disabled).toBe(true);expect(host.textContent).toContain("fork.error.disallowed");
 });
 it("keeps a plain signature-rejection error in the chooser and never retries automatically",async()=>{
  await mount();await select("target-b");await submit();env.fork.mockRejectedValueOnce(new Error("fork_history_signature_rejected"));await submit();expect(host.querySelector('[role="alert"]')?.textContent).toBe("fork.error.signature");expect(env.fork).toHaveBeenCalledTimes(1);expect(env.close).not.toHaveBeenCalled();
 });
 it("drops an older preview when selections complete out of order",async()=>{
  await mount();let oldResolve!:(v:SessionForkPreview)=>void;env.preview.mockImplementation((_id:string,req:SessionForkPreviewRequest)=>req.profile==="target-b"?new Promise<SessionForkPreview>(yes=>{oldResolve=yes;}):Promise.resolve({...preview(req),historyBytes:2048}));
  await select("target-b");await select("target-c");await act(async()=>oldResolve({...preview({afterTurnId:"turn-1",profile:"target-b"}),historyBytes:999}));expect(host.querySelector("select")!.value).toBe("target-c");expect(host.textContent).toContain("2 KiB");expect(host.textContent).not.toContain("999");
 });
 it("cannot overwrite a new source-family quota with an older snapshot response",async()=>{
  let oldQuota!:(value:unknown)=>void;
  env.quota.mockImplementation(({provider}:{provider:string})=>provider==="anthropic"?new Promise(yes=>{oldQuota=yes;}):Promise.resolve({providers:[{pick:{candidates:[{profile:"target-c",remainingPercent:18}]}}]}));
  env.preview.mockImplementation(async(_id:string,req:SessionForkPreviewRequest)=>({...preview(req),sourceProviderFamily:req.profile==="target-c"?"new-family":"anthropic"}));
  await mount();await select("target-c");await act(async()=>oldQuota({providers:[{pick:{candidates:[{profile:"target-c",remainingPercent:99}]}}]}));
  expect(host.textContent).toContain("fork.profile.quota 18");expect(host.textContent).not.toContain("fork.profile.quota 99");
 });
 it("an expired host connection cannot submit and late completion cannot close a newer dialog",async()=>{
  await mount();env.live=false;await submit();expect(env.fork).not.toHaveBeenCalled();env.live=true;let complete!:()=>void;env.fork.mockImplementationOnce(()=>new Promise<void>(yes=>{complete=yes;}));await submit();act(()=>root.render(null));await act(async()=>complete());expect(env.close).not.toHaveBeenCalled();
 });
 it("keeps the same-profile operation available if preflight is absent, while not calling unsupported routes",async()=>{
  env.features.delete("session-fork-preview");await mount();expect(env.preview).not.toHaveBeenCalled();expect(host.textContent).toContain("fork.error.unsupported");await submit();expect(env.fork).toHaveBeenCalledWith("source","turn-1","host-A",undefined);
 });
});
describe("fork entry capability",()=>{
 it("preserves old-daemon direct fork and opens the shared chooser only on new hosts",async()=>{
  env.features.clear();await requestFork("source","turn-1","host-A");expect(env.fork).toHaveBeenCalledWith("source","turn-1","host-A");expect(env.choose).not.toHaveBeenCalled();
  env.features.add("session-fork-profile");await requestFork("source",null,"host-A");expect(env.choose).toHaveBeenCalledWith("source","host-A",null);
 });
});
