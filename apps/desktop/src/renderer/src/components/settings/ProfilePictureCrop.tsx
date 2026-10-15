import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { croppedPicture, INITIAL_CROP, squareCrop, type CropPosition } from "../../lib/imageCrop";
import { AVATAR_PX } from "../../lib/profileAvatar";
import { Button } from "./Form";

/** Both picture upload entry points share this cropper; confirmation only updates the draft. */
export function ProfilePictureCrop({ file, onCancel, onConfirm }: { file: File; onCancel(): void; onConfirm(picture: string): void }) {
  const { t } = useI18n();
  const title = useId();
  const hint = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; position: CropPosition } | null>(null);
  const [url, setUrl] = useState("");
  const [image, setImage] = useState<{ width: number; height: number } | null>(null);
  const [position, setPosition] = useState<CropPosition>(INITIAL_CROP);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    active.current = true;
    // Renderer CSP permits data images. Keep the original resolution for crop preview.
    const reader = new FileReader();
    reader.onload = () => { if (active.current && typeof reader.result === "string") setUrl(reader.result); };
    reader.onerror = () => { if (active.current) setError(true); };
    reader.readAsDataURL(file);
    const modal = dialog.current!;
    modal.showModal();
    return () => {
      active.current = false;
      reader.abort();
      modal.close();
    };
  }, [file]);
  const crop = image ? squareCrop(image.width, image.height, position) : null;
  const move = (start: CropPosition, dx: number, dy: number) => {
    if (!image) return;
    const next = { ...start, x: start.x + dx / image.width, y: start.y + dy / image.height };
    const bounded = squareCrop(image.width, image.height, next);
    setPosition({ ...next, x: (bounded.x + bounded.size / 2) / image.width, y: (bounded.y + bounded.size / 2) / image.height });
  };
  const confirm = async () => {
    if (!image || saving) return;
    setSaving(true);
    setError(false);
    try {
      const picture = await croppedPicture(file, position, AVATAR_PX);
      if (active.current) onConfirm(picture);
    } catch {
      if (active.current) setError(true);
    } finally {
      if (active.current) setSaving(false);
    }
  };
  return createPortal(
    <dialog ref={dialog} aria-labelledby={title} aria-describedby={hint}
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onKeyDown={(e) => e.stopPropagation()}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[25rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface p-5 text-foreground shadow-2xl backdrop:bg-black/50">
      <h3 id={title} className="text-sm font-semibold">{t("settings.profile.picture.crop")}</h3>
      <p id={hint} className="mt-1 text-xs text-subtle">{t("settings.profile.picture.cropHint")}</p>
      <div role="group" aria-label={t("settings.profile.picture.position")} aria-describedby={hint} tabIndex={0}
        onKeyDown={(e) => {
          if (!crop || saving) return;
          const step = crop.size * (e.shiftKey ? 0.1 : 0.02);
          const delta = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
          if (delta) { e.preventDefault(); move(position, delta[0]!, delta[1]!); }
        }}
        onPointerDown={(e) => {
          if (!crop || saving || e.button !== 0) return;
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, position };
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start || start.id !== e.pointerId || !crop || !image) return;
          const scale = squareCrop(image.width, image.height, start.position).size / e.currentTarget.getBoundingClientRect().width;
          move(start.position, (start.x - e.clientX) * scale, (start.y - e.clientY) * scale);
        }}
        onPointerUp={(e) => { if (drag.current?.id === e.pointerId) { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); } }}
        onLostPointerCapture={() => { drag.current = null; }}
        className="relative mx-auto mt-4 aspect-square w-full max-w-80 touch-none overflow-hidden rounded-sm border border-border bg-background outline-none select-none focus-visible:ring-2 focus-visible:ring-accent cursor-grab active:cursor-grabbing">
        {url && <img src={url} alt="" draggable={false}
          onLoad={(e) => setImage({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          onError={() => setError(true)}
          className="pointer-events-none absolute max-w-none"
          style={image && crop ? { width: `${image.width / crop.size * 100}%`, height: `${image.height / crop.size * 100}%`, left: `${-crop.x / crop.size * 100}%`, top: `${-crop.y / crop.size * 100}%` } : { visibility: "hidden" }} />}
        {/* Square output, with a circular guide matching the avatar's actual display. */}
        <div className="pointer-events-none absolute inset-0 rounded-full border border-white/70 shadow-[0_0_0_80px_#0004]" />
      </div>
      <label className="mt-4 flex items-center gap-3 text-xs">
        <span>{t("settings.profile.picture.zoom")}</span>
        <input type="range" min="1" max="4" step="0.01" value={position.zoom} disabled={!image || saving}
          onChange={(e) => {
            if (!image) return;
            const next = { ...position, zoom: Number(e.target.value) };
            const bounded = squareCrop(image.width, image.height, next);
            setPosition({ ...next, x: (bounded.x + bounded.size / 2) / image.width, y: (bounded.y + bounded.size / 2) / image.height });
          }} className="min-w-0 flex-1 accent-[var(--accent)]" />
        <span className="w-10 text-right tabular-nums">{Math.round(position.zoom * 100)}%</span>
      </label>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{t("settings.profile.picture.bad")}</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button disabled={!image || saving} onClick={() => setPosition(INITIAL_CROP)}>{t("settings.profile.picture.reset")}</Button>
        <Button onClick={onCancel}>{t("dialog.cancel")}</Button>
        <Button primary disabled={!image || saving} onClick={() => void confirm()}>{t("settings.profile.picture.useCrop")}</Button>
      </div>
    </dialog>, document.body,
  );
}
