// Variants topic 「通知页结构」 (owner 2026-10-18): device card first, the long event table last and not
// folded (N1b), or the table as a sub-page (N4); and the wording of the two mappings (L1–L3).
// 单个智能体 and 按项目通知 are hidden for now (sub-pages later). Mock rows only.
import { useState, type ReactNode } from "react";
import { ChevronRight, Lock, Monitor, Server } from "lucide-react";
import { Section, Segmented, Select, SettingRow, Toggle } from "../components/settings/Form";

type Layout = "N1b" | "N4";
type Words = "L0" | "L1" | "L2" | "L3";
const LAYOUTS: Record<Layout, { name: string; note: string }> = {
  N1b: { name: "N1b 长表放最后，不折叠", note: "这台设备 → 每个等级怎么提醒 → 新智能体 / 主人通知 → 最后是 20 类事件全部展开。" },
  N4: { name: "N4 长表做成子页", note: "主页面最后一行是「20 类事件 · 改过 1 项 ›」，点进去是子页「设置 › 通知 › …」，有返回。以后「单个智能体」「按项目通知」也用同一种子页。" },
};
const WORDS: Record<Words, { name: string; note: string; ways: string; waysHint: string; events: string; eventsHint: string; msg: (lv: string) => string; reply: string }> = {
  L0: { name: "L0 现在", note: "「等级 → 通知方式」「事件 → 等级」。智能体消息写成「智能体消息 · 告知」，再映射到等级「记录」：同一组词既是输入又是输出。", ways: "等级 → 通知方式", waysHint: "每个等级用哪些方式；带锁的格子固定。", events: "事件 → 等级", eventsHint: "一件事同时属于几类时取最高的等级。", msg: (lv) => `智能体消息 · ${lv}`, reply: "智能体消息 · 需要回复" },
  L1: { name: "L1 两个问题", note: "两节各是一个问题：「每个等级怎么提醒你」「什么事算哪个等级」。智能体消息写成「智能体说『告知』」，一看就知道左边是智能体的说法、右边是你的规则。", ways: "每个等级怎么提醒你", waysHint: "带锁的格子固定。", events: "什么事算哪个等级", eventsHint: "一件事同时属于几类时，按最高的算。", msg: (lv) => `智能体说「${lv}」`, reply: "智能体要你回复" },
  L2: { name: "L2 轻重", note: "把「等级」叫「轻重」：「按轻重提醒」「每件事有多重」。更口语；但「等级」这个词在铃铛、主人通知里也要跟着改。", ways: "按轻重提醒", waysHint: "每种轻重用哪些方式；带锁的格子固定。", events: "每件事有多重", eventsHint: "一件事同时属于几类时，按最重的算。", msg: (lv) => `智能体标为「${lv}」`, reply: "智能体要你回复" },
  L3: { name: "L3 提醒 / 归类", note: "「提醒方式」「事件归类」：名词短标题，提示句说清楚方向。", ways: "提醒方式", waysHint: "每个等级用哪些方式提醒你；带锁的格子固定。", events: "事件归类", eventsHint: "每类事件算哪个等级；同时属于几类时按最高的算。", msg: (lv) => `智能体标为「${lv}」`, reply: "智能体要你回复" },
};

const tag = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const localTag = <span className={`${tag} bg-surface-2 text-muted`}><Monitor size={11} />本机</span>;
const hostTag = <span className={`${tag} bg-accent/12 text-accent`}><Server size={11} />cutex 后端 · HOST-A</span>;
const LV = ["紧急", "需要你", "告知", "记录"];

function PartHead({ title, hint, chip }: { title: string; hint: string; chip: ReactNode }) {
  return (
    <div className="mt-2 mb-3 border-b border-border/60 pb-2">
      <div className="flex items-center gap-2"><span className="text-[15px] font-semibold">{title}</span>{chip}</div>
      <p className="mt-0.5 text-[13px] text-muted">{hint}</p>
    </div>
  );
}

function DeviceCard() {
  const [d, setD] = useState({ desktop: true, sound: true });
  return (
    <Section title="这台设备收不收" hint="主机决定什么时候提醒；这台设备可以关掉某种方式。" actions={<span className="flex gap-1.5"><button className="rounded-md border border-border px-2 py-0.5 text-xs text-muted">测试通知</button><button className="rounded-md border border-border px-2 py-0.5 text-xs text-muted">测试声音</button></span>}>
      <SettingRow label="系统通知权限" hint="没有允许时，桌面通知不会弹出"><span className="flex items-center gap-2 text-xs"><span className="text-warn-text">需要允许</span><button className="rounded-md border border-border px-2 py-0.5">允许</button></span></SettingRow>
      <SettingRow label="桌面通知"><Toggle checked={d.desktop} onChange={(v) => setD({ ...d, desktop: v })} /></SettingRow>
      <SettingRow label="声音"><Toggle checked={d.sound} onChange={(v) => setD({ ...d, sound: v })} /></SettingRow>
      <SettingRow label="置顶提醒窗" hint="这台设备上不可用"><span className="text-xs text-subtle">不可用</span></SettingRow>
    </Section>
  );
}

const LEVELS = [
  { k: "紧急", h: "必须马上知道", c: [1, 1, 1, 1, 1, 1] },
  { k: "需要你", h: "你不动，事情就停在那里", c: [1, 1, 1, 0, 0, 1] },
  { k: "告知", h: "你发起的事有了结果", c: [0, 1, 1, 1, 0, 0] },
  { k: "记录", h: "其它一切，只在时间线", c: [0, 0, 0, 0, 0, 0] },
];
const COLS = ["计入需要你", "标记", "桌面通知", "声音", "置顶提醒窗", "手机推送"];

function Matrix({ w }: { w: (typeof WORDS)[Words] }) {
  return (
    <Section title={w.ways} hint={w.waysHint} actions={<Segmented value={"custom" as string} onChange={() => {}} options={[{ value: "quiet", label: "安静" }, { value: "rec", label: "推荐" }, { value: "all", label: "全部" }, { value: "custom", label: "自定义" }]} />}>
      <div className="grid grid-cols-[1fr_repeat(6,4.6rem)] items-center gap-y-2 py-3 text-xs">
        <span />
        {COLS.map((c) => <span key={c} className="text-center text-[11px] text-subtle">{c}{c === "手机推送" && <span className="block text-[10px] text-warn-text">未配对</span>}</span>)}
        {LEVELS.map((l) => [
          <span key={l.k}><span className="text-[13px] text-foreground">{l.k}</span><span className="block text-[11px] text-subtle">{l.h}</span></span>,
          ...l.c.map((on, i) => <span key={l.k + i} className="flex justify-center">{i === 0 && l.k !== "告知" ? <Lock size={12} className="text-subtle" /> : <input type="checkbox" defaultChecked={!!on} />}</span>),
        ])}
      </div>
    </Section>
  );
}

const EVENTS = (w: (typeof WORDS)[Words]): [string, [string, string][]][] => [
  ["智能体消息", [[w.msg("告知"), "记录"], [w.msg("需要你"), "告知"], [w.msg("紧急"), "紧急"], [w.reply, "需要你"]]],
  ["Cutex 系统", [["智能体消息被隔离", "记录"], ["委托或结果投递不了", "记录"], ["委托长期无变化", "记录"]]],
  ["审批与提问", [["审批请求", "需要你"], ["智能体提问", "需要你"], ["主人审批", "需要你"]]],
  ["委托", [["委托等主人审阅", "需要你"], ["主人的委托失败", "需要你"], ["委托发送失败", "记录"]]],
  ["消息总线", [["智能体消息发送失败", "记录"]]],
  ["回合", [["主人回合完成", "记录"], ["主人回合失败", "需要你"], ["主人回合被中断", "记录"], ["其它回合完成", "记录"], ["其它回合失败", "记录"]]],
  ["运行时", [["运行时出错", "告知"]]],
  ["作业", [["智能体提交的作业结束", "记录"]]],
];

function EventRows({ w }: { w: (typeof WORDS)[Words] }) {
  return (
    <>
      {EVENTS(w).map(([group, rows]) => (
        <div key={group}>
          <div className="pt-3 pb-1 text-[11px] text-subtle">{group}</div>
          {rows.map(([e, lv]) => (
            <SettingRow key={e} label={e}><Select value={lv} onChange={() => {}} options={LV.map((x) => ({ value: x, label: x }))} /></SettingRow>
          ))}
        </div>
      ))}
    </>
  );
}

function EventsSection({ w }: { w: (typeof WORDS)[Words] }) {
  return (
    <Section title={w.events} hint={w.eventsHint} actions={<Segmented value={"custom" as string} onChange={() => {}} options={[{ value: "rec", label: "推荐" }, { value: "custom", label: "自定义" }]} />}>
      <EventRows w={w} />
    </Section>
  );
}

function OtherHost() {
  return (
    <>
      <Section title="新智能体的提醒" hint="跟标题栏铃铛一样；之后可在铃铛里单独改每个智能体。">
        <SettingRow label="默认级别"><Segmented value={"on" as string} onChange={() => {}} options={[{ value: "off", label: "关" }, { value: "on", label: "开" }, { value: "imp", label: "重要" }]} /></SettingRow>
      </Section>
      <Section title="主人通知" hint="智能体给你发消息时怎么提醒你；智能体只决定级别。">
        <SettingRow label="哪些智能体能用" hint="影响智能体下次启动时的工具列表"><Select value={"d" as string} onChange={() => {}} options={[{ value: "d", label: "项目主管和主人创建的智能体（默认）" }]} /></SettingRow>
        <SettingRow label="每个智能体每小时条数" hint="超过后降为「告知」且不推送"><span className="text-xs">12 条</span></SettingRow>
        <SettingRow label="每小时紧急条数" hint="每个智能体；超过后「紧急」降为「需要你」"><span className="text-xs">3 条</span></SettingRow>
      </Section>
    </>
  );
}

function Page({ crumbs, children }: { crumbs: string[]; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">
        {crumbs.map((c, i) => <span key={c}>{i > 0 && " › "}<span className={i === crumbs.length - 1 ? "font-semibold text-foreground" : ""}>{c}</span></span>)}
      </div>
      <div className="mx-auto max-w-[720px] px-4 py-5">{children}</div>
    </div>
  );
}

export function NotifyTopic() {
  const q = new URLSearchParams(location.search);
  const [v, setV] = useState<Layout>((q.get("n") as Layout | null) ?? "N1b");
  const [words, setWords] = useState<Words>((q.get("w") as Words | null) ?? "L1");
  const [sub, setSub] = useState(q.get("sub") === "1");
  const w = WORDS[words];
  const btn = (on: boolean) => `rounded-md border px-3 py-1 text-sm ${on ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`;
  const head = (
    <>
      <p className="mb-1 text-[13px] text-muted">什么事、用什么方式提醒你：这台设备收不收，和主机上的规则。</p>
      <div className="mb-5 flex gap-1.5 border-b border-border/60 pb-3">{localTag}<span className={`${tag} bg-surface-2 text-muted`}>+</span>{hostTag}</div>
    </>
  );
  return (
    <>
      <div className="my-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-subtle">结构</span>
        {(Object.keys(LAYOUTS) as Layout[]).map((k) => <button key={k} onClick={() => (setV(k), setSub(false))} className={btn(k === v)}>{LAYOUTS[k].name}</button>)}
        <span className="ml-4 text-xs text-subtle">叫法</span>
        {(Object.keys(WORDS) as Words[]).map((k) => <button key={k} onClick={() => setWords(k)} className={btn(k === words)}>{WORDS[k].name}</button>)}
      </div>
      <p className="mb-1 text-sm text-muted">{LAYOUTS[v].note}</p>
      <p className="mb-4 text-sm text-muted">{w.note}</p>
      {v === "N4" && sub ? (
        <Page crumbs={["设置", "通知", w.events]}>
          <button type="button" onClick={() => setSub(false)} className="mb-3 text-[13px] text-accent hover:underline">‹ 返回通知</button>
          <p className="mb-1 text-[13px] text-muted">{w.eventsHint}</p>
          <div className="mb-5 flex gap-1.5 border-b border-border/60 pb-3">{hostTag}</div>
          <Section actions={<Segmented value={"custom" as string} onChange={() => {}} options={[{ value: "rec", label: "推荐" }, { value: "custom", label: "自定义" }]} />} title="预设">
            <EventRows w={w} />
          </Section>
        </Page>
      ) : (
        <Page crumbs={["设置", "通知"]}>
          {head}
          <PartHead title="这台设备" hint="只作用于这台设备。" chip={localTag} />
          <DeviceCard />
          <PartHead title="主机规则" hint="存在主机的 cutex 后端里，连这台主机的每台设备都一样。" chip={hostTag} />
          <Matrix w={w} />
          <OtherHost />
          {v === "N1b" ? (
            <EventsSection w={w} />
          ) : (
            <Section title={w.events} hint={w.eventsHint}>
              <button type="button" onClick={() => setSub(true)} className="flex w-full items-center gap-2 py-3 text-left text-[13px] hover:text-accent">
                20 类事件<span className="text-subtle">· 改过 1 项（主人回合完成）</span>
                <ChevronRight size={14} className="ml-auto" />
              </button>
            </Section>
          )}
        </Page>
      )}
    </>
  );
}
