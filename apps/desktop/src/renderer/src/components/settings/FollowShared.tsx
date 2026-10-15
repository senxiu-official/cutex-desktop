// 「{{agent}}跟随共享配置」 (cutex settings `codexConfigFollowShared`): one switch for the shared codex
// config of 插件 / MCP / 技能 / 钩子, so it heads all four pages (settings audit 2026-10-15, lead
// decision 4). The value lives in cutex: each page reads it on open, so a change on one page is what
// the other three show.
import { useEffect, useState } from "react";
import type { GlobalSettings } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi } from "../../lib/targetHost";
import { ErrorNote, Section, SettingRow, Toggle } from "./Form";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Hidden on a cutex whose settings do not carry the field. */
export function FollowSharedSection() {
  const api = useTargetApi();
  const { t } = useI18n();
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.getSettings().then(setSettings, () => setSettings(null));
  }, []);
  if (settings?.codexConfigFollowShared === undefined) return null;
  const patch = async (value: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await api.patchSettings({ codexConfigFollowShared: value }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section id={settingsAnchorId("sync")} title={t("codex-config.plugins.sync")}>
      <SettingRow label={t("codex-config.plugins.follow")} hint={t("codex-config.plugins.followHint")}>
        <Toggle disabled={busy} checked={settings.codexConfigFollowShared} label={t("codex-config.plugins.follow")} onChange={(v) => void patch(v)} />
      </SettingRow>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Section>
  );
}
