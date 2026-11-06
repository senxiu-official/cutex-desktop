import { resizeObserverFor } from "../../lib/ownerWindow";
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { DEFAULT_BROWSER_CURSOR_COLOR, browserCursorOutline, type BrowserCursorView } from "../../../../shared/browserCursor";
import "./BrowserAgentCursor.css";

/** Desktop document only. Its transparent overlay never enters or captures input from the guest. */
export function BrowserAgentCursor({ cue, granted, visible, viewport }: { cue?: BrowserCursorView; granted: boolean; visible: boolean; viewport: RefObject<HTMLDivElement | null> }) {
  const [available, setAvailable] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const invalidated = useRef(0);
  const current = useRef(cue); current.current = cue;
  useLayoutEffect(() => {
    const target = viewport.current, doc = target?.ownerDocument;
    if (!target || !doc) return;
    const check = () => {
      const c = current.current, size = target.getBoundingClientRect();
      const allowed = visible && granted && !doc.hidden && !!c && size.width > 0 && size.height > 0
        && Math.abs(size.width - c.viewport.width) < 1.5 && Math.abs(size.height - c.viewport.height) < 1.5;
      if (!allowed && c) invalidated.current = Math.max(invalidated.current, c.sequence);
      setAvailable(allowed);
    };
    check(); doc.addEventListener("visibilitychange", check);
    const observer = resizeObserverFor(target, check); observer?.observe(target);
    return () => { doc.removeEventListener("visibilitychange", check); observer?.disconnect(); };
  }, [viewport, visible, granted, cue?.sequence, cue?.viewport.width, cue?.viewport.height]);
  useLayoutEffect(() => {
    setFeedback(!!cue && cue.phase === "dispatch");
    if (!cue || cue.phase !== "dispatch") return;
    const timer = setTimeout(() => setFeedback(false), cue.kind === "click" ? 420 : 850);
    return () => clearTimeout(timer);
  }, [cue?.sequence, cue?.phase, cue?.kind]);
  if (!cue || !available || !granted || !visible || cue.sequence <= invalidated.current) return null;
  const outline = browserCursorOutline(cue.color);
  const style = { "--agent-cursor-color": cue.color, "--agent-cursor-outline": outline } as CSSProperties;
  return <div data-browser-agent-cursor data-default-color={cue.color === DEFAULT_BROWSER_CURSOR_COLOR || undefined} data-cursor-kind={cue.kind} data-cursor-phase={cue.phase} aria-hidden className="browser-agent-cursor-overlay" style={style}>
    {feedback && cue.kind === "type" && cue.rect && <div data-agent-focus-ring className="browser-agent-focus-ring" style={{ left: cue.rect.x, top: cue.rect.y, width: cue.rect.width, height: cue.rect.height }} />}
    <div data-agent-cursor-tip className="browser-agent-cursor-pointer" style={{ transform: `translate(${cue.x}px, ${cue.y}px)` }}>
      {feedback && cue.kind === "click" && <span key={cue.sequence} data-agent-click-pulse className="browser-agent-click-pulse" />}
      <svg width="24" height="24" viewBox="0 0 24 24"><path d="M0 0L20 7L7.8 7.8L7 20Z" transform="rotate(5)" fill="var(--agent-cursor-color)" stroke="var(--agent-cursor-outline)" strokeWidth="1.2" strokeLinejoin="round" /></svg>
      {feedback && cue.kind === "scroll" && <svg data-agent-scroll-hint className="browser-agent-scroll-hint" width="13" height="23" viewBox="0 0 13 23"><path d="m3 6 3.5-3.5L10 6M3 15l3.5 3.5L10 15" fill="none" stroke="var(--agent-cursor-color)" strokeWidth="1.8" /></svg>}
    </div>
  </div>;
}
