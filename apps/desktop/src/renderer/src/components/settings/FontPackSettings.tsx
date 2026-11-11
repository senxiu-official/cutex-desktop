// Settings → 外观 → 中文字体包 (shared/fontCatalog.ts): the big CJK fonts that are not part of the install. 下载并安装
// (main downloads the pinned release asset and installs only files that match the catalog; progress, 取消, plain-word
// errors, 继续下载 after an interruption), 导入字体包… as the fallback (main's folder dialog) and 打开文件夹. One row per
// family: its name in its own preview font, weights, size, whether it is installed, 删除. Nothing here reads files.
import { useState } from "react";
import { FONT_PACK_ARCHIVE, PACK_FONTS, type FontPackDownload, type FontPackImportResult } from "../../../../shared/fontCatalog";
import { useI18n, type MessageKey } from "../../i18n";
import { cancelFontPackDownload, downloadFontPack, importFontPack, openFontPackFolder, removeFontPack, useFontPack } from "../../lib/fontPack";
import { fontLabel, FONT_SAMPLE, previewFontFamily } from "../../lib/fontPreview";
import { formatSize } from "../../lib/docPreview";
import { settingsAnchorId } from "../../lib/settingsNav";
import { bridge } from "../../bridge";
import { ArmedRemove, Button, ListRow, Notice, Section, SettingsGroup } from "./Form";

type Line = { text: string; tone: "info" | "warn" };

export function FontPackSection() {
  const { t, locale } = useI18n();
  const pack = useFontPack();
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  if (!bridge.fontPack) return null;
  const download = pack?.download;
  const running = !!download && download.phase !== "failed";
  const complete = !!pack && pack.families.every((f) => f.installed === f.total);
  const run = async (action: () => Promise<Line[]>) => {
    setBusy(true);
    try {
      setLines(await action());
    } catch (error) {
      setLines([{ text: t("appearance.fontPack.failed", { error: error instanceof Error ? error.message : String(error) }), tone: "warn" }]);
    } finally {
      setBusy(false);
    }
  };
  const describe = (result: FontPackImportResult | null): Line[] => {
    if (!result || result.canceled) return [];
    const out: Line[] = [];
    if (result.imported.length > 0) out.push({ text: t("appearance.fontPack.result.imported", { count: result.imported.length }), tone: "info" });
    else if (result.refused.length === 0) out.push({ text: t("appearance.fontPack.result.nothing"), tone: "warn" });
    if (result.refused.length > 0) out.push({ text: t("appearance.fontPack.result.refused", { files: result.refused.join(", ") }), tone: "warn" });
    return out;
  };
  const resumable = download?.phase === "failed" && download.received > 0 && download.error !== "mismatch";
  return (
    <Section
      id={settingsAnchorId("fontPack")}
      title={t("appearance.fontPack")}
      hint={t("appearance.fontPackHint", { size: formatSize(FONT_PACK_ARCHIVE.bytes) })}
      actions={
        <>
          {!complete && (
            <SettingsGroup agents="none" source="local"><Button primary disabled={busy || running} onClick={() => void run(async () => (setLines([]), await downloadFontPack(), []))}>
              {resumable ? t("appearance.fontPack.resume") : t("appearance.fontPack.download")}
            </Button></SettingsGroup>
          )}
          <SettingsGroup agents="none" source="local"><Button disabled={busy || running} onClick={() => void run(async () => describe(await importFontPack()))}>
            {t("appearance.fontPack.import")}
          </Button></SettingsGroup>
          <SettingsGroup agents="none" source="local"><Button onClick={openFontPackFolder}>{t("appearance.fontPack.openFolder")}</Button></SettingsGroup>
        </>
      }
    >
      {download && <DownloadRow download={download} />}
      {PACK_FONTS.map((entry) => {
        const state = pack?.families.find((f) => f.id === entry.id);
        const installed = state?.installed ?? 0, total = entry.faces.length;
        const status = installed === total ? "imported" : installed > 0 ? "partial" : "missing";
        const name = fontLabel(entry.family, locale);
        return (
          <ListRow
            key={entry.id}
            title={<span data-font-pack={entry.id} style={{ fontFamily: previewFontFamily(entry.family) }}>{name} <span className="text-subtle">{FONT_SAMPLE.cjk}</span></span>}
            detail={t("appearance.fontPack.detail", { weights: entry.faces.map((f) => f.weight).join(" / "), size: formatSize(entry.faces.reduce((n, f) => n + f.bytes, 0)) })}
            actions={
              <>
                <span data-font-pack-status={status} className={`text-xs ${status === "imported" ? "text-accent" : "text-subtle"}`}>
                  {status === "partial" ? t("appearance.fontPack.status.partial", { installed, total }) : t(`appearance.fontPack.status.${status}` as MessageKey)}
                </span>
                {installed > 0 && <ArmedRemove title={t("appearance.fontPack.remove", { name })} label={t("appearance.fontPack.removeShort")} disabled={busy || running} onRemove={() => void run(async () => (await removeFontPack(entry.id), []))} />}
              </>
            }
          />
        );
      })}
      {lines.length > 0 && (
        <div role="status">
          {lines.map((line, i) => (
            <Notice key={i} tone={line.tone}>
              {line.text}
            </Notice>
          ))}
        </div>
      )}
    </Section>
  );
}

/** The running download (bar, bytes, 取消) or why the last one stopped. */
function DownloadRow({ download }: { download: FontPackDownload }) {
  const { t } = useI18n();
  if (download.phase === "failed") {
    return (
      <div role="status" data-font-pack-download="failed">
        <Notice tone="warn">{t(`appearance.fontPack.error.${download.error ?? "network"}` as MessageKey)}</Notice>
      </div>
    );
  }
  const percent = download.total > 0 ? Math.min(100, Math.round((download.received / download.total) * 100)) : 0;
  const label =
    download.phase === "downloading"
      ? t("appearance.fontPack.progress.downloading", { received: formatSize(download.received), total: formatSize(download.total) })
      : t(`appearance.fontPack.progress.${download.phase}` as MessageKey);
  return (
    <ListRow
      frame="bg-surface-2/40"
      title={<span data-font-pack-download={download.phase}>{label}</span>}
      detail={
        <span
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-1 block h-1.5 w-full max-w-80 overflow-hidden rounded-full bg-surface-2"
        >
          <span className="block h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${download.phase === "downloading" ? percent : 100}%` }} />
        </span>
      }
      actions={download.phase === "downloading" ? <Button onClick={cancelFontPackDownload}>{t("appearance.fontPack.cancel")}</Button> : undefined}
    />
  );
}
