// @vitest-environment jsdom
// The fork dialog with the real Profile picker (components/EntitySelect), not the native stand-in of
// forkProfileDialog.test.tsx: Escape inside the open picker closes only the picker (review of 5a29fcb0), and a pick
// reaches the dialog (preview for the chosen Profile).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionForkPreview, SessionForkPreviewRequest } from "../src/shared/sessionFork";
const env=vi.hoisted(()=>({features:new Set(["session-fork-profile","session-fork-preview","profile-auto-pick"]),live:true,preview:vi.fn(),profiles:vi.fn(),quota:vi.fn(),fork:vi.fn(),choose:vi.fn(),close:vi.fn(),resets:new Set<(host:string)=>void>()}));
vi.mock("../src/renderer/src/bridge",()=>({api:{},bridge:{on:()=>()=>{}},onEvent:()=>()=>{},cleanIpcMessage:(m:string)=>m,apiFor:()=>({forkPreview:env.preview,profileAutoPick:env.quota})}));
vi.mock("../src/renderer/src/store",()=>({featuresOf:()=>env.features,useApp:Object.assign((selector:(v:object)=>unknown)=>selector({}),{getState:()=>({forkSession:env.fork})})}));
vi.mock("../src/renderer/src/lib/profileSnapshot",()=>({loadProfileList:env.profiles}));
vi.mock("../src/renderer/src/lib/contextMenu",()=>({closeDialog:env.close,forkProfileDialog:env.choose}));
vi.mock("../src/renderer/src/lib/hostSwitch",()=>({captureHostAction:()=>()=>env.live,onHostSwitch:()=>()=>{},onHostReset:(fn:(host:string)=>void)=>{env.resets.add(fn);return()=>env.resets.delete(fn);}}));
vi.mock("../src/renderer/src/i18n",()=>({useI18n:()=>({t:(k:string,v?:Record<string,unknown>)=>v?`${k} ${Object.values(v).join(" ")}`:k})}));
import { ForkProfileDialog } from "../src/renderer/src/components/ForkProfileDialog";
vi.mock("../src/renderer/src/components/EntityIcon", () => import("./helpers/entityIconStub"));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement; const resolve=vi.fn();
function preview(request:SessionForkPreviewRequest={}):SessionForkPreview{return {contractVersion:2,cutexSessionId:"source",afterTurnId:request.afterTurnId??null,profile:request.profile??null,sourceProfile:"locked-source",sourceCliKind:"claude",sourceProviderFamily:"anthropic",targets:[
 {id:"b",name:"target-b",cliKind:"claude",providerFamily:"anthropic",eligible:true,reason:null},
 {id:"c",name:"target-c",cliKind:"claude",providerFamily:"anthropic",eligible:true,reason:null},
 {id:"wrong",name:"other-provider",cliKind:"codex",providerFamily:"openai-chatgpt",eligible:false,reason:{code:"provider_family_mismatch",message:"Different"}},
],eligible:true,reason:null,historyBytes:8*1024**2,historyBytesEstimate:"upperBound",historyBytesMeaning:"Includes later turns",coldCache:!!request.profile,boundaryNote:"Source obligations stay with source"};}
beforeEach(()=>{env.features=new Set(["session-fork-profile","session-fork-preview","profile-auto-pick"]);env.live=true;env.preview.mockReset().mockImplementation(async(_id:string,request:SessionForkPreviewRequest)=>preview(request));env.profiles.mockReset().mockResolvedValue({profiles:[]});env.quota.mockReset().mockResolvedValue({providers:[{pick:{candidates:[{profile:"target-b",remainingPercent:42}]}}]});env.fork.mockReset().mockResolvedValue(undefined);env.choose.mockReset().mockResolvedValue(undefined);env.close.mockReset();resolve.mockReset();env.resets.clear();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function mount(){await act(async()=>root.render(h(ForkProfileDialog,{sessionId:"source",hostId:"host-A",afterTurnId:"turn-1",resolve})));}
const trigger = () => host.querySelector<HTMLButtonElement>("[data-entity-select]")!;
const escape = (el: Element) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });

it("Escape in the open Profile picker closes only the picker: the fork dialog stays, focus back on the picker", async () => {
  await mount();
  act(() => trigger().click());
  const search = document.querySelector<HTMLInputElement>("input[data-menu-search]")!;
  expect(search).not.toBeNull();
  escape(search);
  expect(env.close).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
  expect(document.querySelector("[role=listbox]")).toBeNull();
  expect(document.activeElement).toBe(trigger());
  // The picker closed, Escape is the dialog's again.
  escape(trigger());
  expect(env.close).toHaveBeenCalledOnce();
});

it("a pick in the real picker selects that Profile for the preview; the same-profile row stays first", async () => {
  await mount();
  act(() => trigger().click());
  expect([...document.querySelectorAll<HTMLElement>("[role=option]")].map((o) => o.dataset.value)).toEqual(["", "target-b", "target-c"]);
  await act(async () => document.querySelector<HTMLButtonElement>('[role=option][data-value="target-b"]')!.click());
  expect(trigger().dataset.value).toBe("target-b");
  expect(env.preview).toHaveBeenLastCalledWith("source", expect.objectContaining({ profile: "target-b" }));
  expect(host.textContent).toContain("fork.profile.coldCache");
});
