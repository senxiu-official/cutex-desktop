// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => new Proxy({}, { get: (_target,key) => key === "then" ? undefined : key === "agentResume" ? () => Promise.resolve({agentPause:null,changed:true}) : () => Promise.resolve(null) }));
vi.mock("../src/renderer/src/bridge", () => ({ api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (s:string) => s }));
import { useApp } from "../src/renderer/src/store";
import { useAgentPauses, noteAgentPause } from "../src/renderer/src/lib/agentPause";
import { I18nProvider } from "../src/renderer/src/i18n";
import { AgentRowButton } from "../src/renderer/src/components/AgentRows";
import { AgentPausedSection } from "../src/renderer/src/components/AgentPauseParts";
import { TurnTail } from "../src/renderer/src/components/Timeline";
import { TimelineViewContext } from "../src/renderer/src/modules/timelineItemsView";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("a held open turn has a static busy ring, pause reason and working row; resume preserves the turn", async () => {
 localStorage.setItem("cutex-desktop.locale","zh-CN");
 const pause={cutexSessionId:"s",phase:"paused" as const,by:"owner" as const,requestedAt:"2026-11-04T00:00:00Z",at:"toolBoundary" as const,toolGate:true,held:[{callId:"c",tool:"Bash",turnId:"t",since:"2026-11-04T00:00:00Z"}]};
 const session={cutexSessionId:"s",displayName:"Paused agent",lifecycle:"active",revision:1,runtime:{status:"online",activeTurnId:"t",runtimeGeneration:1},agentPause:pause};
 useApp.setState({features:new Set(["agent-pause"]),sidebar:{active:[session],retired:[],hostRows:{}} as never});useAgentPauses.setState({byKey:{}});
 const timeline=timelineFromThreadRead({thread:{id:"th",turns:[{id:"t",status:"inProgress",items:[]}]}});
 const row={id:"s",name:"Paused agent",subtitle:"",status:"running",isDirector:false,pinned:false,lastActivity:0,profile:null,color:null,session};
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(h(I18nProvider,null,h(AgentRowButton,{row:row as never}),h(AgentPausedSection,{hostId:"local",sessionId:"s"}),h(TimelineViewContext.Provider,{value:{hostId:"local",sessionId:"s",tools:[],received:[],agent:{runtime:"codex",map:null}} as never},h(TurnTail,{timeline,sessionId:"s"})))));
  expect(host.querySelector('[data-agent-tool-held]')?.textContent).toContain("已暂停 · 等待继续");
  expect(host.querySelector('[data-testid="agent-paused"]')?.textContent).toContain("已暂停 · 停在 Bash 之前");
  expect(host.querySelector('[data-agent-pause]')?.getAttribute("title")).toContain("停在 Bash 之前");
  expect(host.querySelector<HTMLElement>('[data-running-paused]')?.style.animationPlayState).toBe("paused");
  await act(async()=>{(host.querySelector('[data-testid="agent-resume"]') as HTMLButtonElement).click();});
  expect(host.querySelector('[data-agent-tool-held]')).toBeNull();
  expect(host.querySelector('[data-running-paused]')).toBeNull();
  expect(host.querySelector('[data-testid="turn-working"]')).not.toBeNull();
  expect(session.runtime.activeTurnId).toBe("t"); expect(timeline.activeTurnId).toBe("t");
  await act(async()=>noteAgentPause("local","s",{...pause,at:"turnEnd",toolGate:false,held:[]}));
  expect(host.querySelector('[data-agent-tool-held]')).toBeNull();expect(host.querySelector('[data-running-paused]')).toBeNull();
 } finally {act(()=>root.unmount());host.remove();useAgentPauses.setState({byKey:{}});useApp.setState({features:new Set(),sidebar:null});}
});
