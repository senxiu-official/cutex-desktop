// 开始使用 (onboarding v3, owner 2026-11-26): three steps in the main area — connect a host, have a Profile that can
// run, send the first message — instead of a tour. Each step shows its real state and only the open one is expanded;
// done ones say what was chosen, with 改 to go back. Shown where the empty main area is on a first run (no agents, no
// host, cutex not installed / not running; components/Conversation) and as a page (帮助 → 开始使用). Sending creates an
// agent with the first message (lib/newAgentSteps, as 新建智能体 does) and opens it with 接下来可以试试 (./TryNext).
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BookOpen, Check } from "lucide-react";
import { api, bridge } from "../../bridge";
import { Button, TextArea, TextInput } from "../../components/settings/Form";
import { AddHostForm } from "../../components/settings/ConnectionSettings";
import { OnboardingClaudeRuntime } from "../../components/OnboardingClaudeRuntime";
import { TokenImportForm } from "../../components/settings/HostTokenImport";
import { useI18n, type MessageKey } from "../../i18n";
import { INSTALL_GUIDE_URL } from "../../lib/firstRun";
import { hasLocalHost, hasNoHost } from "../../lib/hosts";
import { runNewAgentSteps, NO_PROGRESS } from "../../lib/newAgentSteps";
import { cachedProfileList, loadProfileList, onProfileListChange } from "../../lib/profileSnapshot";
import { useSettingsShelf } from "../../lib/settingsShelf";
import type { NewProfileStart } from "../../lib/newProfileModel";
import { setViewScope } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { canSend, chosenProfile, firstAgentName, hostStage, profileSettled, profileStage, startStep, type HostStage, type ProfileStage, type StartStep } from "./model";
import { noteFirstAgent } from "./state";
import type { PageParams } from "../slots";

/** 自定义桌面 (step 4): loaded when unfolded. */
const CustomizePanel = lazy(() => import("./CustomizePanel").then((m) => ({ default: m.CustomizePanel })));

/** cutex gives a cwd-less agent a scratch workspace (as 新建智能体: HUMAN_AGENT_SCRATCH_FEATURE). */
const SCRATCH_FEATURE = "human-agent-scratch-cwd";

type HostChoice = "local" | "ssh" | "token";

const TILE = "rounded-lg border px-2.5 py-2 text-left text-meta transition-colors";
const tile = (on: boolean, disabled = false) => `${TILE} ${disabled ? "border-border bg-background opacity-50" : on ? "border-accent bg-accent/10 ring-1 ring-accent ring-inset" : "border-border bg-background hover:bg-hover"}`;

function Dot({ state, n }: { state: "done" | "open" | "todo"; n: number }) {
  if (state === "done") return <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ok text-white"><Check size={12} strokeWidth={3} /></span>;
  return <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-meta font-bold ${state === "open" ? "border-accent text-accent" : "border-border text-subtle"}`}>{n}</span>;
}

function Step({ n, state, title, detail, onChange, children }: { n: number; state: "done" | "open" | "todo"; title: ReactNode; detail?: ReactNode; onChange?: () => void; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <li data-start-step={n} data-state={state} className="flex gap-2.5 border-t border-border py-2.5 first:border-t-0">
      <Dot state={state} n={n} />
      <div className="min-w-0 flex-1">
        <div className={state === "open" ? "font-semibold text-foreground" : state === "done" ? "text-muted" : "text-subtle"}>{title}</div>
        {(detail || (state === "done" && onChange)) && (
          <div className="text-meta text-subtle">
            {detail}
            {state === "done" && onChange && <button type="button" onClick={onChange} className="ml-1.5 text-accent hover:underline">{t("start.card.change")}</button>}
          </div>
        )}
        {state === "open" && children}
      </div>
    </li>
  );
}

/**
 * The focus host's Profiles: its cached list (kept current by Settings → Profile and cutex's profile events, and told
 * to listeners: lib/profileSnapshot onProfileListChange), read again on another host and whenever Settings closes
 * (a Profile made or signed in there moves the card on).
 */
function useProfiles(hostId: string, connected: boolean): ProfileStage {
  const list = useSyncExternalStore(onProfileListChange, () => cachedProfileList(hostId));
  const settingsOpen = useSettingsShelf((st) => st.open);
  useEffect(() => {
    if (connected && !settingsOpen) void loadProfileList(hostId).catch(() => {});
  }, [hostId, connected, settingsOpen]);
  return useMemo(() => profileStage(connected ? list : null), [connected, list]);
}

function HostStep({ stage, label, open, onChange }: { stage: HostStage; label: string; open: boolean; onChange(): void }) {
  const { t } = useI18n();
  const hosts = useApp((s) => s.hosts);
  const daemon = useApp((s) => s.daemon);
  const openSettings = useApp((s) => s.openSettings);
  const local = hasLocalHost(hosts) && (hosts?.active ?? "local") === "local";
  const [choice, setChoice] = useState<HostChoice>(() => (hasLocalHost(hosts) ? "local" : "ssh"));
  // A host added here becomes the focus (the card follows it).
  const known = useRef(new Set(hosts?.hosts.map((h) => h.id) ?? []));
  const added = () => {
    const now = useApp.getState().hosts;
    const fresh = now?.hosts.find((h) => !known.current.has(h.id));
    if (fresh) void setViewScope({ kind: "host", id: fresh.id });
  };
  const localState: MessageKey = !hasLocalHost(hosts) ? "start.host.local.none" : !local ? "start.host.local.running" : stage === "connected" ? "start.host.local.running" : stage === "notInstalled" ? "start.host.local.notInstalled" : stage === "notRunning" ? "start.host.local.notRunning" : stage === "connecting" ? "start.host.local.connecting" : "start.host.local.unreachable";
  const guide = (
    <Button onClick={() => void api.openExternal(INSTALL_GUIDE_URL)} title={INSTALL_GUIDE_URL}>
      <BookOpen size={13} className="mr-1 inline-block align-[-2px]" />
      {t("firstRun.installGuide")}
    </Button>
  );
  const done = stage === "connected" && !open;
  return (
    <Step n={1} state={done ? "done" : "open"} title={done ? t("start.host.done", { host: label }) : t("start.host.title")} detail={done ? t(local ? "start.host.local.running" : "start.host.ssh") : undefined} onChange={onChange}>
      <p className="mt-1 text-meta text-muted">{t("start.host.lead")}</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("start.host.title")}>
        {([
          ["local", "start.host.local", localState, !hasLocalHost(hosts)],
          ["ssh", "start.host.ssh", "start.host.ssh.hint", false],
          ["token", "start.host.token", "start.host.token.hint", false],
        ] as const).map(([id, title, hint, disabled]) => (
          <button key={id} type="button" role="radio" aria-checked={choice === id} disabled={disabled} data-start-host={id} onClick={() => setChoice(id)} className={tile(choice === id, disabled)}>
            <b className="block text-ui font-semibold text-foreground">{t(title)}</b>
            {t(hint)}
          </button>
        ))}
      </div>
      <div className="mt-2" data-start-host-panel={choice}>
        {choice === "local" && local && (stage === "notInstalled" || stage === "notRunning") && (
          <div className="rounded-lg border border-border bg-background p-2.5 text-meta text-muted">
            {stage === "notInstalled" ? (
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>{t("firstRun.notInstalled.step1")}</li>
                <li>{t("firstRun.notInstalled.step2")}</li>
                <li>{t("firstRun.notInstalled.step3")}</li>
              </ol>
            ) : (
              <p className="whitespace-pre-line">{t("firstRun.notRunning.body", { url: daemon.baseUrl })}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button primary onClick={() => void api.reconnectHost()}>{t("firstRun.retry")}</Button>
              {guide}
              {bridge.shell && <Button onClick={() => void bridge.shell?.openLogs()}>{t("firstRun.openLogs")}</Button>}
            </div>
          </div>
        )}
        {choice === "local" && local && (stage === "connecting" || stage === "unreachable") && (
          <div className="flex flex-wrap items-center gap-1.5 text-meta text-muted">
            {t(stage === "connecting" ? "start.host.connecting" : "start.host.problem", { host: label })}
            {stage === "unreachable" && <Button onClick={() => void api.reconnectHost()}>{t("start.host.reconnect")}</Button>}
            <Button onClick={() => openSettings("hosts")}>{t("firstRun.hostSettings")}</Button>
          </div>
        )}
        {choice === "local" && !local && hasLocalHost(hosts) && (
          <Button onClick={() => void setViewScope({ kind: "host", id: "local" })}>{t("start.profile.continue")}</Button>
        )}
        {choice === "local" && !local && !hasLocalHost(hosts) && stage !== "connected" && stage !== "noHost" && (
          <div className="flex flex-wrap items-center gap-1.5 text-meta text-muted">
            {t(stage === "connecting" ? "start.host.connecting" : "start.host.problem", { host: label })}
            {stage === "unreachable" && <Button onClick={() => void api.reconnectHost()}>{t("start.host.reconnect")}</Button>}
          </div>
        )}
        {choice === "ssh" && <AddHostForm onDone={added} />}
        {choice === "token" && <TokenImportForm onDone={added} />}
      </div>
    </Step>
  );
}

function ProfileStep({ state, profiles, picked, onPick, onConfirm, onChange }: { state: "done" | "open" | "todo"; profiles: ProfileStage; picked: string | null; onPick(name: string): void; onConfirm(): void; onChange(): void }) {
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  const [kind, setKind] = useState<NewProfileStart>("chatgpt");
  const chosen = chosenProfile(profiles, picked);
  if (state !== "open") {
    return <Step n={2} state={state} title={state === "done" && chosen ? t("start.profile.done", { name: chosen.name }) : t("start.profile.title")} onChange={onChange} />;
  }
  const some = profiles.kind === "some";
  return (
    <Step n={2} state="open" title={t(some && profiles.ready.length ? "start.profile.pickTitle" : "start.profile.title")}>
      {profiles.kind === "unknown" && <p className="mt-1 text-meta text-subtle">{t("start.profile.loading")}</p>}
      {profiles.kind === "none" && (
        <>
          <p className="mt-1 text-meta text-muted">{t("start.profile.lead")}</p>
          <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("start.profile.title")}>
            {(["chatgpt", "claude", "apiKey"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} data-start-profile-kind={k} onClick={() => setKind(k)} className={tile(kind === k)}>
                <b className="block text-ui font-semibold text-foreground">{t(`start.profile.${k}`)}</b>
                {t(`start.profile.${k}.hint`)}
              </button>
            ))}
          </div>
          {/* Claude: whether its CLI and sign-in are there (read only once Claude is picked). */}
          {kind === "claude" && <OnboardingClaudeRuntime />}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* The pick opens the 添加 form on it (lib/newProfileModel choiceForStart). */}
            <Button primary onClick={() => openSettings("profiles", { create: true, createKind: kind })}>{t("start.profile.continue")}</Button>
            <span className="text-meta text-subtle">{t("start.profile.waiting")}</span>
          </div>
        </>
      )}
      {some && (
        <>
          {profiles.ready.length > 0 && <p className="mt-1 text-meta text-muted">{t("start.profile.have")}</p>}
          <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t("start.profile.pickTitle")}>
            {profiles.ready.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={chosen?.name === p.name} data-start-profile={p.name} onClick={() => onPick(p.name)} className={tile(chosen?.name === p.name)}>
                <b className="block truncate text-ui font-semibold text-foreground">{p.name}</b>
                <span className="text-ok">{t("start.profile.ready")}</span>
                {p.model && <span className="block truncate">{p.model}</span>}
              </button>
            ))}
          </div>
          {profiles.unready.map(({ profile, needs }) => (
            <div key={profile.id} className="mt-1.5 flex flex-wrap items-center gap-2 text-meta text-muted" data-start-profile-needs={needs}>
              {t(needs === "login" ? "start.profile.needsLogin" : "start.profile.needsKey", { name: profile.name })}
              <Button onClick={() => openSettings("profiles", { profile: profile.name, anchor: "account" })}>{t(needs === "login" ? "start.profile.login" : "start.profile.addKey")}</Button>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {chosen && <Button primary onClick={onConfirm}>{t("start.profile.use", { name: chosen.name })}</Button>}
            <button type="button" onClick={() => openSettings("profiles", { create: true })} className="text-meta text-accent hover:underline">{t("start.profile.another")}</button>
          </div>
        </>
      )}
    </Step>
  );
}

function MessageStep({ state, profileName, profileId, hostId }: { state: "open" | "todo"; profileName: string | null; profileId: string | null; hostId: string }) {
  const { t } = useI18n();
  const features = useApp((s) => s.features);
  const openAgent = useApp((s) => s.openAgent);
  const openPage = useApp((s) => s.openPage);
  const scratchOk = features.has(SCRATCH_FEATURE);
  const [folder, setFolder] = useState("");
  const [text, setText] = useState(() => t("start.message.example"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageId = useRef(crypto.randomUUID());
  const progress = useRef(NO_PROGRESS);
  const name = firstAgentName(profileName ? { name: profileName } : null);
  if (state !== "open") return <Step n={3} state="todo" title={t("start.message.title")} />;
  const check = canSend(text, folder, scratchOk);
  const send = async () => {
    if (check !== "ok") return setError(t(check === "folder" ? "start.message.needsFolder" : "start.message.text"));
    setBusy(true);
    setError(null);
    try {
      const agent = await runNewAgentSteps(
        {
          create: async (start) => (await api.createAgent({ name, cwd: folder.trim() || undefined, profile: profileName ?? undefined, start })).cutexSessionId,
          refresh: async () => {
            await useApp.getState().refreshHostSidebar(hostId);
          },
          assignDirector: async () => {},
          start: async (id) => {
            await useApp.getState().sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false }, hostId);
          },
          submit: async (id, message, extra) => {
            await api.submit(id, message, "auto", false, { clientUserMessageId: messageId.current, extra });
          },
        },
        { start: true, director: false, message: text.trim(), extra: [] },
        progress.current,
        (p) => (progress.current = p),
      );
      noteFirstAgent({ hostId, sessionId: agent });
      await openAgent(agent, hostId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Step n={3} state="open" title={t("start.message.title")}>
      <label className="mt-1.5 block text-meta text-subtle">
        {t("start.message.folder")}
        <div className="mt-0.5"><TextInput value={folder} onChange={setFolder} width="w-full" mono placeholder={scratchOk ? t("start.message.folder.scratchPlaceholder") : "D:\\code\\my-app"} label={t("start.message.folder")} /></div>
        <span className="text-meta">{t(scratchOk ? "start.message.folder.scratch" : "start.message.folder.required")}</span>
      </label>
      <label className="mt-1.5 block text-meta text-subtle">
        {t("start.message.text")}
        <div className="mt-0.5"><TextArea value={text} onChange={setText} width="w-full" rows={2} label={t("start.message.text")} /></div>
      </label>
      <p className="mt-1 text-meta text-muted">{t("start.message.note", { name })}</p>
      {error && <p role="alert" className="mt-1 text-meta text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button primary disabled={busy} onClick={() => void send()}>{t(busy ? "start.message.sending" : "start.message.send")}</Button>
        <button type="button" onClick={() => openPage("agent-config.newAgent", { host: hostId, ...(profileId ? { profile: profileId } : {}) })} className="text-meta text-accent hover:underline">{t("start.message.more")}</button>
      </div>
    </Step>
  );
}

/**
 * Step 4, optional (owner 2026-11-26: 自定义桌面 is part of the guide, not a Settings page): the look choices, folded
 * until asked for; open at any time, not only after the first message.
 */
function CustomizeStep({ open, onToggle }: { open: boolean; onToggle(): void }) {
  const { t } = useI18n();
  return (
    <li data-start-step={4} data-state={open ? "open" : "todo"} className="flex gap-2.5 border-t border-border py-2.5">
      <Dot state={open ? "open" : "todo"} n={4} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={open ? "font-semibold text-foreground" : "text-muted"}>{t("start.customize.title")}</span>
          <span className="text-meta text-subtle">{t("start.customize.optional")}</span>
          <button type="button" data-start-customize-toggle="" aria-expanded={open} onClick={onToggle} className="ml-auto text-meta text-accent hover:underline">
            {t(open ? "start.customize.fold" : "start.customize.unfold")}
          </button>
        </div>
        <div className="text-meta text-subtle">{t("start.customize.hint")}</div>
        {open && (
          <div className="mt-2.5">
            <Suspense fallback={null}><CustomizePanel /></Suspense>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * `onClose`: shown as a page (帮助 → 开始使用), with a way out; the empty main area's card has none. `customize`:
 * open with step 4 unfolded (帮助 → 自定义桌面).
 */
export function StartCard({ onClose, customize = false }: { onClose?: () => void; customize?: boolean }) {
  const { t } = useI18n();
  const daemon = useApp((s) => s.daemon);
  const hosts = useApp((s) => s.hosts);
  const hostId = hosts?.active ?? "local";
  const label = hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId;
  const stage = hostStage(daemon, hasNoHost(hosts));
  const [customizeOpen, setCustomizeOpen] = useState(customize);
  useEffect(() => {
    if (customize) setCustomizeOpen(true);
  }, [customize]);
  const [hostOpen, setHostOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // A new focus host starts the later steps over.
  useEffect(() => {
    setPicked(null);
    setConfirmed(false);
    setProfileOpen(false);
  }, [hostId]);
  const connected = stage === "connected";
  const profilesProbe = useProfiles(hostId, connected);
  const settled = profileSettled(profilesProbe);
  const step: StartStep = hostOpen ? "host" : profileOpen ? "profile" : startStep(stage, profilesProbe, confirmed || settled);
  const chosen = chosenProfile(profilesProbe, picked);
  const fast = connected && settled && !confirmed && !hostOpen && !profileOpen;
  const hostDone = connected && step !== "host";
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-6" data-start-card="" data-start-at={step}>
      <div className="w-full max-w-[34rem] rounded-xl border border-border bg-surface px-5 py-4 text-ui">
        <div className="flex items-start gap-2">
          <h2 className="flex-1 text-title font-semibold text-foreground">{t("start.card.title")}</h2>
          {onClose && <button type="button" onClick={onClose} className="text-meta text-subtle hover:text-foreground">{t("start.card.close")}</button>}
        </div>
        <p className="mb-2 text-meta text-muted">{t(fast ? "start.card.leadReady" : "start.card.lead")}</p>
        <ol className="m-0 list-none p-0">
          <HostStep stage={stage} label={label} open={!hostDone} onChange={() => setHostOpen(true)} />
          <ProfileStep
            state={step === "profile" ? "open" : step === "message" ? "done" : "todo"}
            profiles={profilesProbe}
            picked={picked}
            onPick={setPicked}
            onConfirm={() => {
              setConfirmed(true);
              setProfileOpen(false);
            }}
            onChange={() => setProfileOpen(true)}
          />
          <MessageStep state={step === "message" ? "open" : "todo"} profileName={chosen?.name ?? null} profileId={chosen?.id ?? null} hostId={hostId} />
          <CustomizeStep open={customizeOpen} onToggle={() => setCustomizeOpen((v) => !v)} />
        </ol>
        {hostOpen && connected && (
          <div className="mt-1"><Button onClick={() => setHostOpen(false)}>{t("start.next.back")}</Button></div>
        )}
      </div>
    </div>
  );
}

/**
 * The 开始使用 page (main.page): the card with a way back to what was open. `params.embedded`: the empty main area on a
 * first run (components/Conversation), without a close button.
 */
export function StartPage({ params }: { params: PageParams }) {
  const close = () => {
    const app = useApp.getState();
    const first = app.sidebar?.active[0];
    if (first) void app.openAgent(first.cutexSessionId, app.hosts?.active ?? "local");
  };
  return <StartCard onClose={params.embedded ? undefined : close} customize={params.customize === "1"} />;
}

