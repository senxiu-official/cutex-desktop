// Variants topic 「卡片标签」 (owner 2026-10-19): where a card's tags go once there are several —
// where (cutex 后端 · HOST), whether agents feel it, [MCP工具], later [第三方模块] — next to the
// 「只看你修改过的设置」 switch on the right. A: under the hint (like the page header); B: under the
// title, hint last; C: the where tag stays in the title row, the rest on a second line.
import { useState, type ReactNode } from "react";
import { Blocks, Bot, Server, Wrench } from "lucide-react";
import { SettingRow, Toggle } from "../components/settings/Form";

type Layout = "A" | "B" | "C";
const NOTES: Record<Layout, string> = {
  A: "A：标题行只有标题和右边的开关；说明在第二行；标签在说明下面一行（和页头一样：说明在上，标签在下）。",
  B: "B：标签紧贴在标题下面一行，说明放最后。",
  C: "C：位置标签（cutex 后端 · HOST）留在标题行，其余标签放第二行，说明在最后。",
};

const CHIP = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const host = <span key="h" className={`${CHIP} bg-accent/12 text-accent`}><Server size={11} />cutex 后端 · <span className="size-1.5 rounded-full bg-ok" />HOST-A</span>;
const agents = <span key="a" className={`${CHIP} bg-warn/15 text-warn-text`}><Bot size={11} />新启动的智能体</span>;
const mcp = <span key="m" className={`${CHIP} bg-surface-2 text-muted`} title="MCP 工具 · owner_notify：智能体调用它主动给你发消息"><Wrench size={11} />MCP工具</span>;
const third = <span key="t" className={`${CHIP} border border-dashed border-border text-muted`} title="第三方模块 · Example Pack 1.2：不是 Cutex 官方模块提供的设置"><Blocks size={11} />第三方模块</span>;

interface CardSpec { title: string; hint: string; where?: ReactNode; others: ReactNode[]; filter?: boolean; rows: [string, string?][] }

const CARDS: CardSpec[] = [
  { title: "主人通知", hint: "智能体给你发消息时怎么提醒你；智能体只决定级别，看不到你在哪儿、怎么收到。", where: host, others: [agents, mcp], filter: true, rows: [["哪些智能体能用这个工具", "影响智能体下次启动时的工具列表"], ["每个智能体每小时条数", "超过后降为「告知」且不推送"]] },
  { title: "排队顺序", hint: "", where: host, others: [], rows: [["排队消息可以排到委托前面", "在「接下来」面板里拖动你的消息时，可以越过委托和待投递的结果"]] },
  { title: "Example Pack 设置", hint: "第三方模块的卡片：只多一个标签。", others: [third], rows: [["启用示例功能"]] },
  { title: "发送", hint: "", others: [], rows: [["发送方式", "智能体工作时，Enter 把消息排队，这一轮结束后发送"]] },
];

function Filter() {
  return (
    <label className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-muted">
      只看你修改过的设置（1）
      <Toggle checked={false} onChange={() => {}} />
    </label>
  );
}

function Tags({ tags }: { tags: ReactNode[] }) {
  return tags.length ? <div className="mt-1 flex flex-wrap items-center gap-1.5">{tags}</div> : null;
}

function Card({ c, layout }: { c: CardSpec; layout: Layout }) {
  const all = [c.where, ...c.others].filter(Boolean) as ReactNode[];
  const hint = c.hint ? <p className="mt-0.5 text-xs text-subtle">{c.hint}</p> : null;
  return (
    <section className="mb-6">
      <div className="mb-2">
        <div className="flex h-8 items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold">{c.title}</h3>
          {layout === "C" && c.where}
          {c.filter && <Filter />}
        </div>
        {layout === "A" && <>{hint}<Tags tags={all} /></>}
        {layout === "B" && <><Tags tags={all} />{hint}</>}
        {layout === "C" && <><Tags tags={c.others} />{hint}</>}
      </div>
      <div className="rounded-xl border border-[var(--card-border,var(--border))] bg-surface px-4">
        {c.rows.map(([l, h]) => <SettingRow key={l} label={l} hint={h}><Toggle checked onChange={() => {}} /></SettingRow>)}
      </div>
    </section>
  );
}

export function CardTagsTopic() {
  const q = new URLSearchParams(location.search);
  const [layout, setLayout] = useState<Layout>((q.get("l") as Layout | null) ?? "A");
  const [narrow, setNarrow] = useState(false);
  const btn = (on: boolean) => `rounded-md border px-3 py-1 text-sm ${on ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`;
  return (
    <>
      <div className="my-4 flex flex-wrap items-center gap-2">
        {(["A", "B", "C"] as Layout[]).map((k) => <button key={k} onClick={() => setLayout(k)} className={btn(k === layout)}>{k}</button>)}
        <button onClick={() => setNarrow(!narrow)} className={`ml-4 ${btn(narrow)}`}>窄卡片（{narrow ? "开" : "关"}）</button>
      </div>
      <p className="mb-4 text-sm text-muted">{NOTES[layout]}</p>
      <div className="rounded-xl border border-border bg-background">
        <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › <span className="font-semibold text-foreground">示意</span></div>
        <div className={`mx-auto px-4 py-5 ${narrow ? "max-w-[440px]" : "max-w-[720px]"}`}>
          {CARDS.map((c) => <Card key={c.title} c={c} layout={layout} />)}
        </div>
      </div>
    </>
  );
}
