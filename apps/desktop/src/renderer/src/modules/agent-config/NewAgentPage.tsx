// New agent (DESIGN §3.1): cutex `POST /v2/human/agents` — name, project, directory, profile,
// start now, and (human-create-session) floating per-thread launch options beside the composer.
// One agent = one cutex session = one native thread. With cutex `project-optional-director` the
// project list also offers 「新项目…」 (create_project, then the agent joins it) and the new agent
// can become the project's Director (assign_director; params.director = "1" from the projects page).
// Multi-host (P1 step 2c, RFC §9.2): a host picker on top (★ Q10 default; params.host presets it,
// params.project without a host = the focus host's project); everything the form loads and creates
// goes to that host (lib/targetHost), and the new agent opens there.
// Claude profiles (cutex human-agent-claude): Advanced keeps model / effort and shows the profile's
// write / exec rules instead of the Codex-only sandbox / approval / network / writable roots; a
// host without the capability greys Claude profiles out (lib/newAgentClaude).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import type { SkillMetadata, SkillsListResponse } from "@cutex-desktop/protocol/codex/v2";
import { Check, ChevronDown, FolderOpen, LoaderCircle, Plus, Sparkles, UserRound, X } from "lucide-react";
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { CLAUDE_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES, type ProfileItem, type ProfileModelsView, type SidebarSnapshot } from "../../../../shared/ipc";
import { dataUrlBytes, type DraftImage } from "../../../../shared/input";
import { SANDBOX_MODES, BUILTIN_THREAD_DEFAULTS, launchFromForm, readNewThreadDefaults, type ClaudeLaunchMode, type LaunchForm, type LaunchPermissions } from "../../../../shared/launch";
import { useI18n, type MessageKey } from "../../i18n";
import { modelControlTitle, useModelName } from "../../lib/modelDisplay";
import { cachedProfileList, loadProfileList } from "../../lib/profileSnapshot";
import { useOrderedProfiles } from "../../lib/profileOrder";
import { useTrackOverlay } from "../../lib/openOverlays";
import { profileColor } from "../../lib/profileLook";
import { saveAgentPicture } from "../../lib/agentPicture";
import { AgentAvatarPicker } from "../../components/AgentAvatarPicker";
import { pickDirectory, useFolderPickBlocked, useImagePickBlocked } from "../../lib/remoteMode";
import { imageFileToDataUrl } from "../../lib/images";
import { draftSubmit, hasDraftContent } from "../../lib/pendingChat";
import { appendToken } from "../../lib/composerTools";
import { getUiPrefs, setUiPref, useUiPrefs } from "../../lib/prefs";
import { projectColor } from "../../lib/sidebar";
import { projectIcon } from "../../lib/projectIcons";
import { autoBadge, CREATE_ROOT_FEATURE, createProject, ensureNewProject, OPTIONAL_DIRECTOR_FEATURE, ProjectNameTakenError, sameProjectElsewhere, slugifyProjectId } from "../../lib/projectCreate";
import { ProjectIconPicker } from "../../components/ProjectIconPicker";
import type { ProjectIconChoice } from "../../lib/projectIcons";
import { setProjectIcon } from "../../lib/prefs";
import { useHostScope } from "../../lib/useHostScope";
import { ComponentNotice } from "../../components/ComponentCard";
import { CLAUDE_RUNTIME_COMPONENT, componentBlocks } from "../../lib/componentCard";
import { useComponentState } from "../../lib/componentView";
import { claudeLaunchFromForm, claudeLaunchModes, effectiveProfile, HUMAN_AGENT_CLAUDE_FEATURE, isClaudeCreatorRefusal, isClaudeProfile, shownClaudeMode } from "../../lib/newAgentClaude";
import { NewAgentStepError, NO_PROGRESS, runNewAgentSteps, type NewAgentProgress, type NewAgentStep } from "../../lib/newAgentSteps";
import { ProjectColorPicker } from "../../components/ProjectColorPicker";
import { ProjectBadge } from "../../components/ProjectBadge";
import { shortenHome } from "../../lib/workspace";
import { TargetHostContext, useFocusHostId, useTargetApi, useTargetFeatures, useTargetIsFocus, useTargetSidebar } from "../../lib/targetHost";
import { rememberCreateHost, useCreateHost, type CreateHost } from "../../lib/useCreateHost";
import { draftFits, dropNewAgentDraft, keepNewAgentDraft, keptNewAgentDraft } from "../../lib/newAgentReturn";
import { setSettingsHost } from "../../lib/settingsHost";
import { HostPicker } from "../../components/HostPicker";
import { useApp } from "../../store";
import { bridge } from "../../bridge";
import type { PageParams } from "../slots";
import { WritableRootsEditor } from "../../components/LaunchOptions";
import { LaunchAttachments, LaunchComposer, LaunchDock, LaunchFieldsBox, LaunchIntro, LaunchPage } from "../../components/LaunchPage";
import { profileProvider } from "../../lib/provider";
import { ChipDivider, EffortPicker, ProfileQuota } from "../../components/Composer";
import { ComposerTools } from "../../components/ComposerTools";
import { Menu, Popover } from "../../components/Menu";
import { ModelPicker } from "../../components/ModelPicker";
import { LAUNCH_FOR_MODE, LAUNCH_REVIEWER_FEATURE, PERMISSION_MODES, permissionModeOfLaunch, reviewerForCreate } from "../../lib/permissionModes";
import { Button, Segmented, SettingRow, Select, TextInput, Toggle } from "../../components/settings/Form";

const INDEPENDENT = "";
/** cutex can give a cwd-less, project-less `POST /v2/human/agents` a scratch workspace. Not
 *  implemented yet (cutex answers `cwd_required`; TODO.md) — until a host reports it, an
 *  independent agent needs a directory. */
const HUMAN_AGENT_SCRATCH_FEATURE = "human-agent-scratch-cwd";
/** Project dropdown entry: create a new project (optional-Director cutex only). */
const NEW_PROJECT = "__new_project__";
/** Example workspace path for this computer (the local host); a remote host gets a POSIX one. */
const localWorkspacePlaceholder = () => (bridge.platform === "win32" ? "D:\\path\\to\\workspace" : bridge.platform === "darwin" ? "/Users/me/project" : "/home/me/project");
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const formFrom = (d: LaunchPermissions): LaunchForm => ({ ...d, writableRoots: [...d.writableRoots], model: "", reasoningEffort: "" });

/** Chip body: the label gives way before the value (LaunchPage.css); the full text is the tooltip. */
function LaunchValue({ label, value, icon, title }: { label: string; value: string; icon?: ReactNode; /** Default "label: value". */ title?: string }) {
  return <span className="launch-value" title={title ?? `${label}: ${value}`}><span className="launch-value-label text-subtle">{label}</span>{icon}<span className="launch-value-text text-foreground">{value}</span><ChevronDown size={11} className="ml-auto shrink-0 text-subtle" /></span>;
}

/** Small, separate panels keep launch choices beside the composer without a scrolling form. */
function LaunchModelPanel({ profile, catalog, form, touched, onChange, onReset }: {
  profile: string | null;
  catalog: ProfileModelsView | null;
  form: LaunchForm;
  touched: boolean;
  onChange(patch: Partial<LaunchForm>): void;
  onReset(): void;
}) {
  const { t } = useI18n();
  const modelName = useModelName();
  const models = catalog?.models ?? [];
  const extra = [...(catalog?.discovery?.models ?? []), ...(catalog?.selectedModel ? [catalog.selectedModel] : [])]
    .filter((id, i, all) => all.indexOf(id) === i && !models.some((m) => m.id === id));
  const choices = [
    ...models.map((m) => ({ value: m.id, label: modelName(m.id, m.displayName, profile) })),
    ...extra.map((id) => ({ value: id, label: modelName(id, null, profile) })),
  ];
  const shown = models.find((m) => m.id === (form.model || catalog?.selectedModel));
  const efforts = shown?.supportedReasoningEfforts.length ? shown.supportedReasoningEfforts : EFFORTS;
  const effortName = (e: string) => {
    const key = `composer.effort.${e}` as MessageKey;
    return t(key) === key ? e : t(key);
  };
  return (
    <LaunchFieldsBox>
        <div className="launch-fields">
          <label className="launch-field">
            {t("composer.modelTitle")}
            {choices.length > 0 ? (
              <Select width="w-full" value={form.model}
                options={[{ value: "", label: t("launch.profileDefault", { model: catalog?.selectedModel ? modelName(catalog.selectedModel, models.find((m) => m.id === catalog.selectedModel)?.displayName, profile) : "—" }) }, ...choices]}
                onChange={(model) => onChange({ model, reasoningEffort: "" })} />
            ) : (
              <TextInput mono width="w-full" value={form.model} placeholder={catalog?.selectedModel ?? t("launch.profileDefault", { model: "—" })} onChange={(model) => onChange({ model })} />
            )}
          </label>
          <label className="launch-field">
            {t("agent-config.newAgent.effort")}
            <Select width="w-full" value={form.reasoningEffort}
              options={[{ value: "", label: shown?.defaultReasoningEffort ? `— (${effortName(shown.defaultReasoningEffort)})` : t("quick-chats.defaultProfile") }, ...efforts.map((e) => ({ value: e, label: effortName(e) }))]}
              onChange={(reasoningEffort) => onChange({ reasoningEffort })} />
          </label>
        </div>
      {touched && <div className="mt-3 flex justify-end"><Button onClick={onReset}>{t("agent-config.newAgent.advancedReset")}</Button></div>}
    </LaunchFieldsBox>
  );
}

/** `agent-config.newAgent` (params.project presets the project, params.host its host). */
export function NewAgentPage({ params }: { params: PageParams }) {
  const focus = useFocusHostId();
  // A draft kept while the owner added / managed profiles (lib/newAgentReturn) comes back with its host.
  const [restored] = useState(() => {
    const kept = keptNewAgentDraft();
    return kept && draftFits(kept, params) ? kept : null;
  });
  useEffect(() => {
    if (restored) dropNewAgentDraft();
  }, [restored]);
  const preset = params.host ?? (params.project ? focus : null);
  const target = useCreateHost(restored?.hostId ?? preset);
  const { setHostId } = target;
  // Opened again for another project / host while mounted.
  useEffect(() => {
    if (preset) setHostId(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.host, params.project]);
  return (
    <TargetHostContext.Provider value={target.hostId}>
      <NewAgentForm params={params} target={target} presetHost={preset} restored={restored?.hostId === target.hostId ? { ...(restored.form as NewAgentDraft), ...(restored.createdProfile ? { profile: restored.createdProfile, portraitSelected: true, launch: { ...(restored.form as NewAgentDraft).launch, model: "", reasoningEffort: "" } } : {}) } : null} />
    </TargetHostContext.Provider>
  );
}

/** The form fields kept while the owner adds / manages profiles (lib/newAgentReturn). */
interface NewAgentDraft {
  name: string;
  avatar: SessionAvatar | null;
  picture: string | null;
  task: string;
  images: (DraftImage & { bytes: number })[];
  pickedSkills: { name: string; path: string }[];
  project: string;
  cwd: string;
  cwdTouched: boolean;
  profile: string;
  portraitSelected: boolean;
  start: boolean;
  launch: LaunchForm;
  launchTouched: boolean;
  /** Claude profiles (cutex claude-launch-permission-mode): the picked starting mode; null = the default. */
  claudeMode?: ClaudeLaunchMode | null;
  projectName: string;
  projectBadge: string;
  projectColorName: string;
  projectIconChoice: ProjectIconChoice | null;
  asDirector: boolean;
}

/**
 * `presetHost`: the host `params.project` belongs to (null = no preset project). `restored`: a draft
 * kept on the way to Settings → Profiles (its host is the form's host).
 */
function NewAgentForm({ params, target, presetHost, restored }: { params: PageParams; target: CreateHost; presetHost: string | null; restored: NewAgentDraft | null }) {
  const hostId = target.hostId;
  const projectId = params.project ?? null;
  const { t } = useI18n();
  const api = useTargetApi();
  const isFocus = useTargetIsFocus();
  const features = useTargetFeatures();
  const sidebar = useTargetSidebar();
  const refreshSidebar = useApp((s) => s.refreshSidebar);
  const openAgent = useApp((s) => s.openAgent);
  const projects = sidebar?.projects?.projects ?? [];
  // Projects of the same name can live on several hosts (two 「Chores」): name the host in the picker
  // whenever more than one host is connected or the form targets another host than the focus host.
  const scope = useHostScope();
  const focusSidebar = useApp((s) => s.sidebar);
  const byHost = useApp((s) => s.byHost);
  const [name, setName] = useState(restored?.name ?? "");
  const [avatar, setAvatar] = useState<SessionAvatar | null>(restored?.avatar ?? null);
  const [picture, setPicture] = useState<string | null>(restored?.picture ?? null);
  const [task, setTask] = useState(restored?.task ?? "");
  const [images, setImages] = useState<(DraftImage & { bytes: number })[]>(restored?.images ?? []);
  const [imageLoading, setImageLoading] = useState(false);
  const imageLoadingRef = useRef(false);
  const draftGeneration = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [allSkills, setAllSkills] = useState<SkillMetadata[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [pickedSkills, setPickedSkills] = useState<{ name: string; path: string }[]>(restored?.pickedSkills ?? []);
  const imagePickBlocked = useImagePickBlocked();
  const hasTask = hasDraftContent({ text: task, images });
  const [panel, setPanel] = useState<"project" | "model" | null>(null);
  useTrackOverlay(!!panel);
  const optionsRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      const trigger = optionsRef.current?.querySelector<HTMLButtonElement>(`[data-launch-option="${panel}"]`);
      if (!detailsRef.current?.contains(target) && !trigger?.contains(target)) setPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPanel(null);
      optionsRef.current?.querySelector<HTMLButtonElement>(`[data-launch-option="${panel}"]`)?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [panel]);
  const sending = useRef(false);
  const messageId = useRef(crypto.randomUUID());
  const [project, setProject] = useState<string>(restored?.project ?? projectId ?? INDEPENDENT);
  const [cwd, setCwd] = useState(restored?.cwd ?? "");
  const [profile, setProfile] = useState(restored?.profile ?? "");
  const [portraitSelected, setPortraitSelected] = useState(restored?.portraitSelected ?? false);
  const [start, setStart] = useState(restored?.start ?? true);
  // From the host's cached list first (shared with 快速启动), so a revisit paints the launcher art in
  // its first frame instead of the icon intro until the list arrives; refreshed below.
  const [profiles, setProfiles] = useState<{ defaultProfile: string | null; profiles: ProfileItem[] } | null>(() => cachedProfileList(hostId));
  /** The host's profiles in the owner's manual order (lib/profileOrder), for the picker and the portraits. */
  const ordered = useOrderedProfiles(profiles?.profiles, hostId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canLaunch = features.has("human-create-session");
  /** The host creates Claude agents (otherwise Claude profiles are greyed out). */
  const claudeOk = features.has(HUMAN_AGENT_CLAUDE_FEATURE);
  const hasDefaults = features.has("new-thread-defaults");
  const [defaults, setDefaults] = useState<LaunchPermissions>(BUILTIN_THREAD_DEFAULTS.agent);
  const [launch, setLaunch] = useState<LaunchForm>(() => restored?.launch ?? formFrom(BUILTIN_THREAD_DEFAULTS.agent));
  const [launchTouched, setLaunchTouched] = useState(restored?.launchTouched ?? false);
  const [claudeMode, setClaudeMode] = useState<ClaudeLaunchMode | null>(restored?.claudeMode ?? null);
  const [cwdTouched, setCwdTouched] = useState(restored?.cwdTouched ?? false);
  const remote = hostId !== LOCAL_HOST_ID;
  const hostLabel = target.look?.label ?? "";
  const showHost = !!hostLabel && (hostId !== scope.focus || scope.hosts.filter((h) => h.connected).length > 1);
  const withHost = (name: string) => (showHost ? `${name} · ${hostLabel}` : name);
  /** The target host's daemon is online (an offline host keeps the form; creating waits). */
  const online = target.look?.indicator.status === "online";
  const optional = features.has(OPTIONAL_DIRECTOR_FEATURE);
  // 「新项目…」: the project's name / badge / colour; its directory is the agent's working directory.
  const [projectName, setProjectName] = useState(restored?.projectName ?? "");
  const [projectBadge, setProjectBadge] = useState(restored?.projectBadge ?? "");
  const [projectColorName, setProjectColorName] = useState(restored?.projectColorName ?? "cyan");
  /** 项目图标 of 「新项目…」 (same picker as 项目设置), saved once the project was created. */
  const [projectIconChoice, setProjectIconChoice] = useState<ProjectIconChoice | null>(restored?.projectIconChoice ?? null);
  const [asDirector, setAsDirector] = useState(restored?.asDirector ?? params.director === "1");
  // Steps already done, so a retry after a partial failure does not create things twice.
  // 「新项目…」 that exists now (created or reused): the form switched to it, so a retry only creates
  // the agent. `keepSteps`: that switch is the page's own, not the owner changing the form.
  const [projectReady, setProjectReady] = useState<{ id: string; name: string; outcome: "created" | "reused" } | null>(null);
  const keepSteps = useRef(false);
  /** 「切换设备」 from the same-name hint: the project to select once the form moved to that host. */
  const pendingSwitch = useRef<{ hostId: string; projectId: string } | null>(null);
  const [progress, setProgress] = useState<NewAgentProgress>(NO_PROGRESS);
  const createdAgent = progress.agent;
  /** The agent exists but could not be made Director / started: offer retry / open the agent. */
  const [failedStep, setFailedStep] = useState<NewAgentStep | null>(null);
  const newProject = optional && project === NEW_PROJECT;
  const selectedSummary = projects.find((p) => p.project_id === project);
  /** 「新项目…」 named like a project of another connected host (wrong host picked?): offer to switch. */
  const elsewhere = useMemo(() => {
    const name = projectName.trim();
    if (!newProject || !name || projects.some((p) => p.presentation.display_name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) return null;
    const lists = [{ hostId: scope.focus, projects: focusSidebar?.projects }, ...Object.entries(byHost).map(([id, slice]) => ({ hostId: id, projects: slice.sidebar?.projects }))];
    return sameProjectElsewhere(lists, hostId, name);
  }, [newProject, projectName, projects, scope.focus, focusSidebar, byHost, hostId]);
  const icons = useUiPrefs().projectIcons;
  // Director checkbox: a new project, or an existing project that has none.
  const canDirect = optional && (newProject || (!!selectedSummary && !selectedSummary.director_cutex_session_id));
  const directorReason = canDirect ? null : t(!optional ? "agent-config.newAgent.directorUnsupported" : selectedSummary?.director_cutex_session_id ? "agent-config.newAgent.directorExists" : "agent-config.newAgent.directorNeedsProject");
  const chosen = effectiveProfile(profiles, profile);
  const modelName = useModelName();
  const [catalogResult, setCatalogResult] = useState<{ host: string; profile: string; data: ProfileModelsView } | null>(null);
  const catalog = catalogResult?.host === hostId && catalogResult.profile === chosen?.id ? catalogResult.data : null;
  useEffect(() => {
    if (!chosen) return;
    let alive = true;
    api.profileModels(chosen.id).then(
      (data) => { if (alive) setCatalogResult({ host: hostId, profile: chosen.id, data }); },
      () => { if (alive) setCatalogResult(null); },
    );
    return () => { alive = false; };
  }, [api, hostId, chosen?.id]);
  const claude = isClaudeProfile(chosen);
  /** Claude Code modes the new agent can start in (same names as the composer's Claude mode menu). */
  const claudeModes = useMemo(() => claudeLaunchModes(chosen), [chosen]);
  const shownMode = shownClaudeMode(claudeMode, claudeModes);
  /** A Claude profile (picked, or the default) on a host that cannot create Claude agents. */
  const claudeBlocked = claude && !claudeOk;
  // components spec v2 §5: a Claude agent needs the host's claude-runtime component; creating one
  // cannot work while it is missing / installing / needs the owner (viewing the form never blocks).
  const runtime = useComponentState(hostId, CLAUDE_RUNTIME_COMPONENT, { active: claude && claudeOk });
  const runtimeBlocked = claude && claudeOk && componentBlocks(runtime.state);

  // Profiles of the target host (another host has other profiles); reloaded when the host changes.
  useEffect(() => {
    let alive = true;
    setProfiles(cachedProfileList(hostId));
    loadProfileList(hostId).then(
      // A failed load ends "loading" with an empty list, so the intro falls back to the icon one.
      (r) => alive && setProfiles(r ?? { defaultProfile: null, profiles: [] }),
      () => alive && setProfiles((p) => p ?? { defaultProfile: null, profiles: [] }),
    );
    return () => {
      alive = false;
    };
  }, [api, hostId]);
  // Prefill Advanced from the configured agent defaults (Settings → New thread defaults).
  useEffect(() => {
    setDefaults(BUILTIN_THREAD_DEFAULTS.agent);
    if (!canLaunch || !hasDefaults) return;
    let alive = true;
    api.getSettings().then(
      (s) => {
        const d = readNewThreadDefaults(s);
        if (d && alive) setDefaults(d.current.agent);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [canLaunch, hasDefaults, api]);
  // Another host: its projects, profiles, folders and defaults differ — those fields start over
  // (the name stays). The preset project only belongs to its own host.
  const [formHost, setFormHost] = useState(hostId);
  if (formHost !== hostId) {
    setFormHost(hostId);
    const pending = pendingSwitch.current?.hostId === hostId ? pendingSwitch.current.projectId : null;
    pendingSwitch.current = null;
    setProject(pending ?? (projectId && presetHost === hostId ? projectId : INDEPENDENT));
    setProfile("");
    draftGeneration.current++;
    setImages([]);
    setImageLoading(false);
    imageLoadingRef.current = false;
    setAllSkills(null);
    setSkillsError(null);
    setPickedSkills([]);
    setCwd("");
    setCwdTouched(false);
    setLaunchTouched(false);
    setProjectReady(null);
    setProgress(NO_PROGRESS);
    setFailedStep(null);
    setError(null);
  }
  useEffect(() => {
    if (!launchTouched) setLaunch(formFrom(defaults));
  }, [defaults, launchTouched]);
  useEffect(() => setProject(projectId ?? INDEPENDENT), [projectId]);
  useEffect(() => setAsDirector(params.director === "1"), [params.director]);
  // Changing the form after a partial failure starts over (not the page's own switch to the project
  // 「新项目…」 just created).
  useEffect(() => {
    if (keepSteps.current) {
      keepSteps.current = false;
      return;
    }
    setProjectReady(null);
    setProgress(NO_PROGRESS);
    setFailedStep(null);
  }, [project, projectName]);
  // The project list follows cutex events; a project mutation alone sends none, so read the target
  // host's list again whenever the form opens on a host (a project created elsewhere shows up).
  useEffect(() => {
    void useApp.getState().refreshHostSidebar(hostId);
  }, [hostId]);
  useEffect(() => {
    setProgress(NO_PROGRESS);
    setFailedStep(null);
  }, [name]);

  const root = selectedSummary?.workspace_root ?? null;
  const scratchOk = features.has(HUMAN_AGENT_SCRATCH_FEATURE);
  // What cutex needs for a cwd: a directory, or a project with a workspace root, or (with the
  // scratch capability) nothing for an independent agent. 「新项目…」 always needs a directory.
  const missingWorkspace = !cwd.trim() && (newProject ? true : project ? !root : !scratchOk);
  // A project prefills its workspace root. With the scratch capability an independent agent
  // starts with no client-selected path (cutex owns scratch allocation); without it the last
  // directory used on this host is prefilled, as before the launcher redesign.
  useEffect(() => {
    if (cwdTouched) return;
    setCwd(project && project !== NEW_PROJECT ? (root ?? "") : scratchOk && !newProject ? "" : remote ? (getUiPrefs().remoteAgentCwd[hostId] ?? "") : getUiPrefs().lastAgentCwd);
  }, [project, root, cwdTouched, hostId, remote, scratchOk, newProject]);
  const pickBlocked = useFolderPickBlocked();
  const pick = async () => {
    const dir = await pickDirectory(cwd.trim() || root || undefined, hostId);
    if (dir) {
      setCwd(dir);
      setCwdTouched(true);
    }
  };
  const create = async () => {
    if (sending.current || imageLoadingRef.current || !online || claudeBlocked || runtimeBlocked || !name.trim() || imageError || missingWorkspace || (newProject && !projectName.trim())) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setFailedStep(null);
    /** The project of 「新项目…」 exists (this attempt or an earlier one): say so if the agent step fails. */
    let madeProject: { id: string; name: string } | null = null;
    try {
      if ((!project || newProject) && cwd.trim()) {
        if (remote) setUiPref("remoteAgentCwd", { ...getUiPrefs().remoteAgentCwd, [hostId]: cwd.trim() });
        else setUiPref("lastAgentCwd", cwd.trim());
      }
      // 1. 「新项目…」: a Director-less project whose directory is the agent's working directory.
      // An empty project of the same name (e.g. from an attempt whose agent step failed) is reused;
      // afterwards the form shows that project, so a retry only creates the agent.
      let target = project || null;
      let readyNow: { id: string; name: string } | null = projectReady && projectReady.id === project ? projectReady : null;
      if (newProject) {
        const display = projectName.trim();
        const listProjects = async () => {
          if (isFocus) {
            await refreshSidebar();
            return useApp.getState().sidebar?.projects ?? null;
          }
          const snapshot = await api.sidebar();
          void useApp.getState().refreshHostSidebar(hostId);
          return snapshot.projects;
        };
        const ensured = await ensureNewProject({ listProjects, create: (spec) => createProject(api, spec, true) }, hostId,
          { id: slugifyProjectId(display), presentation: { display_name: display, badge_label: projectBadge.trim() || autoBadge(display), color: projectColorName }, workspaceRoot: cwd.trim() || null, director: null, createDirectory: features.has(CREATE_ROOT_FEATURE) });
        target = ensured.projectId;
        if (ensured.outcome === "created" && projectIconChoice) setProjectIcon(hostId, target, projectIconChoice);
        if (isFocus) await refreshSidebar();
        else await useApp.getState().refreshHostSidebar(hostId);
        keepSteps.current = true;
        setProject(target);
        setProjectReady({ id: target, name: display, outcome: ensured.outcome });
        readyNow = { id: target, name: display };
      }
      madeProject = readyNow;
      // 2. The agent, joining the project. 3. Director of that project (CAS from the refreshed
      // summary). A Director is created stopped and started only after the assignment, so its
      // runtime starts with the Director tools (cutex hands out the MCP tool list at start).
      const directorOf = target;
      // The focus host refreshes the store's sidebar; another host is read directly (its slice follows its feed).
      let fresh: SidebarSnapshot | null = null;
      const agent = await runNewAgentSteps(
        {
          create: async (startNow) => {
            // 自动 = auto reviewer: in `launch` where cutex takes it, else set once the thread runs.
            const reviewer = reviewerForCreate(launchFromForm(launch, launchTouched), permissionModeOfLaunch(launch.sandbox, launch.approvalPolicy, launch.approvalsReviewer), features.has(LAUNCH_REVIEWER_FEATURE));
            const id = (await api.createAgent({ name: name.trim(), projectId: target ?? undefined, cwd: cwd.trim() || undefined, profile: profile || undefined, start: startNow, launch: !canLaunch ? undefined : claude ? claudeLaunchFromForm(launch, launchTouched, claudeMode && claudeModes?.includes(claudeMode) ? claudeMode : null, claudeModes) : reviewer.launch })).cutexSessionId;
            if (canLaunch && !claude && reviewer.fallback) useApp.getState().expectApprovalsReviewer(id, hostId, reviewer.fallback);
            return id;
          },
          saveAppearance: avatar ? async (id) => {
            if (picture) {
              try { saveAgentPicture(avatar, picture); }
              catch { throw new Error(t("info.avatar.pictureSaveFailed")); }
            }
            await api.sessionAction(id, "cutex/session/metadata/update", { avatar });
          } : undefined,
          refresh: isFocus
            ? refreshSidebar
            : async () => {
                fresh = await api.sidebar();
              },
          assignDirector: async (id) => {
            if (!directorOf) throw new Error("no project");
            const summary = (isFocus ? useApp.getState().sidebar : fresh)?.projects?.projects.find((p) => p.project_id === directorOf);
            await api.projectMutation(directorOf, { authorityEpoch: summary?.authority_epoch ?? 0, projectRevision: summary?.project_revision ?? 0 }, { kind: "assign_director", cutex_session_id: id });
          },
          start: async (id) => {
            await api.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false });
          },
          submit: async (id, text, extra) => {
            await api.submit(id, text, "auto", true, { clientUserMessageId: messageId.current, extra });
          },
        },
        { start: start || hasTask, director: canDirect && asDirector && !!target, message: task, extra: firstInput.extra },
        progress,
        setProgress,
      );
      rememberCreateHost(hostId);
      await openAgent(agent, hostId);
    } catch (e) {
      if (e instanceof NewAgentStepError && e.step !== "create") setFailedStep(e.step);
      const message = e instanceof Error ? e.message : String(e);
      const shown = e instanceof ProjectNameTakenError ? t("agent-config.newAgent.projectNameTaken") : isClaudeCreatorRefusal(message) ? t("agent-config.newAgent.claudeUnsupported") : message.includes("cwd_required") ? t("agent-config.newAgent.scratchUnsupported") : message;
      // The agent itself failed after the project was made: the project stays selected, a retry only creates the agent.
      setError(madeProject && e instanceof NewAgentStepError && e.step === "create" ? t("agent-config.newAgent.agentFailedProjectReady", { project: madeProject.name, error: shown }) : shown);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const defaultName = profiles?.defaultProfile ?? "—";
  const actionLabel = busy ? t("agent-config.newAgent.creating") : error && projectReady && projectReady.id === project && !createdAgent ? t("agent-config.newAgent.retryAgent") : failedStep === "appearance" ? t("agent-config.newAgent.retryAppearance") : failedStep === "director" ? t("agent-config.newAgent.retryDirector") : failedStep === "start" ? t("agent-config.newAgent.retryStart") : failedStep === "message" ? t("agent-config.newAgent.retryMessage") : hasTask ? t("agent-config.newAgent.createAndSend") : t("agent-config.newAgent.create");
  const panelTitles = {
    project: t("agent-config.newAgent.workspace"),
    model: t("launch.model"),
  };
  const closePanel = () => {
    const trigger = optionsRef.current?.querySelector<HTMLButtonElement>(`[data-launch-option="${panel}"]`);
    setPanel(null);
    trigger?.focus();
  };
  // Project icons (main 9689da4): the chosen project's ProjectBadge, a colour dot for 「新项目…」.
  const projectChip = newProject ? (
    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: projectColor(projectColorName) }} />
  ) : selectedSummary ? (
    <ProjectBadge icon={projectIcon(icons, hostId, project)} badge={selectedSummary.presentation.badge_label || selectedSummary.presentation.display_name.slice(0, 1) || project.slice(0, 1)} color={selectedSummary.presentation.color ?? "blue"} />
  ) : undefined;
  const projectLabel = newProject ? withHost(projectName || t("agent-config.newAgent.newProject")) : selectedSummary ? withHost(selectedSummary.presentation.display_name || project) : t(cwd.trim() ? "agent-config.newAgent.customCwd" : scratchOk ? "agent-config.newAgent.scratchShort" : "agent-config.newAgent.needWorkspace");
  const locked = busy || !!createdAgent;
  const unspecified = t("agent-config.newAgent.unspecified");
  const models = catalog?.models ?? [];
  const defaultModel = models.find((m) => m.isDefault)?.id ?? catalog?.selectedModel ?? chosen?.model ?? null;
  const model = launch.model || defaultModel;
  const row = models.find((m) => m.id === model);
  const canImages = row ? row.inputModalities.includes("image") : true;
  const imageLimit = claude ? CLAUDE_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES;
  const oversized = images.find((image) => image.bytes > imageLimit);
  const firstInput = draftSubmit({ text: task, images, skills: claude ? [] : pickedSkills });
  const imageError = images.length && !canImages ? t("composer.image.unsupported") : oversized ? t("composer.image.tooLarge", { name: oversized.name }) : firstInput.extra.length > 20 ? t("agent-config.newAgent.tooManyAttachments") : null;
  const disabled = !online || claudeBlocked || runtimeBlocked || !name.trim() || busy || imageLoading || !!imageError || missingWorkspace || (newProject && !projectName.trim());
  /** First thing the owner still has to fill in, shown in the composer. */
  const missing = !name.trim() ? t("agent-config.newAgent.needName") : missingWorkspace ? t("agent-config.newAgent.needWorkspace") : null;
  const addImages = async (files?: File[]) => {
    if (locked || imageLoadingRef.current) return;
    if (!canImages) { setError(t("composer.image.unsupported")); return; }
    if (!files && imagePickBlocked) return;
    const generation = draftGeneration.current;
    imageLoadingRef.current = true;
    setImageLoading(true);
    setError(null);
    try {
      const additions: (DraftImage & { bytes: number })[] = [];
      if (files) {
        for (const file of files.filter((file) => file.type.startsWith("image/"))) {
          const url = await imageFileToDataUrl(file, imageLimit);
          if (generation !== draftGeneration.current) return;
          if (!url) { setError(t("composer.image.tooLarge", { name: file.name || "image" })); continue; }
          additions.push({ id: crypto.randomUUID(), name: file.name || "image", bytes: dataUrlBytes(url), preview: url, source: { kind: "data", url } });
        }
      } else {
        const selected = await api.pickImages(imageLimit);
        if (generation !== draftGeneration.current) return;
        for (const image of selected) {
          if (image.error) { setError(t(image.error === "tooLarge" ? "composer.image.tooLarge" : "composer.image.unreadable", { name: image.name })); continue; }
          additions.push({ id: crypto.randomUUID(), name: image.name, bytes: image.size, preview: image.preview, source: { kind: "path", path: image.path } });
        }
      }
      setImages((previous) => [...previous, ...additions]);
    } catch (e) {
      if (generation === draftGeneration.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation === draftGeneration.current) { imageLoadingRef.current = false; setImageLoading(false); }
    }
  };
  const loadSkills = () => {
    setPanel(null);
    const generation = draftGeneration.current;
    api.codexRequest("skills/list", {}).then((result) => {
      if (generation !== draftGeneration.current) return;
      setAllSkills((result as SkillsListResponse).data.flatMap((entry) => entry.skills));
      setSkillsError(null);
    }, (e: unknown) => { if (generation === draftGeneration.current) setSkillsError(e instanceof Error ? e.message : String(e)); });
  };
  const shownModel = model ? modelName(model, row?.displayName, chosen?.id) : unspecified;
  const shownModelTitle = model && shownModel !== model ? `${t("composer.modelTitle")}: ${shownModel} · ${model}` : undefined;
  const effort = launch.reasoningEffort || (launch.model ? row?.defaultReasoningEffort : chosen?.modelReasoningEffort ?? row?.defaultReasoningEffort) || null;
  const efforts = row?.supportedReasoningEfforts ?? [];
  const effortKey = `composer.effort.${effort}` as MessageKey;
  const effortLabel = effort ? (t(effortKey) === effortKey ? effort : t(effortKey)) : unspecified;
  const workspace = !claude && launch.sandbox === "workspace-write";
  const network = launch.sandbox === "danger-full-access" || (workspace && launch.networkAccess);
  const mode = permissionModeOfLaunch(launch.sandbox, launch.approvalPolicy, launch.approvalsReviewer);
  const patchLaunch = (patch: Partial<LaunchForm>) => {
    if (locked) return;
    setLaunch((f) => ({ ...f, ...patch }));
    setLaunchTouched(true);
  };
  /** Settings → Profiles (添加 or the list) on the form's host; the draft waits in lib/newAgentReturn. */
  const toProfiles = (create: boolean) => {
    if (locked) return;
    const form: NewAgentDraft = { name, avatar, picture, task, images, pickedSkills, project, cwd, cwdTouched, profile, portraitSelected, start, launch, launchTouched, claudeMode, projectName, projectBadge, projectColorName, projectIconChoice, asDirector };
    keepNewAgentDraft({ hostId, params, form });
    // Host pages open on the form's host (the settings host picker; reset when Settings closes).
    if (hostId !== scope.focus) setSettingsHost(hostId);
    useApp.getState().openSettings("profiles", create ? { create: true } : undefined);
  };
  const profileList = (close: () => void) => {
    const select = (value: string) => {
      if (locked) return;
      setPortraitSelected(true);
      setProfile(value);
      setLaunch((f) => ({ ...f, model: "", reasoningEffort: "" }));
      close();
    };
    return (
      <div className="grid gap-1 p-1">
        <div className="px-2 py-1 text-xs text-subtle">{t("agent-config.newAgent.profile")}</div>
        <button type="button" disabled={locked} onClick={() => select("")} className="launch-profile-choice">
          <span>{t("agent-config.newAgent.profileDefault", { name: defaultName })}</span>{!profile && <Check size={14} className="text-accent" />}
        </button>
        {(ordered ?? []).map((p) => (
          <button type="button" key={p.id} disabled={locked || (isClaudeProfile(p) && !claudeOk)} onClick={() => select(p.id)} className="launch-profile-choice">
            <span>{isClaudeProfile(p) && !claudeOk ? t("agent-config.newAgent.claudeUnsupportedOption", { name: p.name }) : p.name}</span>
            {profile === p.id && <Check size={14} className="text-accent" />}
          </button>
        ))}
        {/* Add / manage profiles of this host without losing the draft (Settings → Profiles offers the way back). */}
        <div className="my-0.5 border-t border-border" role="separator" />
        <button type="button" disabled={locked} onClick={() => (close(), toProfiles(true))} className="launch-profile-choice text-muted" data-testid="new-agent-add-profile">
          <span>{t("agent-config.newAgent.addProfile")}</span>
          <Plus size={14} />
        </button>
        <button type="button" disabled={locked} onClick={() => (close(), toProfiles(false))} className="launch-profile-choice text-muted">
          <span>{t("agent-config.newAgent.manageProfiles")}</span>
        </button>
      </div>
    );
  };
  const detailsPanel = panel && (
            <div ref={detailsRef} id="agent-launch-options" role="dialog" aria-label={panelTitles[panel]} className="launch-popover">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{panelTitles[panel]}</h2>
                <button type="button" onClick={closePanel} aria-label={t("common.close")} className="rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground"><X size={15} /></button>
              </div>
              <fieldset disabled={busy || !!createdAgent} className="min-w-0">
                {panel === "project" && (
                  <LaunchFieldsBox>
                    <div className="launch-fields">
                      <label className="launch-field">
                        {t("agent-config.newAgent.project")}
                        <Select width="w-full" value={project} options={[
                          { value: INDEPENDENT, label: t(cwd.trim() || !scratchOk ? "agent-config.newAgent.independent" : "agent-config.newAgent.scratchProject") },
                          ...projects.map((p) => ({ value: p.project_id, label: withHost(projects.some((q) => q !== p && q.presentation.display_name === p.presentation.display_name) ? `${p.presentation.display_name} (${p.project_id})` : p.presentation.display_name || p.project_id) })),
                          ...(optional ? [{ value: NEW_PROJECT, label: t("agent-config.newAgent.newProject") }] : []),
                        ]} onChange={(value) => { setProject(value); setCwdTouched(false); }} />
                      </label>
                      <div className="launch-field">
                        <label htmlFor="agent-launch-cwd">{t("agent-config.newAgent.cwd")}</label>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <input id="agent-launch-cwd" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-accent"
                            value={cwd} onChange={(e) => { setCwd(e.target.value); setCwdTouched(true); }}
                            placeholder={root ? shortenHome(root) : newProject || !scratchOk ? (remote ? "/home/me/project" : localWorkspacePlaceholder()) : t("agent-config.newAgent.scratchCwd")} />
                          <button type="button" disabled={pickBlocked} title={pickBlocked ? t("remote.noDirBrowse") : t("agent-config.newAgent.pickFolder")} aria-label={t("agent-config.newAgent.pickFolder")} onClick={() => void pick()} className="shrink-0 rounded-md p-1.5 text-muted hover:bg-surface-2 disabled:opacity-40"><FolderOpen size={15} /></button>
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-subtle">{t(newProject ? "agent-config.newAgent.cwdNewProjectHint" : project ? "agent-config.newAgent.cwdHint" : scratchOk ? "agent-config.newAgent.scratchHint" : "agent-config.newAgent.cwdRequiredHint")}</p>
                    {newProject && (
                      <div className="mt-3 border-t border-border pt-2">
                        <SettingRow label={t("agent-config.newAgent.projectName")} hint={t("projects.icon.hint")}>
                          <div className="flex items-center gap-2">
                            <ProjectIconPicker value={projectIconChoice} onIcon={setProjectIconChoice} badge={projectBadge.trim() || autoBadge(projectName) || "?"} color={projectColorName} onColor={setProjectColorName} />
                            <TextInput width="w-48" value={projectName} onChange={setProjectName} />
                          </div>
                        </SettingRow>
                        <SettingRow label={t("projects.badge")}><TextInput width="w-20" value={projectBadge} onChange={(v) => setProjectBadge(v.slice(0, 4))} placeholder={autoBadge(projectName)} /></SettingRow>
                        <SettingRow label={t("projects.color")}><ProjectColorPicker value={projectColorName} onChange={setProjectColorName} /></SettingRow>
                      </div>
                    )}
                    <SettingRow label={t("agent-config.newAgent.start")} hint={hasTask ? t("agent-config.newAgent.taskStarts") : undefined}>
                      <input type="checkbox" checked={start || hasTask} disabled={hasTask} onChange={(e) => setStart(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                    </SettingRow>
                  </LaunchFieldsBox>
                )}
                {panel === "model" && (
                  <LaunchModelPanel
                    profile={chosen?.id ?? null} catalog={catalog}
                    form={launch} touched={launchTouched}
                    onChange={(patch) => { setLaunch((f) => ({ ...f, ...patch })); setLaunchTouched(true); }}
                    onReset={() => { setLaunchTouched(false); setLaunch(formFrom(defaults)); }} />
                )}
              </fieldset>
            </div>
  );

  return (
    <LaunchPage intro={<LaunchIntro portraits={{ profileId: chosen?.id, profiles: ordered ? ordered.filter((p) => !isClaudeProfile(p) || claudeOk) : null, selected: portraitSelected, disabled: locked, onSelect: (id) => { if (locked) return; setPortraitSelected(true); setProfile(id); setLaunch((f) => ({ ...f, model: "", reasoningEffort: "" })); setPanel(null); } }} provider={chosen ? profileProvider(chosen) : undefined} icon={<Sparkles size={24} />} title={t("agent-config.newAgent.welcome")} hint={t("agent-config.newAgent.welcomeHint")} />}>
      <LaunchDock>
        {projectReady?.outcome === "reused" && projectReady.id === project && <p role="status" className="mb-2 text-xs text-subtle">{t("agent-config.newAgent.projectReused", { project: projectReady.name })}</p>}
        {elsewhere && !locked && (
          <p className="mb-2 text-xs text-warn">
            {t("agent-config.newAgent.sameNameElsewhere", { host: scope.host(elsewhere.hostId)?.label ?? elsewhere.hostId, project: elsewhere.displayName })}
            <button type="button" className="ml-2 underline" onClick={() => { pendingSwitch.current = { hostId: elsewhere.hostId, projectId: elsewhere.projectId }; target.setHostId(elsewhere.hostId); }}>{t("agent-config.newAgent.switchHost")}</button>
          </p>
        )}
        {error && (
          <div role="alert" className="mb-3 max-h-24 overflow-y-auto rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            {failedStep === "director"
              ? t("agent-config.newAgent.directorFailed", { error }) + (start ? ` ${t("agent-config.newAgent.notStarted")}` : "")
              : failedStep === "appearance" ? t("agent-config.newAgent.appearanceFailed", { error })
              : failedStep === "start" ? t("agent-config.newAgent.startFailed", { error })
              : failedStep === "message" ? t("agent-config.newAgent.messageFailed", { error }) : error}
            {failedStep && createdAgent && (
              <button onClick={() => void openAgent(createdAgent, hostId)} className="ml-2 underline">{t("agent-config.newAgent.openAgent")}</button>
            )}
          </div>
        )}
        {!online && <p className="mb-2 text-xs text-warn">{t("hostPicker.unavailable", { host: hostLabel })}</p>}
        {claudeBlocked && <p className="mb-2 text-xs text-warn">{t("agent-config.newAgent.claudeUnsupported")}</p>}
        {claude && claudeOk && <ComponentNotice name={CLAUDE_RUNTIME_COMPONENT} hostId={hostId} className="mb-2" />}
        {runtimeBlocked && <p className="mb-2 text-xs text-warn">{t("modules.component.blocksStart", { component: t("modules.component.claude-runtime.name") })}</p>}

        <div ref={optionsRef} className="relative">
          {panel === "model" && detailsPanel}
          <fieldset disabled={locked} className="launch-settings mb-3" aria-label={t("agent-config.newAgent.settings")}>
            <div className="launch-setting-row launch-setting-model">
              <Popover width="w-72" triggerTitle={t("agent-config.newAgent.profile")} onOpen={() => setPanel(null)}
                trigger={<LaunchValue label={t("agent-config.newAgent.profile")} value={chosen?.name ?? unspecified} />}>
                {profileList}
              </Popover>
              {canLaunch && models.length > 0 ? <Menu title={t("composer.modelTitle")} onOpen={() => setPanel(null)}
                trigger={<LaunchValue label={t("composer.modelTitle")} value={shownModel} title={shownModelTitle} />} align="right"
                items={models.map((m) => ({ value: m.id, label: modelName(m.id, m.displayName, chosen?.id) }))}
                selected={model} onSelect={(model) => patchLaunch({ model, reasoningEffort: "" })} /> : (
                <button type="button" disabled={!canLaunch} data-launch-option="model" onClick={() => setPanel("model")}>
                  <LaunchValue label={t("composer.modelTitle")} value={shownModel} title={shownModelTitle} />
                </button>
              )}
              {canLaunch && efforts.length > 0 ? <Menu title={t("composer.effortTitle")} align="right" onOpen={() => setPanel(null)}
                trigger={<LaunchValue label={t("launch.reasoning")} value={effortLabel} />}
                items={efforts.map((e) => { const key = `composer.effort.${e}` as MessageKey; return { value: e, label: t(key) === key ? e : t(key) }; })}
                selected={effort} onSelect={(reasoningEffort) => patchLaunch({ reasoningEffort })} /> : (
                <button type="button" disabled={!canLaunch} onClick={() => setPanel("model")}><LaunchValue label={t("launch.reasoning")} value={effortLabel} /></button>
              )}
            </div>
            {canLaunch && (claude ? (
              <div className="launch-setting-row" title={t("agent-config.newAgent.claudeRulesHint")}>
                <div className="launch-inline-control">
                  <span className="text-subtle">{t("agent-config.newAgent.ruleSource")}</span>
                  <span>{t("agent-config.newAgent.profile")}</span>
                </div>
                <div className="launch-inline-control">
                  <span className="text-subtle">{t("agent-config.profile.claudeWrite")}</span>
                  <span>{t(chosen?.claudeAllowWrite === false ? "agent-config.profile.off" : "agent-config.profile.on")}</span>
                </div>
                <div className="launch-inline-control">
                  <span className="text-subtle">{t("agent-config.profile.claudeExec")}</span>
                  <span>{t(chosen?.claudeAllowExec === false ? "agent-config.profile.off" : "agent-config.profile.on")}</span>
                </div>
              </div>
            ) : (
              <div className="launch-setting-row">
                <Menu title={t("launch.sandbox")} onOpen={() => setPanel(null)}
                  trigger={<LaunchValue label={t("launch.sandbox")} value={t(`launch.sandbox.${launch.sandbox}`)} />}
                  items={SANDBOX_MODES.map((v) => ({ value: v, label: t(`launch.sandbox.${v}`) }))}
                  selected={launch.sandbox} onSelect={(sandbox) => patchLaunch({ sandbox })} />
                <div className="launch-inline-control">
                  <span className="shrink-0 text-subtle">{t("launch.approval")}</span>
                  <Segmented label={t("launch.approval")} value={launch.approvalPolicy}
                    options={[{ value: "never", label: t("agent-config.newAgent.approvalNever") }, { value: "on-request", label: t("agent-config.newAgent.approvalAsk") }]}
                    onChange={(approvalPolicy) => { setPanel(null); patchLaunch({ approvalPolicy }); }} />
                </div>
                <div className="launch-inline-control" title={workspace ? undefined : t("launch.workspaceOnly")}>
                  <span className="shrink-0 text-subtle">{t("launch.network")}</span>
                  <Toggle label={t("launch.network")} checked={network} disabled={!workspace}
                    onChange={(networkAccess) => { setPanel(null); patchLaunch({ networkAccess }); }} />
                </div>
              </div>
            ))}
            {canLaunch && workspace && (
              <div className="launch-setting-row launch-setting-single">
                <Popover width="w-full" triggerTitle={t("launch.writableRoots")} onOpen={() => setPanel(null)}
                  trigger={<LaunchValue label={t("launch.writableRoots")} value={launch.writableRoots.length ? launch.writableRoots.map(shortenHome).join(" · ") : t("launch.noRoots")} />}>
                  {() => <div className="p-2"><div className="mb-2 text-xs text-subtle">{t("launch.writableRootsHint")}</div><WritableRootsEditor roots={launch.writableRoots} onChange={(writableRoots) => patchLaunch({ writableRoots })} /></div>}
                </Popover>
              </div>
            )}
            <div className="launch-setting-row launch-setting-project">
              <div className="relative launch-project-anchor">
              <button type="button" data-launch-option="project" aria-expanded={panel === "project"}
                aria-controls={panel === "project" ? "agent-launch-options" : undefined} title={panelTitles.project}
                onClick={() => setPanel((current) => current === "project" ? null : "project")}>
                <LaunchValue label={t("agent-config.newAgent.project")} value={projectLabel} icon={projectChip} />
              </button>
                {panel === "project" && detailsPanel}
              </div>
              <label title={directorReason ?? t("agent-config.newAgent.asDirectorHint")} className={`launch-director ${!canDirect ? "opacity-50" : ""}`}>
                <span className="min-w-0 truncate">{t("agent-config.newAgent.asDirector")}{directorReason && <span className="text-subtle"> · {directorReason}</span>}</span>
                <input type="checkbox" disabled={!canDirect} checked={canDirect && asDirector} onChange={(e) => setAsDirector(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
              </label>
            </div>
            <div className="launch-name-row">
              <label className="launch-name">
                <span className="shrink-0 text-xs text-subtle">{t("agent-config.newAgent.name")}</span>
                <input value={name} maxLength={128} onChange={(e) => setName(e.target.value)} placeholder={t("agent-config.newAgent.namePlaceholder")}
                  className="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-subtle" />
              </label>
              <AgentAvatarPicker name={name} color={chosen ? profileColor(chosen) : null} value={avatar} picture={picture}
                onOpen={() => setPanel(null)} onChange={(value, nextPicture) => { if (!locked) { setAvatar(value); setPicture(nextPicture ?? null); } }} />
            </div>
          </fieldset>

        <LaunchComposer
          dragOver={dragOver}
          dragEvents={{
            onDragOver: (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); if (!locked) setDragOver(true); } },
            onDragLeave: () => setDragOver(false),
            onDrop: (e) => { setDragOver(false); if (e.dataTransfer.files.length) { e.preventDefault(); void addImages([...e.dataTransfer.files]); } },
          }}
          attachments={<LaunchAttachments images={images} disabled={locked} onRemove={(id) => setImages((previous) => previous.filter((image) => image.id !== id))} />}
          status={<>
            {imageLoading && <div role="status" className="mb-1 flex items-center gap-1 text-xs text-subtle"><LoaderCircle size={12} className="animate-spin" />{t("common.loading")}</div>}
            {imageError && <p role="alert" className="mb-1 text-xs text-danger">{imageError}</p>}
          </>}
          textarea={{
            ref: textareaRef, autoFocus: true, value: task, readOnly: locked,
            "aria-label": t("agent-config.newAgent.task"), placeholder: missing ?? t("agent-config.newAgent.taskPlaceholder"),
            onFocus: () => setPanel(null), onChange: (e) => setTask(e.target.value),
            onPaste: (e) => { const files = [...e.clipboardData.files]; if (files.some((file) => file.type.startsWith("image/"))) { e.preventDefault(); void addImages(files); } },
            onKeyDown: (e) => {
              if (e.nativeEvent.isComposing || e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              if (!disabled) void create();
            },
          }}
          hint={missing ?? t(hasTask ? "agent-config.newAgent.sendHint" : "agent-config.newAgent.emptyHint")}
          label={actionLabel} disabled={disabled} busy={busy} onSubmit={() => void create()} />
        <fieldset disabled={locked} className="launch-toolbar">
          <HostPicker value={hostId} onChange={target.setHostId} mode={target.mode} title={t("hostPicker.createTitle")} up />
          {locked ? <button type="button" disabled title={t("composer.attach")} className="px-1.5 py-0.5 text-muted"><Plus size={15} /></button> : <ComposerTools key={`${hostId}:${claude}`}
            canImages={canImages} imagePickBlocked={imageLoading ? t("common.loading") : imagePickBlocked ? t("remote.noAttachments") : null}
            canFiles={false} filesDisabledReason={t("chat.draft.afterCreate")} onMention={() => {}}
            onPickImages={() => void addImages()} skills={allSkills} skillsError={skillsError} onLoadSkills={loadSkills}
            skillRefDisabledReason={claude ? t("chat.draft.afterCreate") : null}
            onInsertSkill={(skill) => { setPickedSkills((previous) => [...previous, { name: skill.name, path: skill.path }]); setTask((previous) => appendToken(previous, `$${skill.name} `)); textareaRef.current?.focus(); }}
            plan={{ available: true, on: false, disabledReason: t("chat.draft.afterCreate"), set: () => {} }}
            goal={{ label: t("composer.tools.goal.unset"), disabledReason: t("chat.draft.afterCreate"), onClick: () => {} }}
            onManage={(tab) => useApp.getState().openSettings(tab)} />}
          {canLaunch && <>
            {claude && claudeModes && shownMode ? (
              <Menu<ClaudeLaunchMode> title={t("composer.permissionTitle")} onOpen={() => setPanel(null)}
                trigger={<span className={`trim-cap whitespace-nowrap ${shownMode === "bypassPermissions" ? "text-warn" : ""}`} data-testid="new-agent-claude-mode">{t(`composer.claudeMode.${shownMode}` as MessageKey)}</span>}
                items={claudeModes.map((m) => ({ value: m, label: t(`composer.claudeMode.${m}` as MessageKey), description: t(`composer.claudeModeHint.${m}` as MessageKey) }))}
                selected={shownMode} onSelect={(m) => !locked && setClaudeMode(m)}
                footer={<p className="px-2.5 py-1.5 text-[11px] text-subtle">{t("composer.claudeLaunch.footer")}</p>} />
            ) : claude ? <span className="px-1.5 py-0.5 text-xs text-muted">{t("agent-config.newAgent.claudeRules")}</span> : (
              <Menu title={t("composer.permissionTitle")} onOpen={() => setPanel(null)}
                trigger={<span className={`trim-cap whitespace-nowrap ${mode === "full" ? "text-warn" : ""}`}>{t(`composer.mode.${mode}` as MessageKey)}</span>}
                items={PERMISSION_MODES.map((m) => ({ value: m, label: t(`composer.mode.${m}` as MessageKey), description: t(`composer.modeHint.${m}` as MessageKey) }))}
                selected={mode} onSelect={(m) => m !== "custom" && patchLaunch(LAUNCH_FOR_MODE[m])} />
            )}
          </>}
          <div className="launch-profile-bar ml-auto flex min-w-0 items-center [&>div>button]:px-1 [&>span:not([aria-hidden])]:px-1" onClick={() => setPanel(null)}>
            {chosen ? <ProfileQuota profile={chosen.name} rateLimits={null} rateLimitsAt={null} sessionId={null} busy={busy} switcher={profileList} /> : (
              <Popover align="right" width="w-72" trigger={<><UserRound size={14} /><span>{unspecified}</span></>} triggerTitle={t("agent-config.newAgent.profile")}>
                {profileList}
              </Popover>
            )}
            <ChipDivider />
            {canLaunch && models.length > 0 ? (
              <ModelPicker profile={chosen?.name ?? null}
                models={models.map((m) => ({ model: m.id, displayName: m.displayName ?? m.id, description: m.id === defaultModel ? t("quick-chats.defaultProfile") : "" }))}
                current={model} label={shownModel} trigger={<span className="trim-cap max-w-40 truncate">{shownModel}</span>}
                triggerTitle={modelControlTitle(t("composer.modelTitle"), model, shownModel)} onOpen={() => setPanel(null)}
                onSelect={(value) => patchLaunch({ model: value, reasoningEffort: "" })} />
            ) : <button type="button" disabled={!canLaunch} data-launch-option="model" title={modelControlTitle(t("composer.modelTitle"), model, shownModel)}
              onClick={(e) => { e.stopPropagation(); setPanel((current) => current === "model" ? null : "model"); }}
              className="max-w-40 truncate rounded-md px-1 py-0.5 text-xs text-muted hover:bg-surface-2">{shownModel}</button>}
            {canLaunch && efforts.length > 0 && effort ? <EffortPicker effort={effort} efforts={efforts} onChange={(value) => patchLaunch({ reasoningEffort: value })} /> : (
              <button type="button" disabled={!canLaunch} title={t("composer.effortTitle")}
                onClick={(e) => { e.stopPropagation(); setPanel((current) => current === "model" ? null : "model"); }}
                className="whitespace-nowrap rounded-md px-1 py-0.5 text-xs text-muted hover:bg-surface-2">{effortLabel}</button>
            )}
          </div>
        </fieldset>
        </div>
      </LaunchDock>
    </LaunchPage>
  );
}
