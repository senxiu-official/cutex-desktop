// Variants topic 「对话页：新结构」 (dev preview only): the 对话 settings page as it is now (「现在」, the
// rows of AppSettings ConversationPage + side-chat / annotation module cards) beside a proposed
// regrouping (「新结构」). Mock state only, no prefs. `?v=now` opens the current page.
import { useState, type ReactNode } from "react";
import { Bot, Monitor } from "lucide-react";
import { Button, Section, Segmented, Select, SettingRow, TextArea, TextField, Toggle } from "../components/settings/Form";

const CHIP = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const T = {
  local: <span className={`${CHIP} bg-surface-2 text-muted`}><Monitor size={11} />本地桌面应用</span>,
  next: <span className={`${CHIP} bg-warn/15 text-warn-text`}><Bot size={11} />智能体 · 下次启动生效</span>,
  now: <span className={`${CHIP} bg-warn/15 text-warn-text`}><Bot size={11} />智能体 · 立即生效</span>,
};

const PROMPT =
  "Summarize the user's questions and the resulting discussion in this side conversation as a concise standalone note. Use the user's language. Give a short heading, the confirmed conclusions, and any unresolved questions. Treat inherited main-thread history only as background; do not summarize it wholesale. Do not execute tasks or use tools for this request. Return only the note in Markdown.";

const CHANGES = [
  "页头说明改为「对话标题栏、时间线消息与侧边对话的显示和行为。」，与页面内容一致。",
  "「消息显示」按类型重排：推理 → 智能体间消息 → 图片 → 轮尾摘要，三个开关（已处理的提问和审批、批注、会话开场）放在后面。",
  "「在时间线里显示批注」并入「消息显示」，不再单独占一张「批注」卡片。",
  "「自动折叠长消息」和「折叠较早的智能体回复」合成一个三档「折叠长消息」；「折叠阈值」关时变灰，不隐藏。",
  "侧边对话拆成两张卡：「侧边对话」（历史范围、模型）和「记为批注」（关联的轮、提示词），各自标明对智能体何时生效。",
  "「侧边对话模型」由自由输入改为下拉，列出同一 Profile 可用的模型。",
  "批注提示词默认收起，点「编辑提示词…」才展开编辑框。",
  "文案统一：行说明不带句号、卡片说明带句号；「顶栏」统一为「标题栏」。",
];

function Card({ title, hint, tags, children }: { title: string; hint?: string; tags?: ReactNode[]; children: ReactNode }) {
  // Section's own tag line follows the real page source; this draft draws its tags itself.
  return (
    <section className="mb-6">
      <div className="mb-2">
        <div className="mb-0.5 flex h-8 items-center"><h3 className="text-sm font-semibold">{title}</h3></div>
        {hint && <p className="text-xs text-subtle">{hint}</p>}
        {tags && tags.length > 0 && <div className="mt-1 flex flex-wrap items-center gap-1.5">{tags}</div>}
      </div>
      <div className="rounded-xl border border-border bg-surface px-4">{children}</div>
    </section>
  );
}

function Header({ hint }: { hint: string }) {
  return (
    <div className="mb-4 space-y-1.5 border-b border-border/60 pb-3">
      <p className="text-[13px] text-muted">{hint}</p>
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">{T.local}</div>
    </div>
  );
}

const TURNS = ["20", "30", "50", "100", "0"].map((n) => ({ value: n, label: n === "0" ? "全部" : `最近 ${n} 轮` }));
const LINES = ["8", "12", "20", "40"].map((n) => ({ value: n, label: `${n} 行` }));

function NowPage() {
  const [two, setTwo] = useState(true);
  const [rt, setRt] = useState("all");
  const [reason, setReason] = useState("collapsed");
  const [inter, setInter] = useState(true);
  const [agentMsg, setAgentMsg] = useState("compact");
  const [intro, setIntro] = useState(true);
  const [summary, setSummary] = useState("collapsed");
  const [img, setImg] = useState("thumbnail");
  const [turns, setTurns] = useState("30");
  const [fold, setFold] = useState(true);
  const [lines, setLines] = useState("12");
  const [older, setOlder] = useState(false);
  const [notes, setNotes] = useState(true);
  const [draft, setDraft] = useState(PROMPT);
  const [anchor, setAnchor] = useState("start");
  const [scope, setScope] = useState("all");
  const [model, setModel] = useState("");
  return (
    <>
      <Header hint="对话顶栏和时间线里的消息怎么显示。" />
      <Section title="对话顶部">
        <SettingRow label="顶栏两行" hint="第二行显示工作目录 · 分支 · 改动"><Toggle checked={two} onChange={setTwo} /></SettingRow>
        <SettingRow label="运行时按钮" hint="对话标题栏里的「启动 / 停止运行时」按钮（右键菜单里也有）">
          <Segmented value={rt} onChange={setRt} options={[{ value: "all", label: "所有对话" }, { value: "independent", label: "仅独立智能体" }, { value: "off", label: "不显示" }]} />
        </SettingRow>
      </Section>
      <Section title="消息显示">
        <SettingRow label="推理过程" hint="有完整推理就显示完整的，没有就显示摘要；两者都没有时只在底部显示「推理中」">
          <Segmented value={reason} onChange={setReason} options={[{ value: "expanded", label: "展开" }, { value: "collapsed", label: "折叠" }, { value: "hidden", label: "隐藏" }]} />
        </SettingRow>
        <SettingRow label="在时间线中保留已处理的交互" hint="回答过的问题和已处理的审批在时间线留一行，点开看完整内容和选中的选项；重启应用后不再保留"><Toggle checked={inter} onChange={setInter} /></SettingRow>
        <SettingRow label="智能体间消息" hint="简洁：一行，点开看全文">
          <Segmented value={agentMsg} onChange={setAgentMsg} options={[{ value: "compact", label: "简洁" }, { value: "full", label: "完整" }]} />
        </SettingRow>
        <SettingRow label="显示会话开场" hint="会话开头在屏幕上时，第一个回合之上显示所用 Profile 的立绘和开场白；在 Profile 的外观里设置；新建智能体和快速开始页的立绘也随它开关"><Toggle checked={intro} onChange={setIntro} /></SettingRow>
        <SettingRow label="轮尾摘要" hint="回复下方一行：本轮改过的文件和值得打开的链接；超过 5 个文件时总是收起">
          <Segmented value={summary} onChange={setSummary} options={[{ value: "collapsed", label: "收起" }, { value: "latest", label: "最新一轮展开" }, { value: "off", label: "关闭" }]} />
        </SettingRow>
        <SettingRow label="消息里的图片" hint="指向图片文件的链接和 ![](路径) 显示缩略图，点开在侧栏看大图；5 MB 以内">
          <Segmented value={img} onChange={setImg} options={[{ value: "thumbnail", label: "显示缩略图" }, { value: "link", label: "只显示链接" }]} />
        </SettingRow>
      </Section>
      <Section title="长对话和长消息">
        <SettingRow label="长对话" hint="先显示最近多少轮，更早的点「显示更早」再加载；历史很长时能明显减少卡顿"><Select value={turns} onChange={setTurns} options={TURNS} /></SettingRow>
        <SettingRow label="自动折叠长消息" hint="你发的消息超过阈值时只显示前几行，点「展开全部」看完整内容；也可以在消息的悬停菜单里手动折叠 / 展开"><Toggle checked={fold} onChange={setFold} /></SettingRow>
        <SettingRow label="折叠阈值" hint="按显示出来的行数算，自动换行也算"><Segmented value={lines} onChange={setLines} disabled={!fold} options={LINES} /></SettingRow>
        <SettingRow label="折叠较早的智能体回复" hint="最新的回复始终完整显示；打开后更早的长回复也按阈值折叠"><Toggle checked={older} onChange={setOlder} disabled={!fold} /></SettingRow>
      </Section>
      <Section title="批注">
        <SettingRow label="在时间线里显示批注" hint="仅显示紧凑入口，点击在浮窗查看；关闭此项不删除批注"><Toggle checked={notes} onChange={setNotes} /></SettingRow>
      </Section>
      <Section title="侧边对话">
        <SettingRow label="批注提示词" hint="点击「记为批注」时发送给当前侧边对话，不改变主对话">
          <div className="flex max-w-full flex-col items-end gap-2"><TextArea value={draft} onChange={setDraft} rows={5} /><Button disabled={draft === PROMPT} onClick={() => {}}>保存提示词</Button></div>
        </SettingRow>
        <SettingRow label="批注挂在哪一轮"><Select value={anchor} onChange={setAnchor} options={[{ value: "start", label: "侧边对话的起点" }, { value: "latest", label: "保存时主对话的最新一轮" }]} /></SettingRow>
        <SettingRow label="从某一轮开侧边对话时，它看到"><Select value={scope} onChange={setScope} options={[{ value: "all", label: "全部历史" }, { value: "through", label: "只到那一轮" }]} /></SettingRow>
        <SettingRow label="侧边对话模型" hint="留空跟随主智能体；也可指定同一 Profile 能用的模型名"><TextField value={model} onCommit={setModel} placeholder="跟主智能体相同" /></SettingRow>
      </Section>
    </>
  );
}

function NewPage() {
  const [two, setTwo] = useState(true);
  const [rt, setRt] = useState("all");
  const [reason, setReason] = useState("collapsed");
  const [agentMsg, setAgentMsg] = useState("compact");
  const [img, setImg] = useState("thumbnail");
  const [summary, setSummary] = useState("collapsed");
  const [inter, setInter] = useState(true);
  const [notes, setNotes] = useState(true);
  const [intro, setIntro] = useState(true);
  const [turns, setTurns] = useState("30");
  const [fold, setFold] = useState("mine");
  const [lines, setLines] = useState("12");
  const [scope, setScope] = useState("all");
  const [model, setModel] = useState("same");
  const [anchor, setAnchor] = useState("start");
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(PROMPT);
  const [draft, setDraft] = useState(PROMPT);
  return (
    <>
      <Header hint="对话标题栏、时间线消息与侧边对话的显示和行为。" />
      <Card title="对话顶部">
        <SettingRow label="标题栏显示两行" hint="第二行显示工作目录、分支和改动"><Toggle checked={two} onChange={setTwo} /></SettingRow>
        <SettingRow label="运行时按钮" hint="标题栏中的「启动 / 停止运行时」按钮；右键菜单始终提供">
          <Segmented value={rt} onChange={setRt} options={[{ value: "all", label: "所有对话" }, { value: "independent", label: "单独运行的智能体" }, { value: "off", label: "不显示" }]} />
        </SettingRow>
      </Card>
      <Card title="消息显示">
        <SettingRow label="推理过程" hint="优先显示完整推理，没有时显示摘要">
          <Segmented value={reason} onChange={setReason} options={[{ value: "expanded", label: "展开" }, { value: "collapsed", label: "折叠" }, { value: "hidden", label: "隐藏" }]} />
        </SettingRow>
        <SettingRow label="智能体间消息" hint="简洁只显示一行，点击展开全文">
          <Segmented value={agentMsg} onChange={setAgentMsg} options={[{ value: "compact", label: "简洁" }, { value: "full", label: "完整" }]} />
        </SettingRow>
        <SettingRow label="消息里的图片" hint="图片链接显示为缩略图，点击在侧栏查看；限 5 MB">
          <Segmented value={img} onChange={setImg} options={[{ value: "thumbnail", label: "显示缩略图" }, { value: "link", label: "只显示链接" }]} />
        </SettingRow>
        <SettingRow label="轮尾摘要" hint="回复下方列出本轮修改的文件和相关链接">
          <Segmented value={summary} onChange={setSummary} options={[{ value: "collapsed", label: "收起" }, { value: "latest", label: "最新一轮展开" }, { value: "off", label: "关闭" }]} />
        </SettingRow>
        <SettingRow label="保留已处理的提问和审批" hint="在时间线中保留一行，点击查看所选项；重启应用后清除"><Toggle checked={inter} onChange={setInter} /></SettingRow>
        <SettingRow label="在时间线里显示批注" hint="显示为紧凑入口，点击在浮窗查看；关闭后批注仍保留"><Toggle checked={notes} onChange={setNotes} /></SettingRow>
        <SettingRow label="显示会话开场" hint="第一轮之上显示 Profile 的立绘和开场白，在 Profile → 外观中设置"><Toggle checked={intro} onChange={setIntro} /></SettingRow>
      </Card>
      <Card title="长对话和长消息">
        <SettingRow label="初始加载轮数" hint="更早的轮次点击「显示更早」加载；历史较长时可减少卡顿"><Select value={turns} onChange={setTurns} options={TURNS} /></SettingRow>
        <SettingRow label="折叠长消息" hint="超过阈值时只显示前几行；最新一条回复始终完整显示">
          <Segmented value={fold} onChange={setFold} options={[{ value: "off", label: "关" }, { value: "mine", label: "只折叠我发的" }, { value: "all", label: "也折叠较早的回复" }]} />
        </SettingRow>
        <SettingRow label="折叠阈值" hint="按显示行数计算，含自动换行"><Segmented value={lines} onChange={setLines} disabled={fold === "off"} options={LINES} /></SettingRow>
      </Card>
      <Card title="侧边对话" hint="从某一轮开出的临时对话，不写入主对话。" tags={[T.next]}>
        <SettingRow label="可见的主对话历史" hint="从某一轮打开侧边对话时适用">
          <Segmented value={scope} onChange={setScope} options={[{ value: "all", label: "全部历史" }, { value: "through", label: "截至起始轮" }]} />
        </SettingRow>
        <SettingRow label="模型" hint="同一 Profile 可用的模型">
          <Select value={model} onChange={setModel} options={[{ value: "same", label: "跟主智能体相同" }, { value: "gpt-5.5", label: "gpt-5.5" }, { value: "gpt-5.4-mini", label: "gpt-5.4-mini" }, { value: "claude-opus-5-5", label: "claude-opus-5-5" }]} />
        </SettingRow>
      </Card>
      <Card title="记为批注" hint="把侧边对话整理成一条批注。" tags={[T.now]}>
        <SettingRow label="批注关联的轮">
          <Segmented value={anchor} onChange={setAnchor} options={[{ value: "start", label: "侧边对话的起始轮" }, { value: "latest", label: "保存时主对话的最新一轮" }]} />
        </SettingRow>
        <SettingRow label="批注提示词">
          <Button onClick={() => (setDraft(prompt), setEditing(!editing))}>{editing ? "收起" : "编辑提示词…"}</Button>
        </SettingRow>
        {editing && (
          <div className="flex flex-col items-end gap-2 border-t border-border/60 py-3">
            <TextArea value={draft} onChange={setDraft} rows={6} width="w-full" />
            <Button primary disabled={!draft.trim() || draft === prompt} onClick={() => (setPrompt(draft), setEditing(false))}>保存</Button>
          </div>
        )}
      </Card>
    </>
  );
}

type View = "new" | "now";

export function ConvTopic() {
  const q = new URLSearchParams(location.search);
  const [view, setView] = useState<View>(q.get("v") === "now" ? "now" : "new");
  const btn = (on: boolean) => `rounded-md border px-3 py-1 text-sm ${on ? "border-accent bg-accent/12 text-accent" : "border-border text-muted hover:text-foreground"}`;
  return (
    <>
      <div className="my-4 flex flex-wrap gap-2">
        <button onClick={() => setView("now")} className={btn(view === "now")}>现在</button>
        <button onClick={() => setView("new")} className={btn(view === "new")}>新结构</button>
      </div>
      <ul className="mb-4 list-disc space-y-0.5 rounded-xl border border-border bg-surface px-8 py-3 text-xs text-muted">
        {CHANGES.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="rounded-xl border border-border bg-background">
        <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › <span className="font-semibold text-foreground">对话</span></div>
        <div className="mx-auto max-w-[720px] px-4 py-5">{view === "now" ? <NowPage /> : <NewPage />}</div>
      </div>
    </>
  );
}
