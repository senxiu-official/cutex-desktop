// The 预览 of an image artifact of any size: read window by window (lib/windowedImage) into one Blob, shown from an
// object URL that is revoked when the view leaves it. A big one shows its progress; one over
// IMAGE_PREVIEW_PROMPT_BYTES waits for 仍然打开 (or 用系统应用打开 on this computer).
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ArtifactVersion } from "../../../../shared/artifactStore";
import { SideImage } from "../../components/SideImage";
import { useI18n } from "../../i18n";
import { canRevealLocal, performFilePathAction } from "../../lib/fileActions";
import { IMAGE_PREVIEW_PROMPT_BYTES, loadWindowedImage } from "../../lib/windowedImage";
import { services } from "../app";
import { externalGone, formatBytes } from "./model";

/** Progress shows for images over this (smaller ones load in a moment). */
const PROGRESS_FROM_BYTES = 8 * 1024 * 1024;

type Shown = { key: string; url: string } | { key: string; error: string } | { key: string; notImage: true };

export function ArtifactImage({ hostId, name, typed, version }: { hostId: string; name: string; typed: string; version: ArtifactVersion }) {
  const { t } = useI18n();
  const key = `${hostId}|${version.artifactId}@${version.version}`;
  const [allowed, setAllowed] = useState<string | null>(null);
  const ask = version.bytes > IMAGE_PREVIEW_PROMPT_BYTES && allowed !== key;
  const [progress, setProgress] = useState<{ key: string; done: number; total: number } | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    if (ask) return;
    const stop = new AbortController();
    let url: string | null = null;
    loadWindowedImage(
      async (offset, maxBytes) => {
        const c = await services.daemonFor(hostId).artifactStoreContent(version.artifactId, version.version, { offset, maxBytes, imagePreview: true });
        if (c && externalGone(c)) throw new Error(t("artifacts.externalGone"));
        return c;
      },
      { size: version.bytes, mime: version.mediaType, name: typed, signal: stop.signal, onProgress: (done, total) => !stop.signal.aborted && setProgress({ key, done, total }) },
    ).then(
      (r) => {
        if (stop.signal.aborted) return;
        if (r.state === "not-image") return setShown({ key, notImage: true });
        url = URL.createObjectURL(r.blob);
        setShown({ key, url });
      },
      (e: unknown) => !stop.signal.aborted && setShown({ key, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      stop.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [ask, hostId, key, typed, version.artifactId, version.version, version.bytes, version.mediaType]); // eslint-disable-line react-hooks/exhaustive-deps
  const size = formatBytes(version.bytes);
  const local = canRevealLocal({ hostId, path: version.sourcePath });
  const openSystem = local && (
    <button type="button" onClick={() => void performFilePathAction(hostId, version.sourcePath, "open")} className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-hover" data-artifact-image-system>
      {t("artifacts.image.openSystem")}
    </button>
  );
  if (ask)
    return (
      <div className="m-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-subtle" data-artifact-image-ask>
        <span className="min-w-0 flex-1">{t("artifacts.image.large", { size })}</span>
        <button type="button" onClick={() => setAllowed(key)} className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-hover" data-artifact-image-anyway>
          {t("artifacts.image.openAnyway")}
        </button>
        {openSystem}
      </div>
    );
  const now = shown?.key === key ? shown : null;
  if (now && "url" in now)
    return <SideImage key={now.url} src={now.url} alt={name} hostId={hostId} className="mx-2 my-2" center imgClassName="block h-auto max-w-full rounded-md border border-border bg-surface-2 object-contain" />;
  if (now && "error" in now) return <p className="m-2 text-xs text-danger" role="alert">{t("artifacts.loadFailed", { error: now.error })}</p>;
  if (now) return <p className="m-2 text-xs text-subtle">{t("artifacts.binary", { type: version.mediaType || "?", size })}</p>;
  const p = progress?.key === key ? progress : null;
  const big = (p?.total ?? version.bytes) > PROGRESS_FROM_BYTES;
  return (
    <div className="m-2 flex flex-col gap-1.5 text-xs text-subtle" role="status" data-artifact-image-loading>
      <span className="flex items-center gap-2">
        <Loader2 size={13} className="animate-spin" aria-hidden />
        {big ? t("artifacts.image.loading", { done: formatBytes(p?.done ?? 0), total: formatBytes(p?.total ?? version.bytes) }) : t("artifacts.loading")}
      </span>
      {big && <progress className="h-1.5 w-full max-w-80 accent-accent" value={p?.done ?? 0} max={Math.max(p?.total ?? version.bytes, 1)} aria-label={t("artifacts.image.loadingLabel")} />}
    </div>
  );
}
