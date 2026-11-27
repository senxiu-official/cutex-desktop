// Settings → Profile → 功能 Profile (cutex feature-profiles; owner 2026-11-25, on the Profile page since 2026-11-26):
// the host's model endpoints for app features (提示词增强 first), never agents'. A list (R6: the first ones on the
// page, all with a filter on the sub-page 全部 N), add / edit inline, remove with a second click. Shaped like the
// Profile page's other cards and its new-Profile form (owner 2026-11-26: 「tag风格、host picker什么的都不统一」):
// rows declare host / no agents (the page header's host picker and the card's chips), 未设置 API key reads as on a
// Profile card, the fields use the Profile form's words and widths. The API key is write-only: a new one is typed
// once (add, or 更换 API key on edit), sent through main and cleared with the form; the page only shows whether one
// is set. 测试连接 (cutex feature-profile-test-v1; hidden on hosts without it): a saved row tests with its stored key,
// the form tests what is typed there (a draft with the typed key; nothing is saved). The result shows inline, in plain
// words per error class.
import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, Loader2, TriangleAlert, X } from "lucide-react";
import {
  FEATURE_PROFILE_LIMIT, FEATURE_PROFILE_MODEL_MAX, FEATURE_PROFILE_NAME_MAX, FEATURE_PROFILE_PROTOCOLS, FEATURE_PROFILE_QUOTA_TYPES,
  FEATURE_PROFILE_TEST_FEATURE,
  type FeatureProfile, type FeatureProfileCreate, type FeatureProfileProtocol, type FeatureProfileQuotaType,
  type FeatureProfileTestRequest, type FeatureProfileTestResult,
} from "../../../../shared/featureProfiles";
import { AddButton, ArmedRemove, Button, EmptyState, ErrorNote, IconButton, ListFilter, ListRow, Loading, RefreshButton, Section, Segmented, Select, SettingRow, SettingsGroup, SubPageRow, TextInput, type SettingsRowDecoration as RowEffect } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { dropFeatureProfile, putFeatureProfile, useFeatureProfiles } from "../../lib/featureProfiles";
import { matchesFilter } from "../../lib/listFilter";
import { settingsAnchorId } from "../../lib/settingsNav";
import { FEATURE_PROFILES_ALL_SECTION, FEATURE_PROFILES_SECTION, FEATURE_PROFILES_SUB } from "../../lib/featureProfilesNav";
import { useSettingsCard } from "../../lib/settingsDrafts";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";
import { Pencil } from "lucide-react";

/** Rows on the page; all of them are on the sub-page (R6). */
export const FEATURE_PROFILES_ON_PAGE = 5;

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

type TestState = { kind: "running" } | { kind: "done"; result: FeatureProfileTestResult } | { kind: "error"; text: string } | null;

/** One 测试连接 at a time per row / form; a later run or clear() wins over an answer still on its way. */
function useConnectionTest() {
  const api = useTargetApi();
  const problemText = useProblemText();
  const [state, setState] = useState<TestState>(null);
  const run = useRef(0);
  useEffect(() => () => { run.current++; }, []);
  const test = async (request: FeatureProfileTestRequest, baseUrl?: string) => {
    const mine = ++run.current;
    setState({ kind: "running" });
    try {
      const result = await api.testFeatureProfile(request);
      if (run.current === mine) setState({ kind: "done", result });
    } catch (e) {
      if (run.current === mine) setState({ kind: "error", text: problemText(e, baseUrl) });
    }
  };
  const clear = () => { run.current++; setState(null); };
  return { state, test, clear, running: state?.kind === "running" };
}

/** ✓ 可以连上 · N ms · model, or ✗ and the reason in plain words (the host's short message on hover; shown for other). */
function TestOutcome({ state }: { state: TestState }) {
  const { t } = useI18n();
  if (!state) return null;
  if (state.kind === "running") {
    return <span className="inline-flex items-center gap-1 text-subtle" role="status" data-feature-profile-test="running"><Loader2 size={12} className="animate-spin" aria-hidden />{t("feature-profiles.test.running")}</span>;
  }
  if (state.kind === "error") {
    return <span className="inline-flex items-center gap-1 text-danger" role="status" data-feature-profile-test="error"><X size={12} className="shrink-0" aria-hidden />{state.text}</span>;
  }
  const { ok, latencyMs, model, error } = state.result;
  if (ok) {
    const parts = [t("feature-profiles.test.ok"), latencyMs !== null ? t("feature-profiles.test.ms", { n: latencyMs }) : null, model].filter(Boolean);
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-ok-text" role="status" data-feature-profile-test="ok">
        <Check size={12} className="shrink-0" aria-hidden /><span className="min-w-0 truncate">{parts.join(" · ")}</span>
      </span>
    );
  }
  const cls = error?.class ?? "other";
  return (
    <span className="inline-flex min-w-0 items-start gap-1 text-danger" role="status" title={error?.message || undefined} data-feature-profile-test={cls}>
      <X size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{t(`feature-profiles.test.fail.${cls}` as MessageKey)}{cls === "other" && error?.message ? `（${error.message}）` : ""}</span>
    </span>
  );
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
  const canTest = useTargetFeatures().has(FEATURE_PROFILE_TEST_FEATURE);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const full = (list?.length ?? 0) + damaged.length >= FEATURE_PROFILE_LIMIT;
  const shown = all ? list?.filter((p) => matchesFilter(filter, p.name, p.model, p.baseUrl)) : list?.filter((p, i) => i < FEATURE_PROFILES_ON_PAGE || p.id === editing);
  return (
    <Section
      id={settingsAnchorId(all ? FEATURE_PROFILES_ALL_SECTION : FEATURE_PROFILES_SECTION)}
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
        {editing === "new" && <Editor hostId={hostId} profile={null} canTest={canTest} onDone={() => setEditing(null)} />}
        {!list && !error && <Loading rows={2} />}
        {list && list.length === 0 && damaged.length === 0 && editing !== "new" && <EmptyState>{t("feature-profiles.empty")}</EmptyState>}
        {all && <div role="search" className="contents"><ListFilter count={list?.length ?? 0} value={filter} onChange={setFilter} /></div>}
        {/* Each row a host setting no agent reads (like a Kimi account row's 下次启动): the card's chips and the page
            header's host picker come from these, also while no form is open. */}
        {shown?.map((p) => (
          <SettingsGroup key={p.id} agents="none" source="host">{(effect) => (
            <Row effect={effect} hostId={hostId} profile={p} canTest={canTest} editing={editing === p.id} onEdit={(on) => setEditing(on ? p.id : null)} />
          )}</SettingsGroup>
        ))}
        {/* Damaged records stay visible on both pages until deleted (they still take one of the host's slots). */}
        {list && damaged.map((id) => <SettingsGroup key={id} agents="none" source="host">{(effect) => <DamagedRow effect={effect} hostId={hostId} id={id} />}</SettingsGroup>)}
        {!all && list && list.length > FEATURE_PROFILES_ON_PAGE && (
          <SubPageRow title={t("feature-profiles.all", { n: list.length })} onOpen={() => useApp.getState().openSettings("profiles", { sub: FEATURE_PROFILES_SUB })} />
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Section>
  );
}

function Row({ hostId, profile: p, canTest, editing, onEdit, effect }: { hostId: string; profile: FeatureProfile; canTest: boolean; editing: boolean; onEdit(on: boolean): void; effect?: RowEffect }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const problemText = useProblemText();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const test = useConnectionTest();
  // A result belongs to the settings it tested: a saved edit (a new row object) or opening the form drops it.
  const clearTest = test.clear;
  useEffect(() => clearTest(), [p, editing]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // As a Profile card's grey line: what kind of endpoint first, then the model.
  const detail = [
    isProtocol(p.protocol) ? PROTOCOL_LABEL[p.protocol] : p.protocol,
    p.model,
    hostOf(p.baseUrl),
    isQuota(p.quotaType) ? t(`feature-profiles.quota.${p.quotaType}` as MessageKey) : p.quotaType,
  ].filter(Boolean).join(" · ");
  return (
    <ListRow
      effect={effect}
      frame={editing ? "bg-surface-2/40" : undefined}
      leading={<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"><KeyRound size={14} aria-hidden /></span>}
      title={
        <>
          <span data-feature-profile={p.id}>{p.name}</span>
          {/* As a Profile card's problems beside its name (⚠ 未设置 API key). */}
          {!p.keyPresent && <span className="ml-2 text-xs text-warn" data-feature-profile-key-missing="">⚠ {t("feature-profiles.key.missing")}</span>}
        </>
      }
      detail={
        <>
          {detail}
          {problem && <span className="text-danger"> · {problem}</span>}
        </>
      }
      actions={editing ? undefined : (
        <>
          {canTest && (
            <Button disabled={busy || test.running || !p.keyPresent} title={p.keyPresent ? undefined : t("feature-profiles.test.noKey")} onClick={() => void test.test({ profileId: p.id })}>
              {t("feature-profiles.test.run")}
            </Button>
          )}
          <IconButton label={t("feature-profiles.edit")} disabled={busy} onClick={() => onEdit(true)}><Pencil size={13} /></IconButton>
          <ArmedRemove title={t("feature-profiles.remove")} disabled={busy} onRemove={() => void remove()} />
        </>
      )}
      below={editing
        ? <Editor hostId={hostId} profile={p} canTest={canTest} onDone={() => onEdit(false)} />
        : test.state ? <div className="mt-1 pl-[38px] text-xs" data-feature-profile-test-row={p.id}><TestOutcome state={test.state} /></div> : undefined}
    />
  );
}

/** A record the host could not read (list `errors`): its ID and delete; nothing to edit. */
function DamagedRow({ hostId, id, effect }: { hostId: string; id: string; effect?: RowEffect }) {
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
      effect={effect}
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

/** The fields 测试连接 needs, as cutex checks them (name and quota type play no part). */
function connectionProblem(d: Draft): MessageKey | null {
  if (!d.protocol) return "feature-profiles.form.badProtocol";
  if (!/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost|\[::1\]))/i.test(d.baseUrl.trim())) return "feature-profiles.form.badBaseUrl";
  if (!d.model.trim() || /\s/.test(d.model.trim()) || d.model.trim().length > FEATURE_PROFILE_MODEL_MAX) return "feature-profiles.form.badModel";
  return null;
}

/** Add (profile null) or edit inline. The key: required on add; on edit only after 更换密钥. */
function Editor({ hostId, profile, canTest, onDone }: { hostId: string; profile: FeatureProfile | null; canTest: boolean; onDone(): void }) {
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
  const test = useConnectionTest();
  const change = (patch: Partial<Draft>) => { setD((x) => ({ ...x, ...patch })); setProblem(null); test.clear(); };
  // 测试连接 in the form: a key typed here makes a draft test; without one, an unchanged saved row tests by ID (its
  // stored key); a changed endpoint without a key can't be tested (the stored key never comes back to the desktop).
  const typedKey = key?.trim() || null;
  const endpointChanged = !creating && (d.protocol !== initial.protocol || d.baseUrl.trim() !== initial.baseUrl || d.model.trim() !== initial.model);
  const testBlocked: MessageKey | null = typedKey ? null
    : creating ? "feature-profiles.form.badKey"
    : endpointChanged ? "feature-profiles.test.needKey"
    : !profile.keyPresent ? "feature-profiles.test.noKey" : null;
  const runTest = () => {
    if (testBlocked) return;
    if (typedKey) {
      const bad = connectionProblem(d);
      if (bad) return setProblem(t(bad));
      setProblem(null);
      void test.test({ draft: { protocol: d.protocol as FeatureProfileProtocol, baseUrl: d.baseUrl.trim(), model: d.model.trim(), apiKey: typedKey } }, d.baseUrl);
    } else if (profile) {
      void test.test({ profileId: profile.id });
    }
  };
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
        <TextInput mono width="w-80" label={t("feature-profiles.form.baseUrl")} value={d.baseUrl} placeholder={BASE_PLACEHOLDER[d.protocol || "openaiResponses"]} disabled={busy} onChange={(v) => change({ baseUrl: v })} />
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
            <TextInput type="password" mono width="w-80" value={key} label={t("feature-profiles.form.key")} placeholder={t("feature-profiles.form.keyPlaceholder")} disabled={busy} onChange={(v) => { setKey(v); setProblem(null); test.clear(); }} />
            {!creating && <Button disabled={busy} onClick={() => { setKey(null); test.clear(); }}>{t("feature-profiles.key.keep")}</Button>}
          </>
        )}
      </SettingRow>
      {canTest && (
        <div className="flex min-h-9 flex-wrap items-center gap-2 border-t border-border py-2" data-feature-profile-test-form="">
          <Button disabled={busy || test.running || testBlocked !== null} title={testBlocked ? t(testBlocked) : t("feature-profiles.test.draftHint")} onClick={runTest}>
            {t("feature-profiles.test.run")}
          </Button>
          <span className="min-w-0 flex-1 text-xs">
            {test.state ? <TestOutcome state={test.state} /> : testBlocked === "feature-profiles.test.needKey" ? <span className="text-subtle">{t(testBlocked)}</span> : null}
          </span>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 py-2">
        {problem &&<span className="min-w-0 flex-1 text-xs text-danger" data-feature-profile-problem="">{problem}</span>}
        <Button disabled={busy} onClick={() => { setKey(creating ? "" : null); onDone(); }}>{t("dialog.cancel")}</Button>
        <Button primary disabled={busy} onClick={() => void save()}>{creating ? t("feature-profiles.form.create") : t("settings.save")}</Button>
      </div>
    </div>
  );
}
