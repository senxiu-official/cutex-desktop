// Settings design variants (dev preview only: /settings-variants.html on the renderer preview server).
// A few quick options side by side with the real Form components; the owner picks one, then it is
// built into the real page. `?v=A` opens one variant (screenshots), `?theme=light` the light theme.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Bot, Eye, Info, Monitor, RotateCcw, Server } from "lucide-react";
import { I18nProvider, useI18n } from "../i18n";
import { resolveTerms, useTermOverrides } from "../lib/terms";
import { ResetButton, Section, Segmented, Select, SettingRow, TextField, Toggle } from "../components/settings/Form";
import { termLabel, TermsSection } from "../components/settings/TermsSettings";
import { PreviewBand } from "../components/settings/PreviewBand";
import { FontCombo } from "../components/settings/FontCombo";
import { Avatar } from "../components/Avatar";
import { resetTerm, setTerm, TERM_IDS, TERM_MAX, type TermId } from "../lib/terms";
import { InputSplitTopic } from "./inputSplitTopic";
import { InputLeftoversTopic } from "./inputLeftoversTopic";
import { NotifyTopic } from "./notifyTopic";
import { TintTopic } from "./tintTopic";
import { NotifyNamesTopic } from "./notifyNamesTopic";
import { CardTagsTopic } from "./cardTagsTopic";
import { LabelSpecTopic } from "./labelSpecTopic";
import { HostPickTopic } from "./hostPickTopic";
import { LabelRulesTopic } from "./labelRulesTopic";
import { EventGroupsTopic } from "./eventGroupsTopic";
import { ConvTopic } from "./convTopic";
import { ConnTopic } from "./connTopic";
import { OwnerTopic } from "./ownerTopic";
import { HostPageTopic } from "./hostPageTopic";
import { OwnerDevicesTopic } from "./ownerDevicesTopic";
import "../styles.css";

const q = new URLSearchParams(location.search);
document.documentElement.dataset.theme = q.get("theme") === "light" ? "light" : "dark";

/** What a page changes: where it is stored and whether agents feel it (owner 2026-10-18). */
type Scope = { where: "local" | "host"; host?: string; agents: null | string; detail: string; when?: "next" | "now" };

const GENERAL: { title: string; hint: string; scope: Scope } = {
  title: "通用",
  hint: "界面语言、日期与数字格式、界面里的术语，以及关闭窗口时的行为",
  scope: { where: "local", agents: null, detail: "存在这台电脑的桌面端（这个应用）里，换一台电脑不会跟过去；智能体运行在主机的 cutex 里，看不到这些设置" },
};
const DEFAULTS: { title: string; hint: string; scope: Scope } = {
  title: "新建默认",
  hint: "新建智能体和快速启动时预填的 Profile、权限、沙箱和工作目录",
  scope: { where: "host", host: "HOST-A", agents: "新启动的智能体生效", when: "next", detail: "存在 HOST-A 后台运行的 cutex 里，智能体就运行在那里；任何设备连上 HOST-A 看到的都是同一份" },
};
const USAGE: { title: string; hint: string; scope: Scope } = {
  title: "用量",
  hint: "HOST-A 上各 Profile、模型和智能体用了多少额度和 token",
  scope: { where: "host", host: "HOST-A", agents: null, detail: "存在 HOST-A 后台运行的 cutex 里，智能体就运行在那里；任何设备连上 HOST-A 看到的都是同一份" },
};

/** A chip that opens a small floating explanation on click (closes on outside click / Esc). */
function ChipPop({ className, children, title, body }: { className: string; children: ReactNode; title: string; body: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`${className} cursor-pointer hover:brightness-125`}>{children}</button>
      {open && (
        <span role="dialog" className="absolute top-full left-0 z-20 mt-1.5 w-72 rounded-lg border border-border bg-raised p-3 text-xs shadow-lg">
          <span className="mb-1 block font-medium text-foreground">{title}</span>
          <span className="block leading-relaxed text-muted">{body}</span>
        </span>
      )}
    </span>
  );
}

/** Chips of E / F; the agent word follows 术语. */
function ScopeChips({ scope, always }: { scope: Scope; always: boolean }) {
  const { locale } = useI18n();
  const agent = resolveTerms(useTermOverrides(), locale).agent.one;
  const where = scope.where === "local"
    ? <ChipPop className={`${tag} bg-surface-2 text-muted`} title="本机 · 桌面端" body="存在这个应用里，只影响这台电脑；换一台电脑不会跟过去"><Monitor size={11} />本机</ChipPop>
    : <ChipPop className={`${tag} bg-accent/12 text-accent`} title={`主机 ${scope.host} · cutex`} body={`存在 ${scope.host} 后台运行的 cutex 里，${agent}就在那里运行；任何设备连上 ${scope.host} 看到的都是同一份`}><Server size={11} />主机 {scope.host} · cutex</ChipPop>;
  const agents = scope.agents
    ? <ChipPop className={`${tag} bg-warn/15 text-warn-text`} title={`会影响${agent}`} body={`已经在运行的${agent}不变；之后新建或重启的${agent}按新设置启动`}><Bot size={11} />新启动的{agent}</ChipPop>
    : always ? <ChipPop className={`${tag} bg-surface-2 text-subtle`} title={`不影响${agent}`} body={`只改你看到的界面，${agent}收不到也看不到`}><Bot size={11} />不影响{agent}</ChipPop> : null;
  return <div className="flex flex-wrap items-center gap-1.5">{where}{agents}</div>;
}

/** E: chips only, the agent chip only when agents are affected. */
function HeaderE({ hint, scope }: { hint: string; scope: Scope }) {
  return (
    <div className="mb-5 space-y-1.5 border-b border-border/60 pb-3">
      <p className="text-[13px] text-muted">{hint}</p>
      <ScopeChips scope={scope} always={false} />
    </div>
  );
}

/** F: chips only, always two (a muted 「不影响智能体」 when not). */
function HeaderF({ hint, scope }: { hint: string; scope: Scope }) {
  return (
    <div className="mb-5 space-y-1.5 border-b border-border/60 pb-3">
      <p className="text-[13px] text-muted">{hint}</p>
      <ScopeChips scope={scope} always />
    </div>
  );
}

const tag = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const whereTag = (s: Scope) => (s.where === "local" ? <span className={`${tag} bg-surface-2 text-muted`}><Monitor size={11} />本机 · 桌面端</span> : <span className={`${tag} bg-accent/12 text-accent`}><Server size={11} />主机 {s.host} · cutex</span>);
const agentTag = (s: Scope) => (s.agents ? <span className={`${tag} bg-warn/15 text-warn-text`}><Bot size={11} />影响智能体 · {s.agents}</span> : <span className={`${tag} bg-surface-2 text-subtle`}><Bot size={11} />不影响智能体</span>);

function InfoBtn({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" title={text} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex h-5 w-5 items-center justify-center rounded text-subtle hover:text-foreground">
        <Info size={13} />
      </button>
      {open && <span className="basis-full text-xs text-subtle">{text}</span>}
    </>
  );
}

/** A: two labelled tags (存在 / 智能体) under the one-line description. */
function HeaderA({ hint, scope }: { hint: string; scope: Scope }) {
  return (
    <div className="mb-5 space-y-1.5 border-b border-border/60 pb-3">
      <p className="text-[13px] text-muted">{hint}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
        <span className="text-muted">存在</span>{whereTag(scope)}<InfoBtn text={scope.detail} />
        <span className="ml-3 text-muted">智能体</span>{scope.agents ? <span className={`${tag} bg-warn/15 text-warn-text`}>受影响 · {scope.agents}</span> : <span className={`${tag} bg-surface-2 text-subtle`}>不受影响</span>}
      </div>
    </div>
  );
}

/** B: one plain sentence with an icon, no tags. */
function HeaderB({ hint, scope }: { hint: string; scope: Scope }) {
  const Icon = scope.where === "local" ? Monitor : Server;
  const line = scope.where === "local" ? "只影响这台电脑上的界面，智能体看不到" : `影响 ${scope.host} 上的智能体：${scope.agents}`;
  return (
    <div className="mb-5 space-y-1 border-b border-border/60 pb-3">
      <p className="text-[13px] text-muted">{hint}</p>
      <div className={`flex flex-wrap items-center gap-1.5 text-xs ${scope.agents ? "text-warn-text" : "text-subtle"}`}>
        <Icon size={13} />
        <span>{line}</span>
        <InfoBtn text={scope.detail} />
      </div>
    </div>
  );
}

/** C: a small callout box: icon, what it changes in words, then where / when in grey. */
function HeaderC({ hint, scope }: { hint: string; scope: Scope }) {
  const Icon = scope.where === "local" ? Monitor : Server;
  const title = scope.where === "local" ? "只改这台电脑的界面" : `会改变 ${scope.host} 上的智能体`;
  const sub = scope.where === "local" ? "存在桌面端 · 不影响智能体 · 立即生效" : `存在主机的 cutex · ${scope.agents} · 连到 ${scope.host} 的设备都一样`;
  return (
    <div className="mb-5 space-y-3">
      <p className="text-[13px] text-muted">{hint}</p>
      <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${scope.agents ? "border-warn/35 bg-warn/8" : "border-border bg-surface"}`}>
        <Icon size={16} className={`mt-0.5 shrink-0 ${scope.agents ? "text-warn-text" : "text-muted"}`} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1 text-[13px] font-medium">{title}<InfoBtn text={scope.detail} /></div>
          <div className="text-xs text-subtle">{sub}</div>
        </div>
      </div>
    </div>
  );
}

/** D: description left, compact tags right on the same line (densest). */
function HeaderD({ hint, scope }: { hint: string; scope: Scope }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border/60 pb-3">
      <p className="min-w-0 flex-1 text-[13px] text-muted">{hint}</p>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {whereTag(scope)}
        {agentTag(scope)}
        <InfoBtn text={scope.detail} />
      </div>
    </div>
  );
}

const VARIANTS: Record<string, { name: string; note: string; Header: (p: { hint: string; scope: Scope }) => ReactNode }> = {
  A: { name: "A 两个标签", note: "「存在」+「智能体」各一个标签，说明在 ⓘ 里", Header: HeaderA },
  B: { name: "B 一句话", note: "不用标签，一句白话 + 图标；影响智能体时整句变色", Header: HeaderB },
  C: { name: "C 信息框", note: "页头下一个小框：大字说改的是什么，小字说存哪、何时生效；影响智能体的页是暖色框", Header: HeaderC },
  D: { name: "D 右侧徽章", note: "说明在左，两个徽章靠右同一行，最省高度", Header: HeaderD },
  E: { name: "E 只放标签", note: "没有「存在 / 智能体」字样；点标签浮出解释。影响智能体时才多一个暖色「新启动的智能体」（跟随术语）", Header: HeaderE },
  F: { name: "F 总是两个标签", note: "同 E，但不影响时也放一个灰色「不影响智能体」", Header: HeaderF },
};

/** 通用 split into 语言 / 术语 / 窗口; 日期 / 数字格式 are placeholders for dev (not wired). */
function GeneralBody() {
  const [lang, setLang] = useState("zh-CN");
  const [close, setClose] = useState<"tray" | "quit">("tray");
  const soon = <span className={`${tag} bg-surface-2 text-subtle`}>待实现</span>;
  return (
    <>
      <Section title="语言">
        <SettingRow label="界面语言">
          <Select value={lang} options={[{ value: "zh-CN", label: "简体中文" }, { value: "zh-Hant-CN", label: "繁體中文" }, { value: "en", label: "English" }]} onChange={setLang} />
        </SettingRow>
        <SettingRow label={<span className="inline-flex items-center gap-2">日期格式{soon}</span>} hint="时间线、用量和列表里的日期">
          <Select<string> disabled value="auto" options={[{ value: "auto", label: "跟随界面语言（2026-10-18）" }, { value: "dmy", label: "18/10/2026" }, { value: "mdy", label: "10/18/2026" }]} onChange={() => {}} />
        </SettingRow>
        <SettingRow label={<span className="inline-flex items-center gap-2">数字格式{soon}</span>} hint="用量、额度和价格里的数字">
          <Select<string> disabled value="auto" options={[{ value: "auto", label: "跟随界面语言（1,234.5）" }, { value: "eu", label: "1.234,5" }, { value: "space", label: "1 234,5" }]} onChange={() => {}} />
        </SettingRow>
      </Section>
      <TermsSection />
      <Section title="窗口">
        <SettingRow label="关闭窗口时">
          <Segmented value={close} options={[{ value: "tray", label: "最小化到托盘" }, { value: "quit", label: "退出" }]} onChange={setClose} />
        </SettingRow>
      </Section>
    </>
  );
}

// ---- 预览控件 (owner 2026-10-18: one preview control for 字体 and 术语, not a grey last line) ----

type PreviewStyle = "B1" | "B2" | "B3" | "B4" | "B5" | "B6" | "B7" | "B8";

/**
 * The shared preview control, at the bottom of its card and not a box in the box (owner 2026-10-18).
 * B1 card footer: the card's own bottom band, edge to edge. B2 a left rule only. B3 a dotted canvas
 * band. B4 a dashed divider, the sample straight on the card.
 */
function PreviewArea({ style, children, note, control }: { style: PreviewStyle; children: ReactNode; note?: string; control?: ReactNode }) {
  const label = useContext(LabelCtx);
  const live = <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-ok" />实时</span>;
  const tail = (
    <>
      {note && <span className="ml-auto">{note}</span>}
      {control && <span className={note ? "" : "ml-auto"}>{control}</span>}
    </>
  );
  if (style === "B6" && label !== "L0") {
    const band = "-mx-4 -mb-1 mt-1 rounded-b-xl border-t border-border/70 bg-win px-4";
    const dots = { backgroundImage: "radial-gradient(color-mix(in srgb, var(--fg) 13%, transparent) 1px, transparent 1px)", backgroundSize: "12px 12px" };
    const sample = <div className="pointer-events-none select-none" aria-hidden>{children}</div>;
    if (label === "L1")
      return (
        <div className={`${band} pb-3`} style={dots}>
          <div className="-mx-4 mb-3 flex items-center gap-2 border-b border-border/50 bg-win px-4 py-1.5 text-[11px] text-subtle">
            <span className="inline-flex items-center gap-1 font-medium tracking-wider text-muted"><Eye size={12} aria-hidden />预览</span>
            <span>·</span>
            {live}
            {tail}
          </div>
          {sample}
        </div>
      );
    if (label === "L2")
      return (
        <div className={`${band} relative mt-5 pt-4 pb-3`} style={dots}>
          <span className="absolute -top-2.5 left-3 inline-flex items-center gap-1.5 bg-surface px-1.5 text-[11px] text-muted">
            <Eye size={12} aria-hidden />
            <span className="font-medium tracking-wider">预览</span>
            {live}
          </span>
          {control && <span className="absolute top-1.5 right-4 text-[11px] text-subtle">{control}</span>}
          {note && <span className="absolute top-1.5 right-4 text-[11px] text-subtle">{note}</span>}
          <div className="pt-3">{sample}</div>
        </div>
      );
    return (
      <div className={`${band} flex gap-0 py-0`} style={dots}>
        <div className="-ml-4 flex w-14 shrink-0 flex-col items-center justify-center gap-1 border-r border-border/50 bg-win py-3 text-[11px] text-muted">
          <Eye size={13} aria-hidden />
          <span className="font-medium tracking-[0.3em] [writing-mode:vertical-rl]">预览</span>
        </div>
        <div className="min-w-0 flex-1 py-3 pl-4">
          {(control || note) && <div className="mb-2 flex items-center text-[11px] text-subtle">{live}{tail}</div>}
          {sample}
        </div>
      </div>
    );
  }
  const head = (
    <div className="mb-2.5 flex items-center gap-2 text-[11px] text-subtle">
      <span className="inline-flex h-5 items-center gap-1 rounded border border-border bg-surface-2 px-1.5 font-medium tracking-wider text-muted">
        <Eye size={11} aria-hidden />
        预览
      </span>
      <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-ok" />实时</span>
      {note && <span className="ml-auto">{note}</span>}
      {control && <span className={note ? "" : "ml-auto"}>{control}</span>}
    </div>
  );
  switch (style) {
    case "B1":
      return (
        <div className="-mx-4 -mb-1 mt-1 rounded-b-xl border-t border-border/70 bg-background/70 px-4 py-3">
          {head}
          {children}
        </div>
      );
    case "B2":
      return (
        <div className="my-3 border-l-2 border-accent/60 pl-3">
          {head}
          {children}
        </div>
      );
    case "B3":
      return (
        <div
          className="-mx-4 -mb-1 mt-1 rounded-b-xl border-t border-border/70 px-4 py-3"
          style={{ backgroundImage: "radial-gradient(color-mix(in srgb, var(--fg) 13%, transparent) 1px, transparent 1px)", backgroundSize: "12px 12px" }}
        >
          {head}
          {children}
        </div>
      );
    case "B5":
    case "B6":
      return (
        <div
          className={`-mx-4 -mb-1 mt-1 rounded-b-xl border-t border-border/70 px-4 py-3 ${style === "B5" ? "bg-background/70" : "bg-win"}`}
          style={{ backgroundImage: "radial-gradient(color-mix(in srgb, var(--fg) 13%, transparent) 1px, transparent 1px)", backgroundSize: "12px 12px" }}
        >
          {head}
          {children}
        </div>
      );
    case "B7":
    case "B8":
      // A square frame instead of (B7) or on top of (B8) the dark band: no rounded box inside the rounded card.
      return (
        <div
          className={`mt-2 mb-3 border border-border px-3 py-3 ${style === "B8" ? "bg-win" : ""}`}
          style={{ backgroundImage: "radial-gradient(color-mix(in srgb, var(--fg) 13%, transparent) 1px, transparent 1px)", backgroundSize: "12px 12px" }}
        >
          {head}
          {children}
        </div>
      );
    default:
      return (
        <div className="mt-1 border-t border-dashed border-border py-3">
          {head}
          {children}
        </div>
      );
  }
}

/** A term inside the sample, marked so you see which words your settings change. */
/** How the 「预览」 label looks (owner: a box like the sample's button reads as part of the sample). */
type LabelStyle = "L0" | "L1" | "L2" | "L3";
const LabelCtx = createContext<LabelStyle>("L1");
const LABELS: Record<LabelStyle, { name: string; note: string }> = {
  L0: { name: "L0 现在（小方块）", note: "对照：和样张里的按钮长得像" },
  L1: { name: "L1 文字 + 分隔线", note: "不用方块：小字「预览 · 实时」，下面一条细线把标签和样张隔开" },
  L2: { name: "L2 边上的标签", note: "标签贴在预览区上边线的左端，像表单分组的标题（fieldset legend）" },
  L3: { name: "L3 左侧标签栏", note: "预览区左边留一窄栏竖着放「预览」，一条竖线隔开，样张在右" },
};

/** Which terms the preview marks: all (the 「标出术语」 switch) or the one whose row is hovered / focused. */
type MarkStyle = "M1" | "M2" | "M3";
const MARKS: Record<MarkStyle, { name: string; cls: string }> = {
  M1: { name: "M1 细框", cls: "rounded-sm outline outline-1 outline-offset-1 outline-accent/80" },
  M2: { name: "M2 蓝字 + 虚下划线", cls: "text-accent underline decoration-accent/60 decoration-dotted underline-offset-4" },
  M3: { name: "M3 蓝字", cls: "text-accent" },
};
const MarkCtx = createContext<{ all: boolean; focus: TermId | null; setFocus(id: TermId | null): void; style: MarkStyle }>({ all: false, focus: null, setFocus: () => {}, style: "M1" });

/** A term in the sample: plain (the real look) unless marked; the mark is a highlighter, the text keeps its own colour. */
function T({ id, children }: { id: TermId; children: ReactNode }) {
  const { all, focus, style } = useContext(MarkCtx);
  const on = all || focus === id;
  return <span data-term={id} className={`transition-colors duration-200 ${on ? MARKS[style].cls : ""}`}>{children}</span>;
}

/** The 术语 sample as small pieces of the real UI (button, status, badge, chips), not one sentence. */
function TermsSample() {
  const { locale } = useI18n();
  const w = resolveTerms(useTermOverrides(), locale);
  const pill = "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs";
  return (
    // One line of equal items that just flows (owner: no columns, no groups); what does not fit wraps.
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-[13px]">
      <span className={`${pill} border border-border bg-surface`}><span>＋ 新建<T id="agent">{w.agent.one}</T></span></span>
      <span className="text-xs text-muted">3 个<T id="agent">{w.agent.many}</T>在线</span>
      <span className="inline-flex items-center gap-1.5">
        <Avatar name="Eva" seed="Eva" size={20} />
        <span className="font-medium">Eva</span>
        <span className="rounded bg-surface-2 px-1 text-[11px] text-muted"><T id="director">{w.director.one}</T></span>
      </span>
      <span className="text-xs text-muted">2 个<T id="subagent">{w.subagent.many}</T>工作中</span>
      <span className="text-xs text-muted">汇报给<T id="parentagent">{w.parentagent.one}</T></span>
      <span className={`${pill} bg-warn/15 text-warn-text`}><span>等<T id="owner">{w.owner.one}</T>批准</span></span>
    </div>
  );
}

/** The 术语 rows (real store: typing here renames for real in this browser preview). */
function TermRowsDemo() {
  const { locale } = useI18n();
  const mark = useContext(MarkCtx);
  const overrides = useTermOverrides();
  // Rows in their own box: the last one draws no rule, the preview band is the only divider.
  return (
    <div>
      {TERM_IDS.map((id: TermId) => (
        <div key={id} className="border-b border-border/60 last:border-b-0" onMouseEnter={() => mark.setFocus(id)} onMouseLeave={() => mark.setFocus(null)} onFocusCapture={() => mark.setFocus(id)} onBlurCapture={() => mark.setFocus(null)}>
        <SettingRow label={termLabel(locale, id)} reset={<ResetButton disabled={!overrides[locale]?.[id]?.one} onClick={() => resetTerm(locale, id)} />}>
          <TextField value={overrides[locale]?.[id]?.one ?? ""} placeholder={resolveTerms(overrides, locale)[id].one} maxLength={TERM_MAX} width="w-32" onCommit={(v) => setTerm(locale, id, "one", v)} />
        </SettingRow>
        </div>
      ))}
    </div>
  );
}

const PREVIEWS: Record<PreviewStyle, { name: string; note: string }> = {
  B1: { name: "B1 卡片底栏", note: "预览就是卡片自己的底部一栏：通栏、颜色深一点、上面一条分隔线，没有第二层框" },
  B2: { name: "B2 左侧竖线", note: "不加背景也不加框，只在左边画一条竖线，像引用块" },
  B3: { name: "B3 点阵画布", note: "同 B1 通栏到底，但底色换成设计工具那种点阵，读起来就是「这是样张」" },
  B4: { name: "B4 虚线分隔", note: "最轻：一条虚线隔开，样张直接放在卡片上" },
  B5: { name: "B5 深底 + 点阵", note: "B1 的深底色，再加 B3 的点阵" },
  B6: { name: "B6 更深 + 点阵", note: "用窗口最深的底色（和设置页外框同色）再加点阵，对比最强" },
  B7: { name: "B7 方框 + 点阵", note: "不用深底色，改成一个直角细框（不是圆角小盒子），框里点阵" },
  B8: { name: "B8 深底 + 方框", note: "B6 的深底色和点阵，外面再加直角细框，不通栏" },
};

/** The same control around the font sample (static text here), to see the two previews match. */
function FontsCard({ style }: { style: PreviewStyle }) {
  return (
    <Section title="字体（同一个预览控件）" hint="外观页的字体预览换成同一个控件后的样子">
      <div>
        <SettingRow label="界面字体"><Select value="a" options={[{ value: "a", label: "Segoe UI" }]} onChange={() => {}} /></SettingRow>
        <SettingRow label="对话字体"><Select value="a" options={[{ value: "a", label: "跟随界面字体" }]} onChange={() => {}} /></SettingRow>
      </div>
      <PreviewArea style={style} note="界面 · 对话 · 代码">
        <div className="flex flex-col gap-2">
          <p className="text-[13px]">你好 Hello こんにちは 안녕하세요</p>
          <p className="font-chat-context leading-relaxed">他说：“run job’s task。” She said, “中文。”</p>
          <p className="font-mono text-xs">const 中文 = "job’s"; // 0O 1lI</p>
        </div>
      </PreviewArea>
    </Section>
  );
}

function PreviewTopic() {
  const [p, setP] = useState<PreviewStyle>(((q.get("p") as PreviewStyle | null) ?? "B6") in PREVIEWS ? ((q.get("p") as PreviewStyle | null) ?? "B6") : "B6");
  const P = PREVIEWS[p];
  const [markAll, setMarkAll] = useState(q.has("markAll"));
  const [label, setLabel] = useState<LabelStyle>((q.get("l") as LabelStyle | null) ?? "L1");
  const [mark, setMark] = useState<MarkStyle>((q.get("m") as MarkStyle | null) ?? "M1");
  const [focus, setFocus] = useState<TermId | null>(null);
  return (
    <>
      <div className="my-4 flex flex-wrap gap-2">
        {(Object.keys(PREVIEWS) as PreviewStyle[]).map((k) => (
          <button key={k} onClick={() => setP(k)} className={`rounded-md border px-3 py-1 text-sm ${k === p ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`}>{PREVIEWS[k].name}</button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-subtle">「预览」标签：</span>
        {(Object.keys(LABELS) as LabelStyle[]).map((k) => (
          <button key={k} onClick={() => setLabel(k)} className={`rounded-md border px-2.5 py-0.5 ${k === label ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`}>{LABELS[k].name}</button>
        ))}
        <span className="text-xs text-subtle">{LABELS[label].note}（只在 B6 上）</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-subtle">标出术语的样子：</span>
        {(Object.keys(MARKS) as MarkStyle[]).map((k) => (
          <button key={k} onClick={() => setMark(k)} className={`rounded-md border px-2.5 py-0.5 ${k === mark ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`}>{MARKS[k].name}</button>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted">{P.note}。预览平时是真实的样子：鼠标移到某一行（或点进输入框），预览里对应的词会亮起；打开「标出术语」一次看全部。</p>
      <LabelCtx value={label}>
      <div className="space-y-6">
        <Page title="通用">
          <Section title="术语" hint="界面里这几种角色叫什么，比如把「智能体」改成「助手」">
            <MarkCtx value={{ all: markAll, focus, setFocus, style: mark }}>
              <TermRowsDemo />
              <PreviewArea
                style={p}
                control={
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    标出术语
                    <Toggle label="标出术语" checked={markAll} onChange={setMarkAll} />
                  </label>
                }
              >
                <TermsSample />
              </PreviewArea>
            </MarkCtx>
          </Section>
        </Page>
        <Page title="外观"><FontsCard style={p} /></Page>
      </div>
      </LabelCtx>
    </>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › <span className="font-semibold text-foreground">{title}</span></div>
      <div className="mx-auto max-w-[720px] px-4 py-5">{children}</div>
    </div>
  );
}

// ---- 恢复默认 (owner 2026-10-18: every card keeps the narrow right edge; the reset leaves the control
// column: a mark shows what was changed, the reset sits outside the control or floats) ----

type ResetStyle = "R1" | "R2" | "R3";
const RESETS: Record<ResetStyle, { name: string; note: string }> = {
  R1: { name: "R1 标签旁的点 + ↺", note: "改过的设置在标签前有一个蓝点，↺ 紧跟在标签后面（只在改过时出现），控件不动" },
  R2: { name: "R2 左侧竖条 + 悬停 ↺", note: "改过的行在卡片左边缘有一条蓝色竖条（像 VS Code 设置）；鼠标移到这一行，标签后浮出「↺ 恢复默认」" },
  R3: { name: "R3 控件描边 + 悬停 ↺", note: "改过的控件边框变成蓝色；鼠标移到这一行，↺ 浮在控件左边（叠在空白上，不占位置）" },
};

type BarHeight = "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "H7";
const BARS: Record<BarHeight, string> = { H1: "H1 整行", H2: "H2 上下各缩一点", H3: "H3 跟文字对齐", H4: "H4 固定短条", H5: "H5 跟文字，上下再缩", H6: "H6 短条，竖直居中", H7: "H7 小菱形，嵌在卡片框线上" };

type DemoRow = { id: string; label: string; hint?: string; kind: "seg" | "select" | "num" | "toggle"; options?: string[]; def: string | number | boolean };
const DEMO_ROWS: DemoRow[] = [
  { id: "theme", label: "主题", kind: "seg", options: ["跟随系统", "浅色", "深色"], def: "跟随系统" },
  { id: "zoom", label: "界面缩放", hint: "整个窗口一起缩放", kind: "num", def: 100 },
  { id: "font", label: "界面字体", hint: "侧栏、菜单、设置等界面文字", kind: "select", options: ["默认", "Segoe UI", "Inter"], def: "默认" },
  { id: "fold", label: "自动折叠长消息", kind: "toggle", def: true },
  { id: "density", label: "密度", kind: "seg", options: ["紧凑", "标准", "宽松"], def: "标准" },
];

type MarkShape = "diamond" | "triangle" | "inset";
const SHAPES: Record<MarkShape, string> = { diamond: "菱形（压在框线正中）", triangle: "三角（框线外的一半裁掉）", inset: "菱形向内移（只露一点在框外）" };

/** The 「改过」 mark on the card border (x = -16.5px from the row: the border line). s = the square's side. */
function BorderMark({ shape, size: s, outside }: { shape: MarkShape; size: number; outside: number }) {
  const d = s * Math.SQRT2; // the diamond's width / height once rotated
  const halo = `0 0 0 ${Math.max(1, s / 4)}px var(--surface)`;
  if (shape === "triangle")
    // The diamond's inner half: a right-pointing triangle whose base lies on the border.
    return <span className="absolute top-1/2 -translate-y-1/2 bg-accent" style={{ left: -17, width: d / 2 + 0.5, height: d, clipPath: "polygon(0 0, 100% 50%, 0 100%)" }} />;
  // inset: the diamond's centre moves inward so only `outside` of its width stays outside the border.
  const centre = shape === "inset" ? -16.5 + d / 2 - outside * d : -16.5;
  return <span className="absolute top-1/2 -translate-y-1/2 rotate-45 rounded-[1px] bg-accent" style={{ width: s, height: s, left: centre - s / 2, boxShadow: halo }} />;
}

function ResetDemo({ style, bar, size = 5, shape = "diamond", outside = 0.2 }: { style: ResetStyle; bar: BarHeight; size?: number; shape?: MarkShape; outside?: number }) {
  const [vals, setVals] = useState<Record<string, string | number | boolean>>({ zoom: 110, font: "Inter", fold: false });
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const value = (r: DemoRow) => (r.id in vals ? vals[r.id]! : r.def);
  const changed = (r: DemoRow) => value(r) !== r.def;
  const set = (r: DemoRow, v: string | number | boolean) => setVals((o) => ({ ...o, [r.id]: v }));
  const reset = (r: DemoRow) => setVals((o) => { const n = { ...o }; delete n[r.id]; return n; });
  const rows = DEMO_ROWS.filter((r) => !onlyChanged || changed(r));
  const nChanged = DEMO_ROWS.filter(changed).length;
  const resetBtn = (r: DemoRow, text = false) => (
    <button type="button" title="恢复默认" onClick={() => reset(r)} className="inline-flex items-center gap-1 rounded px-1 text-[11px] text-subtle hover:bg-surface-2 hover:text-foreground">
      <RotateCcw size={12} />
      {text && "恢复默认"}
    </button>
  );
  const control = (r: DemoRow) => {
    const ring = style === "R3" && changed(r) ? "rounded-md ring-1 ring-accent" : "";
    const el =
      r.kind === "seg" ? <Segmented value={String(value(r))} options={r.options!.map((o) => ({ value: o, label: o }))} onChange={(v) => set(r, v)} />
      : r.kind === "select" ? <Select<string> value={String(value(r))} options={r.options!.map((o) => ({ value: o, label: o }))} onChange={(v) => set(r, v)} />
      : r.kind === "num" ? <TextField value={String(value(r))} width="w-20" onCommit={(v) => set(r, Number(v) || 100)} />
      : <Toggle checked={Boolean(value(r))} onChange={(v) => set(r, v)} />;
    return <span className={`inline-flex ${ring}`}>{el}</span>;
  };
  return (
    <div className="mb-6">
      <div className="mb-2 flex h-7 items-center gap-2">
        <h3 className="text-sm font-semibold">整体</h3>
        {/* Per card, only while something in it was changed (owner 2026-10-18). */}
        {(nChanged > 0 || onlyChanged) && (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            只看你修改过的设置（{nChanged}）
            <Toggle label="只看你修改过的设置" checked={onlyChanged} onChange={setOnlyChanged} />
          </label>
        )}
      </div>
      {/* No reset column: the right edge is as narrow as the left (px-4 both sides). */}
      <div className="rounded-xl border border-card-border bg-surface px-4 py-1">
        {rows.length === 0 && <p className="py-3 text-xs text-subtle">你没有修改过这些设置</p>}
        {rows.map((r) => (
          <div key={r.id} onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)} className="relative flex items-center gap-3 border-b border-border/60 py-3 last:border-b-0">
            {style === "R2" && changed(r) && bar === "H1" && <span className="absolute inset-y-0 -left-4 w-0.5 bg-accent" />}
            {style === "R2" && changed(r) && bar === "H2" && <span className="absolute top-2 bottom-2 -left-4 w-0.5 rounded-r bg-accent" />}
            {style === "R2" && changed(r) && bar === "H7" && <BorderMark shape={shape} size={size} outside={outside} />}
            {style === "R2" && changed(r) && bar === "H6" && <span className="absolute top-1/2 -left-4 h-4 w-0.5 -translate-y-1/2 rounded-r bg-accent" />}
            <div className="relative min-w-0 flex-1">
              {style === "R2" && changed(r) && bar === "H3" && <span className="absolute inset-y-0 -left-4 w-0.5 rounded-r bg-accent" />}
              {style === "R2" && changed(r) && bar === "H4" && <span className="absolute top-[3px] -left-4 h-3.5 w-0.5 rounded-r bg-accent" />}
              {style === "R2" && changed(r) && bar === "H5" && <span className="absolute inset-y-1 -left-4 w-0.5 rounded-r bg-accent" />}
              <div className="flex items-center gap-1.5 text-sm">
                {style === "R1" && changed(r) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="已修改" />}
                {r.label}
                {style === "R1" && changed(r) && resetBtn(r)}
                {style === "R2" && changed(r) && hover === r.id && resetBtn(r, true)}
              </div>
              {r.hint && <div className="text-xs text-subtle">{r.hint}</div>}
            </div>
            <div className="relative flex shrink-0 items-center">
              {style === "R3" && changed(r) && hover === r.id && <span className="absolute top-1/2 right-full mr-1.5 -translate-y-1/2">{resetBtn(r)}</span>}
              {control(r)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResetTopic() {
  const [r, setR] = useState<ResetStyle>((q.get("r") as ResetStyle | null) ?? "R2");
  const [bar, setBar] = useState<BarHeight>((q.get("bar") as BarHeight | null) ?? "H7");
  const [size, setSize] = useState(Number(q.get("size") ?? 5));
  const [shape, setShape] = useState<MarkShape>((q.get("shape") as MarkShape | null) ?? "triangle");
  const [outside, setOutside] = useState(Number(q.get("outside") ?? 0.2));
  return (
    <>
      <div className="my-4 flex flex-wrap gap-2">
        {(Object.keys(RESETS) as ResetStyle[]).map((k) => (
          <button key={k} onClick={() => setR(k)} className={`rounded-md border px-3 py-1 text-sm ${k === r ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`}>{RESETS[k].name}</button>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted">{RESETS[r].note}。示例里「界面缩放」「界面字体」「自动折叠长消息」是改过的（后两行相邻）；改一下别的试试，右上角「只看改过的」可以只留改过的行。</p>
      {r === "R2" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-subtle">竖条高度：</span>
          {(Object.keys(BARS) as BarHeight[]).map((k) => (
            <button key={k} onClick={() => setBar(k)} className={`rounded-md border px-2.5 py-0.5 ${k === bar ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`}>{BARS[k]}</button>
          ))}
        </div>
      )}
      {r === "R2" && bar === "H7" && (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <span className="text-subtle">菱形大小：</span>
          <input type="range" min={3} max={10} step={0.5} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-56 accent-[var(--accent)]" />
          <span className="w-12 font-mono text-xs tabular-nums text-muted">{size}px</span>
          {[4, 5, 6].map((n) => (
            <button key={n} onClick={() => setSize(n)} className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground">{n}px</button>
          ))}
        </div>
      )}
      {r === "R2" && bar === "H7" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-subtle">形状：</span>
          {(Object.keys(SHAPES) as MarkShape[]).map((k) => (
            <button key={k} onClick={() => setShape(k)} className={`rounded-md border px-2.5 py-0.5 ${k === shape ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`}>{SHAPES[k]}</button>
          ))}
          {shape === "inset" && (
            <>
              <span className="ml-3 text-subtle">露在框外：</span>
              <input type="range" min={0} max={0.5} step={0.05} value={outside} onChange={(e) => setOutside(Number(e.target.value))} className="w-40" />
              <span className="font-mono text-xs text-muted">{Math.round(outside * 100)}%</span>
            </>
          )}
        </div>
      )}
      <Page title="外观（示例）"><ResetDemo key={r} style={r} bar={bar} size={size} shape={shape} outside={outside} /></Page>
    </>
  );
}

// ---- 外观 → 字体 (page 2): 7 rows told apart only by 「界面 · 非 CJK」 etc. ----

type FontLayout = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";
const FONT_LAYOUTS: Record<FontLayout, { name: string; note: string }> = {
  F1: { name: "F1 三行，每行两个下拉", note: "界面 / 对话正文 / 代码 各一行；每行「西文 + 中文」两个下拉，字号跟在后面" },
  F2: { name: "F2 三组小标题", note: "仍是一行一项，但分成「界面 / 对话正文 / 代码」三组，组内只写「西文 / 中文 / 字号」" },
  F3: { name: "F3 表格", note: "列是「西文 / 中文 / 字号」，行是「界面 / 对话正文 / 代码」，像一张对照表" },
  F6: { name: "F6 = F5 去掉小标题", note: "一张卡，不要分组小标题：标签写全「界面 · 中文字体」等，中文（CJK）在前，预览栏把三节隔开" },
  F5: { name: "F5 一张卡，三段预览", note: "还是一张「字体」卡：界面 → 预览 → 对话正文 → 预览 → 代码 → 预览，依次往下" },
  F4: { name: "F4 = F2 拆成三张卡", note: "界面字体 / 对话字体 / 代码字体 各一张卡，各自底部只预览自己的那一段" },
};
const LATIN_FONTS = ["默认", "Segoe UI", "Inter", "Helvetica Neue"];
const CJK_FONTS = ["默认", "微软雅黑", "思源黑体", "KingHwa_OldSong"];
const MONO_FONTS = ["默认", "Cascadia Code", "JetBrains Mono", "Consolas"];

function FontPick({ fonts, follow, width = "w-36" }: { fonts: string[]; follow?: string; width?: string }) {
  const opts = [...(follow ? [follow] : []), ...fonts];
  const [v, setV] = useState(opts[0]!);
  return <Select<string> width={width} value={v} options={opts.map((o) => ({ value: o, label: o }))} onChange={setV} />;
}
function Px({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <TextField value={String(value)} width="w-14" onCommit={() => {}} />
      <span className="text-xs text-subtle">px</span>
    </span>
  );
}
function FontSample() {
  return (
    <PreviewBand note="界面 · 对话 · 代码">
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px]">Le Café de Cutex 的留言板上，写着各种欢迎：欢迎 · Hello · G'day · こんにちは。</p>
        <p className="font-chat-context leading-relaxed">“To be, or not to be.” 有人用另一种笔迹在下面答道。</p>
        <p className="font-mono text-xs">const xs = arr.map((v) =&gt; v * 2); // 0O 1lI</p>
      </div>
    </PreviewBand>
  );
}
const colHead = "text-[11px] text-subtle";

function FontBand({ children, inline }: { children: ReactNode; inline?: boolean }) {
  return <PreviewBand inline={inline}>{children}</PreviewBand>;
}
const UI_SAMPLE = <p className="text-[13px]">Le Café de Cutex 的留言板上，写着各种欢迎：欢迎 · 歡迎 · Hello · G’day · Привет · Bonjour · こんにちは。</p>;
const CHAT_SAMPLE = (
  <div className="font-chat-context space-y-0.5 leading-relaxed">
    <p>“To be, or not to be: that is the question.” Someone had scribbled it in a corner.</p>
    <p>“仰观宇宙之大，俯察品类之盛。” 有人用另一种笔迹在下面答道。</p>
    <p>“Is ‘仰观宇宙之大’ your answer to Shakespeare?” the first writer asked.</p>
  </div>
);
const CODE_SAMPLE = <p className="font-mono text-xs">const xs = arr.map((v) =&gt; v * 2); // 0O 1lI {"{} [] != ==="} 中文注释</p>;

function FontsVariant({ layout }: { layout: FontLayout }) {
  if (layout === "F6")
    return (
      <Section title="字体" hint="只能用这台设备已安装的字体；未安装的会回退到默认字体。">
        <div>
          <SettingRow label="界面 · 中文字体" hint="汉字，也用于日文假名、韩文（CJK）"><FontPick fonts={CJK_FONTS} /></SettingRow>
          <SettingRow label="界面 · 西文字体" hint="拉丁等字母、数字和符号（Non-CJK）"><FontPick fonts={LATIN_FONTS} /></SettingRow>
        </div>
        <FontBand inline>{UI_SAMPLE}</FontBand>
        <div>
          <SettingRow label="对话 · 中文字体"><FontPick fonts={CJK_FONTS} follow="跟随界面" /></SettingRow>
          <SettingRow label="对话 · 西文字体"><FontPick fonts={LATIN_FONTS} follow="跟随界面" /></SettingRow>
          <SettingRow label="对话 · 字号"><Px value={14} /></SettingRow>
        </div>
        <FontBand inline>{CHAT_SAMPLE}</FontBand>
        <div>
          <SettingRow label="代码 · 中文字体" hint="暂时只能跟随界面"><FontPick fonts={[]} follow="跟随界面" /></SettingRow>
          <SettingRow label="代码 · 西文字体"><FontPick fonts={MONO_FONTS} /></SettingRow>
          <SettingRow label="代码 · 字号"><Px value={13} /></SettingRow>
        </div>
        <FontBand>{CODE_SAMPLE}</FontBand>
      </Section>
    );
  if (layout === "F5") {
    const group = (title: string, first = false) => <div className={`-mx-4 ${first ? "" : "mt-0"} px-4 pt-3 pb-1 text-xs font-medium text-muted`}>{title}</div>;
    return (
      <Section title="字体" hint="只能用这台设备已安装的字体；未安装的会回退到默认字体。">
        {group("界面", true)}
        <div>
          <SettingRow label="西文" hint="拉丁等字母、数字和符号（Non-CJK）"><FontPick fonts={LATIN_FONTS} /></SettingRow>
          <SettingRow label="中文" hint="汉字，也用于日文假名、韩文（CJK）"><FontPick fonts={CJK_FONTS} /></SettingRow>
        </div>
        <FontBand inline>{UI_SAMPLE}</FontBand>
        {group("对话正文")}
        <div>
          <SettingRow label="西文"><FontPick fonts={LATIN_FONTS} follow="跟随界面" /></SettingRow>
          <SettingRow label="中文"><FontPick fonts={CJK_FONTS} follow="跟随界面" /></SettingRow>
          <SettingRow label="字号"><Px value={14} /></SettingRow>
        </div>
        <FontBand inline>{CHAT_SAMPLE}</FontBand>
        {group("代码")}
        <div>
          <SettingRow label="西文"><FontPick fonts={MONO_FONTS} /></SettingRow>
          <SettingRow label="中文" hint="暂时只能跟随界面"><FontPick fonts={[]} follow="跟随界面" /></SettingRow>
          <SettingRow label="字号"><Px value={13} /></SettingRow>
        </div>
        <FontBand>{CODE_SAMPLE}</FontBand>
      </Section>
    );
  }
  if (layout === "F4")
    return (
      <>
        <Section title="界面字体" hint="侧栏、菜单、设置等界面文字；只能用这台设备已安装的字体。">
          <div>
            <SettingRow label="西文" hint="拉丁等字母、数字和符号（Non-CJK）"><FontPick fonts={LATIN_FONTS} /></SettingRow>
            <SettingRow label="中文" hint="汉字，也用于日文假名、韩文（CJK）"><FontPick fonts={CJK_FONTS} /></SettingRow>
          </div>
          <FontBand><p className="text-[13px]">Le Café de Cutex 的留言板上，写着各种欢迎：欢迎 · 歡迎 · Hello · G’day · Привет · Bonjour · こんにちは。</p></FontBand>
        </Section>
        <Section title="对话字体" hint="消息和回复的正文；默认跟随界面。">
          <div>
            <SettingRow label="西文"><FontPick fonts={LATIN_FONTS} follow="跟随界面" /></SettingRow>
            <SettingRow label="中文"><FontPick fonts={CJK_FONTS} follow="跟随界面" /></SettingRow>
            <SettingRow label="字号"><Px value={14} /></SettingRow>
          </div>
          <FontBand>
            <div className="font-chat-context space-y-0.5 leading-relaxed">
              <p>“To be, or not to be: that is the question.” Someone had scribbled it in a corner.</p>
              <p>“仰观宇宙之大，俯察品类之盛。” 有人用另一种笔迹在下面答道。</p>
              <p>“Is ‘仰观宇宙之大’ your answer to Shakespeare?” the first writer asked.</p>
            </div>
          </FontBand>
        </Section>
        <Section title="代码字体" hint="代码块、命令、工具输出和终端。">
          <div>
            <SettingRow label="西文"><FontPick fonts={MONO_FONTS} /></SettingRow>
            <SettingRow label="中文" hint="暂时只能跟随界面"><FontPick fonts={[]} follow="跟随界面" /></SettingRow>
            <SettingRow label="字号"><Px value={13} /></SettingRow>
          </div>
          <FontBand><p className="font-mono text-xs">const xs = arr.map((v) =&gt; v * 2); // 0O 1lI {"{} [] != ==="} 中文注释</p></FontBand>
        </Section>
      </>
    );
  if (layout === "F1")
    return (
      <Section title="字体" hint="只能用这台设备已安装的字体；未安装的会回退到默认字体。">
        <div>
          <SettingRow label="界面" hint="侧栏、菜单、设置等界面文字">
            <FontPick fonts={LATIN_FONTS} width="w-32" />
            <FontPick fonts={CJK_FONTS} width="w-32" />
            <span className="w-[4.75rem]" />
          </SettingRow>
          <SettingRow label="对话正文" hint="消息和回复正文；默认跟随界面">
            <FontPick fonts={LATIN_FONTS} follow="跟随界面" width="w-32" />
            <FontPick fonts={CJK_FONTS} follow="跟随界面" width="w-32" />
            <Px value={14} />
          </SettingRow>
          <SettingRow label="代码" hint="代码块、命令、工具输出和终端">
            <FontPick fonts={MONO_FONTS} width="w-32" />
            <span className="w-32" />
            <Px value={13} />
          </SettingRow>
        </div>
        <FontSample />
      </Section>
    );
  if (layout === "F2") {
    const group = (title: string) => <div className="-mx-4 border-b border-border/60 bg-surface-2/40 px-4 py-1.5 text-xs font-medium text-muted">{title}</div>;
    return (
      <Section title="字体" hint="只能用这台设备已安装的字体；未安装的会回退到默认字体。">
        {group("界面")}
        <SettingRow label="西文"><FontPick fonts={LATIN_FONTS} /></SettingRow>
        <SettingRow label="中文" hint="代码里的中文也用它"><FontPick fonts={CJK_FONTS} /></SettingRow>
        {group("对话正文")}
        <SettingRow label="西文"><FontPick fonts={LATIN_FONTS} follow="跟随界面" /></SettingRow>
        <SettingRow label="中文"><FontPick fonts={CJK_FONTS} follow="跟随界面" /></SettingRow>
        <SettingRow label="字号"><Px value={14} /></SettingRow>
        {group("代码")}
        <SettingRow label="字体"><FontPick fonts={MONO_FONTS} /></SettingRow>
        <SettingRow label="字号"><Px value={13} /></SettingRow>
        <FontSample />
      </Section>
    );
  }
  const row = "grid grid-cols-[6rem_1fr_1fr_5rem] items-center gap-3 border-b border-border/60 py-2.5";
  return (
    <Section title="字体" hint="只能用这台设备已安装的字体；未安装的会回退到默认字体。">
      {/* Column heads say what each script column covers (owner: 中文 / 西文 must be told apart, CJK / non-CJK). */}
      <div className={`${row} items-end py-2`}>
        <span />
        <span className={colHead}>
          <span className="block text-xs font-medium text-muted">西文 · Non-CJK</span>
          拉丁等字母、数字和符号
        </span>
        <span className={colHead}>
          <span className="block text-xs font-medium text-muted">中文 · CJK</span>
          汉字，也用于日文假名、韩文
        </span>
        <span className={colHead}>字号</span>
      </div>
      <div className={row}>
        <span className="text-sm">界面</span>
        <FontPick fonts={LATIN_FONTS} width="w-full" />
        <FontPick fonts={CJK_FONTS} width="w-full" />
        <span className="text-xs text-subtle">随缩放</span>
      </div>
      <div className={row}>
        <span className="text-sm">对话正文</span>
        <FontPick fonts={LATIN_FONTS} follow="跟随界面" width="w-full" />
        <FontPick fonts={CJK_FONTS} follow="跟随界面" width="w-full" />
        <Px value={14} />
      </div>
      <div className={`${row} border-b-0`}>
        <span className="text-sm">代码</span>
        <FontPick fonts={MONO_FONTS} width="w-full" />
        {/* Code has its own CJK slot; until it is wired only 「跟随界面」 is offered. */}
        <FontPick fonts={[]} follow="跟随界面" width="w-full" />
        <Px value={13} />
      </div>
      <FontSample />
    </Section>
  );
}

function FontsTopic() {
  const [l, setL] = useState<FontLayout>((q.get("f") as FontLayout | null) ?? "F6");
  return (
    <>
      <div className="my-4 flex flex-wrap gap-2">
        {(Object.keys(FONT_LAYOUTS) as FontLayout[]).map((k) => (
          <button key={k} onClick={() => setL(k)} className={`rounded-md border px-3 py-1 text-sm ${k === l ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`}>{FONT_LAYOUTS[k].name}</button>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted">{FONT_LAYOUTS[l].note}。「非 CJK」都改叫「西文」。</p>
      <Page title="外观（字体）"><FontsVariant layout={l} /></Page>
    </>
  );
}

// ---- 主题配色 (owner 2026-10-18: a friend prefers Claude desktop's warm off-white to pure white) ----

type Palette = { name: string; note: string; dark: boolean; vars: Record<string, string> };
const PALETTES: Palette[] = [
  { name: "浅色 · 纯白（现在）", note: "现在的浅色", dark: false, vars: {} },
  {
    name: "浅色 · 暖白（米黄）", note: "接近 Claude 桌面端：米色底、暖灰文字", dark: false,
    vars: { "--bg": "#faf9f5", "--surface": "#f3f1ea", "--surface-2": "#e8e5da", "--raised": "#fffdf8", "--fg": "#2d2b26", "--fg-muted": "#69655b", "--fg-subtle": "#7b766b", "--border": "#e2ddd0", "--bubble": "#eeebe1", "--peer": "#edf1f8", "--win": "#efede5", "--hover": "rgba(70, 55, 30, 0.06)", "--card-border": "rgba(70, 55, 30, 0.09)" },
  },
  {
    name: "浅色 · 柔灰", note: "介于两者之间：去掉纯白的刺眼，但不偏黄", dark: false,
    vars: { "--bg": "#f8f8f7", "--surface": "#f1f1ef", "--surface-2": "#e6e6e3", "--raised": "#fdfdfc", "--border": "#dfdfdb", "--bubble": "#ebebe8", "--win": "#ececea" },
  },
  { name: "深色 · 中性灰（现在）", note: "现在的深色", dark: true, vars: {} },
  {
    name: "深色 · 暖灰", note: "接近 Claude 桌面端的深色：略带暖调的炭灰", dark: true,
    vars: { "--bg": "#262624", "--surface": "#2c2c2a", "--surface-2": "#363633", "--raised": "#40403c", "--fg": "#ece9e2", "--fg-muted": "#aaa59a", "--fg-subtle": "#8f8a80", "--border": "#3a3935", "--bubble": "#353531", "--peer": "#2a3140", "--win": "#1f1e1c", "--card-border": "rgba(255, 250, 235, 0.07)" },
  },
  {
    name: "深色 · 纯黑", note: "OLED 屏省电、对比最强", dark: true,
    vars: { "--bg": "#000000", "--surface": "#0b0b0c", "--surface-2": "#18181a", "--raised": "#26262a", "--border": "#1f1f22", "--bubble": "#161618", "--win": "#000000", "--card-border": "rgba(255, 255, 255, 0.08)" },
  },
];
/** 暮色 (dusk) tuned less warm (owner 2026-10-18: 「有点太偏黄了吗」). */
const DUSKS: Palette[] = [
  { name: "石墨（参照）", note: "中性灰，不带暖调", dark: true, vars: {} },
  {
    name: "暮色 · 现在", note: "已提交的版本", dark: true,
    vars: { "--bg": "#262624", "--surface": "#2c2c2a", "--surface-2": "#363633", "--raised": "#40403c", "--fg": "#ece9e2", "--fg-muted": "#aaa59a", "--fg-subtle": "#8f8a80", "--border": "#3a3935", "--bubble": "#353531", "--peer": "#2a3140", "--win": "#1f1e1c", "--card-border": "rgba(255, 250, 235, 0.07)" },
  },
  {
    name: "暮色 · 暖减半", note: "亮度不变，暖调减一半", dark: true,
    vars: { "--bg": "#252524", "--surface": "#2b2b2a", "--surface-2": "#353534", "--raised": "#403f3e", "--fg": "#eceae6", "--fg-muted": "#a8a6a1", "--fg-subtle": "#8d8b86", "--border": "#383735", "--bubble": "#333331", "--peer": "#2a3140", "--win": "#1d1d1c", "--card-border": "rgba(255, 252, 245, 0.07)" },
  },
  {
    name: "暮色 · 微暖", note: "只留一点暖意，比石墨稍亮", dark: true,
    vars: { "--bg": "#212120", "--surface": "#272726", "--surface-2": "#313130", "--raised": "#3d3d3b", "--fg": "#ececea", "--fg-muted": "#a7a6a2", "--fg-subtle": "#8b8a86", "--border": "#343432", "--bubble": "#2f2f2d", "--win": "#191918", "--card-border": "rgba(255, 253, 248, 0.065)" },
  },
  {
    name: "暮色 · 暖但不黄", note: "暖调偏红棕而不是黄（像旧木头）", dark: true,
    vars: { "--bg": "#262423", "--surface": "#2c2a29", "--surface-2": "#363332", "--raised": "#403d3b", "--fg": "#ece8e5", "--fg-muted": "#aaa29d", "--fg-subtle": "#8f8883", "--border": "#3a3634", "--bubble": "#35312f", "--win": "#1f1d1c", "--card-border": "rgba(255, 245, 240, 0.07)" },
  },
];

/** The dark theme's variables, for a dark palette shown on a light page (and the other way round). */
const DARK_BASE: Record<string, string> = { "--bg": "#161616", "--surface": "#1c1c1d", "--surface-2": "#262628", "--raised": "#3a3a3e", "--fg": "#ececec", "--fg-muted": "#a4a4aa", "--fg-subtle": "#86868d", "--border": "#2c2c2f", "--accent": "#60a5fa", "--bubble": "#262628", "--peer": "#1f2a3a", "--warn": "#f59e0b", "--warn-text": "#f59e0b", "--win": "#0e0e0f", "--hover": "rgba(255, 255, 255, 0.06)", "--card-border": "rgba(255, 255, 255, 0.06)" };
const LIGHT_BASE: Record<string, string> = { "--bg": "#ffffff", "--surface": "#f6f6f7", "--surface-2": "#ececee", "--raised": "#ffffff", "--fg": "#1d1d1f", "--fg-muted": "#5f6066", "--fg-subtle": "#6a6b71", "--border": "#e3e3e6", "--accent": "#3b82f6", "--bubble": "#f0f0f2", "--peer": "#eef4ff", "--warn": "#d97706", "--warn-text": "#9a4a06", "--win": "#f1f1f3", "--hover": "rgba(20, 20, 30, 0.06)", "--card-border": "rgba(20, 20, 30, 0.07)" };

/** A small piece of the app (sidebar, a conversation, a settings card) under one palette. */
function MiniApp({ p }: { p: Palette }) {
  // Tailwind's --color-* are resolved once at :root, so a subtree must override them too, not only --bg etc.
  const COLOR: Record<string, string> = { "--bg": "background", "--fg": "foreground", "--fg-muted": "muted", "--fg-subtle": "subtle" };
  const base = { ...(p.dark ? DARK_BASE : LIGHT_BASE), ...p.vars };
  const style = { ...base, ...Object.fromEntries(Object.entries(base).map(([k, v]) => [`--color-${COLOR[k] ?? k.slice(2)}`, v])), colorScheme: p.dark ? "dark" : "light" } as React.CSSProperties;
  return (
    <figure className="m-0">
      <figcaption className="mb-1.5 text-sm font-medium text-foreground">{p.name}<span className="ml-2 text-xs font-normal text-subtle">{p.note}</span></figcaption>
      <div style={style} className="flex h-64 overflow-hidden rounded-xl border border-border bg-win text-foreground">
        <div className="flex w-36 shrink-0 flex-col gap-1 p-2 text-[12px]">
          <div className="rounded-md px-2 py-1 text-muted">＋ 新建智能体</div>
          <div className="mt-1 px-2 text-[10px] text-subtle">cutex-desktop</div>
          {["Eva", "Mika", "Sora"].map((n, i) => (
            <div key={n} className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${i === 0 ? "bg-surface-2" : ""}`}>
              <Avatar name={n} seed={n} size={16} />
              <span className={i === 0 ? "font-medium" : "text-muted"}>{n}</span>
              {i === 1 && <span className="ml-auto rounded bg-warn/15 px-1 text-[10px] text-warn-text">需要你</span>}
            </div>
          ))}
        </div>
        <div className="my-2 mr-2 flex min-w-0 flex-1 flex-col gap-2 rounded-lg bg-bg p-3 text-[12px]" style={{ background: "var(--bg)" }}>
          <div className="self-end rounded-lg bg-bubble px-2.5 py-1.5">把设置页的配色也看一下</div>
          <div className="leading-relaxed">好的。浅色加了「暖白」，深色加了「暖灰」和「纯黑」。<span className="text-accent">查看对比 →</span></div>
          <div className="mt-auto rounded-lg border border-card-border bg-surface px-3 py-1">
            <div className="flex items-center justify-between border-b border-border/60 py-1.5">
              <span>主题</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">跟随系统</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-muted">文字对比度</span>
              <span className="text-[11px] text-subtle">标准</span>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

function PalettesTopic() {
  return (
    <>
      <p className="my-4 text-sm text-muted">每套配色下是同一小块界面：侧栏、对话、设置卡片。上面三套浅色，下面三套深色；设置里会是「主题」下面各一行配色。</p>
      <h2 className="mt-2 mb-3 text-base font-semibold">暮色对比</h2>
      <div className="mb-8 grid grid-cols-3 gap-4">
        {DUSKS.map((p) => <MiniApp key={p.name} p={p} />)}
      </div>
      <h2 className="mb-3 text-base font-semibold">全部配色</h2>
      <div className="grid grid-cols-3 gap-4">
        {PALETTES.map((p) => <MiniApp key={p.name} p={p} />)}
      </div>
    </>
  );
}

// ---- 自定义字体 (owner 2026-10-18: 「自定义…」 sat at the end and opened a second line) ----

const NOT_INSTALLED = new Set(["HarmonyOS Sans SC", "MiSans", "Maple Mono"]);
const CJK_LIST = ["Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "LXGW WenKai", "KingHwa_OldSong"];
const LATIN_LIST = ["Inter", "Segoe UI", "SF Pro Text", "Roboto", "Helvetica Neue"];
const MONO_LIST = ["JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas", "Maple Mono"];

/** B: a select with 「自定义…」 right after the default; picking it turns the select into a field of the same width, ↩ goes back. */
function FontSelectB({ fonts, defaultLabel, initial = "" }: { fonts: string[]; defaultLabel: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [custom, setCustom] = useState(initial !== "" && !fonts.includes(initial));
  if (custom)
    return (
      <span className="inline-flex w-56 items-center gap-1">
        <input autoFocus value={value} placeholder="输入字体名" spellCheck={false} onChange={(e) => setValue(e.target.value)} className="min-w-0 flex-1 rounded-md border border-accent bg-background px-2 py-1 text-sm outline-none" />
        <button type="button" title="回到列表" onClick={() => { setCustom(false); setValue(""); }} className="shrink-0 rounded px-1.5 py-1 text-xs text-subtle hover:bg-surface-2 hover:text-foreground">↩</button>
      </span>
    );
  return (
    <Select<string>
      width="w-56"
      value={value}
      options={[{ value: "", label: defaultLabel }, { value: "\u0000custom", label: "自定义…" }, ...fonts.map((f) => ({ value: f, label: NOT_INSTALLED.has(f) ? `${f}（未安装）` : f }))]}
      onChange={(v) => (v === "\u0000custom" ? setCustom(true) : setValue(v))}
    />
  );
}

function FontComboDemo({ fonts, defaultLabel, initial = "" }: { fonts: string[]; defaultLabel: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <FontCombo value={value} fonts={fonts} defaultLabel={defaultLabel} installed={(f) => !NOT_INSTALLED.has(f)} onChange={setValue} />;
}

function FontPickTopic() {
  const [v, setV] = useState<"A" | "B">((q.get("pick") as "A" | "B" | null) ?? "A");
  const Pick = v === "A" ? FontComboDemo : FontSelectB;
  return (
    <>
      <div className="my-4 flex flex-wrap gap-2">
        {(["A", "B"] as const).map((k) => (
          <button key={k} onClick={() => setV(k)} className={`rounded-md border px-3 py-1 text-sm ${k === v ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`}>{k === "A" ? "A 可输入的下拉框" : "B 原地切换成输入框"}</button>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted">
        {v === "A" ? "点进框里：列表打开，可以直接打字筛选；输入一个列表里没有的名字，最后一项就是「使用 …」。上下键 + 回车也能选。" : "「自定义…」在列表第二项；选它以后这个框原地变成输入框（同样宽），右边 ↩ 回到列表。"}
        「对话 · 西文字体」示例里已经是一个自定义字体。
      </p>
      <Page title="外观（字体）">
        <Section title="字体" hint="从这台设备已安装的字体里选；列表中标「未安装」的，会先用默认字体显示。">
          <SettingRow label="界面 · 中文字体"><Pick fonts={CJK_LIST} defaultLabel="默认" /></SettingRow>
          <SettingRow label="界面 · 西文字体"><Pick fonts={LATIN_LIST} defaultLabel="默认" /></SettingRow>
          <SettingRow label="对话 · 西文字体"><Pick fonts={LATIN_LIST} defaultLabel="跟随界面" initial="Atkinson Hyperlegible" /></SettingRow>
          <SettingRow label="代码 · 西文字体"><Pick fonts={MONO_LIST} defaultLabel="默认" /></SettingRow>
        </Section>
      </Page>
    </>
  );
}

const TOPICS = { ownerdev: "主人的设备", hostpage: "连接：你 · 主机", owner: "所有者页", conn: "连接：新结构", conv: "对话页：新结构", events: "事件分级：分组和控件", rules: "标签规则：所有情况", hostpick: "主机切换放哪", labels: "标签设计", tags: "卡片标签", names: "通知两张表的名字", tint: "表情底色", notify: "通知页结构", leftovers: "输入区收尾", inputsplit: "输入区拆页", fontpick: "自定义字体", palettes: "主题配色", fonts: "字体（外观页）", reset: "恢复默认", preview: "预览控件（已选 B6 + L1 + M3）", header: "页头「说明 + 影响」（已选 F）" } as const;

function Preview() {
  const [topic, setTopic] = useState<keyof typeof TOPICS>((q.get("topic") as keyof typeof TOPICS | null) ?? "ownerdev");
  return (
    <I18nProvider>
      <main className="mx-auto max-w-[1000px] px-6 py-6">
        <h1 className="text-lg font-semibold">设置页方案预览</h1>
        <p className="mt-1 text-xs text-subtle">研发预览，用真实设置组件。每个主题几个方案，点按钮切换。</p>
        <div className="mt-4 flex flex-wrap gap-x-1 border-b border-border">
          {(Object.keys(TOPICS) as (keyof typeof TOPICS)[]).map((k) => (
            <button key={k} onClick={() => setTopic(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm whitespace-nowrap ${k === topic ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}>{TOPICS[k]}</button>
          ))}
        </div>
        {topic === "ownerdev" ? <OwnerDevicesTopic /> : topic === "hostpage" ? <HostPageTopic /> : topic === "owner" ? <OwnerTopic /> : topic === "conn" ? <ConnTopic /> : topic === "conv" ? <ConvTopic /> : topic === "events" ? <EventGroupsTopic /> : topic === "rules" ? <LabelRulesTopic /> : topic === "hostpick" ? <HostPickTopic /> : topic === "labels" ? <LabelSpecTopic /> : topic === "tags" ? <CardTagsTopic /> : topic === "names" ? <NotifyNamesTopic /> : topic === "tint" ? <TintTopic /> : topic === "notify" ? <NotifyTopic /> : topic === "leftovers" ? <InputLeftoversTopic /> : topic === "inputsplit" ? <InputSplitTopic /> : topic === "fontpick" ? <FontPickTopic /> : topic === "palettes" ? <PalettesTopic /> : topic === "fonts" ? <FontsTopic /> : topic === "reset" ? <ResetTopic /> : topic === "preview" ? <PreviewTopic /> : <HeaderTopic />}
      </main>
    </I18nProvider>
  );
}

function HeaderTopic() {
  const [v, setV] = useState(q.get("v") ?? "F");
  const V = VARIANTS[v] ?? VARIANTS.A!;
  return (
      <>
        <div className="my-4 flex flex-wrap gap-2">
          {Object.entries(VARIANTS).map(([k, x]) => (
            <button key={k} onClick={() => setV(k)} className={`rounded-md border px-3 py-1 text-sm ${k === v ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`}>{x.name}</button>
          ))}
        </div>
        <p className="mb-4 text-sm text-muted">{V.note}</p>
        <div className="space-y-6">
          <Page title={DEFAULTS.title}>
            <V.Header hint={DEFAULTS.hint} scope={DEFAULTS.scope} />
            <p className="text-xs text-subtle">（正文略：只看页头在「影响智能体」的主机页上的样子）</p>
          </Page>
          <Page title={USAGE.title}>
            <V.Header hint={USAGE.hint} scope={USAGE.scope} />
            <p className="text-xs text-subtle">（正文略：主机页，但不影响智能体）</p>
          </Page>
          <Page title={GENERAL.title}>
            <V.Header hint={GENERAL.hint} scope={GENERAL.scope} />
            <GeneralBody />
          </Page>
        </div>
      </>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
