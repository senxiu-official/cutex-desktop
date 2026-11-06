// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ handlers: {} as Record<string,(value:any)=>void>, next: null as Promise<unknown> | null, viewHost: "local", calls: [] as string[], alarm: { id: "alarm-a", alarmId: "a", ownerKind: "agent", ownerCutexSessionId: "agent", targetCutexSessionId: "agent", at: new Date(Date.now()+3600000).toISOString(), state: "scheduled", attempts: 0, messagePreview: "private reminder" } }));
vi.mock("../src/renderer/src/store", async original => {
  const mod=await original<object>();const {create}=await import("zustand");
  return {...mod,useApp:create(()=>({hosts:{active:"local"},features:new Set(["alarms-api"]),daemon:{kind:"connected"},byHost:{remote:{features:new Set(["alarms-api"]),daemon:{kind:"connected"}}}})),viewHostOf:()=>fx.viewHost,viewHostIn:()=>fx.viewHost};
});
vi.mock("../src/renderer/src/bridge",()=>({api:{},bridge:{on:(name:string,fn:(value:any)=>void)=>{fx.handlers[name]=fn;return ()=>delete fx.handlers[name];}}}));
vi.mock("../src/renderer/src/modules/app",()=>({services:{daemonFor:(host:string)=>({alarms:async()=>{fx.calls.push(host);if(fx.next){const next=fx.next;fx.next=null;return next;}return {alarms:host==="remote"?[fx.alarm]:[]};}})}}));
const {useApp}=await import("../src/renderer/src/store");
const {ConversationScope}=await import("../src/renderer/src/lib/conversationScope");
const {useAgentAlarms,useAlarmCache,startAlarmSync}=await import("../src/renderer/src/modules/alarms/store");
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:ReturnType<typeof createRoot>;let host:HTMLDivElement;
function Probe(){const data=useAgentAlarms("agent",true);return h("span",null,`${data.hostId}:${data.pending.length}`);}
beforeEach(()=>{fx.viewHost="local";fx.calls=[];useAlarmCache.setState({byKey:{}});host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("loads from the conversation's remote host even before a global view binding is installed",async()=>{
 await act(async()=>root.render(h(ConversationScope.Provider,{value:{paneId:"pane",hostId:"remote",sessionId:"agent",focused:true,visible:true}},h(Probe))));
 expect(host.textContent).toBe("remote:1");expect(fx.calls).toEqual(["remote"]);
});
it("reloads a visible remote agent when its daemon reconnects without restarting the desktop",async()=>{
 fx.viewHost="remote";
 await act(async()=>root.render(h(Probe)));
 expect(fx.calls).toEqual(["remote"]);
 await act(async()=>useApp.setState((s:any)=>({byHost:{...s.byHost,remote:{...s.byHost.remote,daemon:{kind:"disconnected"}}}})));
 await act(async()=>useApp.setState((s:any)=>({byHost:{...s.byHost,remote:{...s.byHost.remote,daemon:{kind:"connected"}}}})));
 expect(fx.calls).toEqual(["remote","remote"]);
});

it("a reply from before reconnect cannot swallow or overwrite the new alarm read",async()=>{
 fx.viewHost="remote";let resolve!:(value:unknown)=>void;fx.next=new Promise(r=>resolve=r);
 await act(async()=>root.render(h(Probe)));
 await act(async()=>useApp.setState((s:any)=>({byHost:{...s.byHost,remote:{...s.byHost.remote,daemon:{kind:"disconnected"}}}})));
 await act(async()=>useApp.setState((s:any)=>({byHost:{...s.byHost,remote:{...s.byHost.remote,daemon:{kind:"connected"}}}})));
 await act(async()=>resolve({alarms:[]}));
 expect(fx.calls).toEqual(["remote","remote"]);expect(host.textContent).toBe("remote:1");
});

it("reloads alarms on hostResync even when a fast SSE reconnect keeps daemon connected",async()=>{
 fx.viewHost="remote";const controller=new AbortController();startAlarmSync({signal:controller.signal} as any);
 try {
  await act(async()=>root.render(h(Probe)));
  await act(async()=>{fx.handlers.hostResync?.({hostId:"remote",reason:"session_status_reconnected"});await new Promise(r=>setTimeout(r,180));});
  expect(fx.calls).toEqual(["remote","remote"]);
 } finally {await act(async()=>controller.abort());}
});

it("does not reload cached agents with no mounted alarm surface on host resync",async()=>{
 fx.viewHost="remote";const controller=new AbortController();startAlarmSync({signal:controller.signal} as any);
 try {await act(async()=>root.render(h(Probe)));await act(async()=>root.render(null));
 await act(async()=>{fx.handlers.hostResync!({hostId:"remote",reason:"session_status_reconnected"});await new Promise(r=>setTimeout(r,180));});expect(fx.calls).toEqual(["remote"]);
 }finally{await act(async()=>controller.abort());}
});
