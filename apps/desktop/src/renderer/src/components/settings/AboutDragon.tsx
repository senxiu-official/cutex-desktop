// Settings → 关于 easter egg: the cutex dragon wobbles and grows a little on every click until it
// fills the free space below the page; it starts small again each time Settings is opened
// (lib/aboutDragon.ts).
import { useLayoutEffect, useRef, useState } from "react";
import cutexLogo from "../../assets/cutex-logo.png";
import { DRAGON_BASE as BASE, dragonSize, setDragonSize } from "../../lib/aboutDragon";

const GROWTH = 1.2;
/** Room kept below the dragon so it never touches the window edge. */
const MARGIN = 24;

export function AboutDragon() {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState(dragonSize);
  const [max, setMax] = useState(Number.POSITIVE_INFINITY);

  // The free space: the page column's width and the window height below the dragon's top. The rows
  // above load asynchronously, so measure again whenever the page column changes size.
  const room = () => {
    const el = box.current;
    const top = img.current?.getBoundingClientRect().top;
    if (!el || top === undefined) return Number.POSITIVE_INFINITY;
    return Math.max(BASE, Math.min(el.getBoundingClientRect().width, window.innerHeight - top - MARGIN));
  };
  useLayoutEffect(() => {
    const measure = () => setMax(room());
    measure();
    const observer = new ResizeObserver(measure);
    if (box.current?.parentElement) observer.observe(box.current.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const shown = Math.min(size, max);
  const grow = () => {
    const limit = room();
    setMax(limit);
    const next = Math.min(Math.min(size, limit) * GROWTH, limit);
    setSize(next);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      img.current?.animate([{ rotate: "0deg" }, { rotate: "-7deg" }, { rotate: "5deg" }, { rotate: "-3deg" }, { rotate: "0deg" }], { duration: 450, easing: "ease-in-out" });
    }
    setDragonSize(next);
  };

  return (
    <div ref={box} className="flex w-full justify-center pt-8">
      <img
        ref={img}
        src={cutexLogo}
        alt=""
        draggable={false}
        onClick={grow}
        style={{ width: shown, height: shown }}
        className="cursor-pointer select-none rounded-[22%] shadow-lg transition-[width,height] duration-300 ease-out"
      />
    </div>
  );
}
