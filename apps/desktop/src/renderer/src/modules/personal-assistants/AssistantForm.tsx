// 创建个人助理 and an assistant's 设置 (plan 「桌面接入规格」 2–3). Creating: pick the home host (hosts with the
// capability), the Profile of that host, a name (names may repeat) and the project set (every paired host listed;
// see ProjectSetPicker). One action id per creation, kept until the outcome is known: a lost reply is retried with
// the same id and the same config (the form is locked meanwhile), never a second creation by name. Settings: name and
// project set replace the stored ones at the revision shown; a 409 reads the latest and asks to check again. Hosts with
// qualified refs (r296) take the set as {instance, project} (`projectRefs` on create, `scopedSettings` on save);
// projects of other hosts are offered only where the host advertises the cross-host scope. Profiles that can't run an
// assistant are greyed with the reason and never chosen by default (./readiness): r299 hosts say which (create-options),
// older ones by this app's rule.
import { useEffect, useMemo, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { PageBody } from "../../components/Page";
import { Button, Section, Select, SettingRow, TextInput } from "../../components/settings/Form";
import type { PaAssistant, PaChange, PaConfig, PaPermissionMode, PaView } from "../../../../shared/personalAssistants";
import { PA_AGENT_FEATURE, PA_NAME_MAX } from "../../../../shared/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { assistantRefs, draftOverlaps, homeProjectIds, keepsActionId, newActionId, paErrorCode, refKey, remoteProjectsSupported, STALE_CODES, type PaProjectRef } from "../../lib/personalAssistants";
import { createAssistant, refreshAssistant, updateAssistant, usePa } from "../../lib/personalAssistantStore";
import { OverlapNotice } from "./OverlapNotice";
import { ProjectSetPicker } from "./ProjectSetPicker";
import { paErrorText, type PaHost } from "./paHooks";
import { assistantProfileChoices, pickAssistantProfile, type ProfileChoice } from "./readiness";
import { adoptFirstAssistant } from "./defaultAssistant";
import { PermissionModeChoice } from "./RuntimeCard";

/** One empty list (a new [] per read would make the store selector loop while a host is not read yet). */
const NO_ASSISTANTS: readonly PaAssistant[] = [];

/** Reason codes with their own words (others: 「这台主机不让用（code）」). */
const KNOWN_REASONS = new Set(["notClaude", "notSubscription", "notListed", "assistant_profile_runtime_unsupported", "assistant_runtime_unavailable", "assistant_runtime_unsupported", "assistant_account_unavailable", "assistant_account_runtime_unsupported", "assistant_profile_selector_unsupported"]);

/** `initialHost`: the home host to start with (新建智能体's 个人助理 choice passes its host), when it can host one. */
export function CreateAssistant({ hosts, onCreated, initialHost }: { hosts: readonly PaHost[]; onCreated(hostId: string, id: string): void; initialHost?: string }) {
  const { t } = useI18n();
  const choices = hosts.filter((h) => h.supported);
  const [hostId, setHostId] = useState(() => (choices.find((h) => h.hostId === initialHost) ?? choices.find((h) => h.online) ?? choices[0])?.hostId ?? "");
  const host = hosts.find((h) => h.hostId === hostId);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [profiles, setProfiles] = useState<ProfileChoice[] | null>(null);
  /** r299: the host's verdicts could not be read (nothing is offered then). */
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const hostSays = !!host?.features.readiness;
  const [refs, setRefs] = useState<PaProjectRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** An attempt without a known outcome: retried exactly (same id, same config, same mode). */
  const [pending, setPending] = useState<{ actionId: string; config: PaConfig; permissionMode?: PaPermissionMode } | null>(null);
  /** r299 normal-agent assistants: the modes the host offers and the one chosen (its default: 自动). */
  const [modes, setModes] = useState<{ offered: PaPermissionMode[]; chosen: PaPermissionMode } | null>(null);
  const agentHost = !!host?.featureSet?.has(PA_AGENT_FEATURE);
  const others = usePa((s) => s.byHost[hostId]?.assistants ?? NO_ASSISTANTS);
  useEffect(() => {
    setProfiles(null);
    setVerdictError(null);
    setRefs([]);
    setModes(null);
    if (!hostId || !host?.online) return;
    let live = true;
    const api = hostApi(hostId);
    // r299: the host's create-options decide; a failed read offers nothing (never this app's guess instead).
    const verdicts = hostSays
      ? api.paCreateOptions().then(
          (o) => {
            const offered = o.permissionModes?.length ? o.permissionModes : null;
            if (live && offered) setModes({ offered, chosen: o.defaultPermissionMode && offered.includes(o.defaultPermissionMode) ? o.defaultPermissionMode : offered.includes("auto") ? "auto" : offered[0]! });
            return o.profiles;
          },
          (e: unknown) => (live && setVerdictError(paErrorText(e, t)), []),
        )
      : Promise.resolve(null);
    void Promise.all([api.listProfiles(), verdicts])
      .then(([list, host]) => {
        if (!live) return;
        const rows = assistantProfileChoices(list?.profiles ?? [], host);
        setProfiles(rows);
        setProfile((cur) => pickAssistantProfile(rows, cur, list?.defaultProfile ?? null));
      })
      .catch(() => live && setProfiles([]));
    return () => {
      live = false;
    };
  }, [hostId, host?.online, hostSays]); // eslint-disable-line react-hooks/exhaustive-deps -- `t` only words the error
  const overlaps = useMemo(() => draftOverlaps(refs, others, null), [refs, others]);
  const instanceId = host?.instanceId ?? null;
  const usable = profiles?.filter((p) => p.eligible) ?? [];
  const ready = !!host?.online && !!instanceId && !!name.trim() && name.trim().length <= PA_NAME_MAX && usable.some((p) => p.name === profile) && !busy;
  const reasonText = (code: string | null) => (code && KNOWN_REASONS.has(code) ? t(`personal-assistants.form.profileReason.${code}` as MessageKey) : t("personal-assistants.form.profileReason.other", { code: code ?? "" }));
  const profileOptions = (profiles ?? []).map((p) => ({
    value: p.name,
    label: `${p.model ? `${p.name} · ${p.model}` : p.name}${p.eligible ? (p.runtimePin ? ` · ${p.runtimePin}` : "") : ` — ${reasonText(p.reason)}`}`,
    disabled: !p.eligible,
    group: p.eligible ? t("personal-assistants.form.profileUsable") : t("personal-assistants.form.profileUnusable"),
    entity: { kind: "profile" as const, ref: p.name, hostId },
  }));
  const profileHint = !profiles ? t("personal-assistants.form.profileHint")
    : profiles.length === 0 ? <span className="text-warn">{t("personal-assistants.form.noProfiles")}</span>
    : verdictError ? <span className="text-warn" data-pa-verdict-error="">{t("personal-assistants.form.verdictFailed", { error: verdictError })}</span>
    : usable.length === 0 ? <span className="text-warn" data-pa-no-usable-profile="">{t(hostSays ? "personal-assistants.form.noUsableProfileHost" : "personal-assistants.form.noUsableProfile")}</span>
    : usable.length < profiles.length ? <span data-pa-some-unusable="">{t(hostSays ? "personal-assistants.form.someUnusableHost" : "personal-assistants.form.someUnusable", { n: profiles.length - usable.length })}</span>
    : t("personal-assistants.form.profileHint");
  const submit = async (attempt: { actionId: string; config: PaConfig; permissionMode?: PaPermissionMode }) => {
    setBusy(true);
    setError(null);
    try {
      const view = await createAssistant(hostId, attempt.actionId, attempt.config, attempt.permissionMode);
      setPending(null);
      // 默认助理 (owner 2026-11-27): the first one created is the default.
      adoptFirstAssistant({ hostId, assistantId: view.assistant.id });
      onCreated(hostId, view.assistant.id);
    } catch (e) {
      setPending(keepsActionId(e) ? attempt : null);
      setError(paErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const remoteOk = remoteProjectsSupported(host?.features ?? null);
  const create = () => {
    if (!instanceId) return;
    const config: PaConfig = { name: name.trim(), profile, homeInstanceId: instanceId, projectIds: homeProjectIds(refs, instanceId) };
    if (host?.features.qualifiedRefs) config.projectRefs = storable(refs, instanceId, remoteOk);
    void submit({ actionId: newActionId("create"), config, ...(agentHost && modes ? { permissionMode: modes.chosen } : {}) });
  };
  const locked = busy || !!pending;
  return (
    <PageBody scrollKey="pa-new">
      {error && <div className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger" role="alert" data-pa-error="">{error}</div>}
      <Section
        title={t("personal-assistants.create")}
        hint={t("personal-assistants.empty.hint")}
        actions={
          pending ? (
            <Button primary disabled={busy} title={t("personal-assistants.form.retryHint")} onClick={() => void submit(pending)}>
              {busy ? t("personal-assistants.form.creating") : t("personal-assistants.form.retry")}
            </Button>
          ) : (
            <Button primary disabled={!ready} onClick={create}>
              {busy ? t("personal-assistants.form.creating") : t("personal-assistants.form.create")}
            </Button>
          )
        }
      >
        <SettingRow agents="none" source="host" label={t("personal-assistants.form.host")} hint={host && !host.online ? <span className="text-warn">{t("personal-assistants.offline", { host: host.label })}</span> : t("personal-assistants.form.hostHint")}>
          <Select value={hostId} disabled={locked} label={t("personal-assistants.form.host")} onChange={setHostId} options={choices.map((h) => ({ value: h.hostId, label: h.label, disabled: !h.online }))} />
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("personal-assistants.form.name")} hint={t("personal-assistants.form.nameHint")}>
          <TextInput value={name} onChange={setName} disabled={locked} maxLength={PA_NAME_MAX} label={t("personal-assistants.form.name")} />
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("personal-assistants.form.profile")} hint={profileHint}>
          <Select value={profile} disabled={locked || !profiles?.length} label={t("personal-assistants.form.profile")} onChange={setProfile} options={profileOptions} />
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("personal-assistants.form.projects")} hint={t("personal-assistants.form.projectsHint")}>
          <ProjectSetPicker hosts={hosts} homeHostId={hostId} remoteOk={remoteOk} value={refs} onChange={setRefs} disabled={locked} />
        </SettingRow>
        {agentHost && modes && (
          <SettingRow agents="none" source="host" label={t("personal-assistants.runtime.mode")} hint={t("personal-assistants.runtime.createHint")}>
            <PermissionModeChoice name="pa-new-mode" value={modes.chosen} offered={modes.offered} disabled={locked} onChange={(chosen) => setModes({ ...modes, chosen })} />
          </SettingRow>
        )}
        <OverlapNotice rows={overlaps} selfId={null} host={host} />
      </Section>
    </PageBody>
  );
}

/** The refs a host stores: all of them where it takes other hosts' projects, else the home host's. */
function storable(refs: readonly PaProjectRef[], home: string, remoteOk: boolean): PaProjectRef[] {
  const keep = remoteOk ? refs : refs.filter((r) => r.instanceId === home);
  return [...keep].sort((a, b) => refKey(a).localeCompare(refKey(b)));
}

/** 设置: name and project set at the shown revision; the Profile as created and as the session runs it now. */
export function AssistantSettings({ hostId, view, hosts, readOnly }: { hostId: string; view: PaView; hosts: readonly PaHost[]; readOnly: boolean }) {
  const { t } = useI18n();
  const a = view.assistant;
  const host = hosts.find((h) => h.hostId === hostId);
  const [name, setName] = useState(a.config.name);
  const [refs, setRefs] = useState<PaProjectRef[]>(() => assistantRefs(a));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  // Another writer changed it: take the stored values (the owner's edits would be against an old revision).
  const [base, setBase] = useState(a.revision);
  useEffect(() => {
    if (a.revision === base) return;
    setBase(a.revision);
    setName(a.config.name);
    setRefs(assistantRefs(a));
  }, [a, base]);
  const others = usePa((s) => s.byHost[hostId]?.assistants ?? NO_ASSISTANTS);
  const draft = useMemo(() => draftOverlaps(refs, others, a.id), [refs, others, a.id]);
  const remoteOk = remoteProjectsSupported(host?.features ?? null, view.fromList ? null : view.capabilities);
  const projectIds = homeProjectIds(refs, a.config.homeInstanceId);
  const kept = storable(refs, a.config.homeInstanceId, remoteOk);
  const stored = storable(assistantRefs(a), a.config.homeInstanceId, true);
  const changed = name.trim() !== a.config.name || kept.map(refKey).join(",") !== stored.map(refKey).join(",");
  const ready = !readOnly && changed && !!name.trim() && name.trim().length <= PA_NAME_MAX && !busy;
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const change: PaChange = host?.features.qualifiedRefs ? { kind: "scopedSettings", name: name.trim(), projectRefs: kept } : { kind: "settings", name: name.trim(), projectIds };
      await updateAssistant(hostId, a, change);
      setNote({ tone: "ok", text: t("personal-assistants.form.saved") });
    } catch (e) {
      if (STALE_CODES.has(paErrorCode(e) ?? "")) {
        await refreshAssistant(hostId, a.id).catch(() => {});
        setNote({ tone: "warn", text: t("personal-assistants.form.stale") });
      } else setNote({ tone: "error", text: paErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  // Saved: the stored overlaps (cutex); while editing: what this app sees.
  const overlapRows = changed ? draft : view.overlaps;
  return (
    <div data-pa-settings="">
      <Section title={t("personal-assistants.tab.settings")} actions={<Button primary disabled={!ready} onClick={() => void save()}>{t("personal-assistants.form.save")}</Button>}>
        {note && <div className={`mb-2 text-caption/[inherit] ${note.tone === "ok" ? "text-subtle" : note.tone === "warn" ? "text-warn" : "text-danger"}`} role="status" data-pa-settings-note={note.tone}>{note.text}</div>}
        <SettingRow agents="none" source="host" label={t("personal-assistants.form.name")} hint={t("personal-assistants.form.nameHint")}>
          <TextInput value={name} onChange={setName} disabled={readOnly || busy} maxLength={PA_NAME_MAX} label={t("personal-assistants.form.name")} />
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("personal-assistants.form.profile")} hint={t("personal-assistants.form.profileSwitch")}>
          <span className="text-ui/[inherit] text-muted" data-pa-profile="">{t("personal-assistants.form.profileNow", { created: a.config.profile, active: view.activeProfile ?? "—" })}</span>
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("personal-assistants.form.projects")} hint={t("personal-assistants.form.projectsHint")}>
          <ProjectSetPicker hosts={hosts} homeHostId={hostId} remoteOk={remoteOk} value={refs} onChange={setRefs} disabled={readOnly || busy} />
        </SettingRow>
        <OverlapNotice key={refs.map(refKey).join(",")} rows={overlapRows} more={!changed && view.moreOverlaps} selfId={a.id} host={host} />
      </Section>
    </div>
  );
}

