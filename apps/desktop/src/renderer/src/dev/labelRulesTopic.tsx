// Variants topic 「标签规则：所有情况」 (owner 2026-10-19: one rule set, no exceptions). Each case is a
// small page drawn by the draft rules:
// 1 header = hint · tags · host picker (only with host settings on the page and >1 host);
// 2 one where-tag per page (a place, or 混合设置 once any card lives elsewhere);
// 3 card where-tags only on 混合设置 pages, then on every card; 4 agents: 不影响智能体 on the page
// when no card affects agents, else the cards that do say how; 5 MCP工具 / 第三方模块 on cards;
// 6 tags read-only, hosts switch only in the header; 7 card tags under the card hint.
import { useState, type ReactNode } from "react";
import { Blocks, Bot, Check, ChevronDown, KeyRound, Layers, Monitor, Server, Wrench } from "lucide-react";
import { SettingRow, Toggle } from "../components/settings/Form";

const CHIP = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const T = {
  local: <span className={`${CHIP} bg-surface-2 text-muted`}><Monitor size={11} />本地桌面应用</span>,
  host: (h: string) => <span className={`${CHIP} bg-accent/12 text-accent`}><Server size={11} />cutex 后端 · {h}</span>,
  codex: (h: string) => <span className={`${CHIP} bg-accent/12 text-accent`}><Server size={11} />Codex 运行时 · {h}</span>,
  mixed: <span className={`${CHIP} bg-surface-2 text-muted`}><Layers size={11} />混合设置</span>,
  none: <span className={`${CHIP} bg-surface-2 text-subtle`}><Bot size={11} />不影响智能体</span>,
  next: <span className={`${CHIP} bg-warn/15 text-warn-text`}><Bot size={11} />智能体 · 下次启动生效</span>,
  now: <span className={`${CHIP} bg-warn/15 text-warn-text`}><Bot size={11} />智能体 · 立即生效</span>,
  access: <span className={`${CHIP} bg-surface-2 text-muted`}><KeyRound size={11} />访问权限</span>,
  mcp: <span className={`${CHIP} bg-surface-2 text-muted`}><Wrench size={11} />MCP工具</span>,
  third: <span className={`${CHIP} border border-dashed border-border text-muted`}><Blocks size={11} />第三方模块</span>,
};
const HOSTS = ["HOST-A", "workstation", "alpha"];

function Picker({ host, setHost }: { host: string; setHost(h: string): void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-surface-2">
        <span className="size-1.5 rounded-full bg-ok" />{host}<ChevronDown size={12} className="text-subtle" />
      </button>
      {open && (
        <span className="absolute top-full left-0 z-20 mt-1 w-56 rounded-xl border border-border bg-surface p-1 shadow-xl">
          {HOSTS.map((x) => (
            <button key={x} type="button" onClick={() => (setHost(x), setOpen(false))} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2">
              <span className="size-1.5 rounded-full bg-ok" />{x}{x === host && <Check size={13} className="ml-auto text-accent" />}
            </button>
          ))}
          <span className="block border-t border-border/60 px-2.5 pt-1.5 pb-1 text-[11px] text-subtle">整个设置里的主机设置都跟着换</span>
        </span>
      )}
    </span>
  );
}

interface CardSpec { title: string; hint?: string; tags: ReactNode[]; row: string }
interface Case { id: string; name: string; rule: string; hint: string; tags: ReactNode[]; picker: boolean; adjust?: boolean; cards: CardSpec[] }

const cases = (h: string): Case[] => [
  { id: "1", name: "① 全在本地 · 不影响智能体（如：通用、外观）", rule: "页头：本地桌面应用 + 不影响智能体；卡片不标。", hint: "语言、术语和窗口行为。", tags: [T.local, T.none], picker: false, cards: [{ title: "语言", tags: [], row: "界面语言" }, { title: "窗口", tags: [], row: "关闭窗口时最小化到托盘" }] },
  { id: "2", name: "② 全在主机 · 只连一台主机", rule: "页头：cutex 后端 · 主机；没有选择器行。", hint: "每个智能体用启动时的运行时；升级把空闲的换到新版本。", tags: [T.host("HOST-A")], picker: false, cards: [{ title: "升级智能体", tags: [T.next], row: "升级空闲的" }] },
  { id: "3", name: "③ 全在主机 · 连了多台主机（如：运行时、用户）", rule: "页头第三行出现主机选择器；卡片不标位置。", hint: "每个智能体用启动时的运行时；升级把空闲的换到新版本。", tags: [T.host(h)], picker: true, cards: [{ title: "升级智能体", tags: [T.next], row: "升级空闲的" }, { title: "已安装的运行时", tags: [], row: "清理旧版本" }] },
  { id: "4", name: "④ 全在 Codex 运行时 · 多台主机（如：插件、MCP 服务器）", rule: "页头：Codex 运行时 · 主机 + 选择器。", hint: "Codex 智能体启动时加载已启用的插件；Claude 智能体不加载。", tags: [T.codex(h)], picker: true, cards: [{ title: "同步", tags: [T.next], row: "智能体跟随共享配置" }] },
  { id: "5", name: "⑤ 混合 · 多台主机（如：通知）", rule: "页头：混合设置 + 选择器；每张卡片都标位置，影响智能体的卡片再标何时生效。", hint: "自定义各类事件的通知等级，以及不同等级的通知方式。", tags: [T.mixed], picker: true, cards: [{ title: "提醒开关", hint: "主机决定什么时候提醒；这里可以按方式关掉。", tags: [T.local], row: "桌面通知" }, { title: "通知方式", hint: "调整不同通知等级的通知方式；带锁的格子固定。", tags: [T.host(h)], row: "（表格）" }, { title: "主人通知", hint: "智能体给你发消息时怎么提醒你。", tags: [T.host(h), T.next, T.mcp], row: "哪些智能体能用这个工具" }] },
  { id: "6", name: "⑥ 混合 · 页头有「在主界面调整」 · 多台主机（如：输入区，若「排队顺序」留在这页）", rule: "同⑤：每张卡片都标位置；按钮在右上，选择器在第三行。", hint: "怎么发送消息，以及输入框周围的「接下来」面板、「需要你」条和底栏。", tags: [T.mixed], picker: true, adjust: true, cards: [{ title: "发送", tags: [T.local], row: "处理委托时也能用快捷键插话" }, { title: "排队顺序", tags: [T.host(h)], row: "排队消息可以排到委托前面" }, { title: "「接下来」面板", tags: [T.local], row: "悬停时显示分区名" }] },
  { id: "6b", name: "⑥′ 同一页，若把「排队顺序」挪走", rule: "整页回到「本地桌面应用」，卡片都不标；没有选择器行。", hint: "怎么发送消息，以及输入框周围的「接下来」面板、「需要你」条和底栏。", tags: [T.local, T.none], picker: false, adjust: true, cards: [{ title: "发送", tags: [], row: "处理委托时也能用快捷键插话" }, { title: "「接下来」面板", tags: [], row: "悬停时显示分区名" }] },
  { id: "7", name: "⑦ 全在本地，但有卡片影响智能体", rule: "页头只标位置，不标「不影响智能体」；影响的卡片标何时生效。", hint: "示意：一页本地设置里有一张会传给智能体的卡片。", tags: [T.local], picker: false, cards: [{ title: "显示", tags: [], row: "紧凑模式" }, { title: "写给智能体的说明", tags: [T.now], row: "附带当前文件" }] },
  { id: "8", name: "⑧ 访问权限（如：接入、互联、用户）", rule: "改谁能连进来：和智能体标签同一组，所以按规则 4 标在卡片上，页头不标。", hint: "哪些设备能连这台主机。", tags: [T.host(h)], picker: true, cards: [{ title: "监听", tags: [T.access], row: "允许局域网连接" }, { title: "显示", tags: [], row: "显示连接日志" }] },
  { id: "9", name: "⑨ 第三方模块的卡片 + MCP 工具", rule: "卡片标「第三方模块」；它若是某个 MCP 工具的设置，再标「MCP工具」。", hint: "示意：一页上有第三方模块提供的卡片。", tags: [T.local], picker: false, cards: [{ title: "Example Pack", hint: "第三方模块提供。", tags: [T.third, T.mcp, T.next], row: "启用示例工具" }] },
];

function Page({ c, host, setHost }: { c: Case; host: string; setHost(h: string): void }) {
  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="border-b border-border/60 px-4 py-2 text-sm"><span className="font-semibold">{c.name}</span><span className="ml-2 text-xs text-subtle">{c.rule}</span></div>
      <div className="mx-auto max-w-[680px] px-4 py-4">
        <div className="mb-4 space-y-1.5 border-b border-border/60 pb-3">
          <div className="flex min-h-5 items-start gap-3">
            <p className="min-w-0 text-[13px] text-muted">{c.hint}</p>
            {c.adjust && <button className="-my-1.5 ml-auto inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2.5 text-xs">在主界面调整</button>}
          </div>
          <div className="flex min-h-6 flex-wrap items-center gap-1.5">{c.tags}</div>
          {c.picker && <div><Picker host={host} setHost={setHost} /></div>}
        </div>
        {c.cards.map((k) => (
          <section key={k.title} className="mb-4">
            <div className="mb-2">
              <div className="flex h-8 items-center"><h3 className="text-sm font-semibold">{k.title}</h3></div>
              {k.hint && <p className="text-xs text-subtle">{k.hint}</p>}
              {k.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{k.tags}</div>}
            </div>
            <div className="rounded-xl border border-border bg-surface px-4"><SettingRow label={k.row}><Toggle checked onChange={() => {}} /></SettingRow></div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function LabelRulesTopic() {
  const [host, setHost] = useState("HOST-A");
  return (
    <div className="my-4 space-y-5">
      <ol className="list-decimal space-y-0.5 rounded-xl border border-border bg-surface px-8 py-3 text-xs text-muted">
        <li>页头固定三行：说明 → 标签 → 主机选择器（本页有主机设置、且连了不止一台主机时才有）。</li>
        <li>每页一个位置标签：本地桌面应用 / cutex 后端 · 主机 / Codex 运行时 · 主机 / 混合设置。有一张卡片在别处，就是混合设置。</li>
        <li>卡片的位置标签只在混合设置页出现，而且每张卡片都标。</li>
        <li>整页不影响智能体时页头标「不影响智能体」；否则由影响的卡片标何时生效 / 访问权限。</li>
        <li>MCP工具、第三方模块只在卡片上。</li>
        <li>标签只读；主机只在页头切换，对整个设置生效。</li>
        <li>卡片标签在卡片说明下面一行。</li>
      </ol>
      {cases(host).map((c) => <Page key={c.id} c={c} host={host} setHost={setHost} />)}
    </div>
  );
}
