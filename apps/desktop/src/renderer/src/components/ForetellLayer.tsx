// 动作预告 (docs/design/008-foretell.md; lib/foretell): the dashed outline over each area a click would affect,
// in the colour of what happens (red 替换 / 关掉, blue 打开 / 聚焦, green 并排, grey 收起), with the result
// sentence on it. Areas are found by selector and re-measured every frame while shown (columns glide);
// nothing here takes pointer events. Fades in unless reduced motion. Its tint follows 拖放落点预览 (lib/dropTint).
//
// Drawn in the window of the control that shows it (lib/foretell `doc`; a desk window's, multi-window).
import { useEffect, useState } from "react";
import { DROP_TINT } from "../lib/dropTint";
import { boxInView, halfBox, markText, markTone, useForetellStore, type Foretell, type ForetellBox, type ForetellMark, type ForetellTone } from "../lib/foretell";
import { useOwnerWindow } from "../lib/ownerContext";
import { useOverlayHoles } from "../lib/overlayHoles";
import { OwnerLayer } from "./OwnerLayer";
import "./foretell.css";

/** The first laid-out element matching `selector` — a comma list is tried in order (hidden ones skipped). */
function boxOf(selector: string, doc: Document): ForetellBox | null {
  for (const one of selector.split(",")) {
    for (const el of doc.querySelectorAll<HTMLElement>(one.trim())) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
  }
  return null;
}

/** Where a mark is drawn in `win`: its box, else its element (or that element's half) there — cut to the window. */
function markBox(m: ForetellMark, win: Window): ForetellBox | null {
  const found = m.box ?? (m.selector ? boxOf(m.selector, win.document) : null);
  const box = found && m.half && !m.box ? halfBox(found, m.half) : found;
  return box && boxInView(box, { width: win.innerWidth, height: win.innerHeight });
}

export function ForetellLayer() {
  const shown = useForetellStore((s) => s.shown);
  const doc = useForetellStore((s) => s.doc);
  if (!shown) return null;
  return (
    <OwnerLayer doc={doc}>
      <ForetellMarks shown={shown} />
    </OwnerLayer>
  );
}

function ForetellMarks({ shown }: { shown: Foretell }) {
  const win = useOwnerWindow();
  // Under every menu / popover (owner 2026-10-23): a hole where each open one is (lib/overlayHoles; z: foretell.css).
  const holes = useOverlayHoles(!!shown);
  const [, tick] = useState(0);
  // While shown: follow the areas (a column gliding, the window resizing).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      tick((n) => (n + 1) % 1_000_000);
      raf = win.requestAnimationFrame(loop);
    };
    raf = win.requestAnimationFrame(loop);
    return () => win.cancelAnimationFrame(raf);
  }, [shown, win]);
  return (
    <div data-foretell="" aria-hidden className="foretell-layer" style={holes ? { clipPath: holes } : undefined}>
      {shown.marks.map((m, i) => {
        const box = markBox(m, win);
        if (!box) return null;
        const tone: ForetellTone = markTone(shown, m);
        const text = markText(shown, i);
        return (
          <div key={i} data-foretell-mark={tone} className={`foretell-mark ${DROP_TINT}`} style={{ left: box.left + 3, top: box.top + 3, width: Math.max(0, box.width - 6), height: Math.max(0, box.height - 6) }}>
            {text && <span className="foretell-text">{text}</span>}
          </div>
        );
      })}
      {/* Screen readers: the sentence once. */}
      <span className="sr-only" role="status">
        {shown.text}
      </span>
    </div>
  );
}
