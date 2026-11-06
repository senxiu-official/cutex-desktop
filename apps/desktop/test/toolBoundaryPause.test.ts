import { expect, it } from "vitest";
import { parseAgentPause, type AgentPause } from "../src/shared/agentPause";
import { agentPauseHint } from "../src/renderer/src/lib/agentPausePresentation";
import { applyTerms, DEFAULT_TERMS } from "../src/renderer/src/lib/terms";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import type { MessageKey } from "../src/renderer/src/i18n";
const base: AgentPause = { cutexSessionId: "a", phase: "paused", requestedAt: "2026-11-04T00:00:00Z", by: "owner" };
const call = { callId: "call1", tool: "Bash", since: "2026-11-04T00:01:00Z", turnId: "t1" };
const t = (key: MessageKey, vars?: Record<string, string | number>) => applyTerms(zhCN[key], DEFAULT_TERMS["zh-CN"], "zh-CN").replace(/\{(\w+)\}/g, (all, name: string) => String(vars?.[name] ?? all));
it("parses optional gate metadata and only well-formed bounded held rows", () => {
 const parsed = parseAgentPause({ ...base, at: "toolBoundary", toolGate: true, held: [call, null, {...call,tool:3}, {...call,callId:""}, {...call,since:"invalid"}, {...call,agentId:4}, {...call,agentId:"sub1",secret:"drop"}] });
 expect(parsed).toEqual({...base,at:"toolBoundary",toolGate:true,held:[call,{...call,agentId:"sub1"}]});
 expect(parseAgentPause({...base,held:Array.from({length:80},()=>call)})?.held).toHaveLength(64);
 expect(parseAgentPause({...base,at:"future",toolGate:"true",held:{bad:true}})).toEqual(base);
 expect(parseAgentPause({...base,at:"turnEnd",toolGate:false,held:[]})).toEqual({...base,at:"turnEnd",toolGate:false,held:[]});
 expect(parseAgentPause(base)).toEqual(base);
});
it("keeps legacy/turn-end hints and distinguishes the next-tool pausing hint", () => {
 for(const at of [undefined,"turnEnd"] as const) expect(agentPauseHint({...base,phase:"pausing",at},t,"zh-CN",Date.now())).toBe(t("agentPause.tagHint.pausing"));
 expect(agentPauseHint({...base,phase:"pausing",at:"toolBoundary"},t,"zh-CN",Date.now())).toBe(t("agentPause.tagHint.toolBoundary"));
 expect(agentPauseHint(base,t,"zh-CN",Date.now())).toBe(t("agentPause.tagHint.paused"));
 expect(agentPauseHint(null,t,"zh-CN",Date.now())).toBe("");
});
it("uses the oldest tool, total call count, subagent, since and Director attribution", () => {
 const pause: AgentPause = {...base,by:"director",byCutexSessionId:"dir",held:[{...call,agentId:"sub1"},{...call,callId:"call2",tool:"Read"}]};
 const hint=agentPauseHint(pause,t,"zh-CN",Date.parse("2026-11-04T00:04:00Z"),"Alice");
 expect(hint).toContain("停在 Bash 之前"); expect(hint).toContain("2 个调用");expect(hint).toContain("子智能体");expect(hint).toContain("3分钟前");expect(hint).toContain("Alice");expect(hint).not.toContain("Read");
 expect(agentPauseHint({...base,held:[call]},t,"zh-CN",Date.now())).not.toContain("个调用");
});

it("keeps waiting time relative after an hour and clamps clock skew", () => {
 expect(agentPauseHint({...base,held:[call]},t,"zh-CN",Date.parse("2026-11-04T03:01:00Z"))).toContain("3小时前");
 expect(agentPauseHint({...base,held:[call]},t,"zh-CN",Date.parse("2026-11-03T00:00:00Z"))).toContain("现在");
});
