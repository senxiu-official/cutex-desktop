// Variants topic 「通知两张表的名字」 (owner 2026-10-19: 通知方式 / 通知等级 are still unclear). The page has
// two host tables: event → level (long, last) and level → methods (the grid). Each naming set shows the
// two card heads with a couple of sample rows, and optionally a flow line above them.
import { useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Section, Select, SettingRow } from "../components/settings/Form";

type NameSet = "M1" | "M2" | "M3" | "M4";
const SETS: Record<NameSet, { name: string; note: string; flow: boolean; methods: [string, string]; levels: [string, string] }> = {
  M1: { name: "M1 现在", note: "「通知方式」「通知等级」：两个名词，看不出谁先谁后、谁决定谁。", flow: false, methods: ["通知方式", "每个等级怎么提醒你；带锁的格子固定。"], levels: ["通知等级", "什么事算哪个等级；一件事同时属于几类时，按最高的算。"] },
  M2: { name: "M2 两个问句", note: "标题直接是问题：「每一级怎么提醒你」「每件事算哪一级」。不用先懂「等级」「方式」两个词。", flow: false, methods: ["每一级怎么提醒你", "带锁的格子固定。"], levels: ["每件事算哪一级", "一件事同时属于几类时，按最高的那一级。"] },
  M3: { name: "M3 两步 + 流程线", note: "主机规则顶上一行流程：「一件事 → 定级 → 紧急 / 需要你 / 告知 / 记录 → 提醒」。两张卡就叫「定级」「提醒」，标题前标步骤号。", flow: true, methods: ["② 按级别提醒", "每一级用哪些方式；带锁的格子固定。"], levels: ["① 给每件事定级", "一件事同时属于几类时，按最高的那一级。"] },
  M4: { name: "M4 轻重", note: "把「等级」说成「轻重」：「按轻重提醒」「每件事有多重」。口语，但铃铛和主人通知里的「级别」也要跟着改。", flow: false, methods: ["按轻重提醒", "每种轻重用哪些方式；带锁的格子固定。"], levels: ["每件事有多重", "一件事同时属于几类时，按最重的算。"] },
};

const LV = ["紧急", "需要你", "告知", "记录"];

function Flow() {
  const pill = "rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs text-muted">
      一件事 <ArrowRight size={12} /> <span className="text-foreground">① 定级</span> <ArrowRight size={12} />
      {LV.map((l) => <span key={l} className={pill}>{l}</span>)}
      <ArrowRight size={12} /> <span className="text-foreground">② 提醒</span> <ArrowRight size={12} /> 桌面通知 · 声音 · 手机 …
    </div>
  );
}

function Grid() {
  return (
    <div className="grid grid-cols-[1fr_repeat(3,5rem)] gap-y-2 py-3 text-xs">
      <span />
      {["桌面通知", "声音", "手机推送"].map((c) => <span key={c} className="text-center text-[11px] text-subtle">{c}</span>)}
      {[["紧急", 1, 1, 1], ["需要你", 1, 0, 1], ["告知", 1, 1, 0], ["记录", 0, 0, 0]].map(([k, ...c]) => [
        <span key={String(k)} className="text-[13px]">{k}</span>,
        ...c.map((on, i) => <span key={String(k) + i} className="flex justify-center"><input type="checkbox" defaultChecked={!!on} /></span>),
      ])}
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › <span className="font-semibold text-foreground">通知</span></div>
      <div className="mx-auto max-w-[720px] px-4 py-5">{children}</div>
    </div>
  );
}

export function NotifyNamesTopic() {
  const q = new URLSearchParams(location.search);
  const [v, setV] = useState<NameSet>((q.get("m") as NameSet | null) ?? "M2");
  const s = SETS[v];
  const btn = (on: boolean) => `rounded-md border px-3 py-1 text-sm ${on ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`;
  return (
    <>
      <div className="my-4 flex flex-wrap gap-2">{(Object.keys(SETS) as NameSet[]).map((k) => <button key={k} onClick={() => setV(k)} className={btn(k === v)}>{SETS[k].name}</button>)}</div>
      <p className="mb-4 text-sm text-muted">{s.note}</p>
      <Page>
        <div className="mb-3 border-b border-border/60 pb-2"><span className="text-[15px] font-semibold">主机的通知规则</span><p className="text-[13px] text-muted">存在所选主机的 cutex 后端里，连这台主机的每台设备都一样。</p></div>
        {s.flow && <Flow />}
        <Section title={s.methods[0]} hint={s.methods[1]}><Grid /></Section>
        <p className="mb-6 text-center text-xs text-subtle">（中间：新智能体的提醒、主人通知）</p>
        <Section title={s.levels[0]} hint={s.levels[1]}>
          {[["智能体说「紧急」", "紧急"], ["审批请求", "需要你"], ["主人回合完成", "记录"]].map(([e, l]) => (
            <SettingRow key={e} label={e}><Select value={l!} onChange={() => {}} options={LV.map((x) => ({ value: x, label: x }))} /></SettingRow>
          ))}
          <p className="py-2 text-xs text-subtle">（示意：只画了 3 行）</p>
        </Section>
      </Page>
    </>
  );
}
