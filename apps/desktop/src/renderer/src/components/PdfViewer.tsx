// PDF preview (lazy chunk: pdf.js + its worker load only when a PDF is opened; isolation notes in
// lib/pdfjs.ts). Pages are placeholders until they scroll near the view; a page far out of view drops
// its canvas and text layer again, so a long document keeps only a few pages in memory. Toolbar:
// previous / next, page number, zoom out / in, fit width. The text layer makes text selectable.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Maximize2, Minus, Plus } from "lucide-react";
import { useI18n } from "../i18n";
import { clampZoom, pageAt, parsePage, stepZoom } from "../lib/docPreview";
import { openPdf, TextLayer, type PDFDocumentProxy, type RenderTask } from "../lib/pdfjs";
import "./docPreview.css";

/** pdf.js page units (1/72 in) → CSS px (1/96 in), as pdf.js's own viewer scales. */
const CSS_UNITS = 96 / 72;
const PAGE_GAP = 12;
const PAD = 16;

type Size = { w: number; h: number };
type Observe = (el: Element, onChange: (near: boolean) => void) => () => void;

function PdfPage({ doc, n, scale, fallback, observe }: { doc: PDFDocumentProxy; n: number; scale: number; fallback: Size; observe: Observe }) {
  const box = useRef<HTMLDivElement>(null);
  const canvasHolder = useRef<HTMLDivElement>(null);
  const textHolder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => (box.current ? observe(box.current, setNear) : undefined), [observe]);
  useEffect(() => {
    if (!near) return;
    let live = true;
    let task: RenderTask | null = null;
    let text: TextLayer | null = null;
    const canvas = document.createElement("canvas");
    void doc.getPage(n).then(
      (page) => {
        if (!live) return;
        const raw = page.getViewport({ scale: 1 });
        setSize({ w: raw.width, h: raw.height });
        const viewport = page.getViewport({ scale: scale * CSS_UNITS });
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvasHolder.current?.replaceChildren(canvas);
        task = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        task.promise.catch(() => {});
        const layer = textHolder.current;
        if (layer) {
          layer.replaceChildren();
          text = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
          text.render().catch(() => {});
        }
      },
      () => {},
    );
    return () => {
      live = false;
      task?.cancel();
      text?.cancel();
      // Release the bitmap now (a detached canvas keeps its memory until GC).
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      textHolder.current?.replaceChildren();
    };
  }, [doc, n, scale, near]);
  const s = size ?? fallback;
  const w = Math.floor(s.w * scale * CSS_UNITS);
  const h = Math.floor(s.h * scale * CSS_UNITS);
  return (
    <div ref={box} data-page={n} className="pdf-page relative mx-auto bg-white shadow-sm ring-1 ring-black/10" style={{ width: w, height: h, marginBottom: PAGE_GAP, ["--scale-factor" as string]: scale * CSS_UNITS }}>
      <div ref={canvasHolder} className="absolute inset-0" />
      <div ref={textHolder} className="textLayer" />
    </div>
  );
}

export default function PdfViewer({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [first, setFirst] = useState<Size | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState("1");

  useEffect(() => {
    setDoc(null);
    setFirst(null);
    setError(null);
    const task = openPdf(bytes);
    let live = true;
    task.promise.then(
      async (d) => {
        const p = await d.getPage(1);
        const v = p.getViewport({ scale: 1 });
        if (!live) return;
        setFirst({ w: v.width, h: v.height });
        setDoc(d);
      },
      (e: unknown) => {
        if (!live) return;
        const nameOf = (e as { name?: string })?.name;
        setError(nameOf === "PasswordException" ? "password" : e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
      void task.destroy();
    };
  }, [bytes]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [doc]);

  const scale = useMemo(() => {
    if (zoom !== "fit") return zoom;
    if (!first || width <= 0) return 1;
    return clampZoom((width - PAD * 2) / (first.w * CSS_UNITS));
  }, [zoom, first, width]);

  // One observer for every page: "near" = within about two screens of the view.
  const watchers = useRef(new Map<Element, (near: boolean) => void>());
  const [io, setIo] = useState<IntersectionObserver | null>(null);
  useEffect(() => {
    const root = scroller.current;
    if (!root || !doc) return;
    const obs = new IntersectionObserver((entries) => entries.forEach((e) => watchers.current.get(e.target)?.(e.isIntersecting)), { root, rootMargin: "200% 0px" });
    watchers.current.forEach((_, el) => obs.observe(el));
    setIo(obs);
    return () => obs.disconnect();
  }, [doc]);
  const observe = useCallback<Observe>(
    (el, onChange) => {
      watchers.current.set(el, onChange);
      io?.observe(el);
      return () => {
        watchers.current.delete(el);
        io?.unobserve(el);
      };
    },
    [io],
  );

  const count = doc?.numPages ?? 0;
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const tops = Array.from(el.querySelectorAll<HTMLElement>(".pdf-page"), (p) => p.offsetTop);
    const n = pageAt(tops, el.scrollTop + el.clientHeight / 3);
    if (n !== page) {
      setPage(n);
      setPageText(String(n));
    }
  };
  const goTo = (n: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${n}"]`);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - PAD;
    setPage(n);
    setPageText(String(n));
  };
  // Zooming keeps the current page in view.
  const zoomTo = (next: number | "fit") => {
    const keep = page;
    setZoom(next);
    requestAnimationFrame(() => goTo(keep));
  };

  if (error) return <p className="p-3 text-xs text-danger">{error === "password" ? t("docPreview.password") : t("docPreview.failed", { error })}</p>;
  const button = "inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1 text-xs" role="toolbar" aria-label={name}>
        <button className={button} disabled={!doc || page <= 1} onClick={() => goTo(page - 1)} title={t("docPreview.prev")} aria-label={t("docPreview.prev")}>
          <ChevronUp size={14} />
        </button>
        <button className={button} disabled={!doc || page >= count} onClick={() => goTo(page + 1)} title={t("docPreview.next")} aria-label={t("docPreview.next")}>
          <ChevronDown size={14} />
        </button>
        <input
          value={pageText}
          disabled={!doc}
          aria-label={t("docPreview.page")}
          onChange={(e) => setPageText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const n = parsePage(pageText, count);
            if (n) goTo(n);
            else setPageText(String(page));
          }}
          onBlur={() => setPageText(String(page))}
          className="h-6 w-10 rounded border border-border bg-surface px-1 text-center tabular-nums"
        />
        <span className="text-subtle tabular-nums">{t("docPreview.pageOf", { n: count || "…" })}</span>
        <span className="flex-1" />
        <button className={button} disabled={!doc} onClick={() => zoomTo(stepZoom(scale, -1))} title={t("docPreview.zoomOut")} aria-label={t("docPreview.zoomOut")}>
          <Minus size={14} />
        </button>
        <span className="w-10 text-center text-subtle tabular-nums">{Math.round(scale * 100)}%</span>
        <button className={button} disabled={!doc} onClick={() => zoomTo(stepZoom(scale, 1))} title={t("docPreview.zoomIn")} aria-label={t("docPreview.zoomIn")}>
          <Plus size={14} />
        </button>
        <button className={`${button} ${zoom === "fit" ? "bg-surface-2 text-foreground" : ""}`} disabled={!doc} onClick={() => zoomTo("fit")} title={t("docPreview.fitWidth")} aria-label={t("docPreview.fitWidth")} aria-pressed={zoom === "fit"}>
          <Maximize2 size={13} />
        </button>
      </div>
      <div ref={scroller} onScroll={onScroll} className="pdf-scroller relative min-h-0 flex-1 overflow-auto bg-surface-2" style={{ padding: PAD }}>
        {!doc || !first ? (
          <p className="text-xs text-subtle">{t("docPreview.loading")}</p>
        ) : (
          Array.from({ length: count }, (_, i) => <PdfPage key={i + 1} doc={doc} n={i + 1} scale={scale} fallback={first} observe={observe} />)
        )}
      </div>
    </div>
  );
}
