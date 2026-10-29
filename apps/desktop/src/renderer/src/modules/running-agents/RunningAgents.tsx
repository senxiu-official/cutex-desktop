// 正在运行的智能体 widget: the agents with a turn in progress now — avatar, name, what they are doing (the live
// line of an open conversation, as the timeline's tail shows it; else the agent's latest tool line from the
// activity map the sidebar uses, open or not) and for how long. Data: the scoped sidebar (as 需要你 does), the
// open views' timelines and the activity map through one fingerprint selector (a streamed token changes nothing
// here unless the step changed). Click = `actions.openAgent`.
import { useMemo } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { StatusAvatar } from "../../components/AgentStatus";
import { useScopedSidebar } from "../../lib/scopedSidebarView";
import { agentActivityOf, runningStepOf } from "../../lib/activity";
import { turnActivity } from "../../lib/turnActivity";
import { useApp, viewOf } from "../../store";
import type { DesktopWidgetProps } from "../widgetTypes";
import { longElapsed, minutesRunning, rowsThatFit, runningAgents } from "./runs";
import { Tag, CountBadge } from "../../components/Tag";

/** The label key of an open view's turn activity (a bare name is a `turn.activity.*` key). */
function stepKey(activity: string): MessageKey {
  return (activity.includes(".") ? activity : `turn.activity.${activity}`) as MessageKey;
}

export function RunningAgentsWidget({ settings, width, height, now, arranging, actions }: DesktopWidgetProps) {
  const { t } = useI18n();
  const scoped = useScopedSidebar();
  const focus = scoped.scope.focus;
  const all = useMemo(() => [...scoped.model.groups.flatMap((g) => g.online), ...scoped.model.chats], [scoped.model]);
  const max = typeof settings.maxRows === "number" ? settings.maxRows : 5;
  const list = useMemo(() => runningAgents(all, focus, settings.scope === "focus"), [all, focus, settings.scope]);
  // One line per running row, "<host>\u0002<id>\t<open view's activity>\t<activity map's tool line>": equal
  // strings = nothing shown changed.
  const steps = useApp((s) => {
    let out = "";
    for (const r of list) {
      const view = viewOf(s, r.hostId, r.row.id);
      const tool = runningStepOf(agentActivityOf(s, focus, r.row)) ?? "";
      out += `${r.hostId}\u0002${r.row.id}\t${(view && turnActivity(view.timeline)) ?? ""}\t${tool.replace(/[\t\n]/g, " ")}\n`;
    }
    return out;
  });
  const stepOf = useMemo(() => new Map(steps.split("\n").filter(Boolean).map((l) => { const [k, a, tool] = l.split("\t"); return [k, { activity: a || null, tool: tool || null }] as const; })), [steps]);
  // When some do not fit, the 「还有 N 个」 line needs its own room (about 20 px).
  const fits = list.length > rowsThatFit(height, max) ? rowsThatFit(height - 20, max) : rowsThatFit(height, max);
  const shown = list.slice(0, fits);
  const showStep = width >= 240;
  return (
    <section className="flex h-full flex-col overflow-hidden px-3.5 py-3" data-running-agents="">
      <h4 className="mb-1 flex items-center gap-2 text-ui/[inherit] font-semibold">
        {t("running-agents.widget")}
        {list.length > 0 && <CountBadge tone="accent" count={list.length} className="ml-auto" />}
      </h4>
      {list.length === 0 && <p className="py-1.5 text-xs home-sub">{t("running-agents.none")}</p>}
      {shown.map((r) => {
        const step = stepOf.get(`${r.hostId}\u0002${r.row.id}`);
        // The open view's label (推理中, 等待批准, …) unless it only says 工作中; then the tool line; then 工作中.
        const key = step?.activity && step.activity !== "working" && step.activity !== "subagent" ? stepKey(step.activity) : null;
        const stepText = key ? t(key) : (step?.tool ?? t("turn.activity.working" as MessageKey));
        const mins = minutesRunning(r.since, now);
        return (
          <button key={`${r.hostId}\n${r.row.id}`} type="button" onClick={() => !arranging && void actions.openAgent(r.hostId, r.row.id)} className="flex w-full items-center gap-2.5 rounded-ctl px-1 py-1.5 text-left text-ui/[inherit] hover:bg-[rgba(127,127,140,0.12)]" data-running-agent={r.row.id}>
            <StatusAvatar name={r.row.name} initial={r.row.initial} color={r.row.color} avatar={r.row.session.avatar} seed={r.row.session.cutexSessionId} size={28} signal="running" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{r.row.name}</span>
              {showStep && <span className="block truncate text-caption/[inherit] home-sub" title={stepText}>{stepText}</span>}
            </span>
            <span className="shrink-0 text-caption/[inherit] tabular-nums home-sub">{mins === null ? "" : mins < 1 ? t("running-agents.justNow") : longElapsed(mins)}</span>
          </button>
        );
      })}
      {list.length > shown.length && <p className="mt-auto pt-1 text-caption/[inherit] home-sub">{t("running-agents.more", { n: list.length - shown.length })}</p>}
    </section>
  );
}
