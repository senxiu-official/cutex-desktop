// @vitest-environment jsdom
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => new Proxy({}, { get: (_target, key) => key === "then" ? undefined : () => Promise.resolve(null) }));
vi.mock("../src/renderer/src/bridge", () => ({ api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/i18n", async importOriginal => ({ ...await importOriginal<object>(), useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
import { TurnTail } from "../src/renderer/src/components/Timeline";
import { TimelineViewContext } from "../src/renderer/src/modules/timelineItemsView";
import { CODEX_FEATURES } from "../src/renderer/src/lib/agentFeatures";
import { emptyTimeline, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";

const context={sessionId:"busy",hostId:"local",agent:CODEX_FEATURES,tools:[],received:[]};
function html(timeline: ReturnType<typeof emptyTimeline>, runtime: "codex" | "claude") {
  return renderToStaticMarkup(h(TimelineViewContext.Provider,{value:{...context,agent:{runtime,map:null}}},h(TurnTail,{sessionId:"busy",timeline})));
}
it.each(["codex", "claude"] as const)("%s: shows the working line when legacy bootstrap has an active turn but no start timestamp", runtime => {
  const timeline=timelineFromThreadRead({thread:{id:"th",turns:[{id:"busy",status:"inProgress",items:[]}]}});
  expect(timeline.turns[0]!.startedAt).toBeNull();
  expect(html(timeline,runtime)).toContain('data-testid="turn-working"');
  expect(html(timeline,runtime)).toContain("turn.activity.working");
  expect(html(timeline,runtime)).not.toContain("tabular-nums"); // no invented elapsed time
});
it.each(["codex", "claude"] as const)("%s: keeps the legacy working line during a long tool even when preceding text is complete", runtime => {
  const timeline=timelineFromThreadRead({thread:{id:"th",turns:[{id:"busy",status:"inProgress",items:[
    {id:"reply",type:"agentMessage",text:"Earlier reply",phase:"final_answer"},
    {id:"tool",type:"commandExecution",command:"test",status:"inProgress"},
  ]}]}});
  expect(html(timeline,runtime)).toContain('data-testid="turn-working"');
  expect(html(timeline,runtime)).toContain("turn.activity.command");
});

it.each(["codex", "claude"] as const)("%s: hides the legacy working line without an active turn", runtime => {
  expect(html(emptyTimeline(),runtime)).not.toContain('data-testid="turn-working"');
});
