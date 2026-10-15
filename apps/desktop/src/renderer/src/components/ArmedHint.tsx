// The "click again" hint of an armed button (lib/armedConfirm) as a floating bubble anchored to the
// button: the button keeps its footprint (no label swap, no row reflow). Rendered into <body> with
// position: fixed, above the button when there is room (else below), clamped into the viewport; it
// follows scroll / resize and disappears with the armed state.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { armedHintPosition } from "../lib/armedConfirm";

export function ArmedHint({ anchor, text }: { anchor: RefObject<HTMLElement | null>; text: string }) {
  const bubble = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current;
      const b = bubble.current;
      if (!a || !b) return;
      const r = a.getBoundingClientRect();
      const next = armedHintPosition({ top: r.top, bottom: r.bottom, left: r.left, width: r.width }, { width: b.offsetWidth, height: b.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
      setPos((old) => (old && old.left === next.left && old.top === next.top ? old : { left: next.left, top: next.top }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, text]);
  return createPortal(
    <div
      ref={bubble}
      role="status"
      style={{ position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      className="pointer-events-none z-[1000] max-w-[min(22rem,calc(100vw-16px))] rounded-md border border-danger/50 bg-surface px-2 py-1 text-xs text-danger shadow-lg"
    >
      {text}
    </div>,
    document.body,
  );
}
