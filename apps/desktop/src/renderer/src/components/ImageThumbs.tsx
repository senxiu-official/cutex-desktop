// Image thumbnails with click → full size, one look for a message's images wherever it is: sent
// (Timeline), waiting in the queue (QueuePanel) and attached in the composer. A data: URL renders as
// is; a host path (a picked file, an attachment cutex stored) is read through cutex fs-file-read
// (lib/fileThumbnails, the cache Markdown thumbnails share) — never the local disk — when a `hostId`
// is given and the host has it; otherwise the caller's fallback (a file chip) shows.
import { useEffect, useReducer, useState, type ReactNode, type MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, Image as ImageIcon, X } from "lucide-react";
import { PanZoomImage, usePanZoom } from "./PanZoom";
import type { MessageImage } from "../../../shared/input";
import { EVENT_MEDIA_BLOBS_FEATURE, parseCutexBlobRef, parseMediaBlob } from "../../../shared/mediaBlobs";
import { useI18n } from "../i18n";
import { MAX_IMAGE_BYTES, type ImageActionInput } from "../../../shared/ipc";
import { useThumbnail } from "../lib/fileThumbnails";
import { captureMediaAuthority, mediaKey, parseMediaRef, readHistoryMedia, useMediaAuthority } from "../lib/historyMedia";
import { HOST_FILE_READ_FEATURE } from "../lib/workspace";
import { featuresOf, hostApi, useApp } from "../store";
import { api } from "../bridge";
import { copyImage } from "../lib/imageCopy";
import { isMac } from "../lib/openModifiers";
import { displayKey } from "../lib/shortcuts";
import { contextMenu } from "../lib/contextMenu";
import { fileActions } from "../lib/fileActions";
import { imageBox, imageDimensions, zoomImageBox, type ImageBounds } from "../lib/imageDimensions";
import { rememberedImageSize, rememberImageSize } from "../lib/imageSizes";
import { useLazyDataSrc } from "../lib/lazyImageSrc";
import { useOwnerWindow } from "../lib/ownerContext";

// The copy key of the enlarged view (a key of this view only, like Esc; not a window shortcut).
const COPY_CODE = "KeyC";
const ZOOM_BTN = "flex h-8 w-8 items-center justify-center rounded-md bg-black/55 text-white/90 hover:bg-black/75 hover:text-white focus-visible:outline-2 focus-visible:outline-white";

/**
 * Full size over everything; a left click (while fitted) or Esc closes. Toolbar (top right): 100 % ⇄ 适应,
 * 复制图片, 图片另存为… (when the image has a host read), 关闭; Ctrl/⌘+C copies (unless text is selected). The
 * wheel zooms at the cursor and a drag pans; zoomed, a click no longer closes (components/PanZoom, shared with
 * the side-pane preview, components/SideImage). Portaled: a `fixed` overlay inside a pane is boxed by it.
 */
export function ImageZoom({ src, onClose, onContextMenu, dimensions, onCopy, onSave }: { src: string; onClose(): void; onContextMenu?: MouseEventHandler; dimensions?: { width: number; height: number }; onCopy?(): Promise<boolean>; onSave?(): void }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  // The copy's outcome inside the view too: the app's toast sits under this overlay.
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const runCopy = onCopy && (() => void onCopy().then(setCopied));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const mod = isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!onCopy || !mod || e.altKey || e.shiftKey || e.code !== COPY_CODE) return;
      if (win.getSelection()?.toString()) return; // copying selected text stays the text's
      e.preventDefault();
      runCopy?.();
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [onClose, onCopy, win]);
  const copyTip = `${t("image.copy")} (${displayKey("Ctrl+C", isMac())})`;
  const pz = usePanZoom();
  return createPortal(
    <div
      ref={pz.frameRef}
      {...pz.frameProps}
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-8"
      onClick={() => !pz.view && !pz.dragged() && onClose()}
      onContextMenu={onContextMenu}
      data-testid="message-image-zoom"
      data-zoomed={pz.view ? "" : undefined}
    >
      <div data-image-zoom-toolbar="" role="toolbar" aria-label={t("image.toolbar")} className="absolute top-3 right-3 z-10 flex gap-1.5" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        {!failed && pz.canActual && (
          <button type="button" data-image-zoom-actual="" title={t(pz.view ? "image.fit" : "image.actual")} aria-label={t(pz.view ? "image.fit" : "image.actual")} onClick={pz.toggleActual} className={`${ZOOM_BTN} w-auto px-2 text-xs font-medium`}>
            {pz.view ? t("image.fitShort") : "100%"}
          </button>
        )}
        {onCopy && !failed && (
          <button type="button" data-image-zoom-copy="" title={copyTip} aria-label={t("image.copy")} onClick={runCopy} className={ZOOM_BTN}>
            <Copy size={16} aria-hidden />
          </button>
        )}
        {onSave && !failed && (
          <button type="button" data-image-zoom-save="" title={t("image.save")} aria-label={t("image.save")} onClick={onSave} className={ZOOM_BTN}>
            <Download size={16} aria-hidden />
          </button>
        )}
        <button type="button" data-image-zoom-close="" title={`${t("image.close")} (Esc)`} aria-label={t("image.close")} onClick={onClose} className={ZOOM_BTN}>
          <X size={16} aria-hidden />
        </button>
      </div>
      {copied !== null && (
        <span data-image-zoom-notice="" role="status" className={`absolute top-14 right-3 z-10 rounded-md px-2.5 py-1 text-xs shadow ${copied ? "bg-black/70 text-white" : "bg-danger-solid text-white"}`}>
          {t(copied ? "image.copied" : "image.actionFailed")}
        </span>
      )}
      <div style={zoomImageBox(dimensions)} data-image-zoom-box className={dimensions ? "" : "contents"}>
        {failed ? <span role="alert" className="flex h-full items-center justify-center rounded-lg bg-surface px-4 py-3 text-sm text-foreground">{t("image.failed")}</span> : <img ref={pz.imgRef} src={src} alt="" width={dimensions?.width} height={dimensions?.height} style={dimensions ? { width: "100%", height: "100%", objectFit: "contain", position: "absolute", inset: 0 } : undefined} onLoad={(e) => pz.measure(e.currentTarget)} onError={() => setFailed(true)} className={`max-h-full max-w-full rounded-lg shadow-2xl ${pz.view ? "invisible" : ""}`} />}
      </div>
      <PanZoomImage pz={pz} src={src} />
    </div>,
    win.document.body,
  );
}

/** The src of `image`: its data URL, or a host path's bytes read through cutex (null while unknown / unreadable). */
function useImageSrc(image: MessageImage, hostId: string | null | undefined, retry: number) {
  const authority = useMediaAuthority(hostId);
  const path = image.kind === "path" ? image.path : null;
  const blob = image.kind === "blob" ? parseMediaBlob(image.blob) : null;
  const blobRef = blob ? parseCutexBlobRef(blob.url) : image.kind === "url" ? parseCutexBlobRef(image.url) : null;
  const media = blobRef ? { ...blobRef, kind: "blob" as const } : image.kind === "url" ? parseMediaRef(image.url) : null;
  const canRead = useApp((s) => !!hostId && !!path && featuresOf(s, hostId).has(HOST_FILE_READ_FEATURE));
  const canBlob = useApp((s) => !!hostId && featuresOf(s, hostId).has(EVENT_MEDIA_BLOBS_FEATURE));
  const usable = image.kind === "blob" ? !!blob && canBlob && /^image\//.test(blob.mime) : !blobRef || canBlob;
  const baseKey = usable && media && hostId ? mediaKey(hostId, media) : canRead && hostId && path ? JSON.stringify([hostId, "host", path, authority]) : null;
  const key = baseKey ? `${baseKey}|${blob ? JSON.stringify([blob.mime, blob.size]) : "legacy"}|retry:${retry}` : null;
  const expected = blob ? { mime: blob.mime, size: blob.size } : undefined;
  // A sent image is up to the send cap (MAX_IMAGE_BYTES: pastes / picks on Codex agents, and the attachment
  // r259+ desktops upload them as), not the 5 MB of a Markdown file thumbnail: a 5–8 MB screenshot read
  // with that cap came back truncated and stayed a file chip once its optimistic preview was gone.
  const read = usable && media && hostId ? () => readHistoryMedia(hostId, media, expected) : key ? () => hostApi(hostId!).hostFile(path!, MAX_IMAGE_BYTES) : null;
  const { ref, state } = useThumbnail(key, read, { hostId: hostId ?? undefined, isCurrent: hostId ? captureMediaAuthority(hostId) : undefined, maxBytes: MAX_IMAGE_BYTES });
  if (image.kind === "url" && !media && !/^cutex-(media|blob):/.test(image.url)) return { ref, src: image.url, loading: false, key: image.url };
  return { ref, src: state.status === "ok" ? state.src : null, loading: !!key && (state.status === "idle" || state.status === "loading"), key };
}

/** The host read of an image for copy / save (a blob / media ref, an inline data URL); null for a path, or blobs on a host without them. */
function hostInput(image: MessageImage, hostId: string | null | undefined): { input: ImageActionInput; mime: string | null } | null {
  if (image.kind === "path") return null;
  const blob = image.kind === "blob" ? parseMediaBlob(image.blob) : null;
  const blobRef = blob ? parseCutexBlobRef(blob.url) : image.kind === "url" ? parseCutexBlobRef(image.url) : null;
  const media = blobRef ?? (image.kind === "url" ? parseMediaRef(image.url) : null);
  if (media) {
    if (!hostId) return null;
    const state = useApp.getState?.();
    if (blobRef && (!state || !featuresOf(state, hostId).has(EVENT_MEDIA_BLOBS_FEATURE))) return null;
    return { input: { kind: blobRef ? "blob" : "media", ...media, ...(blob ? { mime: blob.mime, size: blob.size } : {}) }, mime: blob?.mime ?? null };
  }
  if (image.kind === "url" && image.url.startsWith("data:image/")) return { input: { kind: "inline", dataUrl: image.url }, mime: /^data:(image\/[^;,]+)/.exec(image.url)?.[1] ?? null };
  return null;
}

function imageMetadata(image: MessageImage): string {
  const info = image.kind === "blob" ? image.blob : image.kind === "unavailable" ? image : null;
  if (!info) return "";
  const size = info.size;
  return [info.mime, typeof size === "number" ? size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : size >= 1024 ? `${Math.ceil(size / 1024)} KB` : `${size} B` : null].filter(Boolean).join(" · ");
}

/**
 * One image as a thumbnail button (click → ImageZoom). `className` sizes the button, `imgClassName`
 * the image; `fallback` shows when there is nothing to render (a path the host cannot read).
 * `rememberSize`: a host path without a size from cutex reserves the box it had when it last loaded here (lib/imageSizes).
 */
export function ImageThumb({ image, hostId, title, className, imgClassName, fallback, bounds, loadingPreview, rememberSize = false }: { image: MessageImage; hostId?: string | null; title?: string; className: string; imgClassName: string; fallback: ReactNode; bounds?: ImageBounds; loadingPreview?: string; rememberSize?: boolean }) {
  const { t } = useI18n();
  const pathText = image.kind === "path" && image.delivery === "pathText";
  const [retry, setRetry] = useState(0);
  const { ref, src: loadedSrc, loading, key } = useImageSrc(image, hostId, retry);
  // These bytes were already visible for this send before its attachment path arrived.
  // Keep their natural size while the authenticated host read catches up.
  const src = loadedSrc ?? (loading ? loadingPreview : null);
  // An inline image far off screen: a same-size placeholder until it comes near (lib/lazyImageSrc).
  const { lazyRef, shownSrc, pending } = useLazyDataSrc(src ?? null);
  const recorded = imageDimensions(image);
  const sizePath = rememberSize && !recorded && image.kind === "path" && hostId ? image.path : null;
  const [, followSize] = useReducer((n: number) => n + 1, 0);
  const dimensions = recorded ?? (sizePath ? rememberedImageSize(hostId!, sizePath) : undefined);
  const box = imageBox(dimensions, bounds);
  const [zoom, setZoom] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  useEffect(() => { setZoom(false); setActionNotice(null); }, [key, retry]);
  const authority = () => (hostId ? captureMediaAuthority(hostId) : () => true);
  const copy = (shown: string | null, current = authority()) => {
    const target = hostInput(image, hostId);
    const notify = useApp.getState().notify;
    return copyImage({ input: target?.input ?? null, mime: target?.mime ?? null, src: shown }, {
      imageAction: (input, action) => {
        if (!current()) throw Error("media_authority_changed");
        return (hostId ? hostApi(hostId) : api).imageAction(input, action);
      },
    }).then(
      () => (current() && notify(t("image.copied")), true),
      () => (current() && notify(t("image.actionFailed"), "error"), false),
    );
  };
  const save = (() => {
    const target = hostInput(image, hostId);
    if (!target || !hostId) return undefined;
    return async (current = captureMediaAuthority(hostId)) => {
      try {
        if (!current()) throw Error("media_authority_changed");
        const result = await hostApi(hostId).imageAction(target.input, "save");
        if (current() && result.status !== "cancelled") setActionNotice(t("image.saved"));
      } catch { if (current()) setActionNotice(t("image.actionFailed")); }
    };
  })();
  const menu = contextMenu(() => {
    const current = authority();
    const copyEntry = src && broken !== src ? [{ label: t("image.copy"), onSelect: async () => void (await copy(src, current)) }] : [];
    if (image.kind === "path") return [...copyEntry, ...(copyEntry.length ? ["separator" as const] : []), ...fileActions({ hostId: hostId ?? "unknown", path: image.path }, t)];
    const target = hostInput(image, hostId);
    if (!target || !hostId) return copyEntry;
    return [{ label: t("image.copy"), onSelect: async () => void (await copy(src && broken !== src ? src : null, current)) }, ...(save ? [{ label: t("image.save"), onSelect: () => save(current) }] : [])];
  });
  const metadata = imageMetadata(image);
  if (loading && !src) return <span ref={ref} style={box} data-image-box={dimensions ? "reserved" : undefined} onContextMenu={menu} role="status" title={`${t("image.loading")} ${metadata}`} aria-label={`${t("image.loading")} ${metadata}`} className={`flex items-center gap-1 overflow-hidden bg-surface-2 p-1 text-xs text-subtle ${className}`}><ImageIcon size={12} className="shrink-0" /><span className="min-w-0 truncate">{t("image.loading")}{metadata && ` · ${metadata}`}</span></span>;
  if (!src || broken === src) return <span ref={ref} onContextMenu={menu} className="inline-flex flex-col gap-1" data-image-failed="">
    {image.kind === "path" && !broken ? fallback : <span style={box} data-image-box={dimensions ? "reserved" : undefined} role="status" title={metadata} className={`flex items-center gap-1 overflow-hidden bg-surface-2 p-1 text-xs text-muted ${className}`}><ImageIcon size={12} className="shrink-0" /><span className="min-w-0 truncate">{t(pathText ? "image.pathTextUnavailable" : image.kind === "unavailable" || (image.kind === "blob" && !key) ? "image.unavailable" : "image.failed")}{metadata && ` · ${metadata}`}</span></span>}
    {key && <button type="button" onClick={() => { setBroken(null); setRetry((v) => v + 1); }} className="text-xs text-accent">{t("image.retry")}</button>}
    {actionNotice && <span role="status" className="text-xs text-muted">{actionNotice}</span>}
  </span>;
  return (
    <>
      <button
        ref={(element) => { ref.current = element; }}
        type="button"
        onContextMenu={menu}
        onClick={(e) => {
          e.stopPropagation();
          setZoom(true);
        }}
        title={title}
        aria-label={t("composer.image.enlarge")}
        className={`cursor-zoom-in overflow-hidden ${className}`}
        style={box}
        data-image-box={dimensions ? "reserved" : undefined}
        data-testid="image-thumb"
      >
        <img ref={lazyRef} src={shownSrc ?? src} data-image-pending={pending ? "" : undefined} alt="" width={dimensions?.width} height={dimensions?.height} style={dimensions ? { width: "100%", height: "100%", objectFit: "contain", position: "absolute", inset: 0, maxWidth: "100%", maxHeight: "100%" } : undefined} draggable={false} onLoad={(e) => {
          // The host read's own bytes only: a send's preview may be scaled down, and the lazy placeholder is not the image.
          if (sizePath && !pending && loadedSrc && rememberImageSize(hostId!, sizePath, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)) followSize();
        }} onError={() => !pending && setBroken(src)} className={imgClassName} />
      </button>
      {actionNotice && <span role="status" className="text-xs text-muted">{actionNotice}</span>}
      {zoom && <ImageZoom key={src} src={src} dimensions={dimensions} onContextMenu={menu} onClose={() => setZoom(false)} onCopy={() => copy(src)} onSave={save && (() => void save())} />}
    </>
  );
}

/**
 * A user message's images (Timeline; a pending send's too): thumbnails, click → full size. A path is read
 * through the agent's host (cutex fs-file-read); a host without it, or a file it cannot read, keeps the
 * file chip (the name, the path on hover): an empty frame would say less.
 * `sent`: this send's own bytes, shown until the host read of the uploaded copy lands. Kept once seen: the
 * draft they come from is cleared as soon as the agent's copy lands.
 */
export function MessageImages({ images, hostId, messageId, pending = false, sent }: { images: MessageImage[]; hostId: string | null | undefined; messageId?: string; pending?: boolean; sent?: readonly MessageImage[] }) {
  const { t } = useI18n();
  const authority = useMediaAuthority(hostId);
  const scope = JSON.stringify([hostId, authority, messageId]);
  const seed = pending ? images : sent?.length ? sent : [];
  const [preview, setPreview] = useState(() => ({ scope, images: seed }));
  if (preview.scope !== scope || (pending && preview.images !== images) || (!preview.images.length && seed.length)) {
    setPreview({ scope, images: seed });
  }
  // Only the matching optimistic send can supply a preview. Never borrow another
  // row's image, a previous host connection's bytes, or substitute for a failed read.
  const previews = messageId && preview.scope === scope && preview.images.length === images.length ? preview.images : [];
  return (
    <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
      {images.map((img, i) => {
        const pathText = img.kind === "path" && img.delivery === "pathText";
        const thumb = <ImageThumb
          key={i}
          image={img}
          hostId={hostId}
          loadingPreview={img.kind === "path" && previews[i]?.kind === "url" && previews[i].url.startsWith("data:image/") ? previews[i].url : undefined}
          className="rounded-xl border border-border"
          imgClassName="max-h-40 max-w-60 object-cover"
          bounds={{ maxWidth: 240, maxHeight: 160, contentBox: true }}
          rememberSize
          fallback={
            img.kind === "path" && (
              <span className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-muted" title={img.path} data-testid={pathText ? "path-text-image-unavailable" : "message-image-chip"}>
                <ImageIcon size={12} aria-hidden />
                {pathText ? t("image.pathTextUnavailable") : img.path.split(/[\\/]/).pop()}
              </span>
            )
          }
        />;
        return pathText ? <div key={i} className="flex flex-col items-end gap-1" data-path-text-image="">
          {thumb}
          <span className="text-xs text-subtle" title={img.path}>{t("image.pathText")}</span>
        </div> : thumb;
      })}
    </div>
  );
}

/**
 * A queued / inserting / sending message's images on its 24px row: small thumbnails, the rest as +N.
 * `total`: how many it had when fewer are known (a kept insert's inline images stripped to fit storage).
 */
export function QueuedImages({ images, hostId, max = 3, total = images.length }: { images: MessageImage[]; hostId?: string | null; max?: number; total?: number }) {
  const more = Math.max(total, images.length) - Math.min(images.length, max);
  if (!images.length && !more) return null;
  const name = (img: MessageImage) => (img.kind === "path" ? img.path.split(/[\\/]/).pop() || img.path : undefined);
  return (
    <span className="flex shrink-0 items-center gap-1" data-testid="queue-item-images">
      {images.slice(0, max).map((img, i) => (
        <ImageThumb
          key={i}
          image={img}
          hostId={hostId}
          title={name(img)}
          className="h-5 w-5 shrink-0 rounded border border-border"
          imgClassName="h-full w-full object-cover"
          bounds={{ maxWidth: 20, maxHeight: 20 }}
          fallback={
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-surface-2 text-subtle" title={name(img)}>
              <ImageIcon size={11} aria-hidden />
            </span>
          }
        />
      ))}
      {more > 0 && <span className="text-caption/[inherit] text-subtle">+{more}</span>}
    </span>
  );
}
