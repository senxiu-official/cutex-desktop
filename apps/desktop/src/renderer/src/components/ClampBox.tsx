// Long notification text (owner 2026-10-15): wrapped, never a sideways scrollbar, cut at `lines`
// lines with a soft fade and a 「展开」 / 「收起」 toggle under it. The toggle only appears when the
// content really is taller than the clamp (measured, re-measured on resize / content change).
// `.wrap-all` (styles.css) also makes Markdown code blocks and tables inside wrap.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useI18n } from "../i18n";

export function ClampBox({ lines, className, children, resetKey }: { lines: number; className?: string; children: ReactNode; resetKey?: unknown }) {
  const { t } = useI18n();
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
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [lines, children]);
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
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-0.5 flex items-center gap-0.5 rounded text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {t(expanded ? "clamp.collapse" : "clamp.expand")}
        </button>
      )}
    </div>
  );
}
