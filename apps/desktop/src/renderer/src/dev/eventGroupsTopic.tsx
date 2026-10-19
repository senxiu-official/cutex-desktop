// Variants topic 「事件分级：分组和控件」 (owner 2026-10-19): group the event → level rows by what the event
// means for you instead of by cutex module, and pick a level with radio columns (like 状态 → 显示位置)
// instead of 20 dropdowns. G0 now, G1 new groups + dropdowns, G2 new groups + radio table.
import { useState } from "react";
import { Section, Select, SettingRow } from "../components/settings/Form";

type View = "G0" | "G1" | "G2" | "G3" | "G4";
const LV = ["紧急", "需要你", "告知", "记录"] as const;
type Lv = (typeof LV)[number];
interface Ev { id: string; name: string; lv: Lv; module: string; group: string; changed?: boolean; desc?: string }
const DESC: Record<string, string> = {
  "ownerNotify.info": "智能体判断需要你知晓，无需立即处理",
  "ownerNotify.attention": "智能体判断需要你查看",
  "ownerNotify.urgent": "智能体判断需要你立即处理",
  "ownerNotify.needsReply": "智能体发来消息并等待你答复",
  "system.quarantine": "来源未通过校验的消息已被拦截，未交给智能体",
  "system.deliveryFailed": "委托或其结果未能送达对方",
  "system.idleDelegation": "委托在设定时间内没有进展",
  "native.approval": "智能体请求执行命令或修改文件，等待批准",
  "native.question": "智能体暂停并向你提问",
  "approvals.owner": "需要主人本人批准的操作",
  "delegation.review": "委托已有结果，按设置等待你审阅",
  "delegation.ownerFailed": "你发起的委托未能完成",
  "delegation.sendFailed": "委托未能发出",
  "agentBus.sendFailed": "智能体之间的消息未能送达",
  "turn.owner.done": "你发起的一轮已完成",
  "turn.owner.failed": "你发起的一轮以错误结束",
  "turn.owner.interrupted": "这一轮被停止，或因运行时重启而中断",
  "turn.other.done": "由其他智能体或委托发起的一轮已完成",
  "turn.other.failed": "由其他智能体或委托发起的一轮以错误结束",
  "runtime.error": "智能体的运行时报错或意外退出",
  "jobs.done": "智能体提交的后台作业已结束"
};
/** UI-side titles by event id (cutex gives module-style ones). */
const NAME: Record<string, string> = {
  "ownerNotify.info": "告知",
  "ownerNotify.attention": "需要你",
  "ownerNotify.urgent": "紧急",
  "ownerNotify.needsReply": "要求回复",
  "system.quarantine": "智能体消息被隔离",
  "system.deliveryFailed": "委托或委托结果投递失败",
  "system.idleDelegation": "委托长时间无进展",
  "native.approval": "审批请求",
  "native.question": "智能体提问",
  "approvals.owner": "主人审批",
  "delegation.review": "委托等待主人审阅",
  "delegation.ownerFailed": "主人发起的委托失败",
  "delegation.sendFailed": "委托发送失败",
  "agentBus.sendFailed": "智能体消息发送失败",
  "turn.owner.done": "主人回合完成",
  "turn.owner.failed": "主人回合失败",
  "turn.owner.interrupted": "主人回合被中断",
  "turn.other.done": "其他回合完成",
  "turn.other.failed": "其他回合失败",
  "runtime.error": "运行时错误",
  "jobs.done": "智能体提交的作业完成"
};

const EVENTS: Ev[] = [
  { id: "ownerNotify.info", name: "智能体说「告知」", lv: "记录", module: "智能体消息", group: "said" },
  { id: "ownerNotify.attention", name: "智能体说「需要你」", lv: "告知", module: "智能体消息", group: "said" },
  { id: "ownerNotify.urgent", name: "智能体说「紧急」", lv: "紧急", module: "智能体消息", group: "said" },
  { id: "ownerNotify.needsReply", name: "智能体要你回复", lv: "需要你", module: "智能体消息", group: "said" },
  { id: "system.quarantine", name: "智能体消息被隔离", lv: "记录", module: "Cutex 系统", group: "trouble" },
  { id: "system.deliveryFailed", name: "委托或结果投递不了", lv: "记录", module: "Cutex 系统", group: "trouble" },
  { id: "system.idleDelegation", name: "委托长期无变化", lv: "记录", module: "Cutex 系统", group: "trouble" },
  { id: "native.approval", name: "审批请求", lv: "需要你", module: "审批与提问", group: "ask" },
  { id: "native.question", name: "智能体提问", lv: "需要你", module: "审批与提问", group: "ask" },
  { id: "approvals.owner", name: "主人审批", lv: "需要你", module: "审批与提问", group: "ask" },
  { id: "delegation.review", name: "委托等主人审阅", lv: "需要你", module: "委托", group: "ask" },
  { id: "delegation.ownerFailed", name: "主人的委托失败", lv: "需要你", module: "委托", group: "mine" },
  { id: "delegation.sendFailed", name: "委托发送失败", lv: "记录", module: "委托", group: "trouble" },
  { id: "agentBus.sendFailed", name: "智能体消息发送失败", lv: "记录", module: "消息总线", group: "trouble" },
  { id: "turn.owner.done", name: "主人回合完成", lv: "记录", module: "回合", group: "mine", changed: true },
  { id: "turn.owner.failed", name: "主人回合失败", lv: "需要你", module: "回合", group: "mine" },
  { id: "turn.owner.interrupted", name: "主人回合被中断", lv: "记录", module: "回合", group: "mine" },
  { id: "turn.other.done", name: "其它回合完成", lv: "记录", module: "回合", group: "others" },
  { id: "turn.other.failed", name: "其它回合失败", lv: "记录", module: "回合", group: "others" },
  { id: "runtime.error", name: "运行时出错", lv: "告知", module: "运行时", group: "trouble" },
  { id: "jobs.done", name: "智能体提交的作业结束", lv: "记录", module: "作业", group: "others" },
];
const GROUPS: { id: string; name: string; hint: string; mcp?: boolean }[] = [
  { id: "ask", name: "待你处理", hint: "需要你批准、答复或审阅，处理之前相关工作会停下" },
  { id: "mine", name: "你发起的任务", hint: "你的回合和你发起的委托有了结果" },
  { id: "said", name: "主人通知", hint: "智能体主动发给你的消息，按智能体标的级别", mcp: true },
  { id: "others", name: "其他活动", hint: "由其他智能体、委托或后台作业产生的结果" },
  { id: "trouble", name: "异常", hint: "消息被拦截、投递失败、运行时错误等" },
];
const MODULES = ["智能体消息", "Cutex 系统", "审批与提问", "委托", "消息总线", "回合", "运行时", "作业"];

const NOTES: Record<View, string> = {
  G0: "G0 现在：按 cutex 的模块分组（「消息总线」「Cutex 系统」…），每行一个下拉框。",
  G1: "G1 新分组 + 下拉框：组名说这件事对你意味着什么，组下一句说明；控件不变。",
  G2: "G2 新分组 + 圆点表格：四列等级，每行点一个；每个事件下面一句说明（界面这边按事件 ID 写）。",
  G4: "G4（owner 选 G2 后）：一张卡片，组之间用一条深色点阵分隔带（同「实时预览」的配色）；每行右边一个四段选择，选中项用蓝色（只在这张表里），不要表头。",
  G3: "G3 父子层级：「事件分级」是上一级标题（更大，带预设），下面各组是它的子卡片（标题小一号，左侧一条竖线把它们收在一起）。每组一张卡（「主人通知」那张带 [MCP工具] 标签，和下面的主人通知卡同名）：卡片标题是组名、说明是组的说明，卡片里续表头（紧急 / 需要你 / 告知 / 记录）；事件下面一句说明。",
};

function Mark() {
  return <span className="absolute top-1/2 -left-4 h-3.5 w-[3px] -translate-y-1/2 rounded-full bg-accent" aria-hidden />;
}

function Dropdowns({ rows, set }: { rows: Ev[]; set(id: string, lv: Lv): void }) {
  return (
    <>
      {rows.map((e) => (
        <SettingRow key={e.id} label={<span className="relative">{e.changed && <Mark />}{NAME[e.id] ?? e.name}</span>}>
          <Select value={e.lv as string} onChange={(v) => set(e.id, v as Lv)} options={LV.map((x) => ({ value: x, label: x }))} />
        </SettingRow>
      ))}
    </>
  );
}

function RadioTable({ groups, events, set }: { groups: { id: string; name: string; hint: string }[]; events: Ev[]; set(id: string, lv: Lv): void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,4.25rem)] items-center py-2 text-sm">
      <span />
      {LV.map((l) => <span key={l} className="pb-1 text-center text-[11px] text-subtle">{l}</span>)}
      {groups.map((g) => [
        <div key={g.id} className="col-span-5 mt-3 border-b border-border/60 pb-1">
          <span className="text-[12px] font-medium text-foreground">{g.name}</span>
          <span className="ml-2 text-[11px] text-subtle">{g.hint}</span>
        </div>,
        ...events.filter((e) => e.group === g.id).flatMap((e) => [
          <span key={e.id} className="relative py-1.5 pl-1">
            {e.changed && <Mark />}
            {NAME[e.id] ?? e.name}
            {DESC[e.id] && <span className="block text-[11px] text-subtle">{DESC[e.id]}</span>}
          </span>,
          ...LV.map((l) => (
            <span key={e.id + l} className="flex justify-center py-1.5">
              <input type="radio" name={`ev-${e.id}`} checked={e.lv === l} onChange={() => set(e.id, l)} aria-label={`${NAME[e.id] ?? e.name} · ${l}`} />
            </span>
          )),
        ]),
      ])}
    </div>
  );
}

const DOTS = { backgroundImage: "radial-gradient(color-mix(in srgb, var(--fg) 13%, transparent) 1px, transparent 1px)", backgroundSize: "12px 12px" };

/** Four levels as one segmented control; the chosen one in the accent colour (this table only). */
function LevelSeg({ value, onChange, label }: { value: Lv; onChange(v: Lv): void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-lg bg-surface-2 p-0.5">
      {LV.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={value === l} onClick={() => onChange(l)} className={`rounded-md px-2.5 py-1 text-xs whitespace-nowrap ${value === l ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function BandTable({ events, set }: { events: Ev[]; set(id: string, lv: Lv): void }) {
  return (
    <div className="-my-1">
      {GROUPS.map((g, i) => (
        <div key={g.id}>
          <div className={`-mx-4 flex min-h-8 items-center gap-2 border-y border-border/70 bg-win px-4 py-1.5 ${i === 0 ? "-mt-px rounded-t-xl border-t-0" : ""}`} style={DOTS}>
            <span className="text-[12px] font-medium text-muted">{g.name}</span>
            <span className="text-[11px] text-subtle">{g.hint}</span>
            {g.mcp && <span className="ml-auto inline-flex h-5 items-center gap-1 rounded bg-surface-2 px-1.5 text-[11px] text-muted">MCP工具</span>}
          </div>
          {events.filter((e) => e.group === g.id).map((e) => (
            <div key={e.id} className="relative flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0">
              {e.changed && <Mark />}
              <div className="min-w-0 flex-1">
                <div className="text-sm">{NAME[e.id] ?? e.name}</div>
                {DESC[e.id] && <div className="text-xs text-subtle">{DESC[e.id]}</div>}
              </div>
              <LevelSeg value={e.lv} onChange={(l) => set(e.id, l)} label={NAME[e.id] ?? e.name} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function GroupCards({ events, set }: { events: Ev[]; set(id: string, lv: Lv): void }) {
  return (
    <>
      {GROUPS.map((g) => (
        <Section key={g.id} title={g.name} hint={g.hint} sub tools={g.mcp ? [{ name: "owner_notify", desc: "智能体用它主动给你发消息，并为消息定一个通知等级。" }] : undefined}>
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,4.25rem)] items-center py-2 text-sm">
            <span />
            {LV.map((l) => <span key={l} className="pb-1 text-center text-[11px] text-subtle">{l}</span>)}
            {events.filter((e) => e.group === g.id).flatMap((e) => [
              <span key={e.id} className="relative border-t border-border/60 py-2 pl-1">
                {e.changed && <Mark />}
                {NAME[e.id] ?? e.name}
                {DESC[e.id] && <span className="block text-[11px] text-subtle">{DESC[e.id]}</span>}
              </span>,
              ...LV.map((l) => (
                <span key={e.id + l} className="flex justify-center self-stretch border-t border-border/60 py-2">
                  <input type="radio" className="self-center" name={`ev3-${e.id}`} checked={e.lv === l} onChange={() => set(e.id, l)} aria-label={`${NAME[e.id] ?? e.name} · ${l}`} />
                </span>
              )),
            ])}
          </div>
        </Section>
      ))}
    </>
  );
}

export function EventGroupsTopic() {
  const q = new URLSearchParams(location.search);
  const [view, setView] = useState<View>((q.get("g") as View | null) ?? "G4");
  const [events, setEvents] = useState(EVENTS);
  const set = (id: string, lv: Lv) => setEvents((xs) => xs.map((e) => (e.id === id ? { ...e, lv, changed: true } : e)));
  const btn = (on: boolean) => `rounded-md border px-3 py-1 text-sm ${on ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`;
  return (
    <>
      <div className="my-4 flex flex-wrap gap-2">{(["G0", "G1", "G2", "G3", "G4"] as View[]).map((k) => <button key={k} onClick={() => setView(k)} className={btn(k === view)}>{k}</button>)}</div>
      <p className="mb-1 text-sm text-muted">{NOTES[view]}</p>
      <p className="mb-4 text-xs text-subtle">分组只在界面这边按事件 ID 归类，不改后端；后端新加、这里还没归类的事件放进最后的「其他」。行首竖条 = 改过（「主人回合完成」）。</p>
      <div className="rounded-xl border border-border bg-background">
        <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › <span className="font-semibold text-foreground">通知</span></div>
        <div className="mx-auto max-w-[720px] px-4 py-5">
          {view === "G3" ? (
            <>
              <div className="mb-4 flex items-start gap-3 border-b border-border/60 pb-2">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold">事件分级</h2>
                  <p className="text-xs text-subtle">调整不同事件的通知等级；一件事同时属于几类时，按最高的算。</p>
                </div>
                <span className="ml-auto inline-flex shrink-0 rounded-md border border-border p-0.5 text-xs"><span className="rounded px-2 py-0.5 text-muted">推荐</span><span className="rounded bg-surface-2 px-2 py-0.5">自定义</span></span>
              </div>
              <div className="border-l border-border/60 pl-4">
                <GroupCards events={events} set={set} />
              </div>
            </>
          ) : (
          <Section title="事件分级" hint="调整不同事件的通知等级；一件事同时属于几类时，按最高的算。">
            {view === "G0" &&
              MODULES.map((m) => (
                <div key={m}>
                  <div className="pt-3 pb-1 text-[11px] font-medium text-subtle">{m}</div>
                  <Dropdowns rows={events.filter((e) => e.module === m)} set={set} />
                </div>
              ))}
            {view === "G1" &&
              GROUPS.map((g) => (
                <div key={g.id}>
                  <div className="pt-4 pb-1">
                    <span className="text-[12px] font-medium text-foreground">{g.name}</span>
                    <span className="ml-2 text-[11px] text-subtle">{g.hint}</span>
                  </div>
                  <Dropdowns rows={events.filter((e) => e.group === g.id)} set={set} />
                </div>
              ))}
            {view === "G2" && <RadioTable groups={GROUPS} events={events} set={set} />}
            {view === "G4" && <BandTable events={events} set={set} />}
          </Section>
          )}
        </div>
      </div>
    </>
  );
}
