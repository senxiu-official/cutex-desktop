// Settings → 会话 → 输入区 → 提示词增强 (lib/promptEnhance.ts): shown when the settings host offers text-rewrite-v1.
// Which model rewrites: the open agent's own Profile (then backups, in order) or one fixed ordered list.
// With feature-profiles (owner 2026-11-25) the backups / list are 功能 Profiles (Settings → 功能 Profile), never
// agent Profiles. On an older cutex the picker is today's: ordinary Profiles. The two sets of choices are saved apart
// (fallback / profiles vs featureFallback / featureProfiles), so neither is lost when a host gains or loses the
// capability. Saved on this desktop, per host (IDs belong to their host).
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, KeyRound, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ProfileItem } from "../../../../shared/ipc";
import { FEATURE_PROFILES_FEATURE } from "../../../../shared/featureProfiles";
import { TEXT_REWRITE_FEATURE, TEXT_REWRITE_MAX_PROFILES } from "../../../../shared/textRewrite";
import { useFeatureProfiles } from "../../lib/featureProfiles";
import { hostRoute, setHostRoute, setPromptEnhanceEnabled, usePromptEnhancePrefs } from "../../lib/promptEnhance";
import { useOrderedProfiles } from "../../lib/profileOrder";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useBindingLabel } from "../../lib/useKeybindings";
import { useApp } from "../../store";
import { Tag } from "../Tag";
import { HintAction, IconButton, Section, Segmented, Select, SettingRow, Toggle } from "./Form";
import { EntityIcon } from "../EntityIcon";

/** The host's ordinary Profiles (older cutex only; `enabled` false: nothing is read). */
function useHostProfiles(enabled: boolean): ProfileItem[] | null {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const [profiles, setProfiles] = useState<ProfileItem[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setProfiles(null);
    api.listProfiles().then((r) => { if (live) setProfiles(r?.profiles ?? []); }, () => { if (live) setProfiles([]); });
    return () => { live = false; };
  }, [hostId, enabled]); // the host decides; its api object is rebuilt per render
  return useOrderedProfiles(profiles, hostId);
}

/** One choosable row of either kind. */
interface Choice { id: string; name: string; model?: string; icon: ReactNode; option?: { kind: "profile"; profile: ProfileItem; hostId: string } }

/** An ordered list of IDs: move, remove, add from the choices not in it yet. */
function OrderList({ ids, max, choices, addLabel, onChange, testId, rowAttr, missingIcon }: {
  ids: string[]; max: number; choices: Choice[] | null; addLabel: string; onChange(next: string[]): void; testId: string;
  rowAttr: "data-profile-id" | "data-feature-profile-id"; missingIcon(id: string): ReactNode;
}) {
  const { t } = useI18n();
  const byId = new Map((choices ?? []).map((c) => [c.id, c]));
  const move = (i: number, by: -1 | 1) => {
    const next = [...ids];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    onChange(next);
  };
  const addable = (choices ?? []).filter((c) => !ids.includes(c.id));
  return (
    <div className="flex w-full flex-col gap-1" data-testid={testId}>
      {ids.length === 0 && <p className="text-xs text-subtle">{t("promptEnhance.settings.none")}</p>}
      {ids.map((id, i) => {
        const c = byId.get(id);
        return (
          <div key={id} className="flex min-h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2" {...{ [rowAttr]: id }}>
            <span className="w-4 shrink-0 text-right font-mono text-caption/[inherit] text-subtle">{i + 1}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">{c?.icon ?? missingIcon(id)}<span className="min-w-0 truncate">{c?.name ?? id}</span></span>
            {c?.model && <span className="truncate text-caption/[inherit] text-subtle">{c.model}</span>}
            {choices && !c && <span className="text-caption/[inherit] text-warn-text">{t("promptEnhance.settings.missingProfile")}</span>}
            <IconButton label={t("promptEnhance.settings.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></IconButton>
            <IconButton label={t("promptEnhance.settings.moveDown")} disabled={i === ids.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></IconButton>
            <IconButton label={t("promptEnhance.settings.remove")} onClick={() => onChange(ids.filter((x) => x !== id))}><X size={13} /></IconButton>
          </div>
        );
      })}
      {ids.length < max && addable.length > 0 && (
        <Select<string>
          value=""
          label={addLabel}
          options={[{ value: "", label: addLabel }, ...addable.map((c) => ({ value: c.id, label: c.model ? `${c.name} · ${c.model}` : c.name, ...(c.option ? { entity: c.option } : {}) }))]}
          onChange={(v) => { if (v) onChange([...ids, v]); }}
        />
      )}
    </div>
  );
}

const featureIcon = <KeyRound size={13} className="shrink-0 text-muted" aria-hidden />;

export function PromptEnhanceSection() {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const hostId = useTargetHostId();
  const prefs = usePromptEnhancePrefs();
  const rewrite = features.has(TEXT_REWRITE_FEATURE);
  const capable = features.has(FEATURE_PROFILES_FEATURE);
  const { list: featureList } = useFeatureProfiles(hostId, rewrite && capable);
  const profiles = useHostProfiles(rewrite && !capable);
  const key = useBindingLabel("promptEnhance");
  const openSettings = useApp((s) => s.openSettings);
  if (!rewrite) return null;
  const route = hostRoute(hostId, prefs);
  const choices: Choice[] | null = capable
    ? featureList?.map((p) => ({ id: p.id, name: p.name, model: p.model, icon: featureIcon })) ?? null
    : profiles?.map((p) => ({ id: p.id, name: p.name, model: p.model ?? undefined, icon: <EntityIcon entity={{ kind: "profile", profile: p, hostId }} />, option: { kind: "profile" as const, profile: p, hostId } })) ?? null;
  const missingIcon = (id: string) => (capable ? featureIcon : <EntityIcon entity={{ kind: "profile", ref: id, hostId }} />);
  const manage = capable ? <HintAction onClick={() => openSettings("feature-profiles")}>{t("promptEnhance.settings.manageFeatureProfiles")}</HintAction> : null;
  const none = capable && featureList !== null && featureList.length === 0;
  const rowAttr = capable ? "data-feature-profile-id" as const : "data-profile-id" as const;
  const addLabel = t(capable ? "promptEnhance.settings.featureAdd" : "promptEnhance.settings.add");
  return (
    <Section id={settingsAnchorId("promptEnhance")} title={<span className="inline-flex items-center gap-2">{t("promptEnhance.title")}<Tag>{t("creation.experimental")}</Tag></span>}
      hint={t("promptEnhance.settings.hint", { key: key || "—" })}>
      <SettingRow agents="none" source="local" label={t("promptEnhance.settings.enabled")}
        hint={<>{t("promptEnhance.settings.keyHint", { key: key || "—" })}<HintAction onClick={() => openSettings("shortcuts")}>{t("conversation.sendKeys.shortcutsLink")}</HintAction></>}>
        <Toggle checked={prefs.enabled} onChange={setPromptEnhanceEnabled} />
      </SettingRow>
      {prefs.enabled && (
        <>
          <SettingRow agents="none" source="local" label={t("promptEnhance.settings.route")}
            hint={t(route.mode === "agent"
              ? (capable ? "promptEnhance.settings.route.featureAgentHint" : "promptEnhance.settings.route.agentHint")
              : (capable ? "promptEnhance.settings.route.featureProfileHint" : "promptEnhance.settings.route.profileHint"))}>
            <Segmented
              value={route.mode}
              options={[
                { value: "agent" as const, label: t("promptEnhance.settings.route.agent") },
                { value: "profile" as const, label: t(capable ? "promptEnhance.settings.route.featureProfile" : "promptEnhance.settings.route.profile") },
              ]}
              onChange={(mode) => setHostRoute(hostId, { mode })}
            />
          </SettingRow>
          {route.mode === "agent" ? (
            <SettingRow agents="none" source="local" label={t(capable ? "promptEnhance.settings.featureFallback" : "promptEnhance.settings.fallback")}
              hint={<>{t(none ? "promptEnhance.settings.noFeatureProfiles" : "promptEnhance.settings.fallbackHint", { n: TEXT_REWRITE_MAX_PROFILES - 1 })}{manage}</>}>
              <OrderList ids={capable ? route.featureFallback : route.fallback} max={TEXT_REWRITE_MAX_PROFILES - 1} choices={choices} addLabel={addLabel} rowAttr={rowAttr} missingIcon={missingIcon}
                onChange={(next) => setHostRoute(hostId, capable ? { featureFallback: next } : { fallback: next })} testId="prompt-enhance-fallback" />
            </SettingRow>
          ) : (
            <SettingRow agents="none" source="local" label={t(capable ? "promptEnhance.settings.featureProfiles" : "promptEnhance.settings.profiles")}
              hint={<>{t(none ? "promptEnhance.settings.noFeatureProfiles" : "promptEnhance.settings.profilesHint", { n: TEXT_REWRITE_MAX_PROFILES })}{manage}</>}>
              <OrderList ids={capable ? route.featureProfiles : route.profiles} max={TEXT_REWRITE_MAX_PROFILES} choices={choices} addLabel={addLabel} rowAttr={rowAttr} missingIcon={missingIcon}
                onChange={(next) => setHostRoute(hostId, capable ? { featureProfiles: next } : { profiles: next })} testId="prompt-enhance-profiles" />
            </SettingRow>
          )}
        </>
      )}
    </Section>
  );
}
