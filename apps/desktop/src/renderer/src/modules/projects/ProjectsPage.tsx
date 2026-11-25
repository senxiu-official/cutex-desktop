// Projects page (DESIGN §4.18): project list + detail — presentation, directory, members /
// Director, project-layer MCP, memory, tasks. Membership and Director changes live only here, on the
// agent tab (the list + MemberPicker); 设置 only links to it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useArchivedAgents } from "../../lib/useArchivedAgents";
import { displayWidth, isBadgeLabelError, projectBadgeWidth } from "../../lib/badgeWidth";
import { BadgeTextInput } from "../../components/BadgeTextInput";
import { Archive, ArrowRightLeft, ChevronDown, Crown, FolderOpen, Pencil, Plus, Shield, StickyNote, UserMinus, Users, UserX } from "lucide-react";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import type { ProjectMemoryView } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { confirmDialog, openMenuFrom, type MenuEntry } from "../../lib/contextMenu";
import { shortenHome } from "../../lib/workspace";
import { onlineCount } from "../../lib/sidebar";
import { useSidebarModel } from "../../lib/sidebarView";
import { ExternalAgentsSection } from "../../components/settings/SecuritySettings";
import { sidebarOf, useApp } from "../../store";
import type { PageParams, ProjectTabProps } from "../slots";
import { ItemBoundary } from "../Outlet";
import type { ProjectTabEntry } from "../../lib/projectTabs";
import { useProjectTabs } from "../../lib/projectTabsView";
import { openProject } from "./projectNav";
import { OfflineSection } from "../../components/Sidebar";
import { AgentRowButton } from "../../components/AgentRows";
import { AgentList, type MemberControls } from "../../components/AgentList";
import { DelegationList } from "../../components/DelegationList";
import { ProjectMemoryList } from "../../components/ProjectMemory";
import { PROJECT_MEMORY_FEATURE } from "../../../../shared/projectMemory";
import { ServiceLine } from "../../components/ServiceLine";
import { PageBody } from "../../components/Page";
import { Button, FormFields, ScopeBaseline, SettingRow, SettingsGroup, Section, Select, TextInput } from "../../components/settings/Form";
import { ProjectColorPicker } from "../../components/ProjectColorPicker";
import { ProjectIconPicker } from "../../components/ProjectIconPicker";
import { projectIcon } from "../../lib/projectIcons";
import { autoBadge, CREATE_ROOT_FEATURE, createProject, independentAgents, OPTIONAL_DIRECTOR_FEATURE, ProjectDirectoryError, slugifyProjectId } from "../../lib/projectCreate";
import type { ProjectIconChoice } from "../../lib/projectIcons";
import { setProjectIconOn, useProjectIcons } from "../../lib/projectIconSync";
import { pickDirectory, useFolderPickBlocked } from "../../lib/remoteMode";
import { workspaceRootErrorKey } from "../../lib/projectRoot";
import { services } from "../app";
import { isTerminalRotation, OWNER_ROTATION_FEATURE } from "../../../../shared/directorRotation";
import { DirectorRotationDialog } from "./DirectorRotationDialog";
import { MemberPicker, type PickerMode } from "./MemberPicker";
import { ProjectRootEditor } from "./ProjectRootEditor";
import { HostPicker } from "../../components/HostPicker";
import { TargetHostContext, useTargetApi, useTargetFeatures, useTargetHostId, useTargetIsFocus, useTargetIsRemote, useTargetSidebar } from "../../lib/targetHost";
import { rememberCreateHost, useCreateHost, type CreateHost } from "../../lib/useCreateHost";
import { hostKey } from "../../lib/hostKeys";
import { useHostData, useHostScope } from "../../lib/useHostScope";
import { loadProjectRotation, useProjectRotation } from "./rotationStore";
import { useUiPrefs } from "../../lib/prefs";
import { editProjectRemark } from "../../lib/projectMenus";
import { archiveProject, confirmProjectArchive } from "../../lib/projectArchive";
import { isOwnerFeatures } from "../../../../shared/users";
import type { AgentRow } from "../../lib/sidebar";
import { operatorIds, operatorSupported, setProjectOperator } from "../../lib/projectOperators";
import { captureHostAction } from "../../lib/hostSwitch";
import { EntityMention } from "../../components/EntityIcon";
import { tNodes } from "../../lib/textNodes";
import { AllProjects } from "./AllProjects";
import { ProjectRail } from "./ProjectRail";
import { splitProjectTabs } from "./projectTable";
import { noteProjectOpened } from "./recentProjects";
import { useProjectFacts, type HostProjectRef } from "./useProjectFacts";

/** Pseudo project id for the "new project" form. */
const NEW = "__new__";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Director choice in the 新建 form: none, a new agent (opens 新建智能体 next), or an existing agent id. */
const DIRECTOR_NONE = "";
const DIRECTOR_NEW = "__new_director__";

/** The 新建 form; multi-host (P1 step 2c): a host picker on top (★ Q10 default), the project and its Director come from / go to that host. */
function NewProject() {
  const target = useCreateHost();
  return (
    <TargetHostContext.Provider value={target.hostId}>
      <FormFields><NewProjectForm key={target.hostId} target={target} /></FormFields>
    </TargetHostContext.Provider>
  );
}

function NewProjectForm({ target }: { target: CreateHost }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const remote = useTargetIsRemote();
  const sidebar = useTargetSidebar();
  const refreshHostSidebar = useApp((s) => s.refreshHostSidebar);
  const features = useTargetFeatures();
  const optional = features.has(OPTIONAL_DIRECTOR_FEATURE);
  // cutex creates a directory that doesn't exist yet (only with create_project, i.e. `optional`).
  const createRoot = optional && features.has(CREATE_ROOT_FEATURE);
  const hostId = target.hostId;
  const hostLabel = target.look?.label ?? hostId;
  const online = target.look?.indicator.status === "online";
  const [name, setName] = useState("");
  const [badge, setBadge] = useState("");
  const [badgeComposing, setBadgeComposing] = useState(false);
  const [color, setColor] = useState<string>("cyan");
  /** 项目图标 (same picker as 项目设置), written to the device-local pref once the project exists. */
  const [icon, setIcon] = useState<ProjectIconChoice | null>(null);
  const [dir, setDir] = useState("");
  const [director, setDirector] = useState(DIRECTOR_NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Older cutex: the project exists but its directory could not be set. */
  const [partial, setPartial] = useState<string | null>(null);
  const pickBlocked = useFolderPickBlocked();
  // Only agents outside every project can direct one (cutex: director_already_has_active_project).
  const agents = independentAgents(sidebar).map((a) => ({ ...a, entity: { kind: "agent" as const, id: a.value, name: a.label } }));
  const badgeText = badge.trim() || autoBadge(name, projectBadgeWidth(features));
  const newDirector = optional && director === DIRECTOR_NEW;
  const ready = online && !!name.trim() && !busy && !badgeComposing && displayWidth(badge.trim()) <= projectBadgeWidth(features) && (optional || !!director);
  const create = async () => {
    if (badgeComposing || displayWidth(badge.trim()) > projectBadgeWidth(features)) return;
    setError(null);
    setPartial(null);
    setBusy(true);
    const id = slugifyProjectId(name);
    try {
      const existing = director && director !== DIRECTOR_NEW ? director : null;
      await createProject(api, { id, presentation: { display_name: name.trim(), badge_label: badgeText, color }, workspaceRoot: dir.trim() || null, director: existing, createDirectory: createRoot }, optional);
      if (icon) void setProjectIconOn(hostId, id, icon);
      rememberCreateHost(hostId);
      // The new Director agent is created on the same host (its form opens preset to it).
      if (newDirector) services.ui.openPage("agent-config.newAgent", { project: id, director: "1", host: hostId });
      else {
        // The page lists every host of the scope: the new project opens in place.
        await refreshHostSidebar(hostId);
        openProject(id, undefined, hostId);
      }
    } catch (e) {
      if (e instanceof ProjectDirectoryError) {
        if (icon) void setProjectIconOn(hostId, e.projectId, icon);
        await refreshHostSidebar(hostId);
        setPartial(e.projectId);
      }
      // A refused directory (create_project's workspace_root, or the follow-up set_workspace_root).
      const rootError = workspaceRootErrorKey(e);
      setError(rootError ? t(rootError) : isBadgeLabelError(e) ? t(features.has("project-badge-wide") ? "projects.badgeHintWide" : "projects.badgeHint") : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const directorOptions = optional
    ? [{ value: DIRECTOR_NONE, label: t("projects.directorNone") }, { value: DIRECTOR_NEW, label: t("projects.directorNew") }, ...agents]
    : [{ value: DIRECTOR_NONE, label: "—" }, ...agents];
  return (
    <PageBody>
      {error && (
        <div className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {partial ? t("projects.directoryFailed", { error }) : error}
          {partial && (
            <button onClick={() => openProject(partial, "settings", hostId)} className="press ml-2 rounded-sm underline">
              {t("projects.openSettings")}
            </button>
          )}
        </div>
      )}
      <Section title={t("projects.basics")} hint={<>{t(optional ? "projects.newHintOptional" : "projects.newHint")}<span className="mt-1 block" data-form-host="">{t("hostPicker.opensOther", { host: hostLabel })}</span></>} actions={<Button primary disabled={!ready} onClick={() => void create()}>{t("projects.create")}</Button>}>
        {target.mode !== "none" && (
          <SettingRow
            agents="none"
            source="local"
            label={t("hostPicker.label")}
            hint={!online ? <span className="text-warn">{t("hostPicker.unavailable", { host: hostLabel })}</span> : undefined}
          >
            <HostPicker value={hostId} onChange={target.setHostId} mode={target.mode} title={t("hostPicker.createTitle")} />
          </SettingRow>
        )}
        <SettingRow agents="none" source={["host", "local"]} label={t("projects.name")} info={t("projects.icon.hint")}>
          <div className="flex w-full min-w-0 max-w-sm items-center gap-2" data-project-name-field="">
            <span className="shrink-0"><ProjectIconPicker value={icon} onIcon={setIcon} badge={badgeText || "?"} color={color} onColor={setColor} /></span>
            <div className="min-w-0 flex-1"><TextInput width="w-full" value={name} onChange={setName} label={t("projects.name")} /></div>
          </div>
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("projects.badge")} info={t(features.has("project-badge-wide") ? "projects.badgeHintWide" : "projects.badgeHint")}>
          <BadgeTextInput value={badge} onChange={setBadge} maxWidth={projectBadgeWidth(features)} onCompositionChange={setBadgeComposing} aria-label={t("projects.badge")} placeholder={autoBadge(name, projectBadgeWidth(features))} className="w-20 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent" />
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("projects.color")} info={t("projects.colorHint")}>
          <ProjectColorPicker value={color} onChange={setColor} preview={{ badge: badgeText || "?", icon }} />
        </SettingRow>
        <SettingRow agents="next" source="host" label={t("projects.directory")} hint={t(createRoot ? "projects.directoryCreateHint" : "projects.directoryNewHint")}>
          <div className="flex w-full min-w-0 max-w-xl flex-wrap items-center gap-1.5" data-project-directory-field="">
            <div className="min-w-0 flex-1 basis-48"><TextInput width="w-full" mono value={dir} onChange={setDir} label={t("projects.directory")} placeholder={remote ? "/home/me/project" : "D:\\path\\to\\project"} /></div>
            <Button
              disabled={pickBlocked}
              onClick={() =>
                void pickDirectory(dir.trim() || undefined, hostId).then((picked) => {
                  if (picked) setDir(picked);
                })
              }
            >
              <FolderOpen size={13} className="mr-1 inline" />
              {t("agent-config.newAgent.pickFolder")}
            </Button>
          </div>
        </SettingRow>
        <SettingRow agents="hostNowRuntimeNext" source="host" label={t("sidebar.director")} hint={optional ? t(newDirector ? "projects.directorNewHint" : "projects.directorHint") : t("projects.directorLegacyHint")}>
          <Select value={director} options={directorOptions} onChange={setDirector} />
        </SettingRow>
        {!optional && agents.length === 0 && <p className="py-2 text-xs text-warn">{t("projects.noIndependent")}</p>}
      </Section>
    </PageBody>
  );
}

/** A module's tab body (§21), in its own error boundary. */
function ModuleTabBody({ entry, hostId, projectId }: { entry: ProjectTabEntry; hostId: string; projectId: string }) {
  const Body = entry.item.Body;
  return (
    <ItemBoundary moduleId={entry.moduleId} resetKey={`${hostId}|${projectId}`}>
      <Body hostId={hostId} projectId={projectId} />
    </ItemBoundary>
  );
}

/** One module's phrase of the overview count line (its `useSummary` hook), a link to its tab. */
function TabSummary({ entry, props, onOpen }: { entry: ProjectTabEntry; props: ProjectTabProps; onOpen(): void }) {
  const text = entry.item.useSummary!(props);
  if (!text) return null;
  // The "·" separators come from CSS, so a phrase that says nothing leaves no stray dot.
  return (
    <span className="before:mr-1.5 before:content-['·'] first:before:content-none">
      <button onClick={onOpen} className="press rounded-sm hover:text-foreground hover:underline">
        {text}
      </button>
    </span>
  );
}

/** 「3 个成果 · 2 个服务」 under the remark: the module tabs that have something to say. */
function TabSummaries({ tabs, hostId, projectId, onOpen }: { tabs: { tab: string; entry: ProjectTabEntry | null }[]; hostId: string; projectId: string; onOpen(tab: string): void }) {
  const props = useMemo(() => ({ hostId, projectId }), [hostId, projectId]);
  const items = tabs.filter((x): x is { tab: string; entry: ProjectTabEntry } => !!x.entry?.item.useSummary);
  if (!items.length) return null;
  return (
    <div className="-mt-2 mb-4 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-subtle empty:hidden" data-project-summaries="">
      {items.map((x) => (
        <ItemBoundary key={x.entry.item.id} moduleId={x.entry.moduleId} resetKey={`${hostId}|${projectId}`}>
          <TabSummary entry={x.entry} props={props} onOpen={() => onOpen(x.tab)} />
        </ItemBoundary>
      ))}
    </div>
  );
}

/** One project of the target host (TargetHostContext: the project's host, which may not be the focus host). */
function ProjectDetail({ project, tab, rotate, pick }: { project: ProjectSummary; tab: string; rotate: boolean; pick: PickerMode | null }) {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const isFocus = useTargetIsFocus();
  const api = useTargetApi();
  const remote = useTargetIsRemote();
  const features = useTargetFeatures();
  const sidebar = useTargetSidebar();
  const refreshHostSidebar = useApp((s) => s.refreshHostSidebar);
  const refreshSidebar = () => refreshHostSidebar(hostId);
  const setTab = (next: string) => openProject(project.project_id, next, hostId);
  // Core tabs + `project.tab` items of modules this project's host supports (§21).
  const tabs = useProjectTabs(hostId);
  // A tab no longer offered (module off, host without the capability; also while capabilities load)
  // shows the overview; the param stays, so the tab comes back when it is offered again.
  const current = tabs.find((x) => x.tab === tab) ?? tabs[0]!;
  const active = current.tab;
  const moduleTab = current.entry;
  const [name, setName] = useState(project.presentation.display_name);
  const [badge, setBadge] = useState(project.presentation.badge_label);
  const [badgeComposing, setBadgeComposing] = useState(false);
  const [color, setColor] = useState(project.presentation.color);
  const [colorSaving, setColorSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allServices = useHostData(hostId)?.services;
  const projectServices = useMemo(() => (allServices ?? []).filter((s) => s.projectId === project.project_id), [allServices, project.project_id]);
  const [memory, setMemory] = useState<ProjectMemoryView | null | undefined>(undefined);
  // The latest read wins (a reload after an edit can overlap the one a new presentation started).
  const memoryRead = useRef(0);
  const reloadMemory = useCallback(() => {
    const n = ++memoryRead.current;
    api.projectMemory(project.project_id).then(
      (m) => n === memoryRead.current && setMemory(m),
      () => n === memoryRead.current && setMemory(null),
    );
  }, [api, project.project_id]);
  const model = useSidebarModel();
  const team = useMemo(() => {
    const group = model.groups.find((g) => g.kind === "project" && g.id === project.project_id);
    return { online: group?.online ?? [], offline: group?.offline ?? [] };
  }, [model, project.project_id]);
  const waiting = team.online.filter((r) => r.status === "needsInput");
  const [mcp, setMcp] = useState<{ servers: Record<string, unknown> } | null | undefined>(undefined);
  const id = project.project_id;
  const { projectRemarks } = useUiPrefs();
  const projectIcons = useProjectIcons();
  const remark = projectRemarks[hostKey(hostId, id)] ?? "";
  const editRemark = () => void editProjectRemark(id, hostId, project.presentation.display_name, t);

  // A new saved presentation (保存, a picker colour, another device) replaces only the fields the
  // form hasn't changed, so a picked colour never wipes a half-typed name and 保存 never sends a stale
  // colour back. Another project resets the whole form.
  const saved = useRef({ id, presentation: project.presentation });
  useEffect(() => {
    const prev = saved.current;
    const next = project.presentation;
    const same = prev.id === id;
    if (!same) setBadgeComposing(false);
    saved.current = { id, presentation: next };
    setName((v) => (same && v !== prev.presentation.display_name ? v : next.display_name));
    setBadge((v) => (same && v !== prev.presentation.badge_label ? v : next.badge_label));
    setColor((v) => (same && v !== prev.presentation.color ? v : next.color));
    setError(null);
    reloadMemory();
    api.projectMcp(id).then(setMcp, () => setMcp(null));
  }, [api, id, project.presentation, reloadMemory]);

  const members = useMemo(() => {
    const all = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
    return all.filter((s) => sidebar?.hostRows[s.cutexSessionId]?.projectId === id && s.lifecycle !== "retired");
  }, [sidebar, id]);
  const [operatorWorkspace, setOperatorWorkspace] = useState<Awaited<ReturnType<typeof api.projectRead>> | null>(null);
  const operatorReadEpoch = useRef(0);
  const [operatorBusy, setOperatorBusy] = useState<string | null>(null);
  const operatorWriteEpoch = useRef(0);
  useEffect(() => { operatorWriteEpoch.current++; setOperatorBusy(null); }, [hostId, id, api]);
  const operatorProjection = JSON.stringify(sidebar?.projectOperators?.[id] ?? null);
  useEffect(() => {
    const epoch = ++operatorReadEpoch.current;
    const currentHost = captureHostAction(hostId);
    setOperatorWorkspace(null);
    void api.projectRead(id).then((workspace) => {
      if (operatorReadEpoch.current === epoch && currentHost() && workspace.project_id === id) setOperatorWorkspace(workspace);
    }, () => {});
    return () => { operatorReadEpoch.current++; };
  }, [api, hostId, id, project.project_revision, project.authority_epoch, operatorProjection]);
  const hasOperators = operatorSupported(operatorWorkspace);
  const grantedOperators = operatorIds(operatorWorkspace);
  const memberIds = useMemo(() => new Set(members.map((s) => s.cutexSessionId)), [members]);
  const operatorGroups = [
    { role: "director", title: t("sidebar.director"), match: (row: AgentRow) => row.id === project.director_cutex_session_id },
    { role: "operator", title: t("projects.operators" as MessageKey), match: (row: AgentRow) => row.id !== project.director_cutex_session_id && memberIds.has(row.id) && grantedOperators.has(row.id) },
    { role: "member", title: t("projects.membersTitle"), match: (row: AgentRow) => row.id !== project.director_cutex_session_id && !(memberIds.has(row.id) && grantedOperators.has(row.id)) },
  ];
  const optional = features.has(OPTIONAL_DIRECTOR_FEATURE);
  // users: a non-owner connection may only look (no membership / Director changes; lib/projectMenus).
  const owner = isOwnerFeatures(features);
  const canManageOperators = owner && hasOperators && operatorWorkspace?.access_role === "human_management" &&
    operatorWorkspace.lifecycle === "active" && !!operatorWorkspace.director &&
    operatorWorkspace.authority_epoch === project.authority_epoch &&
    operatorWorkspace.director.cutex_session_id === project.director_cutex_session_id;
  const changeOperator = async (row: AgentRow, grant: boolean) => {
    if (!canManageOperators || operatorBusy || !memberIds.has(row.id) || row.id === project.director_cutex_session_id) return;
    const epoch = ++operatorWriteEpoch.current;
    const currentHost = captureHostAction(hostId);
    setOperatorBusy(row.id);
    setError(null);
    try {
      await setProjectOperator(hostId, id, row.id, grant);
    } catch (e) {
      if (operatorWriteEpoch.current === epoch && currentHost()) setError(errorText(e));
    } finally {
      if (operatorWriteEpoch.current === epoch && currentHost()) {
        const readEpoch = ++operatorReadEpoch.current;
        const workspace = await api.projectRead(id).catch(() => null);
        if (operatorWriteEpoch.current === epoch && currentHost()) {
          if (operatorReadEpoch.current === readEpoch) setOperatorWorkspace(workspace?.project_id === id ? workspace : null);
          setOperatorBusy(null);
        }
      }
    }
  };
  // 更换 to an existing member: cutex rotate_director (part of owner-rotation; any host of the scope).
  const switchOn = features.has(OWNER_ROTATION_FEATURE);
  const hasDirector = !!project.director_cutex_session_id;
  const expected = { authorityEpoch: project.authority_epoch, projectRevision: project.project_revision ?? 0 };
  // 轮换主管 (owner-rotation): the dialog, opened here or from the agent menu (param rotate=1).
  // The rotation store follows the focus host only (modules/projects/rotationStore).
  const rotationOn = isFocus && features.has(OWNER_ROTATION_FEATURE);
  const rotation = useProjectRotation(id);
  const [rotating, setRotating] = useState(false);
  const directorSession = useMemo(() => {
    const sid = project.director_cutex_session_id;
    return sid ? ([...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === sid) ?? null) : null;
  }, [sidebar, project.director_cutex_session_id]);
  useEffect(() => {
    if (rotationOn) void loadProjectRotation(id);
  }, [rotationOn, id]);
  useEffect(() => {
    if (rotate && rotationOn && hasDirector) setRotating(true);
  }, [rotate, rotationOn, hasDirector]);
  const closeRotation = () => {
    setRotating(false);
    if (rotate) openProject(id, tab, hostId);
  };
  const rotationRunning = rotationOn && !!rotation && !isTerminalRotation(rotation.state);

  // 添加成员 / 指定·更换 Director picker (param pick=add|director from menus elsewhere).
  const canPickDirector = owner && (hasDirector ? switchOn : optional);
  const [picker, setPicker] = useState<PickerMode | null>(null);
  useEffect(() => {
    if (pick === "add" && owner) setPicker("add");
    else if (pick === "director" && canPickDirector) setPicker("director");
  }, [pick, owner, canPickDirector]);
  const closePicker = () => {
    setPicker(null);
    if (pick) openProject(id, tab, hostId);
  };

  /** The project as the host snapshot has it now (its revision moves with every mutation). */
  const fresh = () => {
    const now = sidebarOf(useApp.getState(), hostId)?.projects?.projects.find((p) => p.project_id === id) ?? project;
    return { authorityEpoch: now.authority_epoch, projectRevision: now.project_revision ?? 0 };
  };
  /** One mutation against the current revision, then the host's sidebar again; throws cutex's refusal. */
  const mutate = async (op: Parameters<typeof api.projectMutation>[2]) => {
    try {
      await api.projectMutation(id, fresh(), op);
    } finally {
      await refreshSidebar();
    }
  };
  const nameOf = (sid: string) => [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === sid)?.displayName ?? sid;
  const addMembers = async (ids: string[]) => {
    const failed: Record<string, string> = {};
    // One at a time: each add advances the project revision the next one is fenced with.
    for (const sid of ids) {
      try {
        await mutate({ kind: "add_member", cutex_session_id: sid });
      } catch (e) {
        failed[sid] = errorText(e);
      }
    }
    return failed;
  };
  /** 设为 Director: assign (no Director) or switch (rotate_director, after a confirm naming its consequences). */
  const makeDirector = async (row: Pick<AgentRow, "id" | "name">): Promise<boolean> => {
    // The cached roster can be loading after a grant; always check the canonical successor role.
    const roster = await api.projectRead(id);
    if (operatorIds(roster).has(row.id)) {
      setError(t("projects.operatorSuccessor", { name: row.name }));
      return false;
    }
    const current = project.director_cutex_session_id;
    if (current) {
      const ok = await confirmDialog(t("projects.switchDirectorConfirm", { from: nameOf(current), to: row.name }), false, { ok: t("projects.switchDirectorOk"), cancel: t("projects.picker.cancel") });
      if (!ok) return false;
      await mutate({ kind: "rotate_director", successor_cutex_session_id: row.id });
    } else {
      await mutate({ kind: "assign_director", cutex_session_id: row.id });
    }
    return true;
  };
  // Armed in place (the row's `armed`): a member is added back from the picker; the agent itself stays.
  const detachOne = async (row: Pick<AgentRow, "id" | "name">) => {
    await run(() => api.projectMutation(id, fresh(), { kind: "detach_member", cutex_session_id: row.id }));
  };
  const memberControls: MemberControls | undefined = owner
    ? {
        directorId: project.director_cutex_session_id ?? null,
        detach: (sid) => mutate({ kind: "detach_member", cutex_session_id: sid }),
        rowMenu: (row): MenuEntry[] => {
          const isDirector = row.id === project.director_cutex_session_id;
          if (isDirector) {
            return [
              // 轮换 (handoff + a new successor; the same item as the agent menu's, which then leaves it out).
              rotationOn && { label: t("projects.rotation.menu"), icon: <ArrowRightLeft size={14} />, onSelect: () => setRotating(true) },
              switchOn && { label: t("projects.changeDirector"), icon: <Crown size={14} />, disabled: rotationRunning, title: rotationRunning ? t("projects.directorRotating") : undefined, onSelect: () => setPicker("director") },
              optional && {
                label: t("projects.clearDirector"),
                icon: <UserX size={14} />,
                danger: true,
                disabled: rotationRunning,
                title: rotationRunning ? t("projects.clearDirectorRotating") : undefined,
                armed: t("projects.clearDirectorArmed", { name: row.name }),
                onSelect: () => void run(() => api.projectMutation(id, fresh(), { kind: "clear_director" })),
              },
              { label: t("projects.detach"), icon: <UserMinus size={14} />, disabled: true, title: t("projects.detachDirectorBlocked"), onSelect: () => {} },
            ].filter(Boolean) as MenuEntry[];
          }
          const canMake = hasDirector ? switchOn : optional;
          return [
            canManageOperators && memberIds.has(row.id) && {
              label: t((grantedOperators.has(row.id) ? "projects.revokeOperator" : "projects.setOperator") as MessageKey),
              icon: <Shield size={14} />,
              disabled: !!operatorBusy,
              onSelect: () => void changeOperator(row, !grantedOperators.has(row.id)),
            },
            canMake && {
              label: t("projects.setDirector"),
              icon: <Crown size={14} />,
              disabled: rotationRunning,
              title: rotationRunning ? t("projects.directorRotating") : undefined,
              onSelect: () => void makeDirector(row).catch((e) => setError(errorText(e))),
            },
            { label: t("projects.detach"), icon: <UserMinus size={14} />, danger: true, armed: t("projects.detachArmed", { name: row.name }), onSelect: () => void detachOne(row) },
          ].filter(Boolean) as MenuEntry[];
        },
      }
    : undefined;
  const directorButton = canPickDirector && (
    <Button disabled={rotationRunning} onClick={() => setPicker("director")}>
      <Crown size={13} className="mr-1 inline" />
      {t(hasDirector ? "projects.changeDirector" : "projects.pickDirector")}
    </Button>
  );

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refreshSidebar();
    } catch (e) {
      setError(isBadgeLabelError(e) ? t(features.has("project-badge-wide") ? "projects.badgeHintWide" : "projects.badgeHint") : errorText(e));
    }
  };
  // A colour from the icon picker applies at once (with the *saved* name / badge, so half-typed
  // form edits don't ride along); the rest of the form keeps its explicit 保存.
  const applyColor = (c: string) => {
    if (colorSaving) return;
    setColorSaving(true);
    // Retain the current colour until the host accepts it (older hosts may reject RGB).
    void run(async () => {
      await api.projectPresentation(id, { authorityEpoch: project.authority_epoch, presentationRevision: project.presentation.revision ?? 0 }, { display_name: project.presentation.display_name, badge_label: project.presentation.badge_label, color: c });
      if (saved.current.id === id) setColor(c);
    }).finally(() => setColorSaving(false));
  };
  const dirty = name !== project.presentation.display_name || badge !== project.presentation.badge_label || color !== project.presentation.color;
  const displayName = project.presentation.display_name;

  // Archive is restorable (confirm by risk): one plain dialog, no typed name. With a live Director it offers
  // 「同时归档主管」 (lib/projectArchive: project first, then the Director).
  const archive = async () => {
    const director = directorSession && directorSession.lifecycle !== "retired" ? directorSession : null;
    const answer = await confirmProjectArchive({ displayName, memberCount: members.length, director, hostId, t });
    if (!answer.ok) return;
    setError(null);
    try {
      await archiveProject({ hostId, projectId: id, displayName, expected, directorId: director?.cutexSessionId ?? null, withDirector: answer.withDirector, t });
    } catch (e) {
      setError(isBadgeLabelError(e) ? t(features.has("project-badge-wide") ? "projects.badgeHintWide" : "projects.badgeHint") : errorText(e));
    }
  };

  return (
    <PageBody>
      {error && <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {rotationRunning && rotation && !rotating && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
          <ArrowRightLeft size={13} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">{tNodes(t, "projects.rotation.banner", { from: <EntityMention entity={{ kind: "agent", id: rotation.predecessor.cutexSessionId, name: rotation.predecessor.name }}>{rotation.predecessor.name}</EntityMention>, to: rotation.successorSpec.name, state: t(`projects.rotation.state.${rotation.state}` as MessageKey) })}</span>
          <button onClick={() => setRotating(true)} className="press shrink-0 rounded-sm text-accent hover:underline">
            {t("projects.rotation.view")}
          </button>
        </div>
      )}
      {rotating && <DirectorRotationDialog project={project} director={directorSession} onClose={closeRotation} />}

      <ProjectTabRow tabs={tabs} active={active} onTab={setTab} />
      {active === "overview" && (
        <>
      {/* 本机备注 (device-local prefs; edited here or from the sidebar project menu). */}
      <div className="mb-4 flex min-w-0 items-center gap-1.5 text-xs text-subtle" data-project-remark="">
        <StickyNote size={13} className="shrink-0" aria-label={t("remark.label")} />
        {remark ? (
          <>
            <span className="min-w-0 truncate" title={`${remark}\n${t("remark.tooltip")}`}>{remark}</span>
            <button onClick={editRemark} title={t("remark.edit")} aria-label={t("remark.edit")} className="press-icon shrink-0 rounded p-0.5 hover:bg-surface-2 hover:text-foreground">
              <Pencil size={12} />
            </button>
          </>
        ) : (
          <button onClick={editRemark} title={t("remark.tooltip")} className="press shrink-0 rounded-sm hover:text-foreground hover:underline">
            {t("remark.add")}
          </button>
        )}
      </div>
      <TabSummaries tabs={tabs} hostId={hostId} projectId={id} onOpen={setTab} />
      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold">{t("projects.needsYou")}</h3>
          {waiting.length > 0 && (
            <div className="mb-3 rounded-xl border border-warn/40 bg-warn/5 px-2 py-1">
              {waiting.map((row) => (
                <AgentRowButton key={row.id} row={row} />
              ))}
            </div>
          )}
          <DelegationList projectId={id} only={["needsYou"]} />
          <h3 className="mt-6 mb-2 flex items-center text-sm font-semibold">
            {t("projects.activeTasks")}
            <button onClick={() => setTab("tasks")} className="press ml-auto rounded-sm text-xs font-normal text-accent hover:underline">
              {t("projects.allTasks")} →
            </button>
          </h3>
          <DelegationList projectId={id} only={["active"]} limit={5} />
        </div>
        <aside className="min-w-0">
          <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold">
            <span>{t("projects.team")}</span> <span className="font-normal text-subtle">{t("projects.teamOnline", { online: onlineCount(team), total: team.online.length + team.offline.length })}</span>
            {canPickDirector && (
              <button
                onClick={() => setPicker("director")}
                disabled={rotationRunning}
                title={t(hasDirector ? "projects.changeDirector" : "projects.pickDirector")}
                aria-label={t(hasDirector ? "projects.changeDirector" : "projects.pickDirector")}
                className="press-icon ml-auto rounded p-1 font-normal text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
              >
                <Crown size={13} />
              </button>
            )}
            {owner && (
              <button onClick={() => setPicker("add")} title={t("projects.addMember")} aria-label={t("projects.addMember")} className={`${canPickDirector ? "" : "ml-auto "}press-icon rounded p-1 font-normal text-subtle hover:bg-surface-2 hover:text-foreground`}>
                <Plus size={13} />
              </button>
            )}
          </h3>
          <div className="mb-4 rounded-xl border border-border bg-surface px-1 py-1">
            {hasOperators ? operatorGroups.map((group) => {
              const online = team.online.filter(group.match);
              const offline = team.offline.filter(group.match);
              if (group.role !== "operator" && online.length + offline.length === 0) return null;
              return (
                <div key={group.role} data-project-role={group.role}>
                  <h4 className="px-2 pt-2 pb-1 text-xs text-subtle">{group.title}</h4>
                  {online.map((row) => <AgentRowButton key={row.id} row={row} />)}
                  <OfflineSection rows={offline} searching={false} onAll={() => setTab("agents")} hostId={isFocus ? undefined : hostId} />
                  {group.role === "operator" && online.length + offline.length === 0 && <p className="px-2 py-2 text-xs text-subtle">{t("projects.operatorsEmpty" as MessageKey)}</p>}
                </div>
              );
            }) : <>
            {team.online.map((row) => (
              <AgentRowButton key={row.id} row={row} />
            ))}
            <OfflineSection rows={team.offline} searching={false} onAll={() => setTab("agents")} hostId={isFocus ? undefined : hostId} />
            </>}
            {team.online.length + team.offline.length === 0 && <p className="px-2 py-2 text-xs text-subtle">{t("projects.noMembers")}</p>}
          </div>
          {projectServices.length > 0 && (
            <>
              <h3 className="mb-2 text-sm font-semibold">{t("projects.services")}</h3>
              <div className="mb-4 rounded-xl border border-border bg-surface px-3">
                {projectServices.map((s) => (
                  <ServiceLine key={s.slug} s={s} onError={setError} hostId={hostId} />
                ))}
              </div>
            </>
          )}
          <button onClick={() => setTab("memory")} className="press mb-2 block w-full rounded-xl border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2/60">
            <div className="text-sm">{t("projects.memory")}</div>
            <div className="text-xs text-subtle">{memory ? t("projects.memoryCount", { n: memory.entries.length }) : "…"}</div>
          </button>
          <button onClick={() => setTab("settings")} className="press block w-full rounded-xl border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2/60">
            <div className="text-sm">{t("projects.mcp")}</div>
            <div className="truncate text-xs text-subtle">{mcp ? Object.keys(mcp.servers).join(" · ") || t("projects.mcpNone") : "…"}</div>
          </button>
        </aside>
      </div>
        </>
      )}
      {moduleTab && <ModuleTabBody entry={moduleTab} hostId={hostId} projectId={id} />}
      {active === "agents" && (
        <AgentList
          key={id}
          groupId={id}
          variant="page"
          members={memberControls}
          renderHeader={(tabs) => (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
              {tabs}
              {owner && (
                <span className="ml-auto flex gap-1.5">
                  {directorButton}
                  <Button primary onClick={() => setPicker("add")}>
                    <Plus size={13} className="mr-1 inline" />
                    {t("projects.addMember")}
                  </Button>
                </span>
              )}
            </div>
          )}
        />
      )}
      {picker && (
        <MemberPicker
          mode={picker}
          project={project}
          onClose={closePicker}
          onAddFirst={() => setPicker("add")}
          onRotate={rotationOn && hasDirector ? () => {
            setPicker(null);
            setRotating(true);
          } : null}
          onAdd={addMembers}
          onPickDirector={makeDirector}
        />
      )}
      {active === "tasks" && <DelegationList projectId={id} />}
      {active === "memory" && (
        <>
      <Section title={t("projects.memory")} hint={memory ? `${t("projects.memoryHint")} · ${shortenHome(memory.dir)}` : t("projects.memoryHint")}>
        <SettingsGroup agents="none" source="host">
          <ProjectMemoryList hostId={hostId} projectId={id} memory={memory} editable={features.has(PROJECT_MEMORY_FEATURE)} onChanged={reloadMemory} />
        </SettingsGroup>
      </Section>

        </>
      )}
      {active === "settings" && (
        <ScopeBaseline source="host">
      <Section
        title={t("projects.basics")}
        actions={
          dirty && (
            <Button
              primary
              disabled={badgeComposing || displayWidth(badge.trim()) > projectBadgeWidth(features)}
              onClick={() =>
                !badgeComposing && displayWidth(badge.trim()) <= projectBadgeWidth(features) && void run(() =>
                  api.projectPresentation(id, { authorityEpoch: project.authority_epoch, presentationRevision: project.presentation.revision ?? 0 }, { display_name: name.trim(), badge_label: badge.trim(), color }),
                )
              }
            >
              {t("settings.save")}
            </Button>
          )
        }
      >
        <SettingRow agents="none" source={["host", "local"]} label={t("projects.name")} info={t("projects.icon.hint")}>
          <div className="flex items-center gap-2">
            <ProjectIconPicker hostId={hostId} projectId={id} badge={badge.trim() || name.trim().slice(0, 1) || project.presentation.display_name.slice(0, 1)} color={color} onColor={applyColor} disabled={colorSaving} />
            <TextInput width="w-56" value={name} onChange={setName} />
          </div>
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("projects.badge")} info={t(features.has("project-badge-wide") ? "projects.badgeHintWide" : "projects.badgeHint")}>
          <BadgeTextInput key={`${hostId}:${id}`} value={badge} onChange={setBadge} maxWidth={projectBadgeWidth(features)} onCompositionChange={setBadgeComposing} aria-label={t("projects.badge")} className="w-20 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent" />
        </SettingRow>
        {/* Saved at once, like the colour in the icon picker (the 保存 above is for the name and the badge). */}
        <SettingRow agents="none" source="host" label={t("projects.color")} info={t("projects.colorHint")}>
          <ProjectColorPicker value={color} onChange={applyColor} disabled={colorSaving} preview={{ badge: badge.trim() || name.trim().slice(0, 1) || project.presentation.display_name.slice(0, 1), icon: projectIcon(projectIcons, hostId, id) }} />
        </SettingRow>
        <SettingRow agents="next" source="host" label={t("projects.directory")} info={t("projects.directoryHint")}>
          <ProjectRootEditor
            hostId={hostId}
            current={project.workspace_root ?? null}
            remote={remote}
            apply={async (root) => {
              await api.projectMutation(id, expected, { kind: "set_workspace_root", workspace_root: root });
              await refreshSidebar();
            }}
          />
        </SettingRow>
      </Section>

      {/* Members and the Director are managed on the agent tab (one place, owner 2026-10-14). */}
      <Section title={t("projects.membersTitle")}>
        <SettingsGroup navigation agents="none" source="host">
          <button onClick={() => setTab("agents")} className="press flex items-center gap-1.5 rounded-sm py-2 text-xs text-accent hover:underline" data-members-link="">
            <Users size={13} />
            {t("projects.membersElsewhere", { tab: t("projects.tab.agents") })} →
          </button>
        </SettingsGroup>
      </Section>

      <ExternalAgentsSection projectId={id} />

      <Section title={t("projects.mcp")} hint={t("projects.mcpHint")}>
        {mcp === undefined && <p className="py-2 text-xs text-subtle">…</p>}
        {mcp === null && <p className="py-2 text-xs text-subtle">{t("projects.unavailable")}</p>}
        {mcp && Object.keys(mcp.servers).length === 0 && <p className="py-2 text-xs text-subtle">{t("projects.mcpNone")}</p>}
        {mcp &&
          Object.entries(mcp.servers).map(([server, cfg]) => (
            <SettingRow readOnly key={server} agents="next" source="host" label={server} hint={JSON.stringify(cfg).slice(0, 120)}>
              <span />
            </SettingRow>
          ))}
      </Section>

      <section className="mt-8 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold text-danger">{t("projects.danger")}</h3>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm">{t("projects.archive")}</div>
            <div className="text-xs text-subtle">{t(members.length === 0 ? "projects.archiveHintEmpty" : "projects.archiveHint")}</div>
          </div>
          <button onClick={() => void archive()} className="press-solid flex shrink-0 items-center gap-1 rounded-md bg-danger-solid px-3 py-1 text-xs font-medium text-white hover:brightness-95">
            <Archive size={13} />
            {t("projects.archive")}
          </button>
        </div>
      </section>
        </ScopeBaseline>
      )}
    </PageBody>
  );
}

/**
 * The tab row: the main tabs (projectTable MAIN_PROJECT_TABS) in a row that wraps rather than scrolls, every other tab
 * (modules) under 「更多」, which names the tab shown when it is one of them (owner 2026-11-25: 「委扌」 cut mid-word).
 */
function ProjectTabRow({ tabs, active, onTab }: { tabs: ReturnType<typeof useProjectTabs>; active: string; onTab(tab: string): void }) {
  const { t } = useI18n();
  const { main, more } = splitProjectTabs(tabs);
  const extra = more.find((x) => x.tab === active);
  const tabClass = (on: boolean) => `press -mb-px shrink-0 border-b-2 px-3 py-1.5 whitespace-nowrap ${on ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`;
  return (
    <nav className="mb-5 flex flex-wrap gap-x-1 border-b border-border text-sm" data-project-tabs="">
      {main.map(({ tab: key, titleKey }) => (
        <button key={key} onClick={() => onTab(key)} className={tabClass(active === key)} data-project-tab={key}>
          {t(titleKey)}
        </button>
      ))}
      {more.length > 0 && (
        <button
          type="button"
          aria-haspopup="menu"
          data-project-tab-more=""
          className={`${tabClass(!!extra)} inline-flex items-center gap-0.5`}
          onClick={(e) => openMenuFrom(e.currentTarget, more.map(({ tab: key, titleKey }) => ({ label: t(titleKey), hint: key === active ? "✓" : undefined, onSelect: () => onTab(key) })), { toggle: true })}
        >
          {extra ? t(extra.titleKey) : t("projects.tab.more")}
          <ChevronDown size={13} className="text-subtle" />
        </button>
      )}
    </nav>
  );
}

/** Every project of the scope's hosts (switcher order), then the param's host when it is outside the scope; archived too. */
function useScopeProjects(hostId: string): { projects: HostProjectRef[]; known: boolean; loading: boolean } {
  const scope = useHostScope();
  const hostsState = useApp((s) => s.hosts);
  const sidebar = useApp((s) => s.sidebar);
  const byHost = useApp((s) => s.byHost);
  const features = useApp((s) => s.features);
  return useMemo(() => {
    const source = { hosts: hostsState, sidebar, byHost, features };
    const ids = scope.hostsInScope.map((h) => h.id);
    if (!ids.includes(hostId)) ids.push(hostId);
    const snapshots = ids.map((id) => [id, sidebarOf(source, id)] as const);
    const projects = snapshots.flatMap(([id, snap]) => [
      ...(snap?.projects?.projects ?? []).map((project) => ({ hostId: id, project, archived: false })),
      ...(snap?.projects?.archived_projects ?? []).map((project) => ({ hostId: id, project, archived: true })),
    ]);
    // Loading: a connected host of the view has no snapshot yet (not 「不提供」 while it is still on its way).
    const loading = snapshots.some(([id, snap]) => !snap && (scope.host(id)?.connected ?? id === hostId));
    return { projects, known: snapshots.some(([, snap]) => !!snap?.projects), loading };
  }, [scope.hostsInScope, scope.host, hostId, hostsState, sidebar, byHost, features]);
}

/**
 * The 项目 page (`projects.page`). No `project` (and no `tab`): 「全部项目」, the table of every project of the view
 * (owner 2026-11-25, option B). `project`: an id, or "__new__" for the 新建 form; `tab`; `host`: the project's host.
 */
export function ProjectsPage({ params }: { params: PageParams }) {
  const projectId = params.project ?? null;
  const tab = params.tab ?? "overview";
  const { t } = useI18n();
  const scope = useHostScope();
  const hostId = params.host ?? scope.focus;
  useArchivedAgents(hostId);
  const { projects, known, loading } = useScopeProjects(hostId);
  const facts = useProjectFacts(projects);
  const creating = projectId === NEW;
  const live = projects.filter((p) => !p.archived);
  // `project` names one; an older link with only a `tab` (组合框 「项目记忆」) opens the first project of the host.
  const selected = creating
    ? null
    : projectId
      ? (live.find((p) => p.hostId === hostId && p.project.project_id === projectId) ?? null)
      : params.tab
        ? (live.find((p) => p.hostId === hostId) ?? null)
        : null;
  const selectedKey = selected ? hostKey(selected.hostId, selected.project.project_id) : null;
  useEffect(() => {
    if (selectedKey) noteProjectOpened(selectedKey);
  }, [selectedKey]);
  const newProject = () => openProject(NEW);
  return (
    <main className="flex min-w-0 flex-1">
      <ProjectRail facts={facts} selected={creating ? "new" : (selectedKey ?? "all")} onAll={() => openProject(null)} onNew={newProject} onOpen={(p) => openProject(p.id, undefined, p.hostId)} />
      {creating ? (
        <NewProject />
      ) : selected ? (
        <TargetHostContext.Provider value={selected.hostId}>
          <ProjectDetail
            key={hostKey(selected.hostId, selected.project.project_id)}
            project={selected.project}
            tab={tab}
            rotate={params.rotate === "1"}
            pick={params.pick === "add" || params.pick === "director" ? params.pick : null}
          />
        </TargetHostContext.Provider>
      ) : !known && loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-subtle" role="status" data-projects-loading="">{t("projects.loading")}</div>
      ) : !known ? (
        <div className="flex flex-1 items-center justify-center text-sm text-subtle">{t("projects.unavailable")}</div>
      ) : (
        <AllProjects facts={facts} newProject={newProject} />
      )}
    </main>
  );
}
