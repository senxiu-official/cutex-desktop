import { useEffect, useRef, useState } from "react";
import type { DshProfileOptions, ProfileDetail, ProfileModelsView, ProfilePatch } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { DSH_DEFAULT_MODEL, DSH_EFFORTS, dshModelIds } from "../../lib/dshModels";
import { useTargetApi } from "../../lib/targetHost";
import { Select, SettingRow } from "./Form";

/** A DSH Profile's model list as cutex answers it (`GET /v2/profiles/{p}/models`); null = not read (yet) → lib/dshModels fallback. */
function useDshCatalog(profile: string | undefined): ProfileModelsView | null {
  // The latest host's api without re-reading on every render (useTargetApi may build a new object each time).
  const api = useRef(useTargetApi());
  api.current = useTargetApi();
  const [catalog, setCatalog] = useState<{ profile: string; data: ProfileModelsView } | null>(null);
  useEffect(() => {
    const target = api.current;
    if (!profile || typeof target.profileModels !== "function") return;
    let alive = true;
    target.profileModels(profile).then((data) => { if (alive) setCatalog({ profile, data }); }, () => {});
    return () => { alive = false; };
  }, [profile]);
  return profile && catalog?.profile === profile ? catalog.data : null;
}

export function DshModelFields({ detail, patch, set }: { detail: ProfileDetail; patch: ProfilePatch; set(patch: ProfilePatch): void }) {
  const { t } = useI18n();
  const dsh = patch.options?.dsh ?? detail.options?.dsh ?? { model: DSH_DEFAULT_MODEL, apiKeyEnv: "DEEPSEEK_API_KEY" };
  const catalog = useDshCatalog(detail.id);
  const models = dshModelIds(catalog, dsh.model);
  return <>
    <SettingRow source="host" agents="next" label={t("agent-config.profile.model")}>
      <Select value={dsh.model} options={models.map(value => ({ value, label: value }))} onChange={model => set({ options: { dsh: { ...dsh, model } } })} />
    </SettingRow>
    <SettingRow source="host" agents="next" label={t("agent-config.profile.effort")}>
      <Select value={dsh?.reasoningEffort ?? ""} options={[{ value: "", label: t("agent-config.profile.effortDefault") }, ...DSH_EFFORTS.map(value => ({ value, label: t(`composer.effort.${value}`) }))]} onChange={value => set({ options: { dsh: { ...dsh, reasoningEffort: (value || undefined) as DshProfileOptions["reasoningEffort"] } } })} />
    </SettingRow>
  </>;
}
