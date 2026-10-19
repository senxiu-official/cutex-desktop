// Variants topic 「主机切换放哪」 (owner 2026-10-19): the Settings target host is one choice for the whole
// settings window, so the picker sits once in the page header; card tags only show the host (no ▾).
// P1: picker right after the page tags; P2: its own line under them; P3: at the header's right end.
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Layers, Monitor, Server } from "lucide-react";
import { SettingRow, Toggle } from "../components/settings/Form";

type Pos = "P1" | "P2" | "P3";
const NOTES: Record<Pos, string> = {
  P1: "P1：选择器紧跟在页头标签后面，前面写「主机：」。",
  P2: "P2：选择器在标签下面单独一行，写「正在编辑：」。",
  P3: "P3：选择器放在页头右上角（「在主界面调整」那个位置；有那个按钮的页面两者并排）。",
};
const CHIP = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const dot = (c = "bg-ok") => <span className={`size-1.5 shrink-0 rounded-full ${c}`} />;
const tagLocal = (mixed: boolean) => <span className={`${CHIP} bg-surface-2 text-muted`}><Monitor size={11} />{mixed ? "混合：本地桌面应用" : "本地桌面应用"}</span>;
const tagMixed = <span className={`${CHIP} bg-surface-2 text-muted`}><Layers size={11} />混合设置</span>;
const tagHost = (host: string) => <span className={`${CHIP} bg-accent/12 text-accent`}><Server size={11} />cutex 后端 · {host}</span>;
const HOSTS = [{ id: "HOST-A", dot: "bg-ok", note: "" }, { id: "workstation", dot: "bg-warn", note: "" }, { id: "alpha", dot: "bg-subtle", note: "未连接" }];

function Picker({ host, setHost, prefix }: { host: string; setHost(h: string): void; prefix: string }) {
  const [open, setOpen] = useState(false);
  const h = HOSTS.find((x) => x.id === host)!;
  return (
    <span className="relative inline-flex items-center gap-1.5 text-xs text-muted">
      {prefix}
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-surface-2">
        {dot(h.dot)}{h.id}<ChevronDown size={12} className="text-subtle" />
      </button>
      {open && (
        <span className="absolute top-full left-0 z-20 mt-1 w-56 rounded-xl border border-border bg-surface p-1 shadow-xl">
          {HOSTS.map((x) => (
            <button key={x.id} type="button" disabled={!!x.note} onClick={() => (setHost(x.id), setOpen(false))} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 disabled:opacity-50">
              {dot(x.dot)}{x.id}<span className="ml-auto text-xs text-subtle">{x.note}</span>{x.id === host && <Check size={13} className="text-accent" />}
            </button>
          ))}
          <span className="block border-t border-border/60 px-2.5 pt-1.5 pb-1 text-[11px] text-subtle">整个设置里的主机设置都跟着换</span>
        </span>
      )}
    </span>
  );
}

function Header({ pos, hint, tags, picker, right }: { pos: Pos; hint: string; tags: ReactNode; picker: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 space-y-1.5 border-b border-border/60 pb-3">
      <div className="flex min-h-5 items-start gap-3">
        <p className="min-w-0 text-[13px] text-muted">{hint}</p>
        <span className="ml-auto flex shrink-0 items-center gap-2">{pos === "P3" && picker}{right}</span>
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">{tags}{pos === "P1" && <span className="ml-1.5">{picker}</span>}</div>
      {pos === "P2" && <div>{picker}</div>}
    </div>
  );
}

function Card({ title, hint, tag, rows }: { title: string; hint?: string; tag?: ReactNode; rows: string[] }) {
  return (
    <section className="mb-5">
      <div className="mb-2">
        <div className="flex h-8 items-center"><h3 className="text-sm font-semibold">{title}</h3></div>
        {hint && <p className="text-xs text-subtle">{hint}</p>}
        {tag && <div className="mt-1 flex gap-1.5">{tag}</div>}
      </div>
      <div className="rounded-xl border border-border bg-surface px-4">{rows.map((r) => <SettingRow key={r} label={r}><Toggle checked onChange={() => {}} /></SettingRow>)}</div>
    </section>
  );
}

function Page({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › <span className="font-semibold text-foreground">{name}</span></div>
      <div className="mx-auto max-w-[720px] px-4 py-5">{children}</div>
    </div>
  );
}

export function HostPickTopic() {
  const q = new URLSearchParams(location.search);
  const [pos, setPos] = useState<Pos>((q.get("p") as Pos | null) ?? "P1");
  const [host, setHost] = useState("HOST-A");
  const prefix = pos === "P2" ? "正在编辑：" : "主机：";
  const picker = <Picker host={host} setHost={setHost} prefix={prefix} />;
  const adjust = <button className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-xs text-foreground">在主界面调整</button>;
  const btn = (on: boolean) => `rounded-md border px-3 py-1 text-sm ${on ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`;
  return (
    <>
      <div className="my-4 flex flex-wrap gap-2">{(["P1", "P2", "P3"] as Pos[]).map((k) => <button key={k} onClick={() => setPos(k)} className={btn(k === pos)}>{k}</button>)}</div>
      <p className="mb-1 text-sm text-muted">{NOTES[pos]}</p>
      <p className="mb-4 text-xs text-subtle">三页都一样：卡片上的「cutex 后端 · 主机」只显示，不能点；切换只在页头。点页头的主机可以试切换（卡片跟着变）。只有一台主机时页头不出现选择器。</p>
      <div className="space-y-6">
        <Page name="通知（混合设置）">
          <Header pos={pos} hint="自定义各类事件的通知等级，以及不同等级的通知方式。" tags={tagMixed} picker={picker} />
          <Card title="提醒开关" hint="主机决定什么时候提醒；这里可以按方式关掉。" tag={tagLocal(false)} rows={["桌面通知", "声音"]} />
          <Card title="通知方式" hint="调整不同通知等级的通知方式；带锁的格子固定。" tag={tagHost(host)} rows={["（示意）"]} />
        </Page>
        <Page name="输入区（混合：本地桌面应用）">
          <Header pos={pos} hint="怎么发送消息，以及输入框周围的「接下来」面板、「需要你」条和底栏。" tags={tagLocal(true)} picker={picker} right={adjust} />
          <Card title="发送" rows={["处理委托时也能用快捷键插话"]} />
          <Card title="排队顺序" tag={tagHost(host)} rows={["排队消息可以排到委托前面"]} />
        </Page>
        <Page name="运行时（全在主机）">
          <Header pos={pos} hint="每个智能体用启动时的运行时；升级把空闲的换到新版本。" tags={tagHost(host)} picker={picker} />
          <Card title="升级智能体" rows={["（示意）"]} />
        </Page>
      </div>
    </>
  );
}
