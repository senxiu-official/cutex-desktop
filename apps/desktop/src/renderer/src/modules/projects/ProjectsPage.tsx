// Projects page (DESIGN §4.18): project list + detail — presentation, directory, members /
// Director, project-layer MCP, memory, tasks. Membership and Director changes live only here, on the
// agent tab (the list + MemberPicker); 设置 only links to it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowRightLeft, Crown, FolderOpen, Pencil, Plus, StickyNote, UserMinus, Users, UserX } from "lucide-react";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import type { ProjectMemoryView } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { confirmDialog, type MenuEntry } from "../../lib/contextMenu";
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
import { ServiceLine } from "../../components/ServiceLine";
import { PageBody, SubNav, SUBNAV_ITEM, SUBNAV_OFF, SUBNAV_ON } from "../../components/Page";
import { Button, SettingRow, Section, Select, TextInput } from "../../components/settings/Form";
import { ProjectColorPicker } from "../../components/ProjectColorPicker";
import { ProjectBadge } from "../../components/ProjectBadge";
import { ProjectIconPicker } from "../../components/ProjectIconPicker";
import { projectIcon } from "../../lib/projectIcons";
import { autoBadge, CREATE_ROOT_FEATURE, createProject, independentAgents, OPTIONAL_DIRECTOR_FEATURE, ProjectDirectoryError, slugifyProjectId } from "../../lib/projectCreate";
import type { ProjectIconChoice } from "../../lib/projectIcons";
import { setProjectIcon } from "../../lib/prefs";
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
import type { HostLook } from "../../lib/hostScope";
import { useHostData, useHostScope } from "../../lib/useHostScope";
import { HostMark } from "../../components/HostMark";
import { loadProjectRotation, useProjectRotation } from "./rotationStore";
import { useUiPrefs } from "../../lib/prefs";
import { editProjectRemark } from "../../lib/projectMenus";
import { archiveProject, confirmProjectArchive } from "../../lib/projectArchive";
import { isOwnerFeatures } from "../../../../shared/users";
import type { AgentRow } from "../../lib/sidebar";

/** Pseudo project id for the "new project" form. */
const NEW = "__new__";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A project of one host of the scope (the list merges every host's; multi-host P1). */
interface HostProject {
  hostId: string;
  project: ProjectSummary;
}

/** `selected`: hostKey(host, id) of the shown project, or NEW. `mark`: a host's mark (null: none, scope.showHostMarks). */
function ProjectList({ projects, selected, onSelect, mark }: { projects: HostProject[]; selected: string | null; onSelect(id: string, hostId: string): void; mark(hostId: string): HostLook | null }) {
  const { t } = useI18n();
  const icons = useUiPrefs().projectIcons;
  return (
    <SubNav>
      <button onClick={() => onSelect(NEW, "")} className={`mb-1 ${SUBNAV_ITEM} ${selected === NEW ? SUBNAV_ON : SUBNAV_OFF}`}>
        <Plus size={15} className="mx-0.5 text-subtle" />
        {t("projects.new")}
      </button>
      {projects.map(({ hostId, project: p }) => (
        <button
          key={hostKey(hostId, p.project_id)}
          onClick={() => onSelect(p.project_id, hostId)}
          className={`${SUBNAV_ITEM} ${selected === hostKey(hostId, p.project_id) ? SUBNAV_ON : SUBNAV_OFF}`}
        >
          <ProjectBadge icon={projectIcon(icons, hostId, p.project_id)} badge={p.presentation.badge_label || p.presentation.display_name.slice(0, 1)} color={p.presentation.color} size="lg" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{p.presentation.display_name}</span>
            <span className="block truncate text-[11px] text-subtle">{t("projects.members", { n: p.active_member_count })}</span>
          </span>
          {mark(hostId) && <HostMark host={mark(hostId)!} dotOnly className="shrink-0" />}
        </button>
      ))}
    </SubNav>
  );
}

/** Director choice in the 新建 form: none, a new agent (opens 新建智能体 next), or an existing agent id. */
const DIRECTOR_NONE = "";
const DIRECTOR_NEW = "__new_director__";

/** The 新建 form; multi-host (P1 step 2c): a host picker on top (★ Q10 default), the project and its Director come from / go to that host. */
function NewProject() {
  const target = useCreateHost();
  return (
    <TargetHostContext.Provider value={target.hostId}>
      <NewProjectForm key={target.hostId} target={target} />
    </TargetHostContext.Provider>
  );
}

function NewProjectForm({ target }: { target: CreateHost }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const isFocus = useTargetIsFocus();
  const remote = useTargetIsRemote();
  const sidebar = useTargetSidebar();
  const refreshHostSidebar = useApp((s) => s.refreshHostSidebar);
  const features = useTargetFeatures();
  const optional = features.has(OPTIONAL_DIRECTOR_FEATURE);
  // cutex creates a directory that doesn't exist yet (only with create_project, i.e. `optional`).
  const createRoot = optional && features.has(CREATE_ROOT_FEATURE);
  const hostId = target.hostId;
  const hostLabel = target.look?.label ?? "";
  const online = target.look?.indicator.status === "online";
  const [name, setName] = useState("");
  const [badge, setBadge] = useState("");
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
  const agents = independentAgents(sidebar);
  const badgeText = badge.trim() || autoBadge(name);
  const newDirector = optional && director === DIRECTOR_NEW;
  const ready = online && !!name.trim() && !busy && (optional || !!director);
  const create = async () => {
    setError(null);
    setPartial(null);
    setBusy(true);
    const id = slugifyProjectId(name);
    try {
      const existing = director && director !== DIRECTOR_NEW ? director : null;
      await createProject(api, { id, presentation: { display_name: name.trim(), badge_label: badgeText, color }, workspaceRoot: dir.trim() || null, director: existing, createDirectory: createRoot }, optional);
      if (icon) setProjectIcon(hostId, id, icon);
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
        if (icon) setProjectIcon(hostId, e.projectId, icon);
        await refreshHostSidebar(hostId);
        setPartial(e.projectId);
      }
      // A refused directory (create_project's workspace_root, or the follow-up set_workspace_root).
      const rootError = workspaceRootErrorKey(e);
      setError(rootError ? t(rootError) : errorText(e));
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
            <button onClick={() => openProject(partial, "settings", hostId)} className="ml-2 underline">
              {t("projects.openSettings")}
            </button>
          )}
        </div>
      )}
      <Section title={t("projects.basics")} hint={t(optional ? "projects.newHintOptional" : "projects.newHint")} actions={<Button primary disabled={!ready} onClick={() => void create()}>{t("projects.create")}</Button>}>
        {target.mode !== "none" && (
          <SettingRow
            label={t("hostPicker.label")}
            hint={!online ? <span className="text-warn">{t("hostPicker.unavailable", { host: hostLabel })}</span> : !isFocus ? t("hostPicker.opensOther", { host: hostLabel }) : undefined}
          >
            <HostPicker value={hostId} onChange={target.setHostId} mode={target.mode} title={t("hostPicker.createTitle")} />
          </SettingRow>
        )}
        <SettingRow label={t("projects.name")} hint={t("projects.icon.hint")}>
          <div className="flex items-center gap-2">
            <ProjectIconPicker value={icon} onIcon={setIcon} badge={badgeText || "?"} color={color} onColor={setColor} />
            <TextInput width="w-56" value={name} onChange={setName} />
          </div>
        </SettingRow>
        <SettingRow label={t("projects.badge")} hint={t("projects.badgeHint")}>
          <TextInput width="w-20" value={badge} onChange={(v) => setBadge(v.slice(0, 4))} placeholder={autoBadge(name)} />
        </SettingRow>
        <SettingRow label={t("projects.color")}>
          <ProjectColorPicker value={color} onChange={setColor} />
        </SettingRow>
        <SettingRow label={t("projects.directory")} hint={t(createRoot ? "projects.directoryCreateHint" : "projects.directoryNewHint")}>
          <div className="flex items-center gap-1.5">
            <TextInput width="w-72" mono value={dir} onChange={setDir} placeholder={remote ? "/home/me/project" : "D:\\path\\to\\project"} />
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
        <SettingRow label={t("sidebar.director")} hint={optional ? t(newDirector ? "projects.directorNewHint" : "projects.directorHint") : t("projects.directorLegacyHint")}>
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
      <button onClick={onOpen} className="hover:text-foreground hover:underline">
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
  const [color, setColor] = useState(project.presentation.color);
  const [error, setError] = useState<string | null>(null);
  const allServices = useHostData(hostId)?.services;
  const projectServices = useMemo(() => (allServices ?? []).filter((s) => s.projectId === project.project_id), [allServices, project.project_id]);
  const [memory, setMemory] = useState<ProjectMemoryView | null | undefined>(undefined);
  const model = useSidebarModel();
  const team = useMemo(() => {
    const group = model.groups.find((g) => g.kind === "project" && g.id === project.project_id);
    return { online: group?.online ?? [], offline: group?.offline ?? [] };
  }, [model, project.project_id]);
  const waiting = team.online.filter((r) => r.status === "needsInput");
  const [mcp, setMcp] = useState<{ servers: Record<string, unknown> } | null | undefined>(undefined);
  const id = project.project_id;
  const remark = useUiPrefs().projectRemarks[hostKey(hostId, id)] ?? "";
  const editRemark = () => void editProjectRemark(id, hostId, project.presentation.display_name, t);

  // A new saved presentation (保存, a picker colour, another device) replaces only the fields the
  // form hasn't changed, so a picked colour never wipes a half-typed name and 保存 never sends a stale
  // colour back. Another project resets the whole form.
  const saved = useRef({ id, presentation: project.presentation });
  useEffect(() => {
    const prev = saved.current;
    const next = project.presentation;
    const same = prev.id === id;
    saved.current = { id, presentation: next };
    setName((v) => (same && v !== prev.presentation.display_name ? v : next.display_name));
    setBadge((v) => (same && v !== prev.presentation.badge_label ? v : next.badge_label));
    setColor((v) => (same && v !== prev.presentation.color ? v : next.color));
    setError(null);
    api.projectMemory(id).then(setMemory, () => setMemory(null));
    api.projectMcp(id).then(setMcp, () => setMcp(null));
  }, [api, id, project.presentation]);

  const members = useMemo(() => {
    const all = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
    return all.filter((s) => sidebar?.hostRows[s.cutexSessionId]?.projectId === id && s.lifecycle !== "retired");
  }, [sidebar, id]);
  const optional = features.has(OPTIONAL_DIRECTOR_FEATURE);
  // users: a non-owner connection may only look (no membership / Director changes; lib/projectMenus).
  const owner = isOwnerFeatures(features);
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
  const detachOne = async (row: Pick<AgentRow, "id" | "name">) => {
    if (!(await confirmDialog(t("projects.detachConfirm", { name: row.name }), true))) return;
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
            canMake && {
              label: t("projects.setDirector"),
              icon: <Crown size={14} />,
              disabled: rotationRunning,
              title: rotationRunning ? t("projects.directorRotating") : undefined,
              onSelect: () => void makeDirector(row).catch((e) => setError(errorText(e))),
            },
            { label: t("projects.detach"), icon: <UserMinus size={14} />, danger: true, onSelect: () => void detachOne(row) },
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
      setError(errorText(e));
    }
  };
  // A colour from the icon picker applies at once (with the *saved* name / badge, so half-typed
  // form edits don't ride along); the rest of the form keeps its explicit 保存.
  const applyColor = (c: string) => {
    setColor(c);
    void run(() => api.projectPresentation(id, { authorityEpoch: project.authority_epoch, presentationRevision: project.presentation.revision ?? 0 }, { display_name: project.presentation.display_name, badge_label: project.presentation.badge_label, color: c }));
  };
  const dirty = name !== project.presentation.display_name || badge !== project.presentation.badge_label || color !== project.presentation.color;
  const displayName = project.presentation.display_name;

  // Destructive: an empty project archives after a plain confirm; otherwise type its name. With a
  // live Director the dialog offers 「同时归档主管」 (lib/projectArchive: project first, then the Director).
  const archive = async () => {
    const director = directorSession && directorSession.lifecycle !== "retired" ? directorSession : null;
    const answer = await confirmProjectArchive({ displayName, memberCount: members.length, director, hostId, t });
    if (answer.mismatch) return setError(t("projects.archiveNameMismatch"));
    if (!answer.ok) return;
    setError(null);
    try {
      await archiveProject({ hostId, projectId: id, displayName, expected, directorId: director?.cutexSessionId ?? null, withDirector: answer.withDirector, t });
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <PageBody>
      {error && <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {rotationRunning && rotation && !rotating && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
          <ArrowRightLeft size={13} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">{t("projects.rotation.banner", { from: rotation.predecessor.name, to: rotation.successorSpec.name, state: t(`projects.rotation.state.${rotation.state}` as MessageKey) })}</span>
          <button onClick={() => setRotating(true)} className="shrink-0 text-accent hover:underline">
            {t("projects.rotation.view")}
          </button>
        </div>
      )}
      {rotating && <DirectorRotationDialog project={project} director={directorSession} onClose={closeRotation} />}

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border text-sm">
        {tabs.map(({ tab: key, titleKey }) => (
          <button key={key} onClick={() => setTab(key)} className={`-mb-px shrink-0 border-b-2 px-3 py-1.5 whitespace-nowrap ${active === key ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}>
            {t(titleKey)}
          </button>
        ))}
      </nav>
      {active === "overview" && (
        <>
      {/* 本机备注 (device-local prefs; edited here or from the sidebar project menu). */}
      <div className="mb-4 flex min-w-0 items-center gap-1.5 text-xs text-subtle" data-project-remark="">
        <StickyNote size={13} className="shrink-0" aria-label={t("remark.label")} />
        {remark ? (
          <>
            <span className="min-w-0 truncate" title={`${remark}\n${t("remark.tooltip")}`}>{remark}</span>
            <button onClick={editRemark} title={t("remark.edit")} aria-label={t("remark.edit")} className="shrink-0 rounded p-0.5 hover:bg-surface-2 hover:text-foreground">
              <Pencil size={12} />
            </button>
          </>
        ) : (
          <button onClick={editRemark} title={t("remark.tooltip")} className="shrink-0 hover:text-foreground hover:underline">
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
            <button onClick={() => setTab("tasks")} className="ml-auto text-xs font-normal text-accent hover:underline">
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
                className="ml-auto rounded p-1 font-normal text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
              >
                <Crown size={13} />
              </button>
            )}
            {owner && (
              <button onClick={() => setPicker("add")} title={t("projects.addMember")} aria-label={t("projects.addMember")} className={`${canPickDirector ? "" : "ml-auto "}rounded p-1 font-normal text-subtle hover:bg-surface-2 hover:text-foreground`}>
                <Plus size={13} />
              </button>
            )}
          </h3>
          <div className="mb-4 rounded-xl border border-border bg-surface px-1 py-1">
            {team.online.map((row) => (
              <AgentRowButton key={row.id} row={row} />
            ))}
            <OfflineSection rows={team.offline} searching={false} onAll={() => setTab("agents")} hostId={isFocus ? undefined : hostId} />
            {team.online.length + team.offline.length === 0 && <p className="px-2 py-2 text-xs text-subtle">{t("projects.noMembers")}</p>}
          </div>
          {projectServices.length > 0 && (
            <>
              <h3 className="mb-2 text-sm font-semibold">{t("projects.services")}</h3>
              <div className="mb-4 rounded-xl border border-border bg-surface px-3">
                {projectServices.map((s) => (
                  <ServiceLine key={s.slug} s={s} onError={setError} />
                ))}
              </div>
            </>
          )}
          <button onClick={() => setTab("memory")} className="mb-2 block w-full rounded-xl border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2/60">
            <div className="text-sm">{t("projects.memory")}</div>
            <div className="text-xs text-subtle">{memory ? t("projects.memoryCount", { n: memory.entries.length }) : "…"}</div>
          </button>
          <button onClick={() => setTab("settings")} className="block w-full rounded-xl border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2/60">
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
        <ProjectMemoryList hostId={hostId} projectId={id} memory={memory} />
      </Section>

        </>
      )}
      {active === "settings" && (
        <>
      <Section
        title={t("projects.basics")}
        actions={
          dirty && (
            <Button
              primary
              onClick={() =>
                void run(() =>
                  api.projectPresentation(id, { authorityEpoch: project.authority_epoch, presentationRevision: project.presentation.revision ?? 0 }, { display_name: name.trim(), badge_label: badge.trim(), color }),
                )
              }
            >
              {t("settings.save")}
            </Button>
          )
        }
      >
        <SettingRow label={t("projects.name")} hint={t("projects.icon.hint")}>
          <div className="flex items-center gap-2">
            <ProjectIconPicker hostId={hostId} projectId={id} badge={badge.trim() || name.trim().slice(0, 1) || project.presentation.display_name.slice(0, 1)} color={color} onColor={applyColor} />
            <TextInput width="w-56" value={name} onChange={setName} />
          </div>
        </SettingRow>
        <SettingRow label={t("projects.badge")} hint={t("projects.badgeHint")}>
          <TextInput width="w-20" value={badge} onChange={(v) => setBadge(v.slice(0, 4))} />
        </SettingRow>
        <SettingRow label={t("projects.directory")} hint={t("projects.directoryHint")}>
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
        <button onClick={() => setTab("agents")} className="flex items-center gap-1.5 py-2 text-xs text-accent hover:underline" data-members-link="">
          <Users size={13} />
          {t("projects.membersElsewhere", { tab: t("projects.tab.agents") })} →
        </button>
      </Section>

      <ExternalAgentsSection projectId={id} />

      <Section title={t("projects.mcp")} hint={t("projects.mcpHint")}>
        {mcp === undefined && <p className="py-2 text-xs text-subtle">…</p>}
        {mcp === null && <p className="py-2 text-xs text-subtle">{t("projects.unavailable")}</p>}
        {mcp && Object.keys(mcp.servers).length === 0 && <p className="py-2 text-xs text-subtle">{t("projects.mcpNone")}</p>}
        {mcp &&
          Object.entries(mcp.servers).map(([server, cfg]) => (
            <SettingRow key={server} label={server} hint={JSON.stringify(cfg).slice(0, 120)}>
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
          <button onClick={() => void archive()} className="flex shrink-0 items-center gap-1 rounded-md bg-danger px-3 py-1 text-xs font-medium text-white hover:bg-danger/90">
            <Archive size={13} />
            {t("projects.archive")}
          </button>
        </div>
      </section>
        </>
      )}
    </PageBody>
  );
}

/** The 项目 page (`projects.page`); params: `project` (an id, or "__new__" for the 新建 form), `tab`. */
export function ProjectsPage({ params }: { params: PageParams }) {
  const projectId = params.project ?? null;
  const tab = params.tab ?? "overview";
  const { t } = useI18n();
  const scope = useHostScope();
  const hostId = params.host ?? scope.focus;
  const hostsState = useApp((s) => s.hosts);
  const sidebar = useApp((s) => s.sidebar);
  const byHost = useApp((s) => s.byHost);
  const features = useApp((s) => s.features);
  // Every host of the scope (switcher order), then the param's host when it is outside the scope.
  const { projects, known } = useMemo(() => {
    const source = { hosts: hostsState, sidebar, byHost, features };
    const ids = scope.hostsInScope.map((h) => h.id);
    if (!ids.includes(hostId)) ids.push(hostId);
    const snapshots = ids.map((id) => [id, sidebarOf(source, id)] as const);
    return {
      projects: snapshots.flatMap(([id, snap]) => (snap?.projects?.projects ?? []).map((project) => ({ hostId: id, project }))),
      known: snapshots.some(([, snap]) => !!snap?.projects),
    };
  }, [scope.hostsInScope, hostId, hostsState, sidebar, byHost, features]);
  const creating = projectId === NEW;
  // A host page (`params.host`) shows that host's projects only: no first project of another host.
  const selected = creating
    ? null
    : (projects.find((p) => p.hostId === hostId && p.project.project_id === projectId) ?? projects.find((p) => p.hostId === hostId) ?? (params.host ? null : projects[0]) ?? null);
  const mark = (id: string) => (scope.showHostMarks ? scope.host(id) : null);
  return (
    <main className="flex min-w-0 flex-1">
      <ProjectList projects={projects} selected={creating ? NEW : selected ? hostKey(selected.hostId, selected.project.project_id) : null} onSelect={(id, host) => openProject(id, undefined, host || undefined)} mark={mark} />
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
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-subtle">{t(known ? "projects.none" : "projects.unavailable")}</div>
      )}
    </main>
  );
}
