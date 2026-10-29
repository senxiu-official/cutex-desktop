// An image in a side-pane preview (a Shelf artifact, a file in the 文件 explorer / 预览 card): owner 2026-10-25,
// they could not be enlarged at all. A left click opens the conversation's enlarged view (ImageThumbs
// ImageZoom: 复制图片, wheel zoom, drag, 100 % ⇄ 适应); in the pane itself Ctrl/⌘ + wheel zooms at the cursor
// (a plain wheel keeps scrolling the pane until the image is zoomed), a drag pans, and a hover toolbar has
// 查看大图, 100 % ⇄ 适应 and 复制图片. The zoom is components/PanZoom, the same as the enlarged view's.
import { useState } from "react";
import { Copy, Maximize2 } from "lucide-react";
import { useI18n } from "../i18n";
import { api } from "../bridge";
import { contextMenu } from "../lib/contextMenu";
import { copyImage } from "../lib/imageCopy";
import { hostApi, useApp } from "../store";
import { ImageZoom } from "./ImageThumbs";
import { PanZoomImage, usePanZoom } from "./PanZoom";

const BTN = "flex h-7 min-w-7 items-center justify-center rounded-md bg-black/55 px-1.5 text-xs font-medium text-white/90 hover:bg-black/75 hover:text-white focus-visible:outline-2 focus-visible:outline-white";

export interface SideImageProps {
  /** The bytes as the pane already holds them (a data: URL). */
  src: string;
  alt: string;
  /** The host the image was read from (its main writes the clipboard; the bytes go inline). */
  hostId?: string | null;
  /** The frame (margins). */
  className?: string;
  /** Centre the image in the pane (else it starts at the left). */
  center?: boolean;
  /** The fitted image (its look in the pane). */
  imgClassName?: string;
}

export function SideImage({ src, alt, hostId, className = "", center = false, imgClassName = "" }: SideImageProps) {
  const { t } = useI18n();
  const pz = usePanZoom({ wheelNeedsMod: true, minHeight: 240 });
  const [open, setOpen] = useState(false);
  const copy = () => {
    const notify = useApp.getState().notify;
    return copyImage({ input: null, mime: null, src }, { imageAction: (input, action) => (hostId ? hostApi(hostId) : api).imageAction(input, action) }).then(
      () => (notify(t("image.copied")), true),
      () => (notify(t("image.actionFailed"), "error"), false),
    );
  };
  const menu = contextMenu(() => [
    { label: t("image.copy"), onSelect: async () => void (await copy()) },
    { label: t("image.enlarge"), onSelect: () => setOpen(true) },
  ]);
  const dimensions = pz.natural ? { width: pz.natural.w, height: pz.natural.h } : undefined;
  // The frame is the pane's width (the zoom viewport); the fitted image keeps the toolbar on its own corner.
  // The enlarged view is a sibling, not a child: React events bubble through its portal.
  return (
    <>
      <div ref={pz.frameRef} {...pz.frameProps} onContextMenu={menu} data-side-image="" data-zoomed={pz.view ? "" : undefined} className={`group relative ${className}`}>
        <div className={`relative w-fit max-w-full ${center ? "mx-auto" : ""}`}>
          <img
            ref={pz.imgRef}
            src={src}
            alt={alt}
            draggable={false}
            title={t("image.enlargeHint")}
            onLoad={(e) => pz.measure(e.currentTarget)}
            onClick={() => !pz.view && !pz.dragged() && setOpen(true)}
            className={`cursor-zoom-in ${imgClassName} ${pz.view ? "invisible" : ""}`}
          />
          <div
            data-side-image-toolbar=""
            role="toolbar"
            aria-label={t("image.toolbar")}
            className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <button type="button" data-side-image-enlarge="" title={t("image.enlarge")} aria-label={t("image.enlarge")} onClick={() => setOpen(true)} className={BTN}>
              <Maximize2 size={14} aria-hidden />
            </button>
            {pz.canActual && (
              <button type="button" data-side-image-actual="" title={t(pz.view ? "image.fit" : "image.actual")} aria-label={t(pz.view ? "image.fit" : "image.actual")} onClick={pz.toggleActual} className={BTN}>
                {pz.view ? t("image.fitShort") : "100%"}
              </button>
            )}
            <button type="button" data-side-image-copy="" title={t("image.copy")} aria-label={t("image.copy")} onClick={() => void copy()} className={BTN}>
              <Copy size={14} aria-hidden />
            </button>
          </div>
        </div>
        <PanZoomImage pz={pz} src={src} alt={alt} />
      </div>
      {open && <ImageZoom src={src} dimensions={dimensions} onClose={() => setOpen(false)} onContextMenu={menu} onCopy={copy} />}
    </>
  );
}
