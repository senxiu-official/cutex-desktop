// Variants topic 「输入区收尾」 (owner 2026-10-18): the 排队顺序 host card's title row (C6) and two long
// row hints. Mock title rows (static picker / chips, no host data); the rows use the real Form parts.
import { useState, type ReactNode } from "react";
import { ChevronDown, LayoutGrid, Server } from "lucide-react";
import { Section, SettingRow, Toggle } from "../components/settings/Form";

type TitleStyle = "Q1" | "Q2" | "Q2a" | "Q2b" | "Q3" | "Q4";
const TITLES: Record<TitleStyle, { name: string; note: string }> = {
  Q1: { name: "Q1 现在", note: "标题 · 主机选择器（图标、圆点、HOST-A · 本机）· cutex 标签，一行里四样东西。" },
  Q2: { name: "Q2 合成一个标签", note: "选择器和 cutex 标签合成一个标签「● HOST-A · cutex ▾」：点它换主机，悬停看说明。只有一台主机时没有 ▾。" },
  Q2a: { name: "Q2a cutex 在前", note: "「cutex · ● HOST-A ▾」：先说存在哪（cutex），再说哪台主机。" },
  Q2b: { name: "Q2b cutex 后端 在前", note: "「cutex 后端 · ● HOST-A ▾」：写明 cutex 是后端，长一点。" },
  Q3: { name: "Q3 放到右端", note: "标题单独在左；右端一行淡字「存在 ● HOST-A 的 cutex ▾」，像卡片的操作按钮那样靠右。" },
  Q4: { name: "Q4 放进卡片", note: "标题行只有标题；卡片第一行是一行小字「主机 ● HOST-A · cutex ▾」，下面是设置。" },
};

const dot = <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden />;
const chip = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";

function TitleRow({ style }: { style: TitleStyle }) {
  const title = <span className="text-[13px] font-semibold">排队顺序</span>;
  if (style === "Q1")
    return (
      <div className="flex items-center gap-2">
        {title}
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted"><LayoutGrid size={12} />{dot}HOST-A · 本机</span>
        <span className={`${chip} bg-accent/12 text-accent`}><Server size={11} />cutex</span>
      </div>
    );
  if (style === "Q2")
    return (
      <div className="flex items-center gap-2">
        {title}
        <button type="button" className={`${chip} bg-accent/12 text-accent hover:bg-accent/20`} title="存在 HOST-A 后台运行的 cutex 里；点这里换主机">
          <Server size={11} />
          {dot}HOST-A · cutex
          <ChevronDown size={11} />
        </button>
      </div>
    );
  if (style === "Q2a" || style === "Q2b")
    return (
      <div className="flex items-center gap-2">
        {title}
        <button type="button" className={`${chip} bg-accent/12 text-accent hover:bg-accent/20`} title="存在 HOST-A 后台运行的 cutex 里；点这里换主机">
          <Server size={11} />
          {style === "Q2a" ? "cutex" : "cutex 后端"}
          <span className="opacity-60">·</span>
          {dot}HOST-A
          <ChevronDown size={11} />
        </button>
      </div>
    );
  if (style === "Q3")
    return (
      <div className="flex items-center gap-2">
        {title}
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-[12px] text-subtle hover:text-foreground">
          存在{dot}HOST-A 的 cutex
          <ChevronDown size={12} />
        </button>
      </div>
    );
  return <div className="flex items-center gap-2">{title}</div>;
}

function QueueOrderCard({ style }: { style: TitleStyle }) {
  return (
    <div className="mb-6">
      <div className="mb-2 px-1">
        <TitleRow style={style} />
      </div>
      <Section>
        {style === "Q4" && (
          <div className="flex items-center gap-1.5 border-b border-border/60 py-2 text-[11px] text-subtle">
            <Server size={11} />
            主机{dot}HOST-A · cutex
            <ChevronDown size={11} />
          </div>
        )}
        <SettingRow label="排队消息可以排到委托前面" hint="在「接下来」面板里拖动你的消息时，可以越过委托和待投递的结果">
          <Toggle checked onChange={() => {}} />
        </SettingRow>
      </Section>
    </div>
  );
}

const STRIP_HINTS = [
  { k: "现在", v: "鼠标移到队列左侧的标记上时显示这一段的名字，拖动时显示松开后会怎样；关闭后只保留提示文字" },
  { k: "T1", v: "鼠标移到队列左侧的标记上，或拖动消息时显示" },
  { k: "T2", v: "移到左侧标记上显示这一段的名字，拖动时显示松开后会怎样" },
];
const STEER_HINTS = [
  { k: "现在", v: "插的话会并进委托这一轮，可能随结果交回委托方；发送菜单里总能选插话" },
  { k: "U1", v: "插话会并进委托这一轮，可能随结果交回委托方" },
  { k: "U2", v: "插话会随委托的结果交回委托方；发送菜单里总能选插话" },
];

function HintChoices({ label, items, on }: { label: string; items: { k: string; v: string }[]; on: boolean }) {
  return (
    <Section title={label}>
      {items.map((x) => (
        <SettingRow key={x.k} label={<span>{label} <span className="ml-1 text-[11px] font-normal text-accent">{x.k}</span></span>} hint={x.v}>
          <Toggle checked={on} onChange={() => {}} />
        </SettingRow>
      ))}
    </Section>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-background px-6 py-5"><div className="mx-auto max-w-[720px]">{children}</div></div>;
}

export function InputLeftoversTopic() {
  const q = new URLSearchParams(location.search);
  const [style, setStyle] = useState<TitleStyle>((q.get("t") as TitleStyle | null) ?? "Q1");
  const btn = (on: boolean) => `rounded-md border px-3 py-1 text-sm ${on ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`;
  return (
    <>
      <h2 className="mt-5 text-sm font-semibold">1. 「排队顺序」标题行（主机卡片）</h2>
      <div className="my-3 flex flex-wrap gap-2">
        {(Object.keys(TITLES) as TitleStyle[]).map((k) => <button key={k} onClick={() => setStyle(k)} className={btn(k === style)}>{TITLES[k].name}</button>)}
      </div>
      <p className="mb-3 text-sm text-muted">{TITLES[style].note}</p>
      <Frame>
        <QueueOrderCard style={style} />
      </Frame>
      <h2 className="mt-8 mb-3 text-sm font-semibold">2. 两条长提示（开关：标签说开了是什么，提示只补标签没说的）</h2>
      <Frame>
        <HintChoices label="悬停时显示分区名" items={STRIP_HINTS} on />
        <HintChoices label="处理委托时也能用快捷键插话" items={STEER_HINTS} on={false} />
      </Frame>
    </>
  );
}
