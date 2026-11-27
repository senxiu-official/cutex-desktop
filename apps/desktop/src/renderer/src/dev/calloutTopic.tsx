// Preview topic: an agent reply with Markdown alerts (callout cards), rendered by the real Markdown inside the running
// preview app (its menus and the side-chat module are live), so 解释这段 can be tried on a selection.
// Mount after the app loaded: `import('/src/dev/calloutTopic.tsx').then(m => m.mount())`.
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "../i18n";
import { Markdown } from "../components/Markdown";
import { AgentMarkdownScope } from "../components/AgentMarkdownScope";

export const CALLOUT_REPLY = `讲讲所有权。

> [!EXPLAIN] 所有权：每个值只有一个主人
> 变量离开作用域时，它拥有的值会被自动释放（\`drop\`）。赋值或传参会**移动**所有权，旧变量随之失效：
>
> \`\`\`rust
> let s = String::from("hi");
> let t = s;      // s 移给 t
> \`\`\`
>
> - 一个值同一时刻只有一个所有者
> - move 之后旧变量不能再用；需要两份就 clone，只想看就借用 &

借用检查器在编译期确认：每个值同一时刻只有一个可变引用，或者任意多个共享引用，所以 Rust 不需要 GC 也没有数据竞争。

> [!TIP]
> 想同时保留两份，用 \`s.clone()\`；只想读，用 \`&s\`。

> [!WARNING] 别在循环里 clone 大字符串
> 每次 clone 都会复制整块堆内存。

> 普通引用块不受影响。`;

let root: Root | null = null;
export function mount(): void {
  let host = document.getElementById("callout-topic");
  if (!host) {
    host = document.createElement("div");
    host.id = "callout-topic";
    host.className = "fixed inset-y-0 left-0 z-40 w-[620px] overflow-auto border-r border-border bg-background p-6 text-foreground";
    // Inside the app's isolated layer, so its menus (z 160 there) draw above this panel.
    ([...document.querySelectorAll<HTMLElement>("#root div")].find((d) => getComputedStyle(d).isolation === "isolate") ?? document.body).append(host);
  }
  root ??= createRoot(host);
  root.render(<I18nProvider><div className="text-xs text-subtle mb-1">智能体 · tutor</div><AgentMarkdownScope paneId="callout-topic" hostId="local" sessionId="eva"><Markdown text={CALLOUT_REPLY} /></AgentMarkdownScope></I18nProvider>);
}
