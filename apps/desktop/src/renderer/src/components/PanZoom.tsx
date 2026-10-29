// Wheel zoom, drag to pan and fit ⇄ 100 % for one image (lib/imagePanZoom), shared by the enlarged view
// (ImageThumbs ImageZoom) and the side-pane image preview (SideImage). The caller renders the image as usual
// ("fit": its own layout) and gives the hook two elements: `frame`, the box that becomes the viewport once
// zoomed, and `img`, the fitted image. Zooming starts from exactly where the fitted image is on screen; zooming
// back out to that size returns to the caller's layout.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { actualAt, panBy, wheelFactor, zoomAt, type Size, type View } from "../lib/imagePanZoom";
import { useOwnerWindow } from "../lib/ownerContext";

export interface PanZoomOptions {
  /** Plain wheel zooms only once zoomed; before that Ctrl / ⌘ + wheel (a side pane scrolls with the wheel). */
  wheelNeedsMod?: boolean;
  /** The viewport's least height once zoomed (a small image in a pane still gets room to zoom into). */
  minHeight?: number;
}

export interface PanZoom {
  frameRef: React.RefObject<HTMLDivElement | null>;
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** null = the caller's fitted layout. */
  view: View | null;
  natural: Size | null;
  /** 100 % ⇄ 适应 means something: zoomed, or fitted smaller than the image's own size. */
  canActual: boolean;
  /** The viewport size while zoomed. */
  box: Size | null;
  /** Read the image's natural size (its onLoad). */
  measure(img: HTMLImageElement): void;
  /** Fitted → 100 % (at the centre); zoomed → fitted. */
  toggleActual(): void;
  reset(): void;
  /** A drag just moved the image: the click that ends it is not a click. */
  dragged(): boolean;
  frameProps: {
    onPointerDown(e: ReactPointerEvent): void;
    onPointerMove(e: ReactPointerEvent): void;
    onPointerUp(e: ReactPointerEvent): void;
    onDoubleClick(e: ReactMouseEvent): void;
    style?: CSSProperties;
  };
}

export function usePanZoom({ wheelNeedsMod = false, minHeight = 0 }: PanZoomOptions = {}): PanZoom {
  const win = useOwnerWindow();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  // The fitted image is shown smaller than its own size (kept current while the layout changes).
  const [shrunk, setShrunk] = useState(false);
  // The fitted scale the zoom started from: zooming back to it ends the zoom.
  const fit = useRef(1);
  const drag = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);
  const moved = useRef(0);
  const live = useRef({ view, box, natural });
  live.current = { view, box, natural };

  const measure = useCallback((img: HTMLImageElement) => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setShrunk(img.getBoundingClientRect().width < img.naturalWidth - 0.5);
  }, []);
  useEffect(() => {
    const img = imgRef.current;
    if (!natural || !img || typeof ResizeObserver === "undefined") return;
    const ro = new win.ResizeObserver(() => {
      if (!live.current.view) setShrunk(img.getBoundingClientRect().width < natural.w - 0.5);
    });
    ro.observe(img);
    return () => ro.disconnect();
  }, [natural]);

  /** The fitted image as a view of the frame (where it is on screen now), and the frame as the viewport. */
  const start = (): { v: View; b: Size; frame: DOMRect } | null => {
    const frame = frameRef.current?.getBoundingClientRect(), img = imgRef.current?.getBoundingClientRect(), n = live.current.natural;
    if (!frame || !img || !n || !img.width) return null;
    const b = { w: frame.width, h: Math.max(frame.height, minHeight) };
    fit.current = img.width / n.w;
    return { v: { scale: img.width / n.w, x: img.left - frame.left, y: img.top - frame.top }, b, frame };
  };
  const apply = (next: View, b: Size) => {
    if (next.scale <= fit.current + 1e-6) {
      setView(null);
      setBox(null);
    } else {
      setView(next);
      setBox(b);
    }
  };

  const zoomBy = (factor: number, clientX: number, clientY: number) => {
    const n = live.current.natural;
    if (!n) return;
    const cur = live.current.view && live.current.box ? { v: live.current.view, b: live.current.box, frame: frameRef.current!.getBoundingClientRect() } : start();
    if (!cur) return;
    apply(zoomAt(cur.v, factor, { x: clientX - cur.frame.left, y: clientY - cur.frame.top }, n, cur.b, fit.current), cur.b);
  };

  // Wheel: non-passive (it must not scroll the page under it).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!live.current.natural) return;
      if (wheelNeedsMod && !live.current.view && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(wheelFactor(e.deltaY, e.deltaMode), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads live state through refs
  }, [wheelNeedsMod, frameRef.current]);

  const toggleActual = () => {
    const n = live.current.natural;
    if (live.current.view || !n) return reset();
    const cur = start();
    if (cur) apply(actualAt(cur.v, n, cur.b), cur.b);
  };
  const reset = () => {
    setView(null);
    setBox(null);
  };

  const frameProps: PanZoom["frameProps"] = {
    onPointerDown: (e) => {
      moved.current = 0;
      if (!live.current.view || e.button !== 0) return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current, { view: v, box: b, natural: n } = live.current;
      if (!d || d.id !== e.pointerId || !v || !b || !n) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      moved.current = d.moved;
      setView(panBy(v, dx, dy, n, b));
    },
    onPointerUp: (e) => {
      if (drag.current?.id === e.pointerId) drag.current = null;
    },
    onDoubleClick: (e) => {
      e.stopPropagation();
      if (live.current.view) return reset();
      const n = live.current.natural, cur = start();
      if (n && cur) apply(actualAt(cur.v, n, cur.b, { x: e.clientX - cur.frame.left, y: e.clientY - cur.frame.top }), cur.b);
    },
    style: view && box ? { height: box.h, cursor: drag.current ? "grabbing" : "grab", overflow: "hidden", touchAction: "none" } : undefined,
  };

  return { frameRef, imgRef, view, natural, canActual: !!natural && (shrunk || !!view), box, measure, toggleActual, reset, dragged: () => moved.current > 3, frameProps };
}

/** The zoomed image inside the frame (nothing while fitted). */
export function PanZoomImage({ pz, src, alt = "" }: { pz: PanZoom; src: string; alt?: string }) {
  if (!pz.view || !pz.natural) return null;
  const { scale, x, y } = pz.view;
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      data-pan-zoom-image=""
      style={{ position: "absolute", left: 0, top: 0, width: pz.natural.w, height: pz.natural.h, maxWidth: "none", maxHeight: "none", transform: `translate(${x}px, ${y}px) scale(${scale})`, transformOrigin: "0 0" }}
    />
  );
}
