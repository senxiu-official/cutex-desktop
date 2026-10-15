// Standalone Vite preview of the real renderer components. Uses the mock bridge only.
import { createRoot } from "react-dom/client";
import { Markdown } from "../components/Markdown";
import { ScriptText } from "../components/ScriptText";
import { AppearancePage } from "../components/settings/AppearanceSettings";
import { I18nProvider } from "../i18n";
import { DEFAULT_APPEARANCE, getFontStatus, setAppearance, subscribeBeforeFontChange, subscribeFontChanges, useFontStatus } from "../lib/appearance";
import { captureFontScrollAnchor } from "../lib/fontScrollAnchor";
import "../styles.css";

const SAMPLES = [
  ["english", "She said, “English.”"],
  ["chinese", "他说：“中文。”"],
  ["mixed", "他说：“run job’s task。”"],
  ["english-host", "She said, “中文。”"],
  ["apostrophe", "中文，job’s，中文"],
  ["nested", "他说：“Read ‘job’s guide’.”"],
  ["standalone", "“中文” “English”"],
  ["unclosed", "他说：“unclosed"],
  // Needs a shared quote: text without one keeps plain text nodes (no runs to inspect).
  ["broad", "ABC 中文“DEF”"],
] as const;
const initial = { ...DEFAULT_APPEARANCE, uiFont: "Segoe UI", cjkFont: "KingHwa_OldSong", chatFont: "Segoe UI", chatCjkFont: "KingHwa_OldSong" };
setAppearance(initial, false);

function Preview() {
  const status = useFontStatus();
  return <I18nProvider><main style={{ maxWidth: 1000, margin: "32px auto", padding: "0 28px 40px" }}>
    <h1 style={{ fontSize: 26, fontWeight: 600 }}>Cutex 中英文混排 · 研发预览</h1>
    <p className="my-3 text-sm text-muted">使用正式正文、纯文本及设置预览组件。引号按外层叙述语境分配，词内撇号保持英文。</p>
    <p id="font-status" className="text-xs text-subtle">{status.phase === "loading" ? "正在加载…" : status.failedFamilies.length ? `回退字体：${status.failedFamilies.join(", ")}` : "Segoe UI + KingHwa_OldSong"}</p>
    <div className="my-5 flex gap-2 text-sm">
      <button className="rounded border border-border px-3 py-1" onClick={() => setAppearance(initial, false)}>恢复示例字体</button>
      <button className="rounded border border-border px-3 py-1" onClick={() => setAppearance(DEFAULT_APPEARANCE, false)}>系统默认字体</button>
    </div>
    <section style={{ fontSize: 30 }}>
      {SAMPLES.map(([id, text]) => <div key={id} className="font-chat-context border-b border-border py-3" id={`sample-${id}`}><ScriptText text={text} /></div>)}
    </section>
    <section id="markdown-example" className="my-6" style={{ "--chat-font-size": "26px" } as React.CSSProperties}>
      <Markdown text={'他说：**“run** [job’s task](https://example.com)。”\n\nShe said, **“English.”**\n\n`const 中文 = “job’s”;`'} />
    </section>
    <div className="flex gap-5 py-3 text-2xl"><strong id="sample-bold"><ScriptText text="Bold English 中文" /></strong><em id="sample-italic"><ScriptText text="Italic English 中文" /></em></div>
    <details className="my-5"><summary className="cursor-pointer text-sm">字体设置（与正文共用生效字体）</summary><AppearancePage /></details>
    <details><summary className="cursor-pointer text-sm">滚动与原生输入框检查</summary>
      <textarea id="native-input" defaultValue="他说：“run job’s task。”" className="my-3 w-full rounded border border-border p-2" />
      <div id="scroll-probe" style={{ height: 240, overflow: "auto", overflowAnchor: "none" }}>
        {Array.from({ length: 36 }, (_, i) => <div key={i} data-turn-id={`turn-${i}`}><Markdown text={`${i}. 他说：“run job’s task。” ${"中文与 English mixed prose. ".repeat(8)}`} /></div>)}
      </div>
    </details>
  </main></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function ready() {
  const deadline = performance.now() + 10000;
  while (getFontStatus().phase === "loading") {
    if (performance.now() > deadline) throw new Error("Font generation did not settle");
    await frame();
  }
  await frame(); await frame();
}
async function setFonts(patch: Parameters<typeof setAppearance>[0]) { setAppearance(patch, false); await ready(); return getFontStatus(); }
function metrics() {
  return [...document.querySelectorAll<HTMLElement>("[id^=sample-] .font-run-latin, [id^=sample-] .font-run-cjk, #markdown-example .font-run-latin, #markdown-example .font-run-cjk")].map((el, i) => {
    el.id = `font-probe-${i}`;
    return { id: el.id, sample: el.closest("[id^=sample-]")?.id ?? "markdown", text: el.textContent, kind: el.className, family: getComputedStyle(el).fontFamily, weight: getComputedStyle(el).fontWeight, style: getComputedStyle(el).fontStyle };
  });
}
async function check() {
  await ready();
  const checks: { name: string; ok: boolean }[] = [];
  const assert = (name: string, ok: boolean) => { checks.push({ name, ok }); if (!ok) throw new Error(name); };
  for (const [id, text] of SAMPLES) {
    const el = document.getElementById(`sample-${id}`)!;
    const range = document.createRange(); range.selectNodeContents(el);
    assert(`copy unchanged: ${id}`, range.toString() === text && el.textContent === text);
  }
  assert("pure English uses Latin runs", !document.querySelector("#sample-english .font-run-cjk"));
  assert("English word and apostrophe stay one run", [...document.querySelectorAll("#sample-mixed .font-run-latin")].some((el) => el.textContent === "run job’s task"));
  assert("Markdown code excluded", !document.querySelector("#markdown-example code [class^=font-run]"));
  assert("Markdown link target intact", document.querySelector<HTMLAnchorElement>("#markdown-example a")?.href === "https://example.com/");
  const node = document.querySelector("#sample-mixed .font-run-latin");
  await setFonts({ chatFont: "Georgia" });
  assert("font change preserves prose DOM", document.querySelector("#sample-mixed .font-run-latin") === node);
  const scroller = document.getElementById("scroll-probe")!;
  scroller.closest("details")!.open = true;
  const folded = document.createElement("div");
  folded.id = "clipped-probe";
  folded.className = "markdown";
  folded.style.cssText = "height:40px;overflow:hidden";
  const hiddenParagraph = document.createElement("p");
  hiddenParagraph.style.height = "3000px";
  hiddenParagraph.textContent = "Folded message";
  folded.append(hiddenParagraph);
  scroller.prepend(folded);
  await frame();
  scroller.scrollTop = 950;
  assert("clipped text is outside visible fold but has an intersecting raw rect", folded.getBoundingClientRect().bottom < scroller.getBoundingClientRect().top && hiddenParagraph.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top);
  const anchor = [...scroller.querySelectorAll(".markdown p, .markdown li")].find((el) => !folded.contains(el) && el.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top)!;
  const top = () => anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const before = top();
  let restore = () => {};
  const offBefore = subscribeBeforeFontChange(() => { restore = captureFontScrollAnchor(scroller, false); });
  const offAfter = subscribeFontChanges(() => restore());
  await setFonts({ chatFont: "Segoe UI" });
  const scrollDelta = top() - before;
  offBefore(); offAfter();
  assert("reading block stays anchored during font change", Math.abs(scrollDelta) <= 1);
  folded.remove();
  scroller.scrollTop = scroller.scrollHeight;
  const restoreBottom = captureFontScrollAnchor(scroller, true);
  scroller.style.width = "60%"; restoreBottom();
  assert("bottom stays attached after reflow", Math.abs(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) <= 1);
  scroller.style.width = "";
  scroller.closest("details")!.open = false;
  await setFonts({ chatFont: "Cutex Missing Font Probe 20261010" });
  assert("missing selected face reported", getFontStatus().failedFamilies.includes("Cutex Missing Font Probe 20261010"));
  await setFonts(initial);
  return { checks, scrollDelta, status: getFontStatus(), metrics: metrics() };
}
declare global { interface Window { fontRoutingProbe: { ready: typeof ready; setFonts: typeof setFonts; metrics: typeof metrics; check: typeof check } } }
window.fontRoutingProbe = { ready, setFonts, metrics, check };
