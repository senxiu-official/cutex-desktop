// One Markdown math formula (lib/markdownMath.ts parses it; KaTeX from lib/katexRender.ts typesets it):
// inline, a display block, or a pending opener of a streaming reply (its source as plain text). Before KaTeX
// has loaded, and when the formula does not parse, the source shows as written. Line boxes: lib/mathLayout.ts.
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { splitMathSource, type MathKind } from "../lib/markdownMath";
import { renderMath, useKatex } from "../lib/katexRender";
import { snapDisplayMath, snapInlineMath } from "../lib/mathLayout";
import { MATH_SOURCE_ATTR, retainMathCopy } from "../lib/mathCopy";
import { retainMathMenu } from "../lib/mathMenu";
import { useDevicePixelRatio } from "../lib/pixelRatio";

function useSnap(ref: RefObject<HTMLElement | null>, snap: (element: HTMLElement) => void, html: string | null) {
  const ratio = useDevicePixelRatio();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || html === null) return;
    snap(element);
    // Chat font size / zoom resize the formula, a narrower column moves it to another line: neither renders here.
    // Only widths count: the block grows taller with every streamed line, which changes nothing above it.
    const formula = element.querySelector(".katex-base");
    const block = element.parentElement?.closest("p, li, td, th, h1, h2, h3, h4, h5, h6, div");
    const win = element.ownerDocument.defaultView;
    if (!formula || !win?.ResizeObserver) return;
    const seen = new Map<Element, DOMRectReadOnly>();
    const observer = new win.ResizeObserver((entries) => {
      let changed = false;
      for (const { target, contentRect } of entries) {
        const before = seen.get(target);
        seen.set(target, contentRect);
        // The first report is the size snapped above.
        if (before && (before.width !== contentRect.width || (target === formula && before.height !== contentRect.height))) changed = true;
      }
      if (changed) snap(element);
    });
    observer.observe(formula);
    if (block) observer.observe(block);
    return () => observer.disconnect();
  }, [ref, snap, html, ratio]);
  useEffect(() => {
    const element = ref.current;
    if (!element || html === null) return;
    const releaseCopy = retainMathCopy(element.ownerDocument);
    const releaseMenu = retainMathMenu(element.ownerDocument);
    return () => {
      releaseCopy();
      releaseMenu();
    };
  }, [ref, html]);
}

function InlineMath({ source, html }: { source: string; html: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useSnap(ref, snapInlineMath, html);
  return (
    <span ref={ref} className="math-inline" {...{ [MATH_SOURCE_ATTR]: source }}>
      <span aria-hidden className="math-probe-top" />
      <span aria-hidden className="math-probe-bottom" />
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}

function DisplayMath({ source, html }: { source: string; html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useSnap(ref, snapDisplayMath, html);
  return <div ref={ref} className="math-display" {...{ [MATH_SOURCE_ATTR]: source }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathNode({ kind, source }: { kind: MathKind; source: string }) {
  const katex = useKatex();
  const { tex } = splitMathSource(source);
  const block = kind === "display";
  const rendered = kind !== "pending" && katex ? renderMath(katex, tex, block) : null;
  if (!rendered || "error" in rendered) {
    const title = rendered && "error" in rendered ? rendered.error : undefined;
    return block ? (
      <div className="math-source math-source-block" title={title}>
        {source}
      </div>
    ) : (
      <span className="math-source" title={title}>
        {source}
      </span>
    );
  }
  return block ? <DisplayMath source={source} html={rendered.html} /> : <InlineMath source={source} html={rendered.html} />;
}
