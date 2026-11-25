// Settings → 功能 Profile (cutex feature-profiles; owner 2026-11-25): the host's model endpoints for app features
// (提示词增强 first), never agents'. A list (R6: the first ones on the page, all with a filter on 全部 N), add / edit
// inline, remove with a second click. The API key is write-only: a new one is typed once (add, or 更换密钥 on edit),
// sent through main and cleared with the form; the page only shows whether one is set.
import { useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import {
  FEATURE_PROFILE_LIMIT, FEATURE_PROFILE_MODEL_MAX, FEATURE_PROFILE_NAME_MAX, FEATURE_PROFILE_PROTOCOLS, FEATURE_PROFILE_QUOTA_TYPES,
  type FeatureProfile, type FeatureProfileCreate, type FeatureProfileProtocol, type FeatureProfileQuotaType,
} from "../../../../shared/featureProfiles";
import { AddButton, ArmedRemove, Button, ErrorNote, IconButton, ListFilter, ListRow, Loading, RefreshButton, Section, Segmented, Select, SettingRow, SubPageRow, TextInput } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { dropFeatureProfile, putFeatureProfile, useFeatureProfiles } from "../../lib/featureProfiles";
import { matchesFilter } from "../../lib/listFilter";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useSettingsCard } from "../../lib/settingsDrafts";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";
import { Pencil } from "lucide-react";

/** Rows on the page; all of them are on the sub-page (R6). */
export const FEATURE_PROFILES_ON_PAGE = 5;
export const FEATURE_PROFILES_SUB = "all";

const PROTOCOL_LABEL: Record<FeatureProfileProtocol, string> = { openaiResponses: "OpenAI Responses", anthropicMessages: "Anthropic Messages" };
const BASE_PLACEHOLDER: Record<FeatureProfileProtocol, string> = { openaiResponses: "https://api.openai.com/v1", anthropicMessages: "https://api.anthropic.com" };

const isProtocol = (v: string): v is FeatureProfileProtocol => (FEATURE_PROFILE_PROTOCOLS as readonly string[]).includes(v);
const isQuota = (v: string): v is FeatureProfileQuotaType => (FEATURE_PROFILE_QUOTA_TYPES as readonly string[]).includes(v);

/** A loopback base URL: cutex refuses its own Management / Agent Bus ports there, with the generic invalid code. */
const isLoopbackUrl = (url: string) => /^https?:\/\/(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?(\/|$)/i.test(url.trim());

function useProblemText() {
  const { t } = useI18n();
  return (e: unknown, baseUrl?: string): string => {
    const text = e instanceof Error ? e.message : String(e);
    // A dedicated code once cutex names it (e.g. feature_profile_control_port); until then, a loopback guess.
    if (/\bfeature_profile_[a-z_]*control_port\b/.test(text)) return t("feature-profiles.error.controlPort");
    if (baseUrl !== undefined && text.includes("invalid_feature_profile") && isLoopbackUrl(baseUrl)) return t("feature-profiles.error.controlPort");
    for (const code of ["invalid_feature_profile", "feature_profile_limit", "feature_profile_not_found", "feature_profiles_unavailable"] as const) {
      if (text.includes(code)) return t(`feature-profiles.error.${code}` as MessageKey, { n: FEATURE_PROFILE_LIMIT });
    }
    return text;
  };
}

/** The host part of a base URL (the row's detail), else the text itself. */
function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}

export function FeatureProfilesSection() {
  const hostId = useTargetHostId();
  return <ProfilesCard key={hostId} hostId={hostId} all={false} />;
}

/** 功能 Profile → 全部 N 个: every row, with a filter. */
export function FeatureProfilesAll() {
  const hostId = useTargetHostId();
  return <ProfilesCard key={hostId} hostId={hostId} all />;
}

function ProfilesCard({ hostId, all }: { hostId: string; all: boolean }) {
  const { t } = useI18n();
  const { list, damaged, error, reload } = useFeatureProfiles(hostId);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const full = (list?.length ?? 0) + damaged.length >= FEATURE_PROFILE_LIMIT;
  const shown = all ? list?.filter((p) => matchesFilter(filter, p.name, p.model, p.baseUrl)) : list?.filter((p, i) => i < FEATURE_PROFILES_ON_PAGE || p.id === editing);
  return (
    <Section
      id={settingsAnchorId(all ? "feature-profiles.all" : "feature-profiles.list")}
      title={all ? t("feature-profiles.all", { n: list?.length ?? 0 }) : t("feature-profiles.section")}
      hint={all ? undefined : t("feature-profiles.sectionHint")}
      actions={
        <>
          <RefreshButton onClick={reload} />
          <AddButton primary disabled={editing === "new" || !list || full} title={full ? t("feature-profiles.error.feature_profile_limit", { n: FEATURE_PROFILE_LIMIT }) : undefined} onClick={() => setEditing("new")}>{t("feature-profiles.add")}</AddButton>
        </>
      }
    >
      <div data-feature-profiles="">
        {editing === "new" && <Editor hostId={hostId} profile={null} onDone={() => setEditing(null)} />}
        {!list && !error && <Loading rows={2} />}
        {list && list.length === 0 && damaged.length === 0 && editing !== "new" && <p className="py-2 text-xs text-subtle">{t("feature-profiles.empty")}</p>}
        {all && <div role="search" className="contents"><ListFilter count={list?.length ?? 0} value={filter} onChange={setFilter} /></div>}
        {shown?.map((p) => (
          <Row key={p.id} hostId={hostId} profile={p} editing={editing === p.id} onEdit={(on) => setEditing(on ? p.id : null)} />
        ))}
        {/* Damaged records stay visible on both pages until deleted (they still take one of the host's slots). */}
        {list && damaged.map((id) => <DamagedRow key={id} hostId={hostId} id={id} />)}
        {!all && list && list.length > FEATURE_PROFILES_ON_PAGE && (
          <SubPageRow title={t("feature-profiles.all", { n: list.length })} onOpen={() => useApp.getState().openSettings("feature-profiles", { sub: FEATURE_PROFILES_SUB })} />
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Section>
  );
}

function Row({ hostId, profile: p, editing, onEdit }: { hostId: string; profile: FeatureProfile; editing: boolean; onEdit(on: boolean): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const problemText = useProblemText();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.deleteFeatureProfile(p.id);
      dropFeatureProfile(hostId, p.id);
    } catch (e) {
      const text = problemText(e);
      if (String(e).includes("feature_profile_not_found")) dropFeatureProfile(hostId, p.id);
      else setProblem(text);
    } finally {
      setBusy(false);
    }
  };
  const detail = [
    p.model,
    isProtocol(p.protocol) ? PROTOCOL_LABEL[p.protocol] : p.protocol,
    hostOf(p.baseUrl),
    isQuota(p.quotaType) ? t(`feature-profiles.quota.${p.quotaType}` as MessageKey) : p.quotaType,
  ].filter(Boolean).join(" · ");
  return (
    <ListRow
      frame={editing ? "bg-surface-2/40" : undefined}
      leading={<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"><KeyRound size={14} aria-hidden /></span>}
      title={<span data-feature-profile={p.id}>{p.name}</span>}
      detail={
        <>
          {detail}
          {!p.keyPresent && <span className="text-warn-text"> · {t("feature-profiles.key.missing")}</span>}
          {problem && <span className="text-danger"> · {problem}</span>}
        </>
      }
      actions={editing ? undefined : (
        <>
          <IconButton label={t("feature-profiles.edit")} disabled={busy} onClick={() => onEdit(true)}><Pencil size={13} /></IconButton>
          <ArmedRemove title={t("feature-profiles.remove")} disabled={busy} onRemove={() => void remove()} />
        </>
      )}
      below={editing ? <Editor hostId={hostId} profile={p} onDone={() => onEdit(false)} /> : undefined}
    />
  );
}

/** A record the host could not read (list `errors`): its ID and delete; nothing to edit. */
function DamagedRow({ hostId, id }: { hostId: string; id: string }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const problemText = useProblemText();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.deleteFeatureProfile(id);
      dropFeatureProfile(hostId, id);
    } catch (e) {
      if (String(e).includes("feature_profile_not_found")) dropFeatureProfile(hostId, id);
      else setProblem(problemText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ListRow
      leading={<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-warn/15 text-warn-text"><TriangleAlert size={14} aria-hidden /></span>}
      title={<span data-feature-profile-damaged={id}>{t("feature-profiles.damaged")}</span>}
      detail={
        <>
          {t("feature-profiles.damagedHint")} · <span className="font-mono">{id}</span>
          {problem && <span className="text-danger"> · {problem}</span>}
        </>
      }
      actions={<ArmedRemove title={t("feature-profiles.remove")} disabled={busy} onRemove={() => void remove()} />}
    />
  );
}

interface Draft { name: string; protocol: FeatureProfileProtocol | ""; baseUrl: string; model: string; quotaType: FeatureProfileQuotaType | "" }

const draftOf = (p: FeatureProfile | null): Draft => ({
  name: p?.name ?? "",
  protocol: p ? (isProtocol(p.protocol) ? p.protocol : "") : "openaiResponses",
  baseUrl: p?.baseUrl ?? "",
  model: p?.model ?? "",
  quotaType: p ? (isQuota(p.quotaType) ? p.quotaType : "") : "payAsYouGo",
});

/** What the owner typed that cutex would refuse anyway (cutex validates again; its answer is shown as is). */
function draftProblem(d: Draft, key: string | null, creating: boolean): MessageKey | null {
  if (!d.name.trim() || d.name.trim().length > FEATURE_PROFILE_NAME_MAX) return "feature-profiles.form.badName";
  if (!d.protocol) return "feature-profiles.form.badProtocol";
  if (!/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost|\[::1\]))/i.test(d.baseUrl.trim())) return "feature-profiles.form.badBaseUrl";
  if (!d.model.trim() || /\s/.test(d.model.trim()) || d.model.trim().length > FEATURE_PROFILE_MODEL_MAX) return "feature-profiles.form.badModel";
  if (!d.quotaType) return "feature-profiles.form.badQuota";
  if ((creating || key !== null) && !key?.trim()) return "feature-profiles.form.badKey";
  return null;
}

/** Add (profile null) or edit inline. The key: required on add; on edit only after 更换密钥. */
function Editor({ hostId, profile, onDone }: { hostId: string; profile: FeatureProfile | null; onDone(): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const problemText = useProblemText();
  const card = useSettingsCard();
  const creating = profile === null;
  const initial = draftOf(profile);
  const [d, setD] = useState<Draft>(initial);
  // The new key while typed: null = keep the stored one (edit). Cleared with the form after every write.
  const [key, setKey] = useState<string | null>(creating ? "" : null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const change = (patch: Partial<Draft>) => { setD((x) => ({ ...x, ...patch })); setProblem(null); };
  const save = async () => {
    const bad = draftProblem(d, key, creating);
    if (bad) return setProblem(t(bad, { n: FEATURE_PROFILE_NAME_MAX }));
    setBusy(true);
    setProblem(null);
    try {
      let saved: FeatureProfile;
      if (creating) {
        const body: FeatureProfileCreate = { name: d.name.trim(), protocol: d.protocol as FeatureProfileProtocol, baseUrl: d.baseUrl.trim(), model: d.model.trim(), quotaType: d.quotaType as FeatureProfileQuotaType, apiKey: key!.trim() };
        saved = await api.createFeatureProfile(body);
      } else {
        const patch: Record<string, string> = {};
        for (const f of ["name", "protocol", "baseUrl", "model", "quotaType"] as const) if (d[f].trim() !== initial[f]) patch[f] = d[f].trim();
        if (key !== null) patch.apiKey = key.trim();
        if (!Object.keys(patch).length) { setKey(null); onDone(); return; }
        saved = await api.patchFeatureProfile(profile.id, patch);
      }
      setKey(creating ? "" : null);
      putFeatureProfile(hostId, saved);
      onDone();
    } catch (e) {
      setKey((k) => (k === null ? null : ""));
      setProblem(problemText(e, d.baseUrl));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={card.ref} className="my-2 rounded-lg border border-border px-3 py-1" data-feature-profile-editor={profile?.id ?? "new"}>
      <SettingRow agents="none" source="host" label={t("feature-profiles.form.name")}>
        <TextInput autoFocus width="w-64" value={d.name} maxLength={FEATURE_PROFILE_NAME_MAX} placeholder={t("feature-profiles.form.namePlaceholder")} disabled={busy} onChange={(v) => change({ name: v })} />
      </SettingRow>
      <SettingRow agents="none" source="host" label={t("feature-profiles.form.protocol")} hint={!d.protocol && profile ? t("feature-profiles.form.unknownProtocol", { protocol: profile.protocol }) : undefined}>
        <Segmented value={d.protocol as FeatureProfileProtocol} options={FEATURE_PROFILE_PROTOCOLS.map((p) => ({ value: p, label: PROTOCOL_LABEL[p] }))} disabled={busy} onChange={(protocol) => change({ protocol })} />
      </SettingRow>
      <SettingRow agents="none" source="host" label={t("feature-profiles.form.baseUrl")} info={t("feature-profiles.form.baseUrlInfo")}>
        <TextInput mono width="w-72" value={d.baseUrl} placeholder={BASE_PLACEHOLDER[d.protocol || "openaiResponses"]} disabled={busy} onChange={(v) => change({ baseUrl: v })} />
      </SettingRow>
      <SettingRow agents="none" source="host" label={t("feature-profiles.form.model")}>
        <TextInput mono width="w-64" value={d.model} maxLength={FEATURE_PROFILE_MODEL_MAX} placeholder={d.protocol === "anthropicMessages" ? "claude-haiku-5-5" : "gpt-6.2-mini"} disabled={busy} onChange={(v) => change({ model: v })} />
      </SettingRow>
      <SettingRow agents="none" source="host" label={t("feature-profiles.form.quota")} hint={t("feature-profiles.form.quotaHint")}>
        <Select<string> value={d.quotaType} disabled={busy}
          options={[...(d.quotaType ? [] : [{ value: "", label: profile?.quotaType || "—" }]), ...FEATURE_PROFILE_QUOTA_TYPES.map((q) => ({ value: q, label: t(`feature-profiles.quota.${q}` as MessageKey) }))]}
          onChange={(v) => change({ quotaType: v as FeatureProfileQuotaType })} />
      </SettingRow>
      <SettingRow agents="none" source="host" label={t("feature-profiles.form.key")} hint={key === null ? t(profile?.keyPresent ? "feature-profiles.key.set" : "feature-profiles.key.missing") : t("feature-profiles.form.keyHint")}>
        {key === null ? (
          <Button disabled={busy} onClick={() => setKey("")}>{t("feature-profiles.key.replace")}</Button>
        ) : (
          <>
            <TextInput type="password" mono width="w-64" value={key} label={t("feature-profiles.form.key")} placeholder={t("feature-profiles.form.keyPlaceholder")} disabled={busy} onChange={(v) => { setKey(v); setProblem(null); }} />
            {!creating && <Button disabled={busy} onClick={() => setKey(null)}>{t("feature-profiles.key.keep")}</Button>}
          </>
        )}
      </SettingRow>
      <div className="flex items-center justify-end gap-2 py-2">
        {problem && <span className="min-w-0 flex-1 text-xs text-danger" data-feature-profile-problem="">{problem}</span>}
        <Button disabled={busy} onClick={() => { setKey(creating ? "" : null); onDone(); }}>{t("dialog.cancel")}</Button>
        <Button primary disabled={busy} onClick={() => void save()}>{creating ? t("feature-profiles.form.create") : t("settings.save")}</Button>
      </div>
    </div>
  );
}
