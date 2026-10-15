// Standalone renderer acceptance fixture. No product entry, bridge, store, daemon or clipboard.
import { useLayoutEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { PreserveTextSelection } from "../src/renderer/src/components/PreserveTextSelection";
import { ScriptText } from "../src/renderer/src/components/ScriptText";
import { rehypeFontRuns } from "../src/renderer/src/lib/rehypeFontRuns";
import { captureTextSelection } from "../src/renderer/src/lib/textSelection";

const host = document.getElementById("app")!;
const reactRoot = createRoot(host);
const baseRehype = Object.entries(defaultRehypePlugins).filter(([name]) => name !== "harden").map(([, plugin]) => plugin);
const routedRehype = [...baseRehype, rehypeFontRuns];
const plugins = { cjk, code };
const components = {};
const checks: Array<{ name: string; passed: boolean; actual: unknown; expected: unknown }> = [];
const observations: unknown[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  checks.push({ name, passed: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
}
const settle = () => new Promise<void>((resolve) => setTimeout(() => { void host.offsetHeight; resolve(); }, 25));
async function render(children: ReactNode) {
  flushSync(() => reactRoot.render(children));
  await settle();
}
async function reset() {
  document.getSelection()?.removeAllRanges();
  (document.activeElement as HTMLElement | null)?.blur?.();
  await render(null);
}
function Boundary({ children, revision, preserve = true }: { children: ReactNode; revision: string | number; preserve?: boolean }) {
  return preserve ? <PreserveTextSelection revision={revision}>{children}</PreserveTextSelection> : <div style={{ display: "contents" }}>{children}</div>;
}
function MarkdownView({ text, streaming, preserve = true, routed = true }: { text: string; streaming: boolean; preserve?: boolean; routed?: boolean }) {
  return <Boundary revision={`${streaming}:${text}`} preserve={preserve}>
    <div id="content"><Streamdown className="markdown" mode={streaming ? "streaming" : "static"}
      isAnimating={streaming} parseIncompleteMarkdown={streaming} plugins={plugins} components={components}
      rehypePlugins={routed ? routedRehype : baseRehype} shikiTheme={["github-light", "github-dark"]}>{text}</Streamdown></div>
  </Boundary>;
}
function byId(id: string): HTMLElement { return document.getElementById(id)!; }
function firstText(element: Node): Text {
  const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
  if (!node) throw new Error("Expected a text node");
  return node as Text;
}
function pointAt(element: Node, offset: number): { node: Text; offset: number } {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let rest = offset;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (rest <= node.length) return { node, offset: rest };
    rest -= node.length;
  }
  throw new Error(`Text offset ${offset} outside element`);
}
function select(element: Node, anchor: number, focus: number): string {
  const a = pointAt(element, anchor), f = pointAt(element, focus);
  document.getSelection()!.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  return document.getSelection()!.toString();
}
function offsetIn(element: Node, node: Node | null, offset: number): number | null {
  if (!node || !element.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
}
function selection(element: Node = byId("content")) {
  const current = document.getSelection()!;
  return { text: current.toString(), anchor: offsetIn(element, current.anchorNode, current.anchorOffset), focus: offsetIn(element, current.focusNode, current.focusOffset) };
}

async function plainAppend(preserve: boolean) {
  await reset();
  let text = "Plain job’s 中文 text";
  const view = () => <Boundary revision={text} preserve={preserve}><span id="content">{text}</span></Boundary>;
  await render(view());
  const originalNode = firstText(byId("content"));
  select(byId("content"), 3, 12);
  const expected = selection();
  const steps = [];
  for (let i = 0; i < 5; i++) {
    text += ` append${i}`;
    await render(view());
    const actual = selection();
    steps.push({ i, ...actual, sameTextNode: firstText(byId("content")) === originalNode });
    if (preserve) check(`same Text.data append ${i}`, actual, expected);
  }
  observations.push({ case: "plain append", preserve, expected, steps });
}

async function replacementAndPrefix() {
  await reset();
  const text = "他说：“run job’s task。”";
  await render(<Boundary revision={0}><span id="content">{text}</span></Boundary>);
  select(byId("content"), 17, 4);
  const expected = selection();
  const originalNode = firstText(byId("content"));
  await render(<Boundary revision={1}><span id="content"><ScriptText text={text} /></span></Boundary>);
  check("font spans replace raw text; backwards selection", selection(), expected);
  check("font spans preserve every source character", byId("content").textContent, text);
  check("replacement actually changed the text node", firstText(byId("content")) !== originalNode, true);
  await render(<Boundary revision={2}><span id="content"><ScriptText text={`Prefix ${text}`} /></span></Boundary>);
  check("insertion before selected text shifts both ends", selection(), { text: expected.text, anchor: expected.anchor! + 7, focus: expected.focus! + 7 });
}

async function markdownScenario(kind: "settled" | "active" | "backwards", preserve = true) {
  await reset();
  const prefix = Array.from({ length: 6 }, (_, i) => `Stable ${i}: 中文，job’s “**中文**” and *English*。`).join("\n\n") + "\n\n";
  let text = prefix + "他说：“run job’s task";
  await render(<MarkdownView text={text} streaming preserve={preserve} />);
  const paragraphs = () => [...byId("content").querySelectorAll("p")];
  const chosen = kind === "settled" ? paragraphs()[2]! : paragraphs().at(-1)!;
  const originalNode = firstText(chosen);
  select(chosen, kind === "backwards" ? 14 : 4, kind === "backwards" ? 4 : 14);
  const expected = selection();
  const expectedInParagraph = selection(chosen);
  const steps = [];
  for (let i = 0; i < 8; i++) {
    text += ` step${i}`;
    await render(<MarkdownView text={text} streaming preserve={preserve} />);
    const actual = selection();
    steps.push(actual);
    if (preserve) check(`Markdown ${kind} append ${i}`, actual, expected);
  }
  text += "。”";
  await render(<MarkdownView text={text} streaming preserve={preserve} />);
  if (preserve) check(`Markdown ${kind} quote closes`, selection(), expected);
  const beforeCompletionNode = firstText(kind === "settled" ? paragraphs()[2]! : paragraphs().at(-1)!);
  const beforeCompletionText = byId("content").textContent;
  const beforeCompletionHtml = byId("content").innerHTML;
  await render(<MarkdownView text={text} streaming={false} preserve={preserve} />);
  const actual = selection();
  if (preserve) check(`Markdown ${kind} streaming to static`, selection(kind === "settled" ? paragraphs()[2]! : paragraphs().at(-1)!), expectedInParagraph);
  observations.push({ case: `Markdown ${kind}`, preserve, expected, steps, afterCompletion: actual,
    appendKeptTextNode: beforeCompletionNode === originalNode,
    beforeCompletionText, afterCompletionText: byId("content").textContent,
    beforeCompletionHtml, afterCompletionHtml: byId("content").innerHTML,
    completionKeptTextNode: firstText(kind === "settled" ? paragraphs()[2]! : paragraphs().at(-1)!) === beforeCompletionNode });
}

async function crossScope(preserve: boolean) {
  await reset();
  const view = (text: string) => <><span id="outside">outside start </span><Boundary revision={text} preserve={preserve}><span id="content">{text}</span></Boundary></>;
  await render(view("inside 中文 text"));
  document.getSelection()!.setBaseAndExtent(firstText(byId("outside")), 2, firstText(byId("content")), 8);
  await render(view("inside 中文 text appended"));
  return selection(host);
}

function ChangeSelection({ revision, action }: { revision: number; action: "new" | "reverse" | "clear" }) {
  useLayoutEffect(() => {
    if (!revision) return;
    if (action === "clear") document.getSelection()!.removeAllRanges();
    else select(byId("content"), action === "reverse" ? 11 : 12, action === "reverse" ? 4 : 18);
  }, [revision, action]);
  return <span id="content">old choice; chosen replacement</span>;
}
async function explicitChildSelection() {
  for (const action of ["new", "reverse", "clear"] as const) {
    await reset();
    const view = (revision: number) => <Boundary revision={revision}><ChangeSelection revision={revision} action={action} /></Boundary>;
    await render(view(0));
    select(byId("content"), 4, 11);
    await render(view(1));
    if (action === "clear") check("child layout effect may clear selection", document.getSelection()!.rangeCount, 0);
    else check(`child layout effect may ${action} selection`, selection(), action === "reverse"
      ? { text: "choice;", anchor: 11, focus: 4 } : { text: "chosen", anchor: 12, focus: 18 });
  }
}

async function nativeTextarea() {
  await reset();
  const view = (text: string) => <><textarea id="native-input" defaultValue="native job’s 中文" /><Boundary revision={text}><span id="content">{text}</span></Boundary></>;
  await render(view("paragraph before"));
  select(byId("content"), 1, 6);
  const input = byId("native-input") as HTMLTextAreaElement;
  input.focus();
  input.setSelectionRange(4, 11, "backward");
  await render(view("paragraph before appended"));
  check("native textarea keeps focus and own backward selection", {
    active: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd,
    direction: input.selectionDirection, value: input.value,
  }, { active: true, start: 4, end: 11, direction: "backward", value: "native job’s 中文" });
}

async function repeatedParagraphs() {
  const repeated = "重复中文 word word，English repeat repeat。";
  const text = Array(5).fill(repeated).join("\n\n");
  await reset();
  await render(<MarkdownView text={text} streaming />);
  const paragraphs = () => [...byId("content").querySelectorAll("p")];
  const secondWord = repeated.indexOf("word") + 5;
  select(paragraphs()[2]!, secondWord + 4, secondWord);
  await render(<MarkdownView text={text} streaming={false} />);
  check("identical paragraphs keep the third paragraph and second repeated word", {
    ...selection(paragraphs()[2]!),
    paragraph: paragraphs().findIndex((p) => p.contains(document.getSelection()!.anchorNode)),
  }, { text: "word", anchor: secondWord + 4, focus: secondWord, paragraph: 2 });

  await reset();
  await render(<MarkdownView text={text} streaming />);
  const start = pointAt(paragraphs()[1]!, 2), end = pointAt(paragraphs()[3]!, 14);
  document.getSelection()!.setBaseAndExtent(end.node, end.offset, start.node, start.offset);
  const selectedCopyBefore = document.getSelection()!.toString();
  const domTextBefore = byId("content").textContent!;
  await render(<MarkdownView text={text} streaming={false} />);
  const current = document.getSelection()!;
  check("backward cross-paragraph selection keeps both original paragraph positions", {
    anchorParagraph: paragraphs().findIndex((p) => p.contains(current.anchorNode)),
    anchor: offsetIn(paragraphs()[3]!, current.anchorNode, current.anchorOffset),
    focusParagraph: paragraphs().findIndex((p) => p.contains(current.focusNode)),
    focus: offsetIn(paragraphs()[1]!, current.focusNode, current.focusOffset),
  }, { anchorParagraph: 3, anchor: 14, focusParagraph: 1, focus: 2 });
  const selectedCopyAfter = current.toString();
  check("cross-paragraph native copy text remains the same", selectedCopyAfter, selectedCopyBefore);
  observations.push({ case: "repeated paragraph mode switch", domTextBefore,
    domTextAfter: byId("content").textContent, selectedCopyBefore, selectedCopyAfter,
    note: "Streamdown itself adds LF text nodes between blocks in static mode; original DOM text is not rewritten by the selection boundary" });
}

async function realWhitespace() {
  for (const kind of ["inline", "pre", "pre-parent", "inline-blocks", "structural"] as const) {
    await reset();
    const content = kind === "inline" ? <p id="content"><span>A</span>{"\n"}<span>B</span></p>
      : kind === "pre" ? <pre id="content">{"A\nB"}</pre>
      : <div id="content" style={{ whiteSpace: kind === "pre-parent" ? "pre" : "normal" }}>
        <p style={{ display: kind === "inline-blocks" ? "inline" : undefined }}>A</p>{"\n"}
        <p style={{ display: kind === "inline-blocks" ? "inline" : undefined }}>B</p>
      </div>;
    await render(<Boundary revision={0}>{content}</Boundary>);
    document.getSelection()!.selectAllChildren(byId("content"));
    const snapshot = captureTextSelection(byId("content"));
    check(`${kind} whitespace logical indexing`, snapshot?.text, kind === "structural" ? "AB" : "A\nB");
    check(`${kind} whitespace leaves source textContent untouched`, byId("content").textContent, "A\nB");
  }
}

async function sourceAndCopyParity() {
  await reset();
  const text = "他说：“run **job’s** task。”\n\nShe said, “中文.”\n\n中文，😀 👩‍💻 é，English *nested* quotation。\n\nPath: C:\\work\\job’s.txt / https://example.com/中文?q=1\n\n`code job’s 中文`";
  await render(<MarkdownView text={text} streaming={false} preserve={false} routed={false} />);
  const baseline = byId("content").textContent;
  document.getSelection()!.selectAllChildren(byId("content"));
  const copyBaseline = document.getSelection()!.toString();
  await reset();
  await render(<MarkdownView text={text} streaming={false} />);
  check("routed Markdown textContent matches default Streamdown", byId("content").textContent, baseline);
  document.getSelection()!.selectAllChildren(byId("content"));
  check("native selected copy text matches default Streamdown", document.getSelection()!.toString(), copyBaseline);
  check("inline code receives no font run spans", byId("content").querySelector("code .font-run-latin, code .font-run-cjk"), null);
}

(window as unknown as { runFontSelectionProbe: () => Promise<unknown> }).runFontSelectionProbe = async () => {
  await plainAppend(false);
  await plainAppend(true);
  await replacementAndPrefix();
  await markdownScenario("active", false);
  for (const kind of ["settled", "active", "backwards"] as const) await markdownScenario(kind);
  const baselineCross = await crossScope(false);
  check("cross-scope selection follows browser default", await crossScope(true), baselineCross);
  await nativeTextarea();
  await explicitChildSelection();
  await repeatedParagraphs();
  await realWhitespace();
  await sourceAndCopyParity();
  const result = { userAgent: navigator.userAgent,
    scope: "Isolated React + Streamdown package fixture and real routing components; no app bridge, daemon, clipboard access or installed-font modification",
    limitation: "No guarantee for nested asynchronous commits that bypass PreserveTextSelection, selected text replacement, or selections spanning message boundaries",
    passed: checks.every((item) => item.passed), checks, observations };
  byId("status").textContent = `${checks.filter((item) => item.passed).length}/${checks.length} checks passed`;
  return result;
};
