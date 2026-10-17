// Settings → 外观 → 启动页立绘: which providers have launcher art (内置 / 已导入 / 无), 从文件夹导入… (main's
// folder dialog, main/launchArt.ts) and 清除 (back to the bundled art, else the icon intro). The images
// themselves come from lib/launchArt; nothing here reads files.
import { useState } from "react";
import type { LaunchArtImportResult } from "../../../../shared/launchArt";
import { useI18n, type MessageKey } from "../../i18n";
import { BUNDLED_LAUNCH_ART, canImportLaunchArt, clearLaunchArt, importLaunchArt, LAUNCH_ART_FILES, launchArtSource, useLaunchArtView } from "../../lib/launchArt";
import type { PortraitProvider } from "../../lib/launchPortraits";
import { PROVIDER_LABEL } from "../../lib/provider";
import { settingsAnchorId } from "../../lib/settingsNav";
import { Button, ListRow, Notice, Section } from "./Form";

const PROVIDERS = Object.keys(LAUNCH_ART_FILES) as PortraitProvider[];

export function LaunchArtSection() {
  const { t } = useI18n();
  const { art, imported } = useLaunchArtView();
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<{ text: string; tone: "info" | "warn" }[]>([]);
  if (!canImportLaunchArt()) return null;
  const anyImported = PROVIDERS.some((p) => launchArtSource(p, {}, imported) === "imported");
  const run = async (action: () => Promise<{ text: string; tone: "info" | "warn" }[]>) => {
    setBusy(true);
    try {
      setLines(await action());
    } catch (error) {
      setLines([{ text: t("appearance.launchArt.failed", { error: error instanceof Error ? error.message : String(error) }), tone: "warn" }]);
    } finally {
      setBusy(false);
    }
  };
  const describe = (result: LaunchArtImportResult) => {
    if (result.canceled) return [];
    const out: { text: string; tone: "info" | "warn" }[] = [];
    const names = (ps: PortraitProvider[]) => ps.map((p) => PROVIDER_LABEL[p]).join(", ");
    if (result.imported.length > 0) out.push({ text: t("appearance.launchArt.result.imported", { providers: names(result.imported) }), tone: "info" });
    else out.push({ text: t("appearance.launchArt.result.nothing"), tone: "warn" });
    if (result.incomplete.length > 0) out.push({ text: t("appearance.launchArt.result.incomplete", { providers: names(result.incomplete) }), tone: "warn" });
    if (result.refused.length > 0) {
      const files = result.refused.map((r) => `${r.file} (${t(`appearance.launchArt.reason.${r.reason}` as MessageKey)})`).join(", ");
      out.push({ text: t("appearance.launchArt.result.refused", { files }), tone: "warn" });
    }
    return out;
  };
  return (
    <Section
      id={settingsAnchorId("launchArt")}
      title={t("appearance.launchArt")}
      hint={t("appearance.launchArtHint")}
      actions={
        <>
          <Button disabled={busy} onClick={() => void run(async () => describe(await importLaunchArt()))}>
            {busy ? t("appearance.launchArt.importing") : t("appearance.launchArt.import")}
          </Button>
          <Button
            disabled={busy || !anyImported}
            onClick={() =>
              void run(async () => {
                await clearLaunchArt();
                return [{ text: t("appearance.launchArt.cleared"), tone: "info" }];
              })
            }
          >
            {t("appearance.launchArt.clear")}
          </Button>
        </>
      }
    >
      {PROVIDERS.map((provider) => {
        const source = launchArtSource(provider, BUNDLED_LAUNCH_ART, imported);
        const portrait = art[provider]?.portrait;
        return (
          <ListRow
            key={provider}
            leading={
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2">
                {portrait ? <img src={portrait} alt="" className="h-full w-full object-cover object-top" /> : null}
              </span>
            }
            title={PROVIDER_LABEL[provider]}
            detail={t("appearance.launchArt.files", LAUNCH_ART_FILES[provider])}
            actions={
              <span data-launch-art-source={source} className={`text-xs ${source === "none" ? "text-subtle" : source === "imported" ? "text-accent" : "text-muted"}`}>
                {t(`appearance.launchArt.source.${source}` as MessageKey)}
              </span>
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
