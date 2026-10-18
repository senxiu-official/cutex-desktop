// Settings → 主机后端更新 (系统 group, host page): the settings target host's cutex — the installed release with
// where it stands in one sentence, what it brought (cutex `installed.notes`, else notes saved while it was on offer), the runtimes new
// agents get (the one place the cutex build and those runtimes show; 运行时 links here); build, commit,
// install kind and service manager under 详细信息; check / download (stage) / update (apply, one-way
// typed confirmation) / cancel / roll back (dry-run preview first); the run by phase; history; the
// automatic-update settings. cutex does all the work (`cutex upgrade …` runner, docs/backend-upgrade.md);
// this page only reads its state and triggers it. A hand-deployed host (managed: false) is read-only.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { UPGRADE_CHECK_INTERVAL_MAX, UPGRADE_PACKAGE_RUN_BATCH_MAX, UPGRADE_PACKAGE_RUNS, upgradeNoteText, type HostServiceInfo, type UpgradeAvailable, type UpgradeMigration, type UpgradeMode, type UpgradePackageRun, type UpgradeRollbackPreview, type UpgradeSettings, type UpgradeSettingsPatch, type UpgradeStatus } from "../../../../shared/backendUpgrade";
import { readCutexBuild } from "@cutex-desktop/cutex-client";
import { ArmedHint } from "../../components/ArmedHint";
import { Button, Details, EmptyState, ErrorNote, Loading, Notice, NumberField, Section, Segmented, Select, SettingRow, TextInput, Toggle } from "../../components/settings/Form";
import { formatWhen } from "../../lib/time";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { cutexBuildText, settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useHostServiceInfo, useUpgradeAction } from "./hooks";
import { applyRequest, intervalChoices, intervalWords, minutesOf, modeKeys, releaseNative, runActive, runDisplay, unixOf } from "./model";
import { installedReleaseNotes } from "./releaseNotes";
import { CommandLine, HistorySection, RunNote, RunSection, When } from "./RunView";
import { loadUpgradeRuns, loadUpgradeStatus, putUpgradeStatus, useHostUpgrade } from "./store";

// The run whose "just finished" note the owner dismissed, per host (a per-viewer convenience: an
// unavailable storage only means the note shows again).
const DISMISSED_KEY = (hostId: string) => `cutex-desktop.backend-upgrade.dismissedRun.${hostId}`;
function readDismissed(hostId: string): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY(hostId));
  } catch {
    return null;
  }
}
function writeDismissed(hostId: string, runId: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY(hostId), runId);
  } catch {
    // ignore: shown again next time
  }
}

/** The check interval in words (model intervalWords): 每小时 / 每天 / 每 3 天 / 每周 … */
function useIntervalText(): (hours: number) => string {
  const { t } = useI18n();
  return (hours) => {
    const w = intervalWords(hours);
    return t(w.key, w.n === undefined ? undefined : { n: w.n });
  };
}

function Value({ children, title }: { children: React.ReactNode; title?: string | null }) {
  return (
    <span className="max-w-72 truncate font-mono text-xs text-muted select-text" title={title ?? undefined}>
      {children}
    </span>
  );
}

function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" | "danger" | "accent" }) {
  const color = tone === "ok" ? "bg-ok/15 text-ok-text" : tone === "warn" ? "bg-warn/15 text-warn" : tone === "danger" ? "bg-danger/12 text-danger" : tone === "accent" ? "bg-accent/12 text-accent" : "bg-surface-2 text-muted";
  return <span className={`inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] whitespace-nowrap ${color}`}>{children}</span>;
}

function ClassTag({ value }: { value: string }) {
  const { t } = useI18n();
  return <Tag tone={value === "one-way" ? "danger" : value === "rollback-safe" ? "warn" : "ok"}>{t(`backend-upgrade.class.${value}` as MessageKey)}</Tag>;
}

/** A migration list with its notes in the UI language. */
function Migrations({ list }: { list: readonly UpgradeMigration[] }) {
  const { t, locale } = useI18n();
  if (list.length === 0) return <p className="text-xs text-subtle">{t("backend-upgrade.migrations.none")}</p>;
  return (
    <ul className="space-y-1">
      {list.map((m) => (
        <li key={m.id} className="flex items-start gap-2 text-xs">
          <ClassTag value={m.class} />
          <span className="min-w-0 flex-1">
            <span className="font-mono">{m.id}</span>
            <span className="text-subtle"> · {m.since}</span>
            {upgradeNoteText(m.notes, locale) && <span className="block text-muted">{upgradeNoteText(m.notes, locale)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------- status ----------

/** The host's update state in one sentence (the 已安装版本 row's hint). */
function useStateLine(status: UpgradeStatus): { text: string; tone?: "accent" | "warn" } {
  const { t, locale } = useI18n();
  const installed = status.installed?.release ?? null;
  const phase = status.run?.phase ?? null;
  if (phase === "needs-owner") return { text: t("backend-upgrade.state.needsOwner"), tone: "warn" };
  if (!status.managed) return { text: t("backend-upgrade.state.unmanaged") };
  if (status.run && runActive(status.run)) return { text: t("backend-upgrade.state.running", { release: status.run.toRelease }), tone: "accent" };
  if (status.staged && status.staged.release !== installed) return { text: t("backend-upgrade.state.staged", { release: status.staged.release }), tone: "accent" };
  if (status.available && status.available.release !== installed) return { text: t("backend-upgrade.state.available", { release: status.available.release }), tone: "accent" };
  const at = unixOf(status.lastCheckAt);
  if (at === null) return { text: t("backend-upgrade.update.notChecked") };
  return { text: t("backend-upgrade.state.upToDateAt", { time: formatWhen(at, Date.now(), locale) }) };
}

function StatusSection({ status, info, onCheck, checking, checkError, installedNotes }: { status: UpgradeStatus; info: HostServiceInfo | null; onCheck?(): void; checking: boolean; checkError: string | null; installedNotes: boolean }) {
  const { t, locale } = useI18n();
  const intervalText = useIntervalText();
  const build = readCutexBuild({ cutexBuild: status.build });
  const installed = status.installed?.release ?? build?.release ?? null;
  const sm = info?.serviceManager;
  const smKind = sm?.kind ?? status.serviceManager;
  const native = info?.runtimes?.native;
  const claude = info?.runtimes?.claude;
  const olderNative = native ? native.inUse.filter((u) => !u.selected).reduce((n, u) => n + u.agents, 0) : 0;
  const state = useStateLine(status);
  // What the installed release brought: cutex's own `installed.notes` (capability
  // upgrade-installed-notes), else the notes this desktop saw while it was on offer (./releaseNotes.ts);
  // nothing when neither knows them.
  const saved = installedReleaseNotes(status.installed, installedNotes);
  const notes = saved ? upgradeNoteText(saved.notes, locale) : null;
  return (
    <Section
      id={settingsAnchorId("status")}
      title={t("backend-upgrade.status.title")}
      actions={
        onCheck ? (
          <Button disabled={checking} onClick={onCheck}>
            {t(checking ? "backend-upgrade.checking" : "backend-upgrade.check")}
          </Button>
        ) : undefined
      }
    >
      <SettingRow label={t("backend-upgrade.status.installed")} hint={<span className={state.tone === "accent" ? "text-accent" : state.tone === "warn" ? "text-warn" : undefined}>{state.text}</span>}>
        <span className="font-mono text-sm tabular-nums select-text">{installed ?? t("backend-upgrade.status.unknown")}</span>
      </SettingRow>
      {notes && (
        <div className="border-b border-border/60 py-3 last:border-b-0" data-installed-notes="">
          <p className="text-sm">{t("backend-upgrade.notes.label", { release: status.installed!.release })}</p>
          <p className="mt-0.5 text-xs whitespace-pre-wrap text-muted">{notes}</p>
        </div>
      )}
      {native && (
        <SettingRow label={t("backend-upgrade.status.runtimes")} hint={olderNative > 0 ? t("backend-upgrade.status.olderNative", { n: olderNative }) : info?.runtimes?.unpinnedAgents ? t("backend-upgrade.status.unpinned", { n: info.runtimes.unpinnedAgents }) : undefined}>
          <Value title={native.latest ? t("backend-upgrade.status.nativeLatest", { release: native.latest }) : null}>
            {[native.selected, claude?.selected].filter(Boolean).join(" · ") || "—"}
          </Value>
        </SettingRow>
      )}
      {status.managed && status.lastCheckError && <ErrorNote>{t("backend-upgrade.status.lastCheckError", { code: status.lastCheckError.code, message: status.lastCheckError.message })}</ErrorNote>}
      {status.managed && status.trustedKeys.length === 0 && <Notice>{t("backend-upgrade.status.noKeys")}</Notice>}
      {checkError && <ErrorNote>{checkError}</ErrorNote>}
      <Details>
        <SettingRow label={t("backend-upgrade.status.build")}>
          <Value>{cutexBuildText(build, { dev: t("cutexBuild.dev"), legacy: t("cutexBuild.legacy") })}</Value>
        </SettingRow>
        {(status.installed?.commit || status.installed?.sequence || status.installed?.manifestSha256) && (
          <SettingRow label={t("backend-upgrade.status.release")}>
            <Value title={status.installed?.manifestSha256 ?? null}>
              {[status.installed?.commit ? status.installed.commit.slice(0, 7) : null, status.installed?.sequence ? t("backend-upgrade.status.sequence", { n: status.installed.sequence }) : null, status.installed?.manifestSha256 ? `sha256 ${status.installed.manifestSha256.slice(0, 12)}` : null].filter(Boolean).join(" · ")}
            </Value>
          </SettingRow>
        )}
        <SettingRow label={t("backend-upgrade.status.install")} hint={status.managed ? t("backend-upgrade.status.managedHint", { base: status.base ?? "—" }) : t("backend-upgrade.status.unmanagedHint")}>
          <Tag tone={status.managed ? "ok" : "warn"}>{t(status.managed ? "backend-upgrade.status.managed" : "backend-upgrade.status.unmanaged")}</Tag>
        </SettingRow>
        <SettingRow label={t("backend-upgrade.status.serviceManager")} hint={sm?.unit ?? undefined}>
          <Value>{t(`backend-upgrade.serviceManager.${["systemd", "cutex-supervisor", "runtime-host", "none"].includes(smKind) ? smKind : "other"}` as MessageKey, { kind: smKind })}</Value>
        </SettingRow>
        {status.managed && (
          <SettingRow label={t("backend-upgrade.status.lastCheck")} hint={status.settings.checkIntervalHours > 0 ? t("backend-upgrade.status.lastCheckHint", { interval: intervalText(status.settings.checkIntervalHours) }) : t("backend-upgrade.status.lastCheckOff")}>
            <span className="text-xs text-muted">
              <When iso={status.lastCheckAt} />
            </span>
          </SettingRow>
        )}
      </Details>
    </Section>
  );
}

/** A hand-deployed host: what it means and how to convert it; no actions. */
function UnmanagedSection() {
  const { t } = useI18n();
  return (
    <Section id={settingsAnchorId("unmanaged")} title={t("backend-upgrade.unmanaged.title")}>
      <div className="space-y-2 py-2.5">
        <p className="text-sm">{t("backend-upgrade.unmanaged.body")}</p>
        <p className="text-xs text-subtle">{t("backend-upgrade.unmanaged.convert")}</p>
        <CommandLine text="cutex service install --dry-run" />
        <CommandLine text="cutex service install" />
        <p className="text-xs text-subtle">{t("backend-upgrade.unmanaged.after")}</p>
      </div>
    </Section>
  );
}

// ---------- the update: download (stage) and apply ----------

/** A click-twice button: the first click arms it (red, hint bubble), the second runs. */
function ArmedButton({ label, armedText, disabled, onConfirm, primary, resetKey }: { label: string; armedText: string; disabled?: boolean; onConfirm(): void; primary?: boolean; resetKey?: unknown }) {
  const [armed, setArmed] = useArmed(resetKey);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchor} className="inline-flex">
      {armed && !disabled ? (
        <button
          className={`${ARMED_FORM_BUTTON} shrink-0 whitespace-nowrap`}
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
        >
          {label}
        </button>
      ) : (
        <Button primary={primary} disabled={disabled} onClick={() => setArmed(true)}>
          {label}
        </Button>
      )}
      {armed && !disabled && <ArmedHint anchor={anchor} text={armedText} />}
    </span>
  );
}

function ReleaseFacts({ available }: { available: UpgradeAvailable }) {
  const { t, locale } = useI18n();
  const notes = upgradeNoteText(available.notes, locale);
  return (
    <div className="space-y-2 border-b border-border/60 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{available.release}</span>
        <ClassTag value={available.class} />
        <Tag tone={available.mode === "full" ? "warn" : "muted"}>{t(`backend-upgrade.mode.short.${available.mode}` as MessageKey)}</Tag>
        {available.publishedAt && (
          <span className="text-xs text-subtle">
            {t("backend-upgrade.update.published")} <When iso={available.publishedAt} />
          </span>
        )}
      </div>
      {notes && <p className="text-xs whitespace-pre-wrap text-muted">{notes}</p>}
      <p className="text-xs text-subtle">{t(modeKeys(available.mode, available.nativeVersion ?? null).impact)}</p>
      {(available.nativeVersion || available.claudeRuntime) && (
        <p className="text-xs text-subtle">
          {available.nativeVersion && t("backend-upgrade.update.native", { version: available.nativeVersion })}
          {available.nativeVersion && available.claudeRuntime ? " · " : ""}
          {available.claudeRuntime && t("backend-upgrade.update.claude", { name: available.claudeRuntime })}
        </p>
      )}
      {(available.migrations ?? []).length > 0 && (
        <div>
          <p className="mb-1 text-xs text-subtle">{t("backend-upgrade.update.migrations")}</p>
          <Migrations list={available.migrations ?? []} />
        </div>
      )}
      {(available.capabilitiesRemoved ?? []).length > 0 && <p className="text-xs text-warn">{t("backend-upgrade.update.capabilitiesRemoved", { list: (available.capabilitiesRemoved ?? []).join(", ") })}</p>}
      {available.belowFloor && <p className="text-xs text-danger">{t("backend-upgrade.update.belowFloor", { floor: available.belowFloor })}</p>}
      {available.desktopMinCommit && <p className="text-xs text-warn">{t("backend-upgrade.update.desktopMin", { commit: available.desktopMinCommit.slice(0, 7) })}</p>}
    </div>
  );
}

function UpdateSection({ hostId, status, busyRun }: { hostId: string; status: UpgradeStatus; busyRun: boolean }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const action = useUpgradeAction();
  const { available, staged, staging, settings } = status;
  const installed = status.installed?.release ?? null;
  const target = staged ?? null;
  // The available release's facts apply to the staged one when they are the same release.
  const facts = available && (!target || available.release === target.release) ? available : null;
  // cutex refused the apply as one-way unconfirmed (e.g. a newer release appeared after a one-way
  // one was staged, so `facts` no longer describe the staged release): ask for the typed confirmation.
  const [refusedOneWay, setRefusedOneWay] = useState<{ release: string; migrations: UpgradeMigration[] } | null>(null);
  const oneWay = facts?.class === "one-way" || (!!target && refusedOneWay?.release === target.release);
  const [advanced, setAdvanced] = useState(false);
  const [mode, setMode] = useState<"auto" | UpgradeMode>("auto");
  // null = not edited: the apply leaves it out and cutex uses its settings (which may change meanwhile).
  const [waitPick, setWaitPick] = useState<number | null>(null);
  const [packageRunPick, setPackageRunPick] = useState<UpgradePackageRun | null>(null);
  const waitMin = waitPick ?? minutesOf(settings.maxWaitSecs);
  const packageRun = packageRunPick ?? settings.packageRun;
  const [confirmText, setConfirmText] = useState("");
  useEffect(() => setConfirmText(""), [target?.release]);
  const effectiveMode: UpgradeMode = mode === "full" || facts?.mode === "full" ? "full" : "reload";
  const stagingRunning = staging?.state === "running";
  const stagedCurrent = !!target && target.release !== installed;
  const canStage = !!available && available.release !== installed && (!target || target.release !== available.release) && !stagingRunning && !available.belowFloor;
  const typedOk = !oneWay || confirmText.trim() === target?.release;

  const stage = async () => {
    await action.run(() => api.upgradeStage(available?.release ?? null));
    void loadUpgradeStatus(hostId);
  };
  const apply = async () => {
    if (!target) return;
    const release = target.release;
    await action.run(
      () =>
        api.upgradeApply(applyRequest({ release, forceFull: mode === "full", effectiveMode, waitMin: waitPick, packageRun: packageRunPick, oneWay })),
      (r) => {
        if (r.code === "one_way_unconfirmed") setRefusedOneWay({ release, migrations: r.migrations ?? [] });
        return false;
      },
    );
    void loadUpgradeStatus(hostId);
  };

  if (!available && !target && !staging) {
    return (
      <Section id={settingsAnchorId("update")} title={t("backend-upgrade.update.title")}>
        <EmptyState>{status.lastCheckAt ? t("backend-upgrade.update.upToDate") : t("backend-upgrade.update.notChecked")}</EmptyState>
      </Section>
    );
  }
  return (
    <Section id={settingsAnchorId("update")} title={t("backend-upgrade.update.title")} hint={installed ? t("backend-upgrade.update.from", { from: installed }) : undefined}>
      {facts && <ReleaseFacts available={facts} />}
      {/* Download (stage): verify signatures, unpack, preflight. Nothing changes on the host yet. */}
      <SettingRow
        label={t("backend-upgrade.stage.label")}
        hint={
          stagingRunning
            ? t("backend-upgrade.stage.running", { release: staging?.release ?? "" })
            : target
              ? t(target.preflightOk ? "backend-upgrade.stage.ready" : "backend-upgrade.stage.preflightFailed", { release: target.release })
              : t("backend-upgrade.stage.hint")
        }
      >
        {target && (
          <span className="text-xs text-subtle">
            <When iso={target.stagedAt} />
          </span>
        )}
        {canStage && (
          <Button disabled={action.busy || busyRun} onClick={() => void stage()}>
            {t(target ? "backend-upgrade.stage.again" : "backend-upgrade.stage.button", { release: available?.release ?? "" })}
          </Button>
        )}
      </SettingRow>
      {staging?.state === "failed" && staging.error && <ErrorNote>{t("backend-upgrade.stage.failed", { release: staging.release, code: staging.error.code, message: staging.error.message })}</ErrorNote>}
      {target && (target.preflight ?? []).some((c) => !c.ok) && (
        <ul className="space-y-0.5 pb-2 text-xs">
          {(target.preflight ?? [])
            .filter((c) => !c.ok)
            .map((c) => (
              <li key={c.name} className="text-danger">
                {c.name}
                {c.detail ? ` — ${c.detail}` : ""}
              </li>
            ))}
        </ul>
      )}
      {stagedCurrent && target.preflightOk && (
        <>
          {oneWay && (
            <div className="space-y-2 border-b border-border/60 py-3">
              <p className="text-xs font-medium text-danger">{t("backend-upgrade.oneWay.warning", { release: target.release })}</p>
              {!facts && refusedOneWay && refusedOneWay.migrations.length > 0 && <Migrations list={refusedOneWay.migrations} />}
              <SettingRow label={t("backend-upgrade.oneWay.type", { release: target.release })}>
                <TextInput value={confirmText} onChange={setConfirmText} placeholder={target.release} mono width="w-40" label={t("backend-upgrade.oneWay.type", { release: target.release })} />
              </SettingRow>
            </div>
          )}
          <div className="border-b border-border/60 py-2">
            <button type="button" className="flex items-center gap-1 text-xs text-muted hover:text-foreground" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
              {advanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {t("backend-upgrade.advanced")}
            </button>
          </div>
          {advanced && (
            <>
              <SettingRow label={t("backend-upgrade.apply.mode")} hint={t(facts?.mode === "full" ? "backend-upgrade.apply.modeFullRequired" : "backend-upgrade.apply.modeHint")}>
                <Segmented
                  label={t("backend-upgrade.apply.mode")}
                  value={facts?.mode === "full" ? "full" : mode}
                  disabled={facts?.mode === "full"}
                  options={[
                    { value: "auto", label: t("backend-upgrade.apply.modeAuto") },
                    { value: "full", label: t("backend-upgrade.mode.short.full") },
                  ]}
                  onChange={(v) => setMode(v)}
                />
              </SettingRow>
              <SettingRow label={t("backend-upgrade.apply.maxWait")} hint={t("backend-upgrade.apply.maxWaitHint")}>
                <NumberField label={t("backend-upgrade.apply.maxWait")} value={waitMin} range={[0, 24 * 60]} unit={t("backend-upgrade.unit.min")} onCommit={(v) => setWaitPick(v)} />
              </SettingRow>
              {effectiveMode === "full" && (
                <SettingRow label={t("backend-upgrade.packageRun.label")} hint={t(`backend-upgrade.packageRun.${packageRun}Hint` as MessageKey)}>
                  <Select label={t("backend-upgrade.packageRun.label")} value={packageRun} options={UPGRADE_PACKAGE_RUNS.map((v) => ({ value: v, label: t(`backend-upgrade.packageRun.${v}` as MessageKey) }))} onChange={setPackageRunPick} />
                </SettingRow>
              )}
            </>
          )}
          <SettingRow label={t("backend-upgrade.apply.label", { release: target.release })} hint={t(modeKeys(effectiveMode, releaseNative(status, target.release)).impact)}>
            <ArmedButton
              primary
              resetKey={`${target.release}|${confirmText}`}
              label={t("backend-upgrade.apply.button")}
              armedText={t(oneWay ? "backend-upgrade.apply.armedOneWay" : "backend-upgrade.apply.armed", { release: target.release, wait: waitMin })}
              disabled={action.busy || busyRun || !typedOk}
              onConfirm={() => void apply()}
            />
          </SettingRow>
        </>
      )}
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
    </Section>
  );
}

// ---------- rollback ----------

function RollbackSection({ hostId, status, busyRun }: { hostId: string; status: UpgradeStatus; busyRun: boolean }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const action = useUpgradeAction();
  const previous = status.previousRelease ?? null;
  const others = status.installedReleases.filter((r) => r !== status.installed?.release);
  const [to, setTo] = useState<string>(previous ?? others[0] ?? "");
  useEffect(() => setTo(previous ?? others[0] ?? ""), [previous, others.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [preview, setPreview] = useState<UpgradeRollbackPreview | null>(null);
  useEffect(() => setPreview(null), [to, status.installed?.release]);
  if (!previous && others.length === 0) {
    return (
      <Section id={settingsAnchorId("rollback")} title={t("backend-upgrade.rollback.title")}>
        <EmptyState>{t("backend-upgrade.rollback.none")}</EmptyState>
      </Section>
    );
  }
  const dryRun = async () => {
    const r = await action.run(() => api.upgradeRollback({ to, dryRun: true }));
    if (r) setPreview(r.preview);
  };
  const rollback = async () => {
    const r = await action.run(() => api.upgradeRollback({ to }));
    if (r) setPreview(null);
    void loadUpgradeStatus(hostId);
  };
  return (
    <Section id={settingsAnchorId("rollback")} title={t("backend-upgrade.rollback.title")} hint={t("backend-upgrade.rollback.hint")}>
      <SettingRow label={t("backend-upgrade.rollback.target")} hint={previous ? t("backend-upgrade.rollback.previous", { release: previous }) : undefined}>
        {others.length > 1 ? (
          <Select label={t("backend-upgrade.rollback.target")} value={to} options={others.map((r) => ({ value: r, label: r === previous ? t("backend-upgrade.rollback.previousOption", { release: r }) : r }))} onChange={setTo} />
        ) : (
          <Value>{to}</Value>
        )}
        <Button disabled={action.busy || busyRun || !to} onClick={() => void dryRun()}>
          {t("backend-upgrade.rollback.preview")}
        </Button>
      </SettingRow>
      {preview && (
        <div className="space-y-2 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono">
              {preview.from} → {preview.to}
            </span>
            <ClassTag value={preview.class} />
          </div>
          <Migrations list={preview.migrations} />
          {preview.movedAside.length > 0 && (
            <div className="text-xs">
              <p className="text-subtle">{t("backend-upgrade.rollback.movedAside")}</p>
              <p className="font-mono break-all select-text">{preview.movedAside.join(", ")}</p>
            </div>
          )}
          <p className="text-xs text-subtle">{preview.selectionBackup ? t("backend-upgrade.rollback.selectionRestored") : t("backend-upgrade.rollback.selectionKept")}</p>
          <p className="text-xs text-warn">{t("backend-upgrade.rollback.sessionsKept")}</p>
          <div className="flex justify-end pb-1">
            <ArmedButton resetKey={`${preview.from}|${preview.to}`} label={t("backend-upgrade.rollback.button", { release: preview.to })} armedText={t("backend-upgrade.rollback.armed", { release: preview.to })} disabled={action.busy || busyRun} onConfirm={() => void rollback()} />
          </div>
        </div>
      )}
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
    </Section>
  );
}

// ---------- settings ----------

function SettingsSection({ hostId, settings }: { hostId: string; settings: UpgradeSettings }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const action = useUpgradeAction();
  const save = async (patch: UpgradeSettingsPatch) => {
    await action.run(() => api.patchUpgradeSettings(patch));
    void loadUpgradeStatus(hostId);
  };
  const hours = intervalChoices(settings.checkIntervalHours);
  const intervalText = useIntervalText();
  return (
    <Section id={settingsAnchorId("settings")} title={t("backend-upgrade.settings.title")}>
      <SettingRow label={t("backend-upgrade.settings.channel")} hint={t("backend-upgrade.settings.channelHint")}>
        <Segmented label={t("backend-upgrade.settings.channel")} value={settings.channel} disabled={action.busy} options={[{ value: "release", label: t("backend-upgrade.channel.release") }, { value: "main", label: t("backend-upgrade.channel.main") }]} onChange={(channel) => void save({ channel })} />
      </SettingRow>
      <SettingRow label={t("backend-upgrade.settings.interval")}>
        <Select
          label={t("backend-upgrade.settings.interval")}
          value={String(settings.checkIntervalHours)}
          disabled={action.busy}
          options={hours.filter((h) => h <= UPGRADE_CHECK_INTERVAL_MAX).map((h) => ({ value: String(h), label: intervalText(h) }))}
          onChange={(v) => void save({ checkIntervalHours: Number(v) })}
        />
      </SettingRow>
      <SettingRow label={t("backend-upgrade.settings.autoStage")} hint={t("backend-upgrade.settings.autoStageHint")}>
        <Toggle label={t("backend-upgrade.settings.autoStage")} checked={settings.autoStage} disabled={action.busy} onChange={(autoStage) => void save({ autoStage })} />
      </SettingRow>
      <SettingRow label={t("backend-upgrade.settings.autoApply")} hint={t("backend-upgrade.settings.autoApplyHint")}>
        <Toggle label={t("backend-upgrade.settings.autoApply")} checked={settings.autoApply} disabled={action.busy} onChange={(autoApply) => void save({ autoApply })} />
      </SettingRow>
      <SettingRow label={t("backend-upgrade.settings.maxWait")} hint={t("backend-upgrade.apply.maxWaitHint")}>
        <NumberField label={t("backend-upgrade.settings.maxWait")} value={minutesOf(settings.maxWaitSecs)} range={[0, 24 * 60]} unit={t("backend-upgrade.unit.min")} disabled={action.busy} onCommit={(v) => v !== null && void save({ maxWaitSecs: v * 60 })} />
      </SettingRow>
      <SettingRow label={t("backend-upgrade.packageRun.label")} hint={t(`backend-upgrade.packageRun.${settings.packageRun}Hint` as MessageKey)}>
        <Select label={t("backend-upgrade.packageRun.label")} value={settings.packageRun} disabled={action.busy} options={UPGRADE_PACKAGE_RUNS.map((v) => ({ value: v, label: t(`backend-upgrade.packageRun.${v}` as MessageKey) }))} onChange={(packageRun) => void save({ packageRun })} />
      </SettingRow>
      {settings.packageRun === "after" && (
        <SettingRow label={t("backend-upgrade.settings.batch")} hint={t("backend-upgrade.settings.batchHint")}>
          <NumberField label={t("backend-upgrade.settings.batch")} value={settings.packageRunBatch} range={[1, UPGRADE_PACKAGE_RUN_BATCH_MAX]} disabled={action.busy} onCommit={(v) => v !== null && void save({ packageRunBatch: v })} />
        </SettingRow>
      )}
      <Details>
        <SettingRow
          label={t("backend-upgrade.settings.source")}
          hint={
            <>
              {t("backend-upgrade.settings.sourceHint")}
              <span className="mt-1 block">
                <CommandLine text="cutex upgrade config --source <url>" />
              </span>
            </>
          }
        >
          <Value title={settings.source}>{settings.source}</Value>
        </SettingRow>
      </Details>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
    </Section>
  );
}

// ---------- page ----------

export function BackendUpgradePage() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const api = useTargetApi();
  const u = useHostUpgrade(hostId);
  const check = useUpgradeAction();
  const status = u.status;
  const run = status?.run ?? null;
  // /v2/host again after a run ends (new build, new runtimes).
  const info = useHostServiceInfo(`${status?.installed?.release ?? ""}|${run?.phase ?? ""}`);
  const showHistory = !!status?.managed || (status?.installedReleases.length ?? 0) > 1;
  useEffect(() => {
    if (u.connected && u.supported && showHistory) void loadUpgradeRuns(hostId);
  }, [hostId, u.connected, u.supported, showHistory]);
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed(hostId));
  useEffect(() => setDismissed(readDismissed(hostId)), [hostId]);
  const display = useMemo(() => runDisplay(run, Date.now(), dismissed), [run, dismissed]);
  const dismiss = (runId: string) => {
    writeDismissed(hostId, runId);
    setDismissed(runId);
  };

  if (!u.connected) {
    // Mid-upgrade the services restart: say so instead of a bare "not connected".
    const down = u.event?.run?.servicesDown;
    return (
      <Section>
        <EmptyState>{down ? t("backend-upgrade.run.servicesDownPage", { to: u.event?.run?.toRelease ?? "" }) : t("backend-upgrade.notConnected")}</EmptyState>
      </Section>
    );
  }
  if (status === undefined) {
    return (
      <Section>
        {u.error ? <ErrorNote>{u.error}</ErrorNote> : null}
        <Loading rows={4} />
      </Section>
    );
  }
  if (status === null) {
    return (
      <Section>
        <EmptyState>{t("settings.pendingCutex", { api: "GET /v2/upgrade" })}</EmptyState>
      </Section>
    );
  }
  const busyRun = runActive(run);
  const doCheck = async () => {
    const r = await check.run(() => api.upgradeCheck());
    if (r) putUpgradeStatus(hostId, r);
  };
  return (
    <>
      {u.error && <ErrorNote>{u.error}</ErrorNote>}
      {run && display === "card" && <RunSection hostId={hostId} run={run} native={releaseNative(status, run.toRelease)} />}
      {run && display === "note" && <RunNote run={run} onDismiss={() => dismiss(run.runId)} />}
      <StatusSection status={status} info={info} onCheck={status.managed ? () => void doCheck() : undefined} checking={check.busy} checkError={check.error} installedNotes={u.installedNotes} />
      {!status.managed ? (
        <UnmanagedSection />
      ) : (
        <>
          <UpdateSection hostId={hostId} status={status} busyRun={busyRun} />
          {status.followUp && !status.followUp.done && <FollowUpNote count={status.followUp.packageRunIds?.length ?? 0} />}
          <RollbackSection hostId={hostId} status={status} busyRun={busyRun} />
        </>
      )}
      {showHistory && <HistorySection runs={u.runs} error={u.runsError} onReload={() => void loadUpgradeRuns(hostId)} />}
      {status.managed && <SettingsSection hostId={hostId} settings={status.settings} />}
    </>
  );
}

function FollowUpNote({ count }: { count: number }) {
  const { t } = useI18n();
  return (
    <Section>
      <Notice tone="info">{t("backend-upgrade.followUp", { n: count })}</Notice>
    </Section>
  );
}
