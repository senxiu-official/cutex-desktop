// A once-a-second clock for one row that only runs while the row can be seen (perf §9, idle rules): `active`, the
// row on screen (IntersectionObserver of its own window) and its window's page visible. Off screen or hidden it
// holds no timer; when it shows again it reads the time at once. Readers share the 1 s ticker (lib/ticker).
import { useEffect, useState, type RefObject } from "react";
import { intersectionObserverFor, ownerDocumentOf } from "./ownerWindow";
import { subscribeTick } from "./ticker";

export function useVisibleNow(ref: RefObject<Element | null>, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const [onScreen, setOnScreen] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const doc = ownerDocumentOf(el);
    const page = () => setPageVisible(doc.visibilityState !== "hidden");
    page();
    doc.addEventListener("visibilitychange", page);
    // No IntersectionObserver (tests): counted as on screen.
    const io = intersectionObserverFor(el, (entries) => setOnScreen(entries.some((e) => e.isIntersecting)));
    io?.observe(el);
    return () => {
      doc.removeEventListener("visibilitychange", page);
      io?.disconnect();
    };
  }, [ref, active]);
  const ticking = active && onScreen && pageVisible;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    return subscribeTick(1000, setNow);
  }, [ticking]);
  return now;
}
