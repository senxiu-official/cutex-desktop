// 图片编辑 (owner 2026-11-28): crop / rotate / pen / highlighter / arrow / rectangle / ellipse / text / 打码 over one
// image, with undo / redo / 重置. Opened from a composer attachment (编辑…: saving replaces the attachment, the original
// is kept for 恢复原图) and from the image viewer (编辑后附加: saving attaches the copy to the composer). The edit model
// and its replay / export are lib/imageEdit; this is the overlay. Pure renderer: canvas only, no network.
// The tool bar starts under the band the window's own buttons need (components/WindowControls captionBand, as the
// enlarged view): Windows' caption buttons / macOS' traffic lights; 0 on Linux. That band stays a window drag area
// like the window bar it covers.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Circle, Crop, Grid3x3, Highlighter, MoveUpRight, Pencil, Redo2, RotateCcw, RotateCw, Square, Type, Undo2, X } from "lucide-react";
import { captionBand } from "./WindowControls";
import { useI18n } from "../i18n";
import { isMac } from "../lib/openModifiers";
import { displayKey } from "../lib/shortcuts";
import { useOwnerWindow } from "../lib/ownerContext";
import { useTrackOverlay } from "../lib/openOverlays";
import { sharedResizeObserver } from "../lib/resizeHub";
import {
  canRedo, canUndo, centredRatioRect, clampRect, cropDrag, drawOp, emptyHistory, exportEdited, meaningful, mosaicBlock, moveRect, pushOp, rectFrom,
  redoEdit, replay, resetEdit, sizeAfter, strokeWidths, TEXT_LINE, textFont, textSize, undoEdit,
  type EditOp, type EditTool, type Point, type Rect, type Size, type Surface,
} from "../lib/imageEdit";

const COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#111111", "#ffffff"] as const;
const HIGHLIGHT_DEFAULT = "#facc15";
const RATIOS: { key: string; ratio: number | null; label?: string }[] = [
  { key: "free", ratio: null }, { key: "1:1", ratio: 1, label: "1:1" }, { key: "4:3", ratio: 4 / 3, label: "4:3" },
  { key: "3:4", ratio: 3 / 4, label: "3:4" }, { key: "16:9", ratio: 16 / 9, label: "16:9" }, { key: "9:16", ratio: 9 / 16, label: "9:16" },
];
const TOOLS: { tool: EditTool; icon: ReactNode }[] = [
  { tool: "crop", icon: <Crop size={16} aria-hidden /> },
  { tool: "pen", icon: <Pencil size={16} aria-hidden /> },
  { tool: "highlight", icon: <Highlighter size={16} aria-hidden /> },
  { tool: "arrow", icon: <MoveUpRight size={16} aria-hidden /> },
  { tool: "rect", icon: <Square size={16} aria-hidden /> },
  { tool: "ellipse", icon: <Circle size={16} aria-hidden /> },
  { tool: "text", icon: <Type size={16} aria-hidden /> },
  { tool: "mosaic", icon: <Grid3x3 size={16} aria-hidden /> },
];
const BTN = "flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-muted outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 disabled:hover:bg-transparent";
const BTN_ON = "bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent";
const SEP = <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;
const DISCARD_ARMED_MS = 2500;

export interface ImageEditResult { url: string; type: "image/png" | "image/jpeg"; size: Size }

export interface ImageEditorProps {
  /** The image (a data: URL, or any src the renderer can draw without tainting the canvas). */
  src: string;
  /** Byte limit of the saved copy (the agent's per-image limit). */
  maxBytes: number;
  /** The save button's words (保存 / 附加到输入框). */
  saveLabel?: string;
  /** Save even without edits (编辑后附加: attaching the image as it is is still a result). */
  saveUnchanged?: boolean;
  onCancel(): void;
  onSave(result: ImageEditResult): void;
  /** 恢复原图: shown when the attachment was edited before. */
  onRestore?(): void;
}

const surfaceFactory = (doc: Document) => (w: number, h: number): Surface => {
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas as unknown as Surface;
};

type Drag =
  | { kind: "draw"; op: EditOp; start: Point }
  | { kind: "crop-new"; anchor: Point }
  | { kind: "crop-move"; last: Point }
  | { kind: "crop-resize"; anchor: Point };

export function ImageEditor({ src, maxBytes, saveLabel, saveUnchanged = false, onCancel, onSave, onRestore }: ImageEditorProps) {
  const { t } = useI18n();
  const win = useOwnerWindow();
  const factory = useMemo(() => surfaceFactory(win.document), [win]);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState(emptyHistory);
  const [tool, setTool] = useState<EditTool>("arrow");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_DEFAULT);
  const [step, setStep] = useState(1);
  const [crop, setCrop] = useState<{ rect: Rect | null; ratio: number | null; key: string }>({ rect: null, ratio: null, key: "free" });
  const [text, setText] = useState<{ at: Point; value: string } | null>(null);
  const [armed, setArmed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const band = captionBand();
  // Modal: the input box's and the conversation's Esc (stop the turn) never act under it.
  useTrackOverlay(true);

  useEffect(() => {
    let live = true;
    const img = win.document.createElement("img");
    img.onload = () => live && setImage(img);
    img.onerror = () => live && setFailed(true);
    img.src = src;
    return () => { live = false; };
  }, [src, win]);

  const base = useMemo<Size>(() => (image ? { w: image.naturalWidth, h: image.naturalHeight } : { w: 1, h: 1 }), [image]);
  // The edited image at full size: replayed when the operations change, not on each pointer move.
  const composed = useMemo(() => (image ? replay(image, base, history.ops, factory) : null), [image, base, history.ops, factory]);
  const size = useMemo(() => (composed ? { w: composed.width, h: composed.height } : sizeAfter(base, history.ops)), [composed, base, history.ops]);
  const widths = strokeWidths(size);
  const scale = stage.w && stage.h ? Math.min(1, stage.w / size.w, stage.h / size.h) : 0;
  const shown = { w: Math.max(1, Math.floor(size.w * scale)), h: Math.max(1, Math.floor(size.h * scale)) };
  const dirty = history.ops.length > 0;
  const activeColor = tool === "highlight" ? highlightColor : color;

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = sharedResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The visible canvas: the composed image plus the operation being drawn.
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !composed) return;
    if (canvas.width !== composed.width || canvas.height !== composed.height) { canvas.width = composed.width; canvas.height = composed.height; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(composed as unknown as CanvasImageSource, 0, 0);
    const d = drag.current;
    if (d?.kind === "draw") drawOp(ctx, d.op, canvas as unknown as Surface, factory);
  }, [composed, factory]);
  // The frame paints with the latest composed image: a frame asked for before a commit must not draw the old one.
  const paintNow = useRef(paint);
  paintNow.current = paint;
  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = win.requestAnimationFrame(() => { frame.current = 0; paintNow.current(); });
  }, [win]);
  useLayoutEffect(() => { paint(); }, [paint]);
  useEffect(() => () => { if (frame.current) win.cancelAnimationFrame(frame.current); }, [win]);

  useEffect(() => { rootRef.current?.focus(); }, []);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), DISCARD_ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 2400);
    return () => clearTimeout(timer);
  }, [status]);

  const commit = useCallback((op: EditOp) => {
    if (meaningful(op)) setHistory((h) => pushOp(h, op));
  }, []);

  const toImage = (e: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
  };

  // The open text box, read by its blur / Enter / a click elsewhere (whichever comes first commits it once).
  const textNow = useRef(text);
  textNow.current = text;
  const commitText = useCallback(() => {
    const cur = textNow.current;
    if (!cur) return;
    textNow.current = null;
    setText(null);
    if (cur.value.trim()) commit({ kind: "text", at: cur.at, text: cur.value.replace(/\s+$/, ""), color, size: textSize(step, size) });
  }, [commit, color, step, size]);

  const applyCrop = useCallback(() => {
    const r = crop.rect && clampRect(crop.rect, size);
    if (!r || (r.w === size.w && r.h === size.h)) { setCrop((c) => ({ ...c, rect: null })); return; }
    commit({ kind: "crop", rect: r });
    setCrop((c) => ({ ...c, rect: null }));
  }, [crop.rect, size, commit]);

  const pickTool = (next: EditTool) => {
    if (text) commitText();
    setTool(next);
    setCrop((c) => ({ ...c, rect: null }));
  };

  const undo = () => { setCrop((c) => ({ ...c, rect: null })); setText(null); setHistory(undoEdit); };
  const redo = () => { setCrop((c) => ({ ...c, rect: null })); setText(null); setHistory(redoEdit); };
  const reset = () => { setCrop((c) => ({ ...c, rect: null })); setText(null); setHistory(resetEdit); };
  const rotate = (turns: 1 | 3) => { setCrop((c) => ({ ...c, rect: null })); commit({ kind: "rotate", turns }); };

  const save = useCallback(() => {
    if (saving || !composed) return;
    if (!dirty && !saveUnchanged) return onCancel();
    setSaving(true);
    // A frame first so 正在保存… shows before the (synchronous) encode of a large image.
    win.setTimeout(() => {
      try {
        const out = exportEdited(composed, maxBytes, factory, { encode: (s, type, q) => (s as unknown as HTMLCanvasElement).toDataURL(type, q) });
        if (!out) { setStatus(t("imageEdit.tooLarge")); setSaving(false); return; }
        onSave(out);
      } catch {
        setStatus(t("imageEdit.failed"));
        setSaving(false);
      }
    }, 16);
  }, [saving, composed, dirty, saveUnchanged, onCancel, win, maxBytes, factory, onSave, t]);

  const cancel = useCallback(() => {
    if (dirty && !armed) { setArmed(true); return; }
    onCancel();
  }, [dirty, armed, onCancel]);

  // Keys of this overlay only (it is modal): the app's own shortcuts do not run under it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target === textRef.current) return; // the text box handles its own Enter / Esc
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      // A focused button keeps its own Enter / Space.
      if ((e.key === "Enter" || e.key === " ") && !mod && (e.target as HTMLElement | null)?.closest?.("button")) return;
      let handled = true;
      if (e.key === "Escape") {
        if (crop.rect) setCrop((c) => ({ ...c, rect: null }));
        else cancel();
      } else if (mod && key === "z" && !e.shiftKey) undo();
      else if (mod && ((key === "z" && e.shiftKey) || key === "y")) redo();
      else if (e.key === "Enter" && !e.isComposing) {
        if (mod) save();
        else if (tool === "crop" && crop.rect) applyCrop();
        else save();
      } else if (e.key === "Tab") handled = false;
      else handled = mod || e.altKey;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    };
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => { if (text) textRef.current?.focus(); }, [text?.at]);

  // ---------- pointer ----------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !composed || saving) return;
    const p = toImage(e);
    if (tool === "text") {
      e.preventDefault();
      if (text) { commitText(); return; }
      setText({ at: p, value: "" });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "crop") {
      const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-crop-handle]")?.dataset.cropHandle;
      const r = crop.rect;
      if (r && handle) {
        // Resize from the opposite corner.
        const anchor = { x: handle.includes("l") ? r.x + r.w : r.x, y: handle.includes("t") ? r.y + r.h : r.y };
        drag.current = { kind: "crop-resize", anchor };
      } else if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        drag.current = { kind: "crop-move", last: p };
      } else {
        drag.current = { kind: "crop-new", anchor: p };
        setCrop((c) => ({ ...c, rect: { x: p.x, y: p.y, w: 0, h: 0 } }));
      }
      return;
    }
    const width = widths[step]!;
    const op: EditOp = tool === "pen" || tool === "highlight" ? { kind: tool, points: [p], color: activeColor, width }
      : tool === "arrow" ? { kind: "arrow", from: p, to: p, color, width }
      : tool === "mosaic" ? { kind: "mosaic", rect: { x: p.x, y: p.y, w: 0, h: 0 }, block: mosaicBlock(size) }
      : { kind: tool, rect: { x: p.x, y: p.y, w: 0, h: 0 }, color, width };
    drag.current = { kind: "draw", op, start: p };
    schedule();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toImage(e);
    if (d.kind === "draw") {
      const op = d.op;
      if (op.kind === "pen" || op.kind === "highlight") {
        const last = op.points[op.points.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * scale >= 1.5) op.points.push(p);
      } else if (op.kind === "arrow") op.to = p;
      else if (op.kind === "rect" || op.kind === "ellipse" || op.kind === "mosaic") {
        op.rect = e.shiftKey && op.kind !== "mosaic" ? cropDrag(d.start, p, 1, { w: Infinity, h: Infinity }) : rectFrom(d.start, p);
      }
      schedule();
    } else if (d.kind === "crop-new" || d.kind === "crop-resize") {
      setCrop((c) => ({ ...c, rect: cropDrag(d.anchor, p, c.ratio, size) }));
    } else if (d.kind === "crop-move") {
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      d.last = p;
      setCrop((c) => (c.rect ? { ...c, rect: moveRect(c.rect, dx, dy, size) } : c));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "draw") {
      if (d.op.kind === "mosaic") {
        const r = clampRect(d.op.rect, size);
        if (r) commit({ ...d.op, rect: r });
      } else commit(d.op);
      schedule();
    } else if (d?.kind === "crop-new") {
      setCrop((c) => (c.rect && (c.rect.w < 3 || c.rect.h < 3) ? { ...c, rect: null } : c));
    }
  };

  const pickRatio = (key: string, ratio: number | null) => {
    setCrop((c) => ({ key, ratio, rect: ratio ? centredRatioRect(ratio, size) : c.rect }));
  };

  // ---------- render ----------

  const pct = (r: Rect): CSSProperties => ({ left: `${(r.x / size.w) * 100}%`, top: `${(r.y / size.h) * 100}%`, width: `${(r.w / size.w) * 100}%`, height: `${(r.h / size.h) * 100}%` });
  const undoKey = displayKey("Ctrl+Z", isMac());
  const redoKey = displayKey("Ctrl+Shift+Z", isMac());
  const hint = tool === "crop" ? t("imageEdit.crop.hint") : tool === "text" ? t("imageEdit.text.hint") : tool === "mosaic" ? t("imageEdit.mosaic.hint") : null;
  const textStyle: CSSProperties | undefined = text ? {
    left: `${(text.at.x / size.w) * 100}%`, top: `${(text.at.y / size.h) * 100}%`,
    font: textFont(Math.max(10, textSize(step, size) * scale)), lineHeight: TEXT_LINE, color,
  } : undefined;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("imageEdit.title")}
      tabIndex={-1}
      data-testid="image-editor"
      data-tool={tool}
      className="fixed inset-0 z-[156] flex flex-col bg-black/80 text-foreground outline-none [app-region:no-drag]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The window bar's strip: the caption buttons stay reachable, the window can still be dragged by it. */}
      <div aria-hidden style={{ height: band }} className="shrink-0 [app-region:drag]" />
      <div className={`flex shrink-0 justify-center px-3 pb-2 ${band ? "" : "pt-3"}`}>
        <div role="toolbar" aria-label={t("imageEdit.tools")} data-image-editor-toolbar="" className="float flex max-w-full flex-wrap items-center gap-0.5 p-1">
          {TOOLS.map(({ tool: id, icon }) => (
            <button key={id} type="button" data-tool-button={id} aria-pressed={tool === id} data-tip={t(`imageEdit.tool.${id}`)} aria-label={t(`imageEdit.tool.${id}`)}
              onClick={() => pickTool(id)} className={`${BTN} ${tool === id ? BTN_ON : ""}`}>{icon}</button>
          ))}
          {SEP}
          {tool === "crop" ? (
            <>
              {RATIOS.map((r) => (
                <button key={r.key} type="button" data-crop-ratio={r.key} aria-pressed={crop.key === r.key} onClick={() => pickRatio(r.key, r.ratio)}
                  className={`${BTN} px-2 text-xs ${crop.key === r.key ? BTN_ON : ""}`}>{r.label ?? t("imageEdit.crop.free")}</button>
              ))}
              {SEP}
              <button type="button" data-crop-apply="" disabled={!crop.rect} onClick={applyCrop} className={`${BTN} px-2 text-xs`}>
                <Check size={14} aria-hidden />{t("imageEdit.crop.apply")}
              </button>
            </>
          ) : tool !== "mosaic" && (
            <>
              <span role="radiogroup" aria-label={t("imageEdit.color")} className="flex items-center gap-0.5">
                {COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={activeColor === c} aria-label={c} data-color={c}
                    onClick={() => (tool === "highlight" ? setHighlightColor(c) : setColor(c))}
                    className={`${BTN} min-w-6 px-1`}>
                    <span className={`block h-4 w-4 rounded-full border ${activeColor === c ? "ring-2 ring-accent ring-offset-1 ring-offset-[var(--float)]" : ""} ${c === "#ffffff" ? "border-border" : "border-black/10"}`} style={{ background: c }} />
                  </button>
                ))}
              </span>
              {SEP}
              <span role="radiogroup" aria-label={t("imageEdit.width")} className="flex items-center gap-0.5">
                {([0, 1, 2] as const).map((i) => (
                  <button key={i} type="button" role="radio" aria-checked={step === i} data-width={i} aria-label={t(`imageEdit.width.${i}`)} data-tip={t(`imageEdit.width.${i}`)}
                    onClick={() => setStep(i)} className={`${BTN} min-w-7 ${step === i ? BTN_ON : ""}`}>
                    <span className="block rounded-full bg-current" style={{ width: 14, height: [2, 4, 7][i] }} />
                  </button>
                ))}
              </span>
            </>
          )}
          {SEP}
          <button type="button" data-rotate="left" onClick={() => rotate(3)} data-tip={t("imageEdit.rotateLeft")} aria-label={t("imageEdit.rotateLeft")} className={BTN}><RotateCcw size={16} aria-hidden /></button>
          <button type="button" data-rotate="right" onClick={() => rotate(1)} data-tip={t("imageEdit.rotateRight")} aria-label={t("imageEdit.rotateRight")} className={BTN}><RotateCw size={16} aria-hidden /></button>
          {SEP}
          <button type="button" data-undo="" disabled={!canUndo(history)} onClick={undo} data-tip={`${t("imageEdit.undo")} (${undoKey})`} aria-label={t("imageEdit.undo")} className={BTN}><Undo2 size={16} aria-hidden /></button>
          <button type="button" data-redo="" disabled={!canRedo(history)} onClick={redo} data-tip={`${t("imageEdit.redo")} (${redoKey})`} aria-label={t("imageEdit.redo")} className={BTN}><Redo2 size={16} aria-hidden /></button>
          <button type="button" data-reset="" disabled={!dirty} onClick={reset} className={`${BTN} px-2 text-xs`}>{t("imageEdit.reset")}</button>
        </div>
      </div>
      <div ref={stageRef} className="relative min-h-0 flex-1 px-6">
        {failed ? (
          <div role="alert" className="flex h-full items-center justify-center"><span className="float px-4 py-3 text-sm">{t("imageEdit.failed")}</span></div>
        ) : composed && scale > 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              data-image-editor-canvas=""
              className={`relative touch-none overflow-hidden shadow-2xl ${tool === "text" ? "cursor-text" : tool === "crop" && crop.rect ? "cursor-default" : "cursor-crosshair"}`}
              style={{ width: shown.w, height: shown.h }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <canvas ref={canvasRef} className="block h-full w-full" />
              {tool === "crop" && crop.rect && crop.rect.w > 0 && (
                <div data-crop-box="" className="absolute cursor-move border border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" style={pct(crop.rect)}>
                  <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }, (_, i) => <span key={i} className="border-[0.5px] border-white/30" />)}
                  </div>
                  {(["tl", "tr", "bl", "br"] as const).map((h) => (
                    <span key={h} data-crop-handle={h}
                      className={`absolute h-3 w-3 rounded-sm border border-black/40 bg-white ${h[0] === "t" ? "-top-1.5" : "-bottom-1.5"} ${h[1] === "l" ? "-left-1.5" : "-right-1.5"} ${h === "tl" || h === "br" ? "cursor-nwse-resize" : "cursor-nesw-resize"}`} />
                  ))}
                </div>
              )}
              {text && (
                <textarea
                  ref={textRef}
                  data-image-editor-text=""
                  rows={Math.max(1, text.value.split("\n").length)}
                  value={text.value}
                  placeholder={t("imageEdit.text.placeholder")}
                  onChange={(e) => setText((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={commitText}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") { e.preventDefault(); setText(null); }
                    else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); commitText(); }
                  }}
                  className="absolute min-w-40 resize-none overflow-hidden border border-dashed border-white/70 bg-black/20 p-0 outline-none placeholder:text-white/60"
                  style={{ ...textStyle, width: `${Math.max(10, Math.max(...text.value.split("\n").map((l) => l.length)) + 2)}ch` }}
                />
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <span role="status" data-image-editor-status="" className="min-w-0 flex-1 truncate text-xs text-white/80">
          {armed ? t("imageEdit.discardArmed") : status ?? hint}
        </span>
        {onRestore && (
          <button type="button" data-image-editor-restore="" onClick={onRestore} className="h-8 rounded-md px-3 text-sm text-white/85 hover:bg-white/10 hover:text-white">{t("imageEdit.restore")}</button>
        )}
        <button type="button" data-image-editor-cancel="" onClick={onCancel} className="flex h-8 items-center gap-1 rounded-md px-3 text-sm text-white/85 hover:bg-white/10 hover:text-white">
          <X size={14} aria-hidden />{t("imageEdit.cancel")}
        </button>
        <button type="button" data-image-editor-save="" disabled={saving || !composed} onClick={save}
          className="flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50">
          <Check size={14} aria-hidden />{saving ? t("imageEdit.saving") : saveLabel ?? t("imageEdit.save")}
        </button>
      </div>
    </div>,
    win.document.body,
  );
}
