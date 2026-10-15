// Claude Science page: one host's accounts (the focus host unless another is picked in the toolbar) (one cutex managed service each), 添加账号, and per
// account 打开 / 启动 / 停止 / 日志 / 移除. 打开 = an owner browser tab on the account's service host
// (each account its own `<slug>.svc.localhost` origin, so its cookies stay apart).
import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { confirmDialog, openMenuFrom } from "../../lib/contextMenu";
import { useModuleHostGate } from "../../lib/hostGatingView";
import { sideShowsHost } from "../../lib/sideServices";
import { serviceStatus } from "../../lib/status";
import { useHostData, useHostScope } from "../../lib/useHostScope";
import { useFocusHostId } from "../../lib/targetHost";
import { hostPickerMode, keepTargetHost } from "../../lib/hostPick";
import { HostPicker } from "../../components/HostPicker";
import { useApp } from "../../store";
import { PageBody, PageToolbar } from "../../components/Page";
import { ServiceLogs } from "../../components/ServiceLogs";
import { StatusIcon } from "../../components/StatusIcon";
import { AddButton, Button, EmptyState, ErrorNote, ListRow, Loading, Notice, Section, SettingRow, TextInput, Toggle } from "../../components/settings/Form";
import { useModulePref } from "../react";
import { accountAction, addAccount, openAccount, removeAccount } from "./actions";
import { accountsOf, DEFAULT_BASE, DEFAULT_BINARY, homeFor, idFromName, specProblems, type Account, type AccountSpec } from "./model";

const MODULE = "claude-science";

function stateLabel(a: Account, t: ReturnType<typeof useI18n>["t"]): string {
  const s = a.service;
  const restarts = s.process?.restarts ?? 0;
  if (serviceStatus(s) === "error" && restarts > 0) return t("claude-science.state.crashing", { n: restarts });
  const key = s.health === "reachable" ? "running" : s.health === "starting" ? "starting" : s.health === "stopped" ? "stopped" : "unreachable";
  return t(`claude-science.state.${key}` as MessageKey);
}

export function ClaudeSciencePage() {
  const { t } = useI18n();
  const scope = useHostScope();
  const focus = useFocusHostId();
  const [chosen, setChosen] = useState<string | null>(null);
  const hostId = keepTargetHost(scope, chosen, focus);
  const pickerMode = hostPickerMode(scope, hostId);
  const data = useHostData(hostId);
  // The module shows when any host of the scope has its capabilities; the picked one may not.
  const gate = useModuleHostGate(MODULE, hostId);
  const unsupported = !gate.ok && !gate.waiting;
  const refresh = useApp((s) => s.refreshServices);
  const accounts = useMemo(() => accountsOf(data?.services), [data?.services]);
  const [adding, setAdding] = useState(false);
  const [logs, setLogs] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    void fn()
      .then(() => refresh())
      .catch((e: unknown) => setError(t("claude-science.failed", { error: e instanceof Error ? e.message : String(e) })));
  };
  const open = (a: Account) => {
    setError(null);
    // The browser tab opens on the right side, which shows the open agent's host only.
    if (!sideShowsHost(hostId)) setError(t("claude-science.otherHost"));
    else if (!openAccount(a.service.slug, hostId)) setError(t("claude-science.needsBrowser"));
  };
  const toggleLogs = (id: string) =>
    setLogs((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const remove = (a: Account) =>
    void (async () => {
      if (await confirmDialog(t("claude-science.removeConfirm", { name: a.name, home: a.home ?? t("claude-science.homeUnknown") }), true)) run(() => removeAccount(a.id, hostId));
    })();

  return (
    <PageBody>
      <PageToolbar>
        <HostPicker value={hostId} onChange={setChosen} mode={pickerMode} title={t("claude-science.host")} />
        <span className="mr-auto text-xs text-subtle">{t("claude-science.description")}</span>
        {!adding && !unsupported && (
          <AddButton primary onClick={() => setAdding(true)}>
            {t("claude-science.add")}
          </AddButton>
        )}
      </PageToolbar>
      {error && <ErrorNote>{error}</ErrorNote>}
      {unsupported && <Notice tone="info">{t("modules.needsCapability", { list: gate.missing.join(", ") })}</Notice>}
      {adding && !unsupported && (
        <AddAccountForm
          taken={new Set(accounts.map((a) => a.id))}
          onCancel={() => setAdding(false)}
          onAdd={(spec) =>
            addAccount(spec, hostId).then(() => {
              setAdding(false);
              void refresh();
            })
          }
        />
      )}
      {!unsupported && (
      <Section>
        {data?.services == null ? (
          <Loading />
        ) : accounts.length === 0 ? (
          <EmptyState>{t("claude-science.empty")}</EmptyState>
        ) : (
          accounts.map((a) => {
            const s = a.service;
            const running = s.health === "reachable" || s.health === "starting";
            const detail = [t("claude-science.port", { port: s.port }), a.home ?? t("claude-science.homeUnknown"), a.shareSsh ? t("claude-science.sshShared") : null].filter(Boolean).join(" · ");
            return (
              <ListRow
                key={s.slug}
                leading={<StatusIcon kind={serviceStatus(s)} />}
                title={
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate">{a.name}</span>
                    <span className="shrink-0 text-xs text-subtle">{stateLabel(a, t)}</span>
                  </span>
                }
                detail={<span className="font-mono text-[11px]">{detail}</span>}
                actions={
                  <>
                    <Button primary onClick={() => open(a)}>
                      {t("claude-science.open")}
                    </Button>
                    {running ? (
                      <Button onClick={() => run(() => accountAction(a.id, "stop", hostId))}>{t("claude-science.stop")}</Button>
                    ) : (
                      <Button onClick={() => run(() => accountAction(a.id, "start", hostId))}>{t("claude-science.start")}</Button>
                    )}
                    <button
                      aria-label="⋯"
                      onClick={(e) =>
                        openMenuFrom(e.currentTarget, [
                          running && { label: t("claude-science.restart"), onSelect: () => run(() => accountAction(a.id, "restart", hostId)) },
                          { label: t(logs.has(a.id) ? "claude-science.hideLogs" : "claude-science.logs"), onSelect: () => toggleLogs(a.id) },
                          "separator",
                          { label: t("claude-science.remove"), danger: true, onSelect: () => remove(a) },
                        ])
                      }
                      className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-foreground"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </>
                }
                below={logs.has(a.id) ? <ServiceLogs slug={s.slug} hostId={hostId} className="mt-2 mb-1" /> : undefined}
              />
            );
          })
        )}
      </Section>
      )}
      <Section title={t("claude-science.login.title")}>
        <ol className="list-decimal space-y-1 py-2 pl-5 text-xs text-muted">
          {(["step1", "step2", "step3", "step4"] as const).map((k) => (
            <li key={k}>{t(`claude-science.login.${k}`)}</li>
          ))}
        </ol>
        <Notice tone="info">{t("claude-science.login.why")}</Notice>
        <Notice tone="info">{t("claude-science.previewNote")}</Notice>
      </Section>
    </PageBody>
  );
}

function AddAccountForm({ taken, onAdd, onCancel }: { taken: ReadonlySet<string>; onAdd(spec: AccountSpec): Promise<void>; onCancel(): void }) {
  const { t } = useI18n();
  const [binaryPref, setBinaryPref] = useModulePref<string>(MODULE, "binary", DEFAULT_BINARY);
  const [base] = useModulePref<string>(MODULE, "base", DEFAULT_BASE);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [home, setHome] = useState("");
  const [homeTouched, setHomeTouched] = useState(false);
  const [binary, setBinary] = useState<string>(binaryPref);
  const [port, setPort] = useState("");
  const [shareSsh, setShareSsh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveId = idTouched ? id : idFromName(name);
  const effectiveHome = homeTouched ? home : effectiveId ? homeFor(base, effectiveId) : "";
  const spec: AccountSpec = { id: effectiveId, name, home: effectiveHome.trim(), binary: binary.trim(), shareSsh, ...(port.trim() ? { port: Number(port.trim()) } : {}) };
  const problems = specProblems(spec, taken);
  const submit = () => {
    if (problems.length > 0 || busy) return;
    setBusy(true);
    setError(null);
    onAdd(spec)
      .then(() => setBinaryPref(spec.binary))
      .catch((e: unknown) => setError(t("claude-science.failed", { error: e instanceof Error ? e.message : String(e) })))
      .finally(() => setBusy(false));
  };
  const shown = name || idTouched || homeTouched ? problems : problems.filter((p) => p !== "id" && p !== "name" && p !== "home");

  return (
    <Section title={t("claude-science.form.title")}>
      <SettingRow label={t("claude-science.form.name")}>
        <TextInput value={name} onChange={setName} placeholder={t("claude-science.form.namePlaceholder")} maxLength={80} autoFocus label={t("claude-science.form.name")} />
      </SettingRow>
      <SettingRow label={t("claude-science.form.id")} hint={t("claude-science.form.idHint")}>
        <TextInput
          value={effectiveId}
          onChange={(v) => {
            setIdTouched(true);
            setId(v.toLowerCase());
          }}
          mono
          maxLength={12}
          label={t("claude-science.form.id")}
        />
      </SettingRow>
      <SettingRow label={t("claude-science.form.home")} hint={t("claude-science.form.homeHint")}>
        <TextInput
          value={effectiveHome}
          onChange={(v) => {
            setHomeTouched(true);
            setHome(v);
          }}
          mono
          label={t("claude-science.form.home")}
        />
      </SettingRow>
      <SettingRow label={t("claude-science.form.binary")}>
        <TextInput value={binary} onChange={setBinary} mono label={t("claude-science.form.binary")} />
      </SettingRow>
      <SettingRow label={t("claude-science.form.port")} hint={t("claude-science.form.portHint")}>
        <TextInput value={port} onChange={(v) => setPort(v.replace(/[^0-9]/g, ""))} mono width="w-24" maxLength={5} label={t("claude-science.form.port")} />
      </SettingRow>
      <SettingRow label={t("claude-science.form.ssh")} hint={t("claude-science.form.sshHint")}>
        <Toggle checked={shareSsh} onChange={setShareSsh} label={t("claude-science.form.ssh")} />
      </SettingRow>
      {shown.map((p) => (
        <Notice key={p}>{t(`claude-science.problem.${p}` as MessageKey)}</Notice>
      ))}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2 py-3">
        <Button onClick={onCancel}>{t("claude-science.form.cancel")}</Button>
        <Button primary disabled={problems.length > 0 || busy} onClick={submit}>
          {t("claude-science.form.submit")}
        </Button>
      </div>
    </Section>
  );
}
