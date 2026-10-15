// Top row of a paged timeline (history pages): fetches the next older page as soon as it scrolls
// into view — and again while it stays in view after a short page — or on click.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { OlderHistory } from "../lib/historyPages";
import { BusyDots } from "./BusyDots";

/** Whether `el` is inside the visible part of its scrolling ancestor (else of the window). */
function inScrollView(el: HTMLElement): boolean {
  let box: { top: number; bottom: number } = { top: 0, bottom: window.innerHeight };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") {
      box = p.getBoundingClientRect();
      break;
    }
  }
  const r = el.getBoundingClientRect();
  return r.bottom > box.top && r.top < box.bottom;
}

export function OlderHistoryRow({ older, onLoad }: { older: OlderHistory; onLoad(): void }) {
  const { t } = useI18n();
  const row = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = row.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const ready = visible && !!older.cursor && !older.loading && !older.error;
  const load = useRef(onLoad);
  load.current = onLoad;
  useEffect(() => {
    // `visible` can be stale right after a page landed (the view was moved back down in a layout
    // effect, the observer reports it a frame later): check the real position before loading more.
    if (ready && row.current && inScrollView(row.current)) load.current();
  }, [ready, older.cursor]);

  return (
    <div ref={row} className="my-2 flex min-h-6 items-center justify-center text-xs text-subtle">
      {older.error ? (
        <span title={older.error}>
          {t("conversation.olderFailed")}
          <button onClick={onLoad} className="ml-2 text-accent hover:underline">
            {t("conversation.olderRetry")}
          </button>
        </span>
      ) : older.loading ? (
        <span className="flex items-center gap-2">
          <BusyDots />
          {t("conversation.loadingOlder")}
        </span>
      ) : (
        <button onClick={onLoad} className="rounded-full border border-border px-3 py-1 text-muted hover:bg-surface-2 hover:text-foreground">
          {t("conversation.loadOlder")}
        </button>
      )}
    </div>
  );
}
