// Long notification text (owner 2026-10-15): wrapped, never a sideways scrollbar, cut at `lines`
// lines with a soft fade and a 「展开」 / 「收起」 toggle under it. The toggle only appears when the
// content really is taller than the clamp (measured, re-measured on resize / content change).
// `.wrap-all` (styles.css) also makes Markdown code blocks and tables inside wrap.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useI18n } from "../i18n";
import { sharedResizeObserver } from "../lib/resizeHub";
import { useUserLayoutToggle } from "../lib/userLayoutToggle";

export function ClampBox({ lines, className, children, resetKey }: { lines: number; className?: string; children: ReactNode; resetKey?: unknown }) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  const box = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => setExpanded(false), [resetKey]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      // Expanded: compare against the clamp height the box would have (lines × line height).
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
      setOverflows(el.scrollHeight > lines * lineHeight + 2);
    };
    measure();
    // Content changes reach us as size changes (the box, or a child growing inside the clamp); children
    // that come later are observed as they arrive. Not keyed on `children` (new JSX every render: a
    // forced layout per render otherwise).
    const observer = sharedResizeObserver(measure);
    const observeAll = () => {
      observer.observe(el);
      for (const child of el.children) observer.observe(child);
    };
    observeAll();
    const mutations = new MutationObserver(() => {
      observeAll();
      measure();
    });
    mutations.observe(el, { childList: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [lines]);
  const clamped = overflows && !expanded;
  return (
    <div className="min-w-0">
      <div
        ref={box}
        data-clamped={clamped || undefined}
        className={`wrap-all min-w-0 overflow-hidden break-words ${className ?? ""}`}
        style={
          clamped
            ? { maxHeight: `${lines}lh`, maskImage: "linear-gradient(to bottom, #000 calc(100% - 1.5lh), transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 1.5lh), transparent)" }
            : undefined
        }
      >
        {children}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => userToggle(() => setExpanded((v) => !v))}
          aria-expanded={expanded}
          className="mt-0.5 flex items-center gap-0.5 rounded text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t(expanded ? "clamp.collapse" : "clamp.expand")}
        </button>
      )}
    </div>
  );
}
