// Design mock 「教学模式」 (owner 2026-11-17, delegation-2f2d9e): the in-chat quiz card (an owner-answered question
// with a hidden key, graded by the desktop) and the explanation card (a Markdown callout). Static mock rows only;
// mount with `import('/src/dev/teachingTopic.tsx').then(m => m.mount())` on the renderer preview.
import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BookOpen, Check, GraduationCap, Lightbulb, MessageSquareText, RotateCcw, Sparkles, X } from "lucide-react";
import { I18nProvider } from "../i18n";
import { Markdown } from "../components/Markdown";
import { btn } from "../components/Button";

type Kind = "single" | "multi" | "fill";
interface Item { kind: Kind; header: string; question: string; options?: { label: string; description?: string }[]; correct: string[]; explain: string }

const ITEMS: Item[] = [
  { kind: "single", header: "Rust 所有权", question: "下面这段代码为什么编译不过？\n\n```rust\nlet s = String::from(\"hi\");\nlet t = s;\nprintln!(\"{s}\");\n```",
    options: [{ label: "s 的所有权移给了 t", description: "move 之后 s 不能再用" }, { label: "println! 不能打印 String" }, { label: "缺少 mut" }, { label: "String::from 返回引用" }],
    correct: ["s 的所有权移给了 t"], explain: "`String` 不是 `Copy`，`let t = s;` 把所有权移给 `t`，之后再用 `s` 就是 use-after-move。要两个都能用就 `s.clone()`，或者借用 `&s`。" },
  { kind: "multi", header: "借用规则", question: "同一时刻，下面哪些组合是允许的？（可多选）",
    options: [{ label: "多个 &T" }, { label: "一个 &mut T" }, { label: "一个 &mut T + 一个 &T" }, { label: "两个 &mut T" }],
    correct: ["多个 &T", "一个 &mut T"], explain: "要么任意多个共享借用，要么恰好一个可变借用，二者不能同时存在。" },
  { kind: "fill", header: "生命周期", question: "补全签名，让返回值活得和两个输入一样久：\n\n`fn longest<'a>(x: &'a str, y: &'a str) -> ____`",
    correct: ["&'a str"], explain: "返回值的生命周期必须标成 `'a`，编译器才知道它不会比 `x`、`y` 活得更久。" },
];

type State = { picked: string[]; text: string; graded: boolean };

/** One quiz card in the dock: answering, then graded in place (✓ / ✗ + the agent's explanation) before it goes back. */
function QuizCard({ item, index, total, state }: { item: Item; index: number; total: number; state: State }) {
  const [s, setS] = useState(state);
  const right = (label: string) => item.correct.includes(label);
  const answer = item.kind === "fill" ? [s.text.trim()] : s.picked;
  const correct = s.graded && answer.length === item.correct.length && answer.every((a) => item.correct.includes(a));
  const pick = (label: string) => !s.graded && setS({ ...s, picked: item.kind === "multi" ? (s.picked.includes(label) ? s.picked.filter((v) => v !== label) : [...s.picked, label]) : [label] });
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-lg">
      <div className="mb-1 flex items-center gap-2 text-xs text-subtle">
        <GraduationCap size={13} className="text-accent" />
        <span className="font-semibold uppercase tracking-wide">小测 · {item.header}</span>
        <span className="ml-auto">{index + 1} / {total}</span>
      </div>
      <div className="selectable mb-3 text-sm"><Markdown compact text={item.question} /></div>
      {item.kind === "multi" && <p className="mb-2 text-xs text-muted">可多选</p>}
      <div className="flex flex-col gap-1.5">
        {item.options?.map((o, i) => {
          const chosen = s.picked.includes(o.label);
          const face = !s.graded ? (chosen ? "border-accent bg-accent/10" : "border-border hover:bg-surface-2")
            : right(o.label) ? "border-ok/60 bg-ok/10" : chosen ? "border-danger/40 bg-danger/5" : "border-border opacity-60";
          return (
            <button key={o.label} type="button" aria-pressed={chosen} onClick={() => pick(o.label)} className={`w-full rounded-lg border px-3 py-1.5 text-left ${face}`}>
              <div className="flex items-center gap-2 text-sm">
                <span className="w-4 text-xs opacity-60">{i + 1}</span>
                <span className="flex-1">{o.label}</span>
                {s.graded && right(o.label) && <Check size={14} className="text-ok" />}
                {s.graded && chosen && !right(o.label) && <X size={14} className="text-danger" />}
              </div>
              {o.description && <div className="pl-6 text-xs text-muted">{o.description}</div>}
            </button>
          );
        })}
        {item.kind === "fill" && (
          <input value={s.text} readOnly={s.graded} onChange={(e) => setS({ ...s, text: e.target.value })} placeholder="写下答案"
            className={`w-full rounded-lg border bg-background px-3 py-1.5 font-mono text-sm outline-none ${s.graded ? (correct ? "border-ok/60" : "border-danger/40") : "border-border focus:border-accent"}`} />
        )}
      </div>
      {s.graded ? (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${correct ? "bg-ok/10" : "bg-danger/5"}`}>
          <div className={`mb-1 flex items-center gap-1.5 font-medium ${correct ? "text-ok-text" : "text-danger-text"}`}>
            {correct ? <Check size={14} /> : <X size={14} />}{correct ? "答对了" : `答错了 · 正确答案：${item.correct.join("、")}`}
          </div>
          <Markdown compact text={item.explain} />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className={btn({ variant: "primary" })}>{index + 1 < total ? "下一题" : "交给智能体"}</button>
            {!correct && <button type="button" className={btn({})}><MessageSquareText size={13} className="mr-1 inline" />问为什么</button>}
            <span className="ml-auto text-xs text-subtle">答题结果会连同对错一起发回智能体</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" disabled={!answer.some(Boolean)} onClick={() => setS({ ...s, graded: true })} className={btn({ variant: "primary" })}>提交</button>
          <button type="button" className={btn({})}>跳过</button>
          <span className="ml-auto text-xs text-subtle">数字键选项 · Enter 提交</span>
        </div>
      )}
    </div>
  );
}

/** The explanation card: an agent reply's `> [!EXPLAIN] 标题` callout, rendered as a card (plain blockquote elsewhere). */
function ExplainCard({ title, body, points }: { title: string; body: string; points: string[] }) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-accent"><Lightbulb size={15} />{title}</div>
      <div className="text-sm"><Markdown text={body} /></div>
      <div className="mt-2 rounded-lg bg-surface/70 px-3 py-2">
        <div className="mb-1 text-xs font-semibold text-muted">要点</div>
        <ul className="list-disc space-y-0.5 pl-5 text-sm">{points.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><BookOpen size={12} />Rust 所有权 · 第 2 节</span>
        <span className="ml-auto inline-flex items-center gap-1 hover:text-foreground"><Sparkles size={12} />选中任意一段 → 右键「解释这段」</span>
      </div>
    </div>
  );
}

function Bubble({ who, children }: { who: string; children: ReactNode }) {
  return <div className="space-y-2"><div className="text-xs text-subtle">{who}</div>{children}</div>;
}

/** Select-to-ask: a selection inside an agent reply and the context menu's new first item. */
function SelectMenu() {
  return (
    <div className="relative">
      <p className="text-sm leading-6">
        借用检查器在编译期确认：<mark className="rounded-sm bg-accent/25 px-0.5 text-foreground">每个值同一时刻只有一个可变引用，或者任意多个共享引用</mark>，所以 Rust 不需要 GC 也没有数据竞争。
      </p>
      <div className="absolute top-8 left-56 z-10 w-52 rounded-lg border border-border bg-surface py-1 text-sm shadow-lg">
        <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5"><Lightbulb size={13} className="text-accent" />解释这段<span className="ml-auto text-xs text-subtle">侧边聊天</span></div>
        <div className="flex items-center gap-2 px-3 py-1.5"><MessageSquareText size={13} />引用到输入框</div>
        <div className="flex items-center gap-2 px-3 py-1.5"><RotateCcw size={13} />复制</div>
      </div>
      <div className="h-24" />
    </div>
  );
}

function Topic() {
  const total = ITEMS.length;
  return (
    <div id="teaching-harness" className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto grid max-w-[1500px] grid-cols-2 gap-8">
        <div className="space-y-5">
          <h2 className="text-title/[inherit] font-semibold">① 讲解卡（对话里）</h2>
          <Bubble who="你">讲讲 Rust 的所有权，讲完出几道题考我。</Bubble>
          <Bubble who="智能体 · tutor">
            <ExplainCard title="所有权：每个值只有一个主人" body={"变量离开作用域时，它拥有的值会被自动释放（`drop`）。赋值或传参会**移动**所有权，旧变量随之失效：\n\n```rust\nlet s = String::from(\"hi\");\nlet t = s;      // s 移给 t\n// println!(\"{s}\"); // 错误：s 已被移动\n```"}
              points={["一个值同一时刻只有一个所有者", "所有者离开作用域，值被 drop", "move 之后旧变量不能再用；需要两份就 clone，只想看就借用 &"]} />
            <p className="text-sm">讲完了，下面三道题，答完我根据你的错题决定下一节讲什么。</p>
          </Bubble>
          <h2 className="pt-2 text-title/[inherit] font-semibold">③ 选中提问「解释这段」</h2>
          <SelectMenu />
          <h2 className="text-title/[inherit] font-semibold">旧客户端 / 手机上同一条回复（降级为普通引用块）</h2>
          <div className="rounded-xl border border-border p-3 text-sm">
            <Markdown text={"> **[!EXPLAIN] 所有权：每个值只有一个主人**\n>\n> 变量离开作用域时，它拥有的值会被自动释放……"} />
          </div>
        </div>
        <div className="space-y-4">
          <h2 className="text-title/[inherit] font-semibold">② 小测卡（输入框上方，和「提问」同一个位置）</h2>
          <p className="text-xs text-muted">a. 单选 · 未作答</p>
          <QuizCard item={ITEMS[0]!} index={0} total={total} state={{ picked: ["s 的所有权移给了 t"], text: "", graded: false }} />
          <p className="text-xs text-muted">b. 多选 · 已批改（答错一项）</p>
          <QuizCard item={ITEMS[1]!} index={1} total={total} state={{ picked: ["多个 &T", "一个 &mut T + 一个 &T"], text: "", graded: true }} />
          <p className="text-xs text-muted">c. 填空 · 已批改（答对）</p>
          <QuizCard item={ITEMS[2]!} index={2} total={total} state={{ picked: [], text: "&'a str", graded: true }} />
        </div>
      </div>
    </div>
  );
}

export function mount() {
  document.body.innerHTML = "";
  const node = document.createElement("div");
  document.body.append(node);
  createRoot(node).render(<I18nProvider><Topic /></I18nProvider>);
}
