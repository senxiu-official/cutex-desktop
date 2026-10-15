// 轮换主管 dialog (cutex `owner-rotation`, docs/research/owner-rotation.md): the successor form, then
// the live progress of the rotation (handoff note → successor → seat → old Director → start), with
// 取消轮换 (until the successor is being created) and 不等交接，继续 (while cutex waits for the note).
// The rotation runs in cutex; closing the dialog leaves it running (the project page shows a banner).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Circle, Copy, Hourglass, Loader2, X } from "lucide-react";
import type { ProjectSummary, SessionResource } from "@cutex-desktop/protocol";
import type { CutexRefusal, DirectorRotation, PredecessorDisposition, ProfileItem } from "../../../../shared/ipc";
import { DISPOSITIONS, isTerminalRotation, nextSuccessorName, rotationCancellable, rotationProgress, rotationWaiting, ROTATION_STEPS, type RotationStep, type StepStatus } from "../../../../shared/directorRotation";
import { api } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { confirmDialog, useOverlayState } from "../../lib/contextMenu";
import { copyText } from "../../lib/menus";
import { useTrackOverlay } from "../../lib/openOverlays";
import { useOrderedProfiles } from "../../lib/profileOrder";
import { useApp } from "../../store";
import { Button, Select, SettingRow, TextInput } from "../../components/settings/Form";
import { cancelRotation, continueRotation, loadProjectRotation, pollRotation, startRotation, useProjectRotation } from "./rotationStore";
import { HANDOFF_MINUTE_CHOICES, useHandoffMinutes } from "./rotationPrefs";
import { minutesLabel, refusalText } from "./rotationView";

const POLL_MS = 1500;

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

function left(iso: string, now: number): string {
  const secs = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Badge color per state. */
function stateTone(state: DirectorRotation["state"]): string {
  if (state === "done") return "bg-ok/15 text-ok-text";
  if (state === "failed") return "bg-danger/15 text-danger";
  if (state === "timeout") return "bg-warn/15 text-warn";
  if (state === "cancelled") return "bg-surface-2 text-muted";
  return "bg-accent/15 text-accent";
}

export function RotationStateBadge({ state }: { state: DirectorRotation["state"] }) {
  const { t } = useI18n();
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${stateTone(state)}`}>{t(`projects.rotation.state.${state}` as MessageKey)}</span>;
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <Check size={14} className="text-ok" />;
  if (status === "current") return <Loader2 size={14} className="animate-spin text-accent" />;
  if (status === "waiting") return <Hourglass size={14} className="text-warn" />;
  if (status === "failed") return <AlertTriangle size={14} className="text-danger" />;
  return <Circle size={12} className="mx-px text-subtle" />;
}

function Progress({ rotation, onClose }: { rotation: DirectorRotation; onClose(): void }) {
  const { t } = useI18n();
  const select = useApp((s) => s.select);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waitingForNote = rotation.state === "handoff_requested" && !!rotation.handoff.deadline;
  const now = useNow(waitingForNote);
  const steps = rotationProgress(rotation);
  const h = rotation.handoff;
  const delegations = rotation.predecessorDelegations;

  const label = (step: RotationStep): string => {
    if (step === "successor") return t("projects.rotation.step.successor", { name: rotation.successorSpec.name });
    if (step === "dispose") return t(`projects.rotation.step.dispose.${rotation.disposition}` as MessageKey);
    return t(`projects.rotation.step.${step}` as MessageKey);
  };
  const detail = (step: RotationStep): ReactNode => {
    if (step !== "handoff") return null;
    const lines: ReactNode[] = [];
    if (h.writtenAt) lines.push(t("projects.rotation.handoffWritten", { time: clock(h.writtenAt) }));
    else if (h.skipped) lines.push(t("projects.rotation.handoffSkipped"));
    else if (rotation.state === "timeout") lines.push(<span className="text-warn">{t("projects.rotation.handoffTimedOut", { time: clock(h.deadline) })}</span>);
    else if (waitingForNote) lines.push(t("projects.rotation.deadline", { time: clock(h.deadline), left: left(h.deadline!, now) }));
    return (
      <>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono" title={h.path}>
            {h.path}
          </span>
          <button onClick={() => copyText(h.path)} title={h.path} className="shrink-0 rounded p-0.5 hover:bg-surface-2 hover:text-foreground">
            <Copy size={11} />
          </button>
        </div>
      </>
    );
  };

  const act = async (fn: () => Promise<{ ok: boolean; error?: CutexRefusal }>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok && r.error) setError(refusalText(r.error, t));
  };
  const cancel = async () => {
    if (!(await confirmDialog(t("projects.rotation.cancelConfirm"), true, { ok: t("projects.rotation.cancel"), cancel: t("projects.rotation.keepWaiting") }))) return;
    await act(() => cancelRotation(rotation.rotationId));
  };
  const proceed = async () => {
    if (!(await confirmDialog(t("projects.rotation.continueConfirm"), false, { ok: t("projects.rotation.continue"), cancel: t("projects.rotation.keepWaiting") }))) return;
    await act(() => continueRotation(rotation.rotationId));
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="font-medium">{rotation.predecessor.name}</span>
          <span className="text-subtle">→</span>
          <span className="font-medium">{rotation.successorSpec.name}</span>
          <span className="ml-auto">
            <RotationStateBadge state={rotation.state} />
          </span>
        </div>
        <ol className="space-y-3">
          {ROTATION_STEPS.map((step) => (
            <li key={step} className="flex gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                <StepIcon status={steps[step]} />
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${steps[step] === "pending" ? "text-subtle" : ""}`}>{label(step)}</div>
                <div className="space-y-0.5 text-xs text-subtle">{detail(step)}</div>
              </div>
            </li>
          ))}
        </ol>
        {rotation.state !== "cancelled" && rotation.state !== "failed" && delegations.requested + delegations.handling > 0 && <p className="mt-4 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">{t("projects.rotation.delegations", { requested: delegations.requested, handling: delegations.handling })}</p>}
        {rotation.warnings.length > 0 && (
          <div className="mt-4 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
            <div className="mb-0.5 font-medium">{t("projects.rotation.warnings")}</div>
            {rotation.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}
        {rotation.error && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            <span className="font-mono">{rotation.error.code}</span>: {rotation.error.message}
          </p>
        )}
        {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      </div>
      <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
        {!isTerminalRotation(rotation.state) && <span className="text-xs text-subtle">{t("projects.rotation.closeHint")}</span>}
        <span className="ml-auto flex gap-1.5">
          {rotationCancellable(rotation) && (
            <Button disabled={busy} onClick={() => void cancel()}>
              {t("projects.rotation.cancel")}
            </Button>
          )}
          {rotationWaiting(rotation) && !rotation.handoff.skipped && (
            <Button primary={rotation.state === "timeout"} disabled={busy} onClick={() => void proceed()}>
              {t("projects.rotation.continue")}
            </Button>
          )}
          {rotation.state === "done" && rotation.successorCutexSessionId && (
            <Button
              primary
              onClick={() => {
                onClose();
                void select(rotation.successorCutexSessionId!);
              }}
            >
              {t("projects.rotation.openSuccessor", { name: rotation.successorSpec.name })}
            </Button>
          )}
          <Button onClick={onClose}>{t("projects.rotation.close")}</Button>
        </span>
      </footer>
    </>
  );
}

function StartForm({ project, director, onStarted, onClose }: { project: ProjectSummary; director: SessionResource; onStarted(rotationId: string): void; onClose(): void }) {
  const { t } = useI18n();
  const directorName = director.formalAgentName || director.displayName;
  const directorProfile = director.profile ?? director.configuredProfile ?? "";
  const directorModel = director.effectiveNextLaunch?.model ?? "";
  const defaultMinutes = useHandoffMinutes();
  const [name, setName] = useState(() => nextSuccessorName(directorName));
  const [profile, setProfile] = useState(directorProfile);
  const [model, setModel] = useState(directorModel);
  const [cwd, setCwd] = useState(director.cwd ?? "");
  const [disposition, setDisposition] = useState<PredecessorDisposition>("member");
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [listed, setProfiles] = useState<ProfileItem[] | null>(null);
  /** Choices in the owner's manual profile order (lib/profileOrder). */
  const profiles = useOrderedProfiles(listed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request id per attempt: a lost reply retried as-is is the same rotation (cutex replays it).
  const requestId = useRef(`desktop-${crypto.randomUUID()}`);

  useEffect(() => {
    api.listProfiles().then((r) => setProfiles(r?.profiles ?? []), () => setProfiles([]));
  }, []);

  const profileOptions = useMemo(() => {
    const names = new Set((profiles ?? []).map((p) => p.name));
    if (directorProfile) names.add(directorProfile);
    return [...names].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n === directorProfile ? `${n} · ${t("sidebar.director")}` : n }));
  }, [profiles, directorProfile, t]);
  const minuteOptions = (HANDOFF_MINUTE_CHOICES as readonly number[]).map((n) => ({ value: String(n), label: minutesLabel(n, t) }));
  const handoffBase = project.workspace_root || director.cwd || "…";
  const sep = handoffBase.includes("\\") ? "\\" : "/";
  const ready = !!name.trim() && !busy && !!cwd.trim();

  const start = async () => {
    setBusy(true);
    setError(null);
    const r = await startRotation({
      requestId: requestId.current,
      projectId: project.project_id,
      expectedDirectorCutexSessionId: project.director_cutex_session_id!,
      expectedAuthorityEpoch: project.authority_epoch,
      predecessor: disposition,
      handoffTimeoutSecs: minutes * 60,
      successor: { name: name.trim(), profile: profile || undefined, model: model.trim() || undefined, cwd: cwd.trim() || undefined },
    });
    setBusy(false);
    if (r.ok) return onStarted(r.rotation.rotationId);
    setError(refusalText(r.error, t));
    // cutex refused this body: the next attempt is a new request.
    if (r.error.code !== "error") requestId.current = `desktop-${crypto.randomUUID()}`;
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <p className="mb-2 text-xs text-subtle">{t("projects.rotation.intro")}</p>
        <h3 className="mt-3 text-xs font-semibold text-muted">{t("projects.rotation.successor")}</h3>
        <SettingRow label={t("projects.rotation.name")} hint={t("projects.rotation.nameHint")}>
          <TextInput width="w-56" value={name} onChange={setName} maxLength={128} />
        </SettingRow>
        <SettingRow label={t("projects.rotation.profile")} hint={t("projects.rotation.profileHint")}>
          <Select
            value={profile}
            options={profileOptions}
            onChange={(next) => {
              setProfile(next);
              // Another profile has its own models: start from its default.
              setModel(next === directorProfile ? directorModel : "");
            }}
          />
        </SettingRow>
        <SettingRow label={t("projects.rotation.model")} hint={t("projects.rotation.modelHint")}>
          <TextInput width="w-56" mono value={model} onChange={setModel} placeholder={t("projects.rotation.modelPlaceholder")} />
        </SettingRow>
        <SettingRow label={t("projects.rotation.cwd")} hint={t("projects.rotation.cwdHint")}>
          <TextInput width="w-72" mono value={cwd} onChange={setCwd} />
        </SettingRow>
        <h3 className="mt-4 text-xs font-semibold text-muted">{t("projects.rotation.predecessor")}</h3>
        <div className="mt-1.5 space-y-1">
          {DISPOSITIONS.map((d) => (
            <label key={d} className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 ${disposition === d ? "bg-surface-2" : "hover:bg-surface-2/60"}`}>
              <input type="radio" name="rotation-disposition" className="mt-0.5 accent-[var(--color-accent)]" checked={disposition === d} onChange={() => setDisposition(d)} />
              <span className="min-w-0">
                <span className="block text-sm">{t(`projects.rotation.disposition.${d}` as MessageKey)}</span>
                <span className={`block text-xs ${d === "archive" && disposition === d ? "text-warn" : "text-subtle"}`}>{t(`projects.rotation.dispositionHint.${d}` as MessageKey)}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3">
          <SettingRow label={t("projects.rotation.timeout")} hint={t("projects.rotation.timeoutHint")}>
            <Select value={String(minutes)} options={minuteOptions} onChange={(v) => setMinutes(Number(v))} />
          </SettingRow>
        </div>
        <p className="mt-2 truncate text-xs text-subtle" title={`${handoffBase}${sep}handoff${sep}`}>
          {t("projects.rotation.handoffAt", { path: `${handoffBase}${sep}handoff${sep}<UTC>.md` })}
        </p>
        {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      </div>
      <footer className="flex items-center justify-end gap-1.5 border-t border-border px-5 py-3">
        <Button onClick={onClose}>{t("projects.rotation.close")}</Button>
        <Button primary disabled={!ready} onClick={() => void start()}>
          {busy && <Loader2 size={12} className="mr-1 inline animate-spin" />}
          {t("projects.rotation.start")}
        </Button>
      </footer>
    </>
  );
}

/** The dialog for one project. `director` is the Director's session (null while the sidebar loads). */
export function DirectorRotationDialog({ project, director, onClose }: { project: ProjectSummary; director: SessionResource | null; onClose(): void }) {
  const { t } = useI18n();
  const rotation = useProjectRotation(project.project_id);
  const [shownId, setShownId] = useState<string | null>(null);
  const overlay = useOverlayState();
  const overlayOpen = useRef(false);
  overlayOpen.current = !!(overlay.menu || overlay.dialog);
  useTrackOverlay(true);

  useEffect(() => {
    void loadProjectRotation(project.project_id);
  }, [project.project_id]);
  // A rotation already running for this project opens on its progress.
  useEffect(() => {
    if (!shownId && rotation && !isTerminalRotation(rotation.state)) setShownId(rotation.rotationId);
  }, [rotation, shownId]);
  const shown = rotation && rotation.rotationId === shownId ? rotation : null;
  const running = !!shown && !isTerminalRotation(shown.state);
  useEffect(() => {
    if (!running || !shownId) return;
    const timer = setInterval(() => void pollRotation(shownId), POLL_MS);
    return () => clearInterval(timer);
  }, [running, shownId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || overlayOpen.current) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const name = shown?.predecessor.name ?? director?.displayName ?? project.director_cutex_session_id ?? "";
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label={t("projects.rotation.title", { name })} className="flex max-h-[84vh] w-[38rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("projects.rotation.title", { name })}</h2>
          <span className="text-xs text-subtle">{project.presentation.display_name}</span>
          <button onClick={onClose} title={t("projects.rotation.close")} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-foreground">
            <X size={15} />
          </button>
        </header>
        {shown ? (
          <Progress rotation={shown} onClose={onClose} />
        ) : rotation === undefined ? (
          <div className="flex items-center justify-center py-12 text-subtle">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : director ? (
          <StartForm project={project} director={director} onStarted={setShownId} onClose={onClose} />
        ) : (
          <p className="px-5 py-6 text-sm text-subtle">{t("projects.unavailable")}</p>
        )}
      </div>
    </div>
  );
}
