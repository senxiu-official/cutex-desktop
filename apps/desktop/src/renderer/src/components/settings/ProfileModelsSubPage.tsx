// Profiles → a Profile → 模型目录 → 全部 N 个模型 (R6): every model of the Profile in the shelf params, with a filter.
// Self-contained: it reads the profile and its models itself; single models are edited in their dialog and saved at
// once (components/settings/ProfileModels ModelList), so nothing here waits for the profile page's save bar.
import { useEffect, useState } from "react";
import type { ProfileDetail, ProfileModelsView } from "../../../../shared/ipc";
import { CLAUDE_COMPACTION_MODELS_FEATURE } from "../../../../shared/claudeCompaction";
import { useI18n, type MessageKey } from "../../i18n";
import { fieldEditable } from "../../lib/profileKind";
import { updateCachedProfile } from "../../lib/profileSnapshot";
import { useSettingsShelf } from "../../lib/settingsShelf";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { EmptyState, ErrorNote, ListFilter, Loading, Section } from "./Form";
import { ModelList } from "./ProfileModels";

export function ProfileModelsSubPage() {
  useScrollToSettingsAnchor();
  const { t } = useI18n();
  const api = useTargetApi();
  const features = useTargetFeatures();
  const targetHost = useTargetHostId();
  const profile = useSettingsShelf((s) => s.params.profile);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [models, setModels] = useState<ProfileModelsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (!profile) return;
    let live = true;
    Promise.all([api.getProfile(profile), api.profileModels(profile)]).then(
      ([d, m]) => { if (live) (setDetail(d), setModels(m)); },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, targetHost]);
  if (!profile) return <EmptyState>{t("settings.modelContext.noMatch" as MessageKey)}</EmptyState>;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!detail || !models) return <Section><Loading rows={4} /></Section>;
  const keep = (next: ProfileDetail) => (setDetail(next), updateCachedProfile(profile, { detail: next }, targetHost));
  const keepModels = (next: ProfileModelsView) => (setModels(next), updateCachedProfile(profile, { models: next }, targetHost));
  const claude = detail.cliKind === "claude" && features.has(CLAUDE_COMPACTION_MODELS_FEATURE) && detail.claudeCompactionModels !== undefined;
  return (
    <Section id={settingsAnchorId("models-all")} title={t("settings.modelContext.allModels" as MessageKey, { n: models.models.length })} hint={t("settings.profileIa.hostProfile" as MessageKey, { name: detail.name })}>
      <div role="search" className="contents"><ListFilter count={models.models.length} value={filter} onChange={setFilter} /></div>
      <ModelList
        profile={profile}
        view={models}
        setView={keepModels}
        filter={filter}
        claude={claude ? { table: detail.claudeCompactionModels ?? null, profile: detail.claudeCompaction ?? null, error: detail.detail?.claudeCompactionModelsError, disabled: !fieldEditable(detail, "claudeCompactionModels"), onDetail: keep } : undefined}
      />
    </Section>
  );
}
