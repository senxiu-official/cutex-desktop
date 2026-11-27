// 「下载完整主题」 where a portrait is chosen or edited (owner 2026-11-27; lib/portraitCollections): small and quiet, never
// on avatars in lists. PortraitDownloadHint: one theme (the avatar pickers' grid) — the chosen picture isn't downloaded
// (`missing`: a stand-in from the same theme shows meanwhile) or the theme has only its starter pictures here.
// PortraitThemesHint: the ticked themes of a 头像风格 picker that have only starter pictures, with a way to the library.
// Nothing is written back: the stored reference stays as it is and the exact picture shows once the theme is installed.
import { useI18n, type MessageKey } from "../i18n";
import { formatBytes } from "../lib/claudeSkillsImport";
import { collectionError, collectionErrorKey, collectionPercent, collectionStatus, installPortraitCollection, retryPortraitCollections, usePortraitCollections } from "../lib/portraitCollections";
import { useApp } from "../store";
import { DEFAULT_PORTRAIT_PACK } from "../../../shared/portraitDefaults";

const LINK = "rounded text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default disabled:text-subtle disabled:no-underline";

export function PortraitDownloadHint({ pack, theme, missing = false }: { pack: string | null; theme: string | null; missing?: boolean }) {
  const { t } = useI18n();
  const view = usePortraitCollections();
  if (!view || !theme || pack !== DEFAULT_PORTRAIT_PACK) return null;
  const status = collectionStatus(view, theme);
  const error = collectionError(view, theme);
  // An update only matters here when the chosen picture is the one missing.
  const offered = status.kind === "downloadable" || (status.kind === "update" && missing);
  if (!offered && status.kind !== "working" && !error) return null;
  const busy = !!view.operation;
  const percent = collectionPercent(status);
  const size = status.kind === "downloadable" || status.kind === "update" ? status.bytes : null;
  return (
    <p role="status" data-portrait-download-hint={error ? "error" : status.kind} data-missing={missing ? "" : undefined} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-caption/[inherit] text-subtle">
      <span>{t(missing ? "portraitHint.missing" : "portraitHint.partial")}</span>
      {status.kind === "working" ? (
        <span className="text-muted tabular-nums">{percent === null ? t("portraitHint.preparing") : t("portraitHint.working", { percent })}</span>
      ) : error ? (
        <>
          <span className="text-danger">{t(collectionErrorKey(error) as MessageKey)}</span>
          <button type="button" className={LINK} disabled={busy} onClick={() => void retryPortraitCollections()}>{t("portraitLib.retry")}</button>
        </>
      ) : (
        <button type="button" data-portrait-download={theme} className={LINK} disabled={busy} title={busy ? t("portraitLib.busy") : undefined} onClick={() => void installPortraitCollection(theme)}>
          {size ? t("portraitHint.downloadSize", { size: formatBytes(size) }) : t("portraitHint.download")}
        </button>
      )}
    </p>
  );
}

export function PortraitThemesHint({ keys }: { keys: readonly string[] }) {
  const { t } = useI18n();
  const view = usePortraitCollections();
  if (!view) return null;
  const prefix = `${DEFAULT_PORTRAIT_PACK}/`;
  const n = keys.filter((k) => k.startsWith(prefix) && collectionStatus(view, k.slice(prefix.length)).kind === "downloadable").length;
  if (!n) return null;
  return (
    <p data-portrait-themes-hint={n} className="flex flex-wrap items-baseline gap-x-1.5 text-caption/[inherit] text-subtle">
      <span>{t("portraitHint.themes", { n })}</span>
      <button type="button" className={LINK} onClick={() => useApp.getState().openSettings("appearance", { anchor: "portrait-library" })}>{t("portraitHint.download")}</button>
    </p>
  );
}
