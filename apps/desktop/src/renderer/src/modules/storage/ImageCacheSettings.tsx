import { useCallback, useEffect, useState } from "react";
import type { ImageCacheSettings as Limits, ImageCacheState } from "../../../../shared/imageCache";
import { bridge } from "../../bridge";
import { ArmedButton } from "../../components/ArmedButton";
import { btnFace, btnShape } from "../../components/Button";
import { ErrorNote, NumberField, RefreshButton, ResetButton, Section, SettingRow } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { resetThumbnailCache } from "../../lib/fileThumbnails";
import { formatBytes } from "./model";

/** main/imageCache.ts defaults. */
const DEFAULT_DAYS = 7;
const DEFAULT_GB = 5;

/** Device-local settings remain usable while the selected host is offline. */
export function ImageCacheSettings() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<ImageCacheState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cache = bridge.imageCache;
  useEffect(() => { let live = true; void cache?.state().then(v => { if (live) setState(v); }, e => { if (live) setError(String(e)); }); return () => { live = false; }; }, [cache]);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (!cache) return;
    setBusy(true); setError("");
    try { await action(); setState(await cache.state()); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }, [cache]);
  if (!cache) return null;
  const configure = (patch: Partial<Limits>) => { if (state) void run(() => cache.configure({ days: state.days, maxBytes: state.maxBytes, ...patch })); };
  const gb = state ? state.maxBytes / 1024 ** 3 : null;
  return <Section title={t("storage.imageCache.title")} hint={t("storage.imageCache.hint")} actions={<RefreshButton disabled={busy} onClick={() => { void run(async () => {}); }} />}>
    {error && <ErrorNote>{error}</ErrorNote>}
    {state && <>
      <SettingRow label={t("storage.imageCache.days")} hint={t("storage.imageCache.daysHint")} source="local" agents="now"
        reset={<ResetButton disabled={busy || state.days === DEFAULT_DAYS} onClick={() => configure({ days: DEFAULT_DAYS })} />}>
        <NumberField label={t("storage.imageCache.days")} value={state.days} range={[1, 3650]} unit={t("storage.imageCache.daysUnit")} disabled={busy} onCommit={days => { if (days != null) configure({ days }); }} />
      </SettingRow>
      <SettingRow label={t("storage.imageCache.cap")} hint={t("storage.imageCache.capHint")} source="local" agents="now"
        reset={<ResetButton disabled={busy || gb === DEFAULT_GB} onClick={() => configure({ maxBytes: DEFAULT_GB * 1024 ** 3 })} />}>
        <NumberField label={t("storage.imageCache.cap")} value={gb} step={0.1} range={[0.1, 1024]} unit="GB" disabled={busy} onCommit={v => { if (v != null) configure({ maxBytes: Math.round(v * 1024 ** 3) }); }} />
      </SettingRow>
      <SettingRow label={t("storage.imageCache.clear")} hint={t("storage.imageCache.used", { size: formatBytes(state.bytes, locale), count: state.entries.toLocaleString(locale) })} source="local" agents="now">
        <ArmedButton shape={`${btnShape()} whitespace-nowrap`} idle={btnFace()} hint={t("storage.imageCache.clearConfirm")} disabled={busy || state.entries === 0} testId="image-cache-clear"
          onConfirm={() => { void run(async () => { await cache.clear(); resetThumbnailCache(); }); }}>
          {t("storage.imageCache.clear")}
        </ArmedButton>
      </SettingRow>
    </>}
  </Section>;
}
