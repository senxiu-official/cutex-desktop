// Settings → 外观 → 完整头像主题 (owner 2026-11-27, docs/desktop-optional-collections.md): each theme of the bundled
// pack with its state — 随应用 (starter pictures only, nothing in the catalogue), 可下载 (size), 已下载 (version; 0 =
// kept from an older app), an update — and 下载 / 更新到 vN, progress, the error in words and 重试. Main runs one
// operation at a time (across windows), so the other buttons wait. The contract has no cancel and no remove: neither
// is offered. Hidden where there is no bridge (a plain browser).
import { Loader2 } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { formatBytes } from "../../lib/claudeSkillsImport";
import {
  checkPortraitCollections,
  collectionError,
  collectionErrorKey,
  collectionPercent,
  collectionStatus,
  hasPortraitCollections,
  installPortraitCollection,
  retryPortraitCollections,
  usePortraitCollections,
  type CollectionStatus,
} from "../../lib/portraitCollections";
import { usePortraitThemes, useSampleUrl, type PortraitThemeInfo } from "../../lib/portraitThemes";
import { settingsAnchorId } from "../../lib/settingsNav";
import { DEFAULT_PORTRAIT_PACK } from "../../../../shared/portraitDefaults";
import { Button, Section, SettingsGroup } from "./Form";

const FACE = 28;

function Cover({ theme }: { theme: PortraitThemeInfo }) {
  const url = useSampleUrl(theme.cover, FACE);
  return (
    <span className="block shrink-0 overflow-hidden rounded bg-surface-2" style={{ width: FACE, height: FACE }}>
      {url && <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />}
    </span>
  );
}

/** The progress line and bar of the running operation (the library row, the download hint). */
export function CollectionProgress({ status }: { status: Extract<CollectionStatus, { kind: "working" }> }) {
  const { t } = useI18n();
  const percent = collectionPercent(status);
  const text =
    status.step === "download"
      ? status.total && status.received !== null
        ? t("portraitLib.step.download", { received: formatBytes(status.received), total: formatBytes(status.total) })
        : t("portraitLib.step.downloadNoSize")
      : t(`portraitLib.step.${status.step}` as MessageKey);
  return (
    <span className="flex w-full min-w-0 items-center gap-2" data-collection-progress={status.step}>
      <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
      <span className="shrink-0 text-caption/[inherit] text-muted tabular-nums">{text}</span>
      <span className="h-1 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <span className={`block h-full rounded-full bg-accent ${percent === null ? "w-1/3 animate-pulse" : "transition-[width]"}`} style={percent === null ? undefined : { width: `${percent}%` }} />
      </span>
    </span>
  );
}

function stateText(t: ReturnType<typeof useI18n>["t"], status: CollectionStatus, count: number): string {
  switch (status.kind) {
    case "starter": return t("portraitLib.starter", { n: count });
    case "downloadable": return status.bytes ? t("portraitLib.downloadable", { size: formatBytes(status.bytes) }) : t("portraitLib.downloadableNoSize");
    case "installed": return status.installed === 0 ? t("portraitLib.legacy") : t("portraitLib.installed", { version: status.installed });
    case "update": return status.installed === 0 ? t("portraitLib.legacy") : t("portraitLib.updatable", { version: status.installed });
    case "working": return "";
  }
}

export function PortraitLibrarySection() {
  const { t } = useI18n();
  const view = usePortraitCollections();
  const { themes } = usePortraitThemes();
  if (!view) {
    if (!hasPortraitCollections()) return null;
    // Main verifies installed collections before it answers (no hash cache): the usual loading line meanwhile.
    return (
      <Section id={settingsAnchorId("portrait-library")} title={t("portraitLib.title")} hint={t("portraitLib.hint")}>
        <p className="flex items-center gap-2 py-2 text-caption/[inherit] text-subtle" data-portrait-library-loading=""><Loader2 size={12} className="animate-spin" />{t("common.loading")}</p>
      </Section>
    );
  }
  const rows = themes.filter((th) => th.bundled && th.pack === DEFAULT_PORTRAIT_PACK);
  const busy = !!view.operation;
  const checking = view.operation?.step === "check" && view.operation.theme === null;
  const offered = rows.filter((th) => {
    const s = collectionStatus(view, th.theme);
    return s.kind === "downloadable" || s.kind === "update";
  }).length;
  const indexError = collectionError(view, null);
  const header = checking ? t("portraitLib.checking") : !view.checked ? t("portraitLib.notChecked") : offered ? t("portraitLib.checked", { n: offered }) : t("portraitLib.checkedNone");
  return (
    <Section
      id={settingsAnchorId("portrait-library")}
      title={t("portraitLib.title")}
      hint={t("portraitLib.hint")}
      actions={
        <SettingsGroup agents="none" source="local">
          <Button onClick={() => void checkPortraitCollections()} disabled={busy} title={busy && !checking ? t("portraitLib.busy") : undefined}>
            {checking ? <Loader2 size={13} className="animate-spin" /> : t("portraitLib.check")}
          </Button>
        </SettingsGroup>
      }
    >
      <div className="space-y-2 py-2" data-portrait-library="" data-checked={view.checked ? "" : undefined}>
        <p className="text-caption/[inherit] text-subtle" data-portrait-library-status="">{header}</p>
        {indexError && (
          <div className="flex items-start gap-2" data-portrait-library-error={indexError}>
            <p className="min-w-0 flex-1 text-xs break-words text-danger">{t(collectionErrorKey(indexError) as MessageKey)}</p>
            <SettingsGroup agents="none" source="local"><Button onClick={() => void retryPortraitCollections()} disabled={busy}>{t("portraitLib.retry")}</Button></SettingsGroup>
          </div>
        )}
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((th) => {
            const status = collectionStatus(view, th.theme);
            const error = collectionError(view, th.theme);
            return (
              <li key={th.key} className="flex min-w-0 flex-col gap-1 px-2 py-1.5" data-portrait-collection={th.theme} data-state={status.kind} data-error={error ?? undefined}>
                <div className="flex min-w-0 items-center gap-2">
                  <Cover theme={th} />
                  <span className="min-w-0 truncate text-ui/[inherit] font-medium" title={th.name}>{th.name}</span>
                  <span className="shrink-0 text-caption/[inherit] text-subtle tabular-nums">{t("portraitLib.count", { n: th.count })}</span>
                  <span className="ml-auto flex min-w-0 items-center gap-2">
                    {status.kind !== "working" && (
                      <span className={`truncate text-caption/[inherit] ${status.kind === "installed" ? "text-ok-text" : "text-subtle"}`}>{stateText(t, status, th.count)}</span>
                    )}
                    {(status.kind === "downloadable" || status.kind === "update") && !error && (
                      <SettingsGroup agents="none" source="local">
                        <Button primary={status.kind === "update"} onClick={() => void installPortraitCollection(th.theme)} disabled={busy} title={busy ? t("portraitLib.busy") : undefined}>
                          {status.kind === "update" ? t("portraitLib.update", { version: status.available }) : t("portraitLib.download")}
                        </Button>
                      </SettingsGroup>
                    )}
                  </span>
                </div>
                {status.kind === "working" && <CollectionProgress status={status} />}
                {error && (
                  <div className="flex items-start gap-2 pl-[36px]">
                    <p className="min-w-0 flex-1 text-xs break-words text-danger">{t(collectionErrorKey(error) as MessageKey)}</p>
                    <SettingsGroup agents="none" source="local"><Button onClick={() => void retryPortraitCollections()} disabled={busy}>{t("portraitLib.retry")}</Button></SettingsGroup>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}
