// Variants topic 「输入区拆页」 (owner 2026-10-18, S1 picked): 状态显示 and 胶囊外观 leave 输入区 for a
// page of their own. Options here: what the places around the input box are called (N1–N3) and
// where the new page sits in the nav (P1 / P2). Mock rows only (no prefs are written).
import { useState, type ReactNode } from "react";
import { Section, Segmented, SettingRow, Toggle } from "../components/settings/Form";

type Naming = "N1" | "N2" | "N3";
type NavPos = "P1" | "P2";

const NAMINGS: Record<Naming, { name: string; note: string; above: string; below: string; aboveHint?: string; belowHint?: string; quota: string; avatar: string }> = {
  N1: { name: "N1 位置词", note: "只用位置说话：输入框上方 / 输入框下方。不用记新词，但「输入框上方」要同时指「需要你」条和目标那一行。", above: "输入框上方", below: "输入框下方", quota: "显示额度重置倒计时", avatar: "显示 Profile 头像" },
  N2: { name: "N2 名词", note: "给两行各起名字：状态行（代码里本来就叫 status row）/ 底栏。短，表格列名也短。", above: "状态行", below: "底栏", quota: "底栏显示额度重置倒计时", avatar: "底栏显示 Profile 头像" },
  N3: { name: "N3 名词 + 位置说明", note: "同 N2，但第一次出现的地方用分区说明交代位置，表格列名带悬停解释。", above: "状态行", below: "底栏", aboveHint: "「需要你」条和状态行都在输入框正上方，状态行显示目标等进行中的事。", belowHint: "输入框下方的一行：模式、Profile、额度和模型。", quota: "显示额度重置倒计时", avatar: "显示 Profile 头像" },
};

const STATUS_ITEMS = ["目标", "计划", "后台终端", "子智能体", "委托", "作业", "闹钟"];

function Pill({ children, active }: { children: ReactNode; active?: boolean }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${active ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"}`}>{children}</span>;
}

// A labelled sketch of the bottom of the main window: which name points where.
function Sketch({ n }: { n: (typeof NAMINGS)[Naming] }) {
  const tag = "absolute -right-2 translate-x-full whitespace-nowrap text-[11px] text-accent";
  return (
    <div className="relative mr-40 rounded-lg border border-border bg-surface/40 p-3 text-xs">
      <div className="relative h-16 rounded border border-dashed border-border/70 text-subtle">
        <span className="absolute left-2 top-2">对话正文</span>
        <span className="absolute right-2 top-2 rounded-full border border-border bg-raised px-2 py-0.5 text-foreground">◎ 接通 /review +5</span>
        <span className={`${tag} top-2`}>← 胶囊</span>
      </div>
      <div className="relative mt-2 flex gap-1.5"><Pill active>Mika 需要你</Pill><Pill>Helper 完成</Pill><span className={`${tag} top-0`}>← 「需要你」条</span></div>
      <div className="relative mt-1.5 text-muted">◎ 目标 把 slash 命令面板做完 · 进行中<span className={`${tag} top-0`}>← {n.above}</span></div>
      <div className="relative mt-1.5 rounded-t border border-b-0 border-border px-2 py-1 text-muted">接下来 · 3<span className={`${tag} top-1`}>← 「接下来」面板</span></div>
      <div className="relative rounded-b border border-border px-2 py-3 text-subtle">继续输入以排队后续消息<span className={`${tag} top-3`}>← 输入框</span></div>
      <div className="relative mt-1.5 flex gap-3 text-muted"><span>+ 自动</span><span className="ml-auto">gamma · 1d19h · 62.4k · GPT 5.5</span><span className={`${tag} top-0`}>← {n.below}</span></div>
    </div>
  );
}

function Nav({ pos }: { pos: NavPos }) {
  const items = pos === "P1" ? ["通用", "外观", "左侧栏", "对话", "输入区", "状态", "右侧栏与留白", "通知"] : ["通用", "外观", "左侧栏", "对话", "状态", "输入区", "右侧栏与留白", "通知"];
  return (
    <div className="w-36 shrink-0 rounded-lg border border-border bg-surface/40 p-2 text-sm">
      <div className="px-2 pb-1 text-xs text-subtle">应用</div>
      {items.map((x) => <div key={x} className={`rounded px-2 py-1 ${x === "状态" ? "bg-accent/12 text-accent" : "text-muted"}`}>{x}{x === "状态" ? "（新）" : ""}</div>)}
    </div>
  );
}

function MiniPage({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-border bg-background">
      <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › <span className="font-semibold text-foreground">{title}</span></div>
      <div className="px-4 py-4"><p className="mb-3 text-sm text-muted">{hint}</p>{children}</div>
    </div>
  );
}

function ComposerPage({ n }: { n: (typeof NAMINGS)[Naming] }) {
  const [send, setSend] = useState("queue");
  const [fold, setFold] = useState("open");
  return (
    <MiniPage title="输入区" hint="怎么发送消息，以及输入框周围的面板和两行。">
      <Section title="发送">
        <SettingRow label="发送方式" hint="（提示的写法在 A 里另定）"><Segmented value={send} onChange={setSend} options={[{ value: "cli", label: "插话优先" }, { value: "queue", label: "排队优先" }]} /></SettingRow>
        <SettingRow label="处理委托时也能用快捷键插话"><Toggle checked={false} onChange={() => {}} /></SettingRow>
      </Section>
      <Section title="排队顺序"><SettingRow label="排队消息可以排到委托前面"><Toggle checked onChange={() => {}} /></SettingRow></Section>
      <Section title="「接下来」面板">
        <SettingRow label="展开方式"><Segmented value={fold} onChange={setFold} options={[{ value: "open", label: "始终展开" }, { value: "auto", label: "自动折叠" }]} /></SettingRow>
        <SettingRow label="悬停时显示分区名"><Toggle checked onChange={() => {}} /></SettingRow>
      </Section>
      <Section title={n.above === "状态行" ? "输入框上方" : n.above} hint={n.aboveHint}>
        <SettingRow label="「需要你」条" hint="所有项目里需要你、刚完成或出错的智能体，点一下打开"><Toggle checked onChange={() => {}} /></SettingRow>
        {n.above === "状态行" ? <SettingRow label="状态行里显示什么" hint="在「状态」页里选"><span className="text-xs text-accent">去「状态」 →</span></SettingRow> : null}
      </Section>
      <Section title={n.below} hint={n.belowHint}>
        <SettingRow label={n.quota}><Toggle checked onChange={() => {}} /></SettingRow>
        <SettingRow label={n.avatar} hint="在 Profile 名字前显示它的头像"><Toggle checked onChange={() => {}} /></SettingRow>
      </Section>
    </MiniPage>
  );
}

function StatusPage({ n }: { n: (typeof NAMINGS)[Naming] }) {
  const cols = [n.above === "状态行" ? "状态行" : "输入框上方", "胶囊", "两者", "不显示"];
  const [place, setPlace] = useState<Record<string, number>>({ 目标: 0 });
  const [corner, setCorner] = useState("tr");
  const [edge, setEdge] = useState("win");
  return (
    <MiniPage title="状态" hint="目标、计划、作业这些进行中的事显示在哪里，以及胶囊放在哪。">
      <Section title="显示位置" hint={n.name.startsWith("N3") ? "胶囊浮在对话正文的一角，点开能看详情；状态行在输入框正上方，一直看得到。" : undefined}>
        <div className="grid grid-cols-[minmax(6rem,1fr)_repeat(4,5.5rem)] items-center gap-y-2 px-4 py-3 text-sm">
          <span />
          {cols.map((c) => <span key={c} className="text-center text-[11px] text-subtle" title={c === "胶囊" ? "浮在对话正文一角的小面板" : c === "状态行" ? "输入框正上方的一行" : undefined}>{c}</span>)}
          {STATUS_ITEMS.map((it) => [
            <span key={it}>{it}</span>,
            ...cols.map((_, i) => <span key={it + i} className="text-center"><input type="radio" name={`sp-${it}`} checked={(place[it] ?? 1) === i} onChange={() => setPlace({ ...place, [it]: i })} /></span>),
          ])}
        </div>
      </Section>
      <Section title="胶囊">
        <SettingRow label="位置" hint="折叠和展开都在这个角"><Segmented value={corner} onChange={setCorner} options={[{ value: "tl", label: "左上" }, { value: "tr", label: "右上" }, { value: "bl", label: "左下" }, { value: "br", label: "右下" }]} /></SettingRow>
        <SettingRow label="贴靠"><Segmented value={edge} onChange={setEdge} options={[{ value: "win", label: "窗口边缘" }, { value: "col", label: "正文边缘" }]} /></SettingRow>
        <SettingRow label="没有内容时也显示胶囊"><Toggle checked={false} onChange={() => {}} /></SettingRow>
        <SettingRow label="大小"><span className="text-xs text-muted">100 %</span></SettingRow>
      </Section>
    </MiniPage>
  );
}

export function InputSplitTopic() {
  const q = new URLSearchParams(location.search);
  const [naming, setNaming] = useState<Naming>((q.get("n") as Naming | null) ?? "N2");
  const [pos, setPos] = useState<NavPos>((q.get("p") as NavPos | null) ?? "P1");
  const n = NAMINGS[naming];
  const btn = (on: boolean) => `rounded-md border px-3 py-1 text-sm ${on ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`;
  return (
    <>
      <div className="my-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-subtle">叫法</span>
        {(Object.keys(NAMINGS) as Naming[]).map((k) => <button key={k} onClick={() => setNaming(k)} className={btn(k === naming)}>{NAMINGS[k].name}</button>)}
        <span className="ml-4 text-xs text-subtle">「状态」放在</span>
        <button onClick={() => setPos("P1")} className={btn(pos === "P1")}>P1 输入区之后</button>
        <button onClick={() => setPos("P2")} className={btn(pos === "P2")}>P2 对话之后</button>
      </div>
      <p className="mb-4 text-sm text-muted">{n.note}</p>
      <div className="mb-6 flex items-start gap-4"><Nav pos={pos} /><div className="min-w-0 flex-1"><Sketch n={n} /></div></div>
      <div className="space-y-6">
        <ComposerPage n={n} />
        <StatusPage n={n} />
      </div>
    </>
  );
}
