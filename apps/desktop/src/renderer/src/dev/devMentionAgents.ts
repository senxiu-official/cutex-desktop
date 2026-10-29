import type { MockCore } from "./mockTypes";
import { agentMentionMarkdown } from "../lib/agentMentions";
const query = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
if (typeof location !== "undefined") new URLSearchParams((location.hash ?? "").replace(/^#\??/, "")).forEach((v,k)=>query.set(k,v));
export const MENTION_AGENTS_SCENE = query.has("mentionAgents");
export const MENTION_LOCAL_ID = "cutex.11111111-1111-4111-8111-111111111111";
export const MENTION_OTHER_ID = "cutex.22222222-2222-4222-8222-222222222222";
export const MENTION_REMOTE_ID = "cutex.33333333-3333-4333-8333-333333333333";
export function mentionAgentsThread() {
  return { thread: { id: "thread-eva", turns: [{ id: "mention-agents-turn", status: "completed", items: [
    { type:"userMessage",id:"mention-user",content:[{type:"text",text:`请 ${agentMentionMarkdown("Astra",MENTION_LOCAL_ID)} 和 ${agentMentionMarkdown("Astra",MENTION_REMOTE_ID,"remote")} 一起检查这个改动。`}] },
    { type:"agentMessage",id:"mention-answer",text:`已记录两位 ${agentMentionMarkdown("Astra",MENTION_LOCAL_ID)} / ${agentMentionMarkdown("Astra",MENTION_REMOTE_ID,"remote")}，引用包含完整会话 ID。` },
  ] }] } };
}
export function installDevMentionAgents(core: MockCore): void {
  const snapshot=core.projectRecords(), source=snapshot.active.find(s=>s.cutexSessionId === "eva");
  if(!source)return;
  for(const [id,name,project,online] of [[MENTION_LOCAL_ID,"Astra",snapshot.hostRows.eva?.projectId ?? "desktop",true],[MENTION_OTHER_ID,"Alden","waveline",false]] as const){
    const s=structuredClone(source);s.cutexSessionId=id;s.displayName=name;s.formalAgentName=name;s.runtime.activeTurnId=null;s.runtime.status=online?"online":"offline";
    snapshot.active.push(s);snapshot.hostRows[id]={...snapshot.hostRows.eva!,id,name,projectId:project};
  }
  source.runtime.activeTurnId=null;core.markIdle("eva");
  localStorage.setItem("cutex-desktop.onboarding",JSON.stringify({doneRevision:3,whatsNew:false,lastWhatsNew:"0.2.0",testEveryBuild:false,lastTestBuild:null}));
  void (async()=>{
    const [{useApp},onboarding,guides]=await Promise.all([import("../store"),import("../lib/onboarding"),import("../lib/guides")]);
    guides.skipAllGuides("0.2.0");
    onboarding.setTestEveryBuild(false);onboarding.setWhatsNewEnabled(false);onboarding.openOnboarding({kind:"intro"});onboarding.closeOnboarding("0.2.0");
    for(let i=0;i<100&&!useApp.getState().sidebar;i++)await new Promise(r=>setTimeout(r,50));
    await useApp.getState().refreshHostSidebar("local");await useApp.getState().select("eva","local");
    useApp.getState().insertIntoComposer("eva",query.get("mentionAgents")==="chip"?`${agentMentionMarkdown("Astra",MENTION_LOCAL_ID)} 请看一下 `:"@","replace",undefined,"local");
    (window as unknown as {__mentionAgentsReady:boolean}).__mentionAgentsReady=true;
  })();
}
