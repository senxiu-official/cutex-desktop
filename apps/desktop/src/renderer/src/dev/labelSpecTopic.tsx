// Variants topic 「标签设计」 (owner 2026-10-19): every scope label a settings page or card can carry, in
// Chinese and English, with what its popover says — the ones in use and the proposed ones — before
// any more of them are built. Click a chip for its popover. Terms are shown resolved (智能体 / agents).
import type { ReactNode } from "react";
import { Blocks, Bot, KeyRound, Layers, Monitor, Server, Wrench } from "lucide-react";
import { ScopeChip } from "../components/settings/Form";

type Tone = "plain" | "quiet" | "host" | "agents";
interface Text { label: string; title: string; body: string }
interface Spec { id: string; status: "现有" | "改" | "新" | "提议"; where: "页头" | "卡片" | "页头 / 卡片"; tone: Tone; icon: ReactNode; zh: Text; en: Text; note?: string }

const I = { local: <Monitor size={11} />, host: <Server size={11} />, mixed: <Layers size={11} />, bot: <Bot size={11} />, key: <KeyRound size={11} />, mcp: <Wrench size={11} />, third: <Blocks size={11} /> };

const GROUPS: { title: string; hint: string; rows: Spec[] }[] = [
  {
    title: "① 存在哪里（每页一个；卡片只在和页不同时标）",
    hint: "页头总有一个。卡片上的同类标签只在位置和页面不同时出现。",
    rows: [
      { id: "local", status: "现有", where: "页头 / 卡片", tone: "plain", icon: I.local, zh: { label: "本地桌面应用", title: "本地桌面应用", body: "这些设置只保存在这台设备的桌面应用里，不会同步到其他设备，也不会影响其他设备上的设置。" }, en: { label: "Local desktop app", title: "Local desktop app", body: "These settings are saved in this device's desktop app only. They don't sync to other devices or change the settings there." } },
      { id: "host", status: "现有", where: "页头 / 卡片", tone: "host", icon: I.host, zh: { label: "cutex 后端 · HOST-A", title: "cutex 后端 · HOST-A", body: "存在 HOST-A 后台运行的 cutex 里，智能体就在那里运行；任何设备连上 HOST-A 看到的都是同一份。" }, en: { label: "cutex backend · HOST-A", title: "cutex backend · HOST-A", body: "Saved in the cutex running on HOST-A, where the agents run; every device connected to HOST-A sees the same." }, note: "多台主机时主机部分可点开切换（▾）。" },
      { id: "codex", status: "改", where: "页头 / 卡片", tone: "host", icon: I.host, zh: { label: "Codex 运行时 · HOST-A", title: "Codex 运行时 · HOST-A", body: "存在 HOST-A 上 Codex 运行时自己的配置里（cute-codex，Cutex 维护的 Codex 分支）。Codex 智能体启动时读取，Claude 智能体不读。" }, en: { label: "Codex runtime · HOST-A", title: "Codex runtime · HOST-A", body: "Saved in the Codex runtime's own config on HOST-A (cute-codex, the Codex fork Cutex maintains). Codex agents read it when they start; Claude agents don't." }, note: "原「Codex 设置」。标签只说在哪，不加「设置 / 配置」，和「本地桌面应用」「cutex 后端」一样。" },
      { id: "claude", status: "新", where: "页头 / 卡片", tone: "host", icon: I.host, zh: { label: "Claude Code 运行时 · HOST-A", title: "Claude Code 运行时 · HOST-A", body: "存在 HOST-A 上 Claude Code 运行时自己的设置里（Claude Agent SDK 自带的 Claude Code）。Claude 智能体启动时读取，Codex 智能体不读。" }, en: { label: "Claude Code runtime · HOST-A", title: "Claude Code runtime · HOST-A", body: "Saved in the Claude Code runtime's own settings on HOST-A (the Claude Code bundled with the Claude Agent SDK). Claude agents read it when they start; Codex agents don't." }, note: "给以后 Claude 那几页（读 Claude Code 自己的设置）用。" },
    ],
  },
  {
    title: "② 页面混合时（提议，三选一或组合）",
    hint: "现在：大部分在一处的页面只标那一处（弹窗里加一句「标了其他位置的卡片除外」）；每张卡片都不同的页面（通知）页头不标。",
    rows: [
      { id: "mixed-local", status: "提议", where: "页头", tone: "plain", icon: I.local, zh: { label: "混合：本地桌面应用", title: "主要在本地桌面应用", body: "这一页的设置大多保存在本地桌面应用里；标了其他位置的卡片，以卡片上的标签为准。" }, en: { label: "Mixed: local desktop app", title: "Mostly in the local desktop app", body: "Most settings on this page are saved in the local desktop app; a card tagged with another place follows its own tag." }, note: "用于「输入区」这类：一张主机卡片（排队顺序），其余在本地。" },
      { id: "mixed-host", status: "提议", where: "页头", tone: "host", icon: I.host, zh: { label: "混合：cutex 后端 · HOST-A", title: "主要在 cutex 后端 · HOST-A", body: "这一页的设置大多存在 HOST-A 的 cutex 里；标了其他位置的卡片，以卡片上的标签为准。" }, en: { label: "Mixed: cutex backend · HOST-A", title: "Mostly in the cutex backend · HOST-A", body: "Most settings on this page are saved in the cutex on HOST-A; a card tagged with another place follows its own tag." } },
      { id: "mixed", status: "提议", where: "页头", tone: "plain", icon: I.mixed, zh: { label: "混合设置", title: "混合设置", body: "这一页的设置存在不同的地方，每张卡片上都标了它存在哪里。" }, en: { label: "Mixed settings", title: "Mixed settings", body: "The settings on this page are saved in different places; each card says where." }, note: "用于「通知」这类：每张卡片都有自己的位置标签。替换已删掉的「本设备 + 主机」。" },
    ],
  },
  {
    title: "③ 是否影响智能体（页头一个；卡片只在和页不同时标）",
    hint: "所有页面过完后统一标（owner 2026-10-18）。",
    rows: [
      { id: "none", status: "现有", where: "页头 / 卡片", tone: "quiet", icon: I.bot, zh: { label: "不影响智能体", title: "不影响智能体", body: "这些设置只影响桌面应用的界面和操作方式，不会改变智能体的行为，也不会把相关信息传给智能体。" }, en: { label: "Doesn't affect agents", title: "Doesn't affect agents", body: "These settings only change the desktop app's interface and how you use it. They don't change how agents behave, and nothing is passed on to them." } },
      { id: "next", status: "改", where: "页头 / 卡片", tone: "agents", icon: I.bot, zh: { label: "智能体 · 下次启动生效", title: "智能体下次启动时生效", body: "正在运行的智能体不变；之后新建的智能体，以及重启后的智能体，按新设置运行。" }, en: { label: "Agents · from next start", title: "Applies to agents from their next start", body: "Running agents stay as they are; agents created afterwards, and agents once restarted, use the new settings." }, note: "原「新启动的智能体 / Newly started agents」：「新启动」读起来像只指新建的，其实重启也算。" },
      { id: "now", status: "改", where: "页头 / 卡片", tone: "agents", icon: I.bot, zh: { label: "智能体 · 立即生效", title: "对运行中的智能体立即生效", body: "改动马上作用到正在运行的智能体，不用重启。" }, en: { label: "Agents · takes effect now", title: "Takes effect for running agents now", body: "The change reaches the agents running now, no restart needed." }, note: "原「运行中的智能体 · 立即」。" },
      { id: "access", status: "改", where: "页头 / 卡片", tone: "plain", icon: I.key, zh: { label: "访问权限", title: "访问权限", body: "不改智能体本身，改的是哪些设备、用户和主机能连进来、能做什么。" }, en: { label: "Access", title: "Access", body: "Doesn't change the agents themselves, but which devices, users and hosts can connect and what they may do." }, note: "原「影响访问」。" },
      { id: "agents-mixed", status: "提议", where: "页头", tone: "plain", icon: I.bot, zh: { label: "智能体 · 因卡片而异", title: "对智能体的影响因卡片而异", body: "这一页有的设置影响智能体、有的不影响，每张卡片上都标了。" }, en: { label: "Agents · varies by card", title: "Effect on agents varies by card", body: "Some settings on this page affect agents and some don't; each card says which." }, note: "原提议「智能体：看卡片」。和「混合设置」配对。" },
    ],
  },
  {
    title: "④ 卡片的来历和用途（只在卡片上）",
    hint: "在卡片说明下面那一行，和①③并排。",
    rows: [
      { id: "mcp", status: "改", where: "卡片", tone: "plain", icon: I.mcp, zh: { label: "MCP工具", title: "MCP 工具 · owner_notify", body: "这张卡片是智能体调用的 MCP 工具 owner_notify 的相关设置。智能体用它主动给你发消息，并为消息定一个通知等级。" }, en: { label: "MCP tool", title: "MCP tool · owner_notify", body: "This card holds the settings of the MCP tool owner_notify that agents call. Agents use it to message you and give each message a notification level." }, note: "第一句是模板，第二句由工具提供（可没有）。" },
      { id: "third", status: "新", where: "卡片", tone: "plain", icon: I.third, zh: { label: "第三方模块", title: "第三方模块 · Example Pack", body: "这张卡片的设置由第三方模块 Example Pack 提供，不是 Cutex 官方做的。" }, en: { label: "Third-party module", title: "Third-party module · Example Pack", body: "The settings on this card come from the third-party module Example Pack, not from Cutex." }, note: "不是我们自己做的都算；判断规则到「模块」页再定。" },
    ],
  },
];

function Chip({ s, lang }: { s: Spec; lang: "zh" | "en" }) {
  const x = s[lang];
  const dashed = s.id === "third";
  return (
    <span className={dashed ? "rounded outline-1 outline-dashed outline-border" : undefined}>
      <ScopeChip tone={s.tone} icon={s.icon} label={x.label} title={x.title} body={x.body} />
    </span>
  );
}

const STATUS_TONE: Record<Spec["status"], string> = { 现有: "text-subtle", 改: "text-accent", 新: "text-accent", 提议: "text-warn-text" };

export function LabelSpecTopic() {
  return (
    <div className="my-4 space-y-8">
      <p className="text-sm text-muted">每个标签：中文 / 英文的样子，点开看弹窗。右边是弹窗里的说明。「现有」是正在用的，「改」「新」「提议」待定。另有卡片标题旁的「旧版 / Legacy」小标签（这部分会重做），不在这一套里。</p>
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h2 className="text-sm font-semibold">{g.title}</h2>
          <p className="mb-2 text-xs text-subtle">{g.hint}</p>
          <div className="divide-y divide-border/60 rounded-xl border border-border bg-surface">
            {g.rows.map((s) => (
              <div key={s.id} className="grid grid-cols-[3.5rem_4rem_minmax(0,15rem)_minmax(0,1fr)] items-start gap-3 px-4 py-3 text-xs">
                <span className={STATUS_TONE[s.status]}>{s.status}</span>
                <span className="text-subtle">{s.where}</span>
                <div className="flex flex-col items-start gap-1.5">
                  <Chip s={s} lang="zh" />
                  <Chip s={s} lang="en" />
                </div>
                <div className="space-y-1.5 text-muted">
                  <p><span className="text-foreground">{s.zh.title}</span>：{s.zh.body}</p>
                  <p><span className="text-foreground">{s.en.title}</span>: {s.en.body}</p>
                  {s.note && <p className="text-subtle">注：{s.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
