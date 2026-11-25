// 创建个人助理 and an assistant's 设置 (plan 「桌面接入规格」 2–3). Creating: pick the home host (hosts with the
// capability), the Profile of that host, a name (names may repeat) and the project set (every paired host listed;
// see ProjectSetPicker). One action id per creation, kept until the outcome is known: a lost reply is retried with
// the same id and the same config (the form is locked meanwhile), never a second creation by name. Settings: name and
// project set replace the stored ones at the revision shown; a 409 reads the latest and asks to check again. Hosts with
// qualified refs (r296) take the set as {instance, project} (`projectRefs` on create, `scopedSettings` on save);
// projects of other hosts are offered only where the host advertises the cross-host scope.
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { PageBody } from "../../components/Page";
import { Button, Section, Select, SettingRow, TextInput } from "../../components/settings/Form";
import type { PaChange, PaConfig, PaView } from "../../../../shared/personalAssistants";
import { PA_NAME_MAX } from "../../../../shared/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { assistantRefs, draftOverlaps, homeProjectIds, keepsActionId, newActionId, paErrorCode, refKey, remoteProjectsSupported, STALE_CODES, type PaProjectRef } from "../../lib/personalAssistants";
import { createAssistant, refreshAssistant, updateAssistant, usePa } from "../../lib/personalAssistantStore";
import { OverlapNotice } from "./OverlapNotice";
import { ProjectSetPicker } from "./ProjectSetPicker";
import { paErrorText, type PaHost } from "./paHooks";

/** `initialHost`: the home host to start with (新建智能体's 个人助理 choice passes its host), when it can host one. */
export function CreateAssistant({ hosts, onCreated, initialHost }: { hosts: readonly PaHost[]; onCreated(hostId: string, id: string): void; initialHost?: string }) {
  const { t } = useI18n();
  const choices = hosts.filter((h) => h.supported);
  const [hostId, setHostId] = useState(() => (choices.find((h) => h.hostId === initialHost) ?? choices.find((h) => h.online) ?? choices[0])?.hostId ?? "");
  const host = hosts.find((h) => h.hostId === hostId);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [profiles, setProfiles] = useState<{ value: string; label: string }[] | null>(null);
  const [refs, setRefs] = useState<PaProjectRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** An attempt without a known outcome: retried exactly (same id, same config). */
  const [pending, setPending] = useState<{ actionId: string; config: PaConfig } | null>(null);
  const others = usePa((s) => s.byHost[hostId]?.assistants ?? []);
  useEffect(() => {
    setProfiles(null);
    setRefs([]);
    if (!hostId || !host?.online) return;
    let live = true;
    void hostApi(hostId)
      .listProfiles()
      .then((list) => {
        if (!live) return;
        const rows = (list?.profiles ?? []).map((p) => ({ value: p.name, label: p.model ? `${p.name} · ${p.model}` : p.name }));
        setProfiles(rows);
        setProfile((cur) => (rows.some((r) => r.value === cur) ? cur : (list?.defaultProfile && rows.some((r) => r.value === list.defaultProfile) ? list.defaultProfile : (rows[0]?.value ?? ""))));
      })
      .catch(() => live && setProfiles([]));
    return () => {
      live = false;
    };
  }, [hostId, host?.online]);
  const overlaps = useMemo(() => draftOverlaps(refs, others, null), [refs, others]);
  const instanceId = host?.instanceId ?? null;
  const ready = !!host?.online && !!instanceId && !!name.trim() && name.trim().length <= PA_NAME_MAX && !!profile && !busy;
  const submit = async (attempt: { actionId: string; config: PaConfig }) => {
    setBusy(true);
    setError(null);
    try {
      const view = await createAssistant(hostId, attempt.actionId, attempt.config);
      setPending(null);
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
    void submit({ actionId: newActionId("create"), config });
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
        <SettingRow agents="none" source="host" label={t("personal-assistants.form.profile")} hint={profiles && profiles.length === 0 ? <span className="text-warn">{t("personal-assistants.form.noProfiles")}</span> : t("personal-assistants.form.profileHint")}>
          <Select value={profile} disabled={locked || !profiles?.length} label={t("personal-assistants.form.profile")} onChange={setProfile} options={profiles ?? []} />
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("personal-assistants.form.projects")} hint={t("personal-assistants.form.projectsHint")}>
          <ProjectSetPicker hosts={hosts} homeHostId={hostId} remoteOk={remoteOk} value={refs} onChange={setRefs} disabled={locked} />
        </SettingRow>
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
  const others = usePa((s) => s.byHost[hostId]?.assistants ?? []);
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

