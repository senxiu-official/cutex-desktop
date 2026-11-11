// Settings → 协作 (cutex `agentSecurity`, docs/agent-tool-security.md §4): agents of different
// projects are isolated by default. The owner can grant a project one external agent (可见的外部
// agent, `agent-external-grants`; only projects with grants are listed, the section header adds), link two whole domains (互通, `links`), or switch the host back to
// host-wide visibility. Removing is click-twice (lib/armedConfirm). The per-project grants also show
// on the project's settings page (ExternalAgentsSection). Then agent 间消息格式 and the
// `settings.section` items targeting "collab": policy (轮换主管, 服务审批, 消息投递) first, the
// agent-bus module's collapsed 「高级」 card (消息总线, 卡住的消息) last.
import { useRef, useState } from "react";
import { useArchivedAgents } from "../../lib/useArchivedAgents";
import { ArrowLeftRight, FolderKanban, User } from "lucide-react";
import type { AgentSecurity, AgentSecurityPatch, DomainKey } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { closeMenu, openMenuFrom, promptDialog } from "../../lib/contextMenu";
import { addGrant, addLink, BOUNDARY_FEATURE, DEFAULT_MAX_EXTERNAL, DEFAULT_MAX_LINKS, domainLabel, domainOptions, EXTERNAL_GRANTS_FEATURE, grantedProjects, grantsFor, removeGrant, removeLink, type ListError } from "../../lib/agentSecurity";
import { grantPickerOptions, linkPickerOptions, securityProjectIds } from "../../lib/securityPicker";
import { SearchablePickerBody, SearchableSelect } from "../SearchablePicker";
import { useRiskAgentSecurity as useAgentSecurity, useSettingsRisk } from "../../lib/useSettingsRisk";
import { confirmSettingsRisk } from "../../lib/settingsRisk";
import { settingsRiskText as riskText } from "../../lib/settingsRiskText";
import { SettingsRiskConfirmation } from "./SettingsRiskConfirmation";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { matchesFilter } from "../../lib/listFilter";
import { useApp } from "../../store";
import { Avatar } from "../Avatar";
import { SettingsSections } from "../../modules/Outlet";
import { MessageTemplatesSection } from "./GlobalSettings";
import { AddButton, ArmedRemove, Button, EmptyState, ErrorNote, ListFilter, Loading, Notice, ResetButton, SettingRow, Section, Segmented, SettingsGroup, SubPageRow } from "./Form";
import { useTargetFeatures, useTargetHostId, useTargetHostLabel, useTargetSelect, useTargetSidebar } from "../../lib/targetHost";
import { projectIcon } from "../../lib/projectIcons";
import { useUiPrefs } from "../../lib/prefs";
import { ProjectBadge } from "../ProjectBadge";

function DomainName({ domain }: { domain: DomainKey }) {
  const sidebar = useTargetSidebar();
  const { label, kind, known } = domainLabel(domain, sidebar);
  const Icon = kind === "project" ? FolderKanban : User;
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${known ? "" : "text-subtle"}`} title={domain}>
      <Icon size={13} strokeWidth={1.75} className="shrink-0 text-subtle" />
      <span className="truncate">{label}</span>
    </span>
  );
}

const listErrorKey: Record<ListError, MessageKey> = { self: "security.error.self", duplicate: "security.error.duplicate", max: "security.error.max" };

type Patch = (p: AgentSecurityPatch, guard?: { expected: AgentSecurity; valid(): boolean }) => Promise<boolean>;

type PendingGrant = { message: string; valid(): boolean; change: AgentSecurityPatch };

/** Re-read without mutating: another desktop may have edited the permissions
 * while the confirmation was open. Never silently replace its newer lists. */
async function applySecurityRisk(_hostId: string, security: AgentSecurity, change: AgentSecurityPatch, valid: () => boolean, patch: Patch, onError: (message: string | null) => void) {
  if (!valid()) return false;
  try {
    return await patch(change, { expected: security, valid });
  } catch (error) { if (valid()) onError(String(error)); return false; }
}

/**
 * Menu rows of the agents a project can be granted (lib/agentSecurity externalCandidates); picking one
 * adds the grant, or reports why not (duplicate / max) through `onError`. Shared by a project's own
 * 添加 and the section header's project → agent picker.
 */
function useGrantMenu(security: AgentSecurity, onPick: (pending: PendingGrant) => void, onError: (text: string | null) => void, context = "all") {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const host = useTargetHostLabel();
  const hostId = useTargetHostId();
  const { projectOrder } = useUiPrefs();
  const projects = securityProjectIds(sidebar, projectOrder ?? [], hostId);
  const gate = useSettingsRisk([security, context, domainOptions(sidebar),
    [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].map(agent => [agent.cutexSessionId, agent.displayName, sidebar?.hostRows[agent.cutexSessionId]?.projectId])]);
  const grants = security.externalAgents ?? [];
  const max = security.maxExternalAgents ?? DEFAULT_MAX_EXTERNAL;
  return (projectId: string) => {
    const valid = gate.capture();
    const options = grantPickerOptions(sidebar, projectId, grants, projects, t("security.independent"));
    return { options, pick: (id: string) => {
        const c = options.find(option => option.value === id);
        if (!c) return;
        if (!valid()) return;
        const next = addGrant(grants, projectId, c.value, max);
        if (typeof next === "string") return onError(t(listErrorKey[next], { max }));
        onError(null);
        const project = sidebar?.projects?.projects.find(item => item.project_id === projectId)?.presentation.display_name ?? projectId;
        gate.invalidate();
        onPick({ valid: gate.capture(), change: { externalAgents: next }, message: riskText("settingsRisk.grant", { host, project, agent: c.label }) });
      } };
  };
}

/** Granted external agents of one project, with click-twice remove; on the project's page also 添加 (menu of agents outside it). */
function ProjectGrants({ projectId, security, patch, saving, showProject }: { projectId: string; security: AgentSecurity; patch: Patch; saving: boolean; showProject: boolean }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const hostId = useTargetHostId();
  const select = useTargetSelect();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingGrant | null>(null);
  const grants = security.externalAgents ?? [];
  const mine = grantsFor(grants, projectId);
  const project = sidebar?.projects?.projects.find((p) => p.project_id === projectId);
  const icon = projectIcon(useUiPrefs().projectIcons, hostId, projectId);
  const picker = useGrantMenu(security, setPending, setError, projectId)(projectId);
  const all = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <div className="flex h-7 items-center gap-2">
        {showProject && project && <ProjectBadge icon={icon} badge={project.presentation.badge_label || project.presentation.display_name.slice(0, 1)} color={project.presentation.color} />}
        {showProject && <span className="min-w-0 truncate text-sm font-medium">{project?.presentation.display_name ?? projectId}</span>}
        <span className="text-xs text-subtle">{t("security.external.count", { n: mine.length })}</span>
        {/* The collab page adds from its section header (project → agent); a project's own page adds here. */}
        {!showProject && (
          <span className="ml-auto">
            <SettingsGroup agents="now" source="host"><SearchableSelect value="" options={picker.options} onChange={picker.pick}
              label={t("security.external.add")} triggerText={`+ ${t("security.external.add")}`} placeholder={t("security.picker.search")} emptyLabel={t("security.picker.empty")}
              disabled={saving || picker.options.length === 0} triggerClassName="rounded-md px-2 py-1 text-xs text-accent hover:bg-hover disabled:opacity-40" /></SettingsGroup>
          </span>
        )}
      </div>
      {mine.map((g) => {
        const s = all.find((x) => x.cutexSessionId === g.agent);
        const pid = sidebar?.hostRows[g.agent]?.projectId ?? null;
        const where = pid ? (sidebar?.projects?.projects.find((p) => p.project_id === pid)?.presentation.display_name ?? pid) : t("security.independent");
        return (
          <div key={g.agent} className="flex h-8 items-center gap-2 pl-1">
            <Avatar name={s?.displayName ?? g.agent} avatar={s?.avatar} seed={g.agent} size={20} />
            <SettingsGroup navigation agents="none" source="local"><button disabled={!s} onClick={() => void select(g.agent)} className="min-w-0 truncate text-left text-sm enabled:hover:underline" title={g.agent}>
              {s?.displayName ?? g.agent}
            </button></SettingsGroup>
            <span className="shrink-0 text-xs text-subtle">· {s ? where : t("security.unknownAgent")}</span>
            <span className="ml-auto" />
            <SettingsGroup agents="now" source="host"><ArmedRemove title={t("security.external.remove")} disabled={saving} onRemove={() => void patch({ externalAgents: removeGrant(grants, projectId, g.agent) })} /></SettingsGroup>
          </div>
        );
      })}
      {error && <p className="pt-1 text-xs text-danger">{error}</p>}
      {pending && <SettingsRiskConfirmation message={pending.message} valid={pending.valid} busy={saving}
        onCancel={() => setPending(null)} onConfirm={() => {
          setPending(null);
          void applySecurityRisk(hostId, security, pending.change, pending.valid, patch, setError);
        }} />}
    </div>
  );
}

/** Project settings page: this project's external agents (cutex agent-external-grants). */
export function ExternalAgentsSection({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const supported = useTargetFeatures().has(EXTERNAL_GRANTS_FEATURE);
  const openSettings = useApp((s) => s.openSettings);
  const { security, error, saving, patch } = useAgentSecurity(supported);
  if (!supported) return null;
  return (
    <SettingsGroup agents="none" source="local"><Section title={t("security.external")} hint={t("security.external.hint")} actions={<Button onClick={() => openSettings("collab", { sub: "external" })}>{t("security.openSettings")}</Button>}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {security?.crossProjectAccess === "host" && <Notice>{t("security.hostModeNote")}</Notice>}
      {security ? <ProjectGrants projectId={projectId} security={security} patch={patch} saving={saving} showProject={false} /> : !error && <Loading rows={1} />}
    </Section></SettingsGroup>
  );
}

function LinksEditor({ security, patch, saving }: { security: AgentSecurity; patch: Patch; saving: boolean }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingGrant | null>(null);
  const hostId = useTargetHostId(), host = useTargetHostLabel();
  const draft = useRef({ a, b, hostId }); draft.current = { a, b, hostId };
  const gate = useSettingsRisk([security, a, b, domainOptions(sidebar)]);
  const { projectOrder } = useUiPrefs();
  const selectOptions = linkPickerOptions(sidebar, securityProjectIds(sidebar, projectOrder ?? [], hostId), t("security.domain.project"), t("security.independent"));
  const max = security.maxLinks ?? DEFAULT_MAX_LINKS;
  const [filter, setFilter] = useState("");
  const shown = security.links.filter((link) => matchesFilter(filter, domainLabel(link[0], sidebar).label, domainLabel(link[1], sidebar).label));
  const add = () => {
    const next = addLink(security.links, a, b, max);
    if (typeof next === "string") return setError(t(listErrorKey[next], { max }));
    setError(null);
    gate.invalidate();
    setPending({ valid: gate.capture(), change: { links: next }, message: riskText("settingsRisk.link", {
      host, a: domainLabel(a, sidebar).label, b: domainLabel(b, sidebar).label,
    }) });
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 py-2.5">
        <SettingsGroup agents="now" source="host"><SearchableSelect value={a} options={selectOptions} onChange={setA} width="w-56" label={t("security.links.pick")} triggerText={t("security.links.pick")} placeholder={t("security.picker.search")} emptyLabel={t("security.picker.empty")} /></SettingsGroup>
        <ArrowLeftRight size={13} className="shrink-0 text-subtle" />
        <SettingsGroup agents="now" source="host"><SearchableSelect value={b} options={selectOptions} onChange={setB} width="w-56" label={t("security.links.pick")} triggerText={t("security.links.pick")} placeholder={t("security.picker.search")} emptyLabel={t("security.picker.empty")} /></SettingsGroup>
        <SettingsGroup agents="now" source="host"><Button disabled={saving || !a || !b} onClick={add}>
          {t("security.links.add")}
        </Button></SettingsGroup>
      </div>
      {pending && <SettingsRiskConfirmation message={pending.message} valid={pending.valid} busy={saving}
        onCancel={() => setPending(null)} onConfirm={() => {
          setPending(null);
          void applySecurityRisk(hostId, security, pending.change, pending.valid, patch, setError)
            .then(ok => { if (ok && draft.current.a === a && draft.current.b === b && draft.current.hostId === hostId) { setA(""); setB(""); } });
        }} />}
      {/* Reserved line: an error never moves the section below. */}
      <p className="h-5 truncate text-xs text-danger">{error}</p>
      <div role="search" className="contents"><ListFilter count={security.links.length} value={filter} onChange={setFilter} /></div>
      {security.links.length > 0 && shown.length === 0 && <p className="py-2 text-xs text-subtle">{t("settings.filterNone")}</p>}
      {security.links.length === 0 && <p className="py-2 text-xs text-subtle">{t("security.links.none")}</p>}
      {shown.map((link) => (
        <div key={link.join("|")} className="flex items-center gap-2 border-b border-border py-2 text-sm">
          <DomainName domain={link[0]} />
          <ArrowLeftRight size={13} className="shrink-0 text-subtle" />
          <DomainName domain={link[1]} />
          <span className="ml-auto" />
          <SettingsGroup agents="now" source="host"><ArmedRemove title={t("security.links.remove")} disabled={saving} onRemove={() => void patch({ links: removeLink(security.links, link) })} /></SettingsGroup>
        </div>
      ))}
    </>
  );
}

/** 可见的外部 agent on the page: how many and the first few; the list and 添加 are on its sub-page. */
function ExternalEntry({ security, host }: { security: AgentSecurity; host: boolean }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const openSettings = useApp((s) => s.openSettings);
  const grants = security.externalAgents ?? [];
  const all = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
  const first = grants.slice(0, 3).map((g) => all.find((s) => s.cutexSessionId === g.agent)?.displayName ?? g.agent).join(" · ");
  return (
    <Section id={settingsAnchorId("external")} title={t("security.external")} hint={t("security.external.hint")}>
      {host && <p className="border-b border-border py-2 text-xs text-warn">{t("security.hostModeNote")}</p>}
      <SubPageRow effect={{ agents: "now", source: "host" }} title={t("security.external.total", { n: grants.length })} summary={first || t("security.external.none")} onOpen={() => openSettings("collab", { sub: "external" })} />
    </Section>
  );
}

/**
 * 协作 → 可见的外部 agent (settings audit 2026-10-15, lead decision 5): only the projects that have
 * grants (in sidebar order, then ids the sidebar does not know); the header's 添加 picks a project,
 * then the external agent; no grants at all = one sentence.
 */
function ExternalGrantsSection({ security, patch, saving, host }: { security: AgentSecurity; patch: Patch; saving: boolean; host: boolean }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingGrant | null>(null);
  const hostId = useTargetHostId();
  const menuFor = useGrantMenu(security, setPending, setError);
  const projects = sidebar?.projects?.projects ?? [];
  const { projectOrder } = useUiPrefs();
  const listed = grantedProjects(sidebar, security.externalAgents);
  const grants = security.externalAgents ?? [];
  const everyone = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
  const [filter, setFilter] = useState("");
  // A project stays whole: by its name, or by the name of an agent granted to it.
  const shown = listed.filter((id) => matchesFilter(filter, projects.find((p) => p.project_id === id)?.presentation.display_name ?? id,
    ...grantsFor(grants, id).map((g) => everyone.find((s) => s.cutexSessionId === g.agent)?.displayName ?? g.agent)));
  const activeProjects = securityProjectIds(sidebar, projectOrder ?? [], hostId).flatMap(id => projects.filter(p => p.project_id === id && (p.lifecycle ?? "active") === "active"));
  const pick = (el: HTMLElement) =>
    openMenuFrom(
      el,
      activeProjects.map((p) => {
        const picker = menuFor(p.project_id);
        return picker.options.length > 0
          ? { label: p.presentation.display_name, flyout: <SearchablePickerBody options={picker.options} placeholder={t("security.picker.search")} emptyLabel={t("security.picker.empty")} onPick={id => { closeMenu(); picker.pick(id); }} />, onSelect: () => {} }
          : { label: p.presentation.display_name, hint: t("security.external.noCandidates"), disabled: true, onSelect: () => {} };
      }),
    );
  return (
    <Section
      id={settingsAnchorId("external")}
      title={t("security.external.totalMax", { n: grants.length, max: security.maxExternalAgents ?? DEFAULT_MAX_EXTERNAL })}
      actions={
        <SettingsGroup agents="now" source="host"><AddButton disabled={saving || activeProjects.length === 0} title={activeProjects.length === 0 ? t("security.external.noProjects") : undefined} onClick={(e) => pick(e.currentTarget)}>
          {t("security.external.add")}
        </AddButton></SettingsGroup>
      }
    >
      {host && <p className="border-b border-border py-2 text-xs text-warn">{t("security.hostModeNote")}</p>}
      <div role="search" className="contents"><ListFilter count={listed.length} value={filter} onChange={setFilter} /></div>
      {listed.length === 0 && <EmptyState>{t("security.external.none")}</EmptyState>}
      {listed.length > 0 && shown.length === 0 && <p className="py-2 text-xs text-subtle">{t("settings.filterNone")}</p>}
      {shown.map((id) => (
        <ProjectGrants key={id} projectId={id} security={security} patch={patch} saving={saving} showProject />
      ))}
      {error && <p className="py-1 text-xs text-danger">{error}</p>}
      {pending && <SettingsRiskConfirmation message={pending.message} valid={pending.valid} busy={saving}
        onCancel={() => setPending(null)} onConfirm={() => {
          setPending(null);
          void applySecurityRisk(hostId, security, pending.change, pending.valid, patch, setError);
        }} />}
    </Section>
  );
}

/** 规则审计's full list is a `settings.section` of the approvals module, placed on its sub-page. */
const AUDIT_SECTIONS = ["approvals.rules.auditAll"];
const RULES_SECTIONS = ["approvals.rules.all"];
/** 协作 → 全部规则. */
export function CollabRulesSubPage() {
  useScrollToSettingsAnchor();
  return <SettingsSections page="collab" only={RULES_SECTIONS} />;
}

export function CollabAuditSubPage() {
  useScrollToSettingsAnchor();
  return <SettingsSections page="collab" only={AUDIT_SECTIONS} />;
}

export function CollabPage() {
  useScrollToSettingsAnchor();
  return (
    <>
      <BoundarySections />
      <MessageTemplatesSection />
      <SettingsSections page="collab" except={[...AUDIT_SECTIONS, ...RULES_SECTIONS]} />
    </>
  );
}

/** 项目边界 / 外部 agent / 互通的项目 (cutex agent-project-boundary). */
function BoundarySections() {
  const { t } = useI18n();
  const boundary = useTargetFeatures().has(BOUNDARY_FEATURE);
  const grantsSupported = useTargetFeatures().has(EXTERNAL_GRANTS_FEATURE);
  const { security, error, saving, patch } = useAgentSecurity(boundary);
  const hostId = useTargetHostId(), hostLabel = useTargetHostLabel();
  useArchivedAgents(hostId);
  const gate = useSettingsRisk(security);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const changeBoundary = async (value: "isolated" | "host") => {
    if (!security || saving || confirming || value === security.crossProjectAccess) return;
    if (value === "isolated") { void patch({ crossProjectAccess: value }); return; }
    const valid = gate.capture(), target = hostLabel === "—" ? hostId : hostLabel;
    setConfirming(true); setRiskError(null);
    try {
      const result = await confirmSettingsRisk(target, () => promptDialog(riskText("settingsRisk.hostVisibility"), "", {
        placeholder: target, hint: riskText("settingsRisk.hostVisibilityHint", { host: hostLabel, target }),
      }), valid);
      if (result === "confirmed") await applySecurityRisk(hostId, security, { crossProjectAccess: value }, valid, patch, setRiskError);
      else if (result !== "cancelled") setRiskError(riskText(result === "changed" ? "settingsRisk.changed" : "settingsRisk.typeMismatch"));
    } finally { setConfirming(false); }
  };
  if (!boundary)
    return (
      <Section id={settingsAnchorId("boundary")} title={t("security.boundary")}>
        <p className="py-2 text-sm text-subtle">{t("security.unsupported")}</p>
      </Section>
    );
  if (!security)
    return (
      <Section id={settingsAnchorId("boundary")} title={t("security.boundary")}>
        {error ? <p className="py-2 text-sm text-danger">{error}</p> : <Loading rows={3} />}
      </Section>
    );
  const host = security.crossProjectAccess === "host";
  const def = security.crossProjectAccessDefault ?? "isolated";
  return (
    <>
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      {riskError && <ErrorNote>{riskError}</ErrorNote>}
      <Section id={settingsAnchorId("boundary")} title={t("security.boundary")} hint={t("security.boundary.hint")}>
        <SettingRow agents="now" source="host"
          label={t("security.crossProject")}
          hint={t(host ? "security.crossProject.hostHint" : "security.crossProject.isolatedHint")}
          reset={<ResetButton disabled={security.crossProjectAccess === def || saving || confirming} onClick={() => void changeBoundary(def)} />}
        >
          <Segmented<"isolated" | "host">
            value={security.crossProjectAccess}
            options={(security.crossProjectAccessOptions ?? ["isolated", "host"]).map((v) => ({ value: v, label: t(`security.crossProject.${v}` as MessageKey) }))}
            onChange={(v) => void changeBoundary(v)}
          />
        </SettingRow>
      </Section>
      {grantsSupported && <ExternalEntry security={security} host={host} />}
      <LinksEntry security={security} host={host} />
    </>
  );
}

/** 互通的项目 on the page: how many and the first few; the list and 添加 are on its sub-page. */
function LinksEntry({ security, host }: { security: AgentSecurity; host: boolean }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const openSettings = useApp((s) => s.openSettings);
  const first = security.links.slice(0, 3).map(([a, b]) => `${domainLabel(a, sidebar).label} ⇄ ${domainLabel(b, sidebar).label}`).join(" · ");
  return (
    <Section id={settingsAnchorId("links")} title={t("security.links")} hint={t("security.links.hint")}>
      {host && <p className="border-b border-border py-2 text-xs text-warn">{t("security.hostModeNote")}</p>}
      <SubPageRow effect={{ agents: "now", source: "host" }} title={t("security.links.count", { n: security.links.length })} summary={first || t("security.links.none")} onOpen={() => openSettings("collab", { sub: "links" })} />
    </Section>
  );
}

/** 协作 → 可见的外部 agent. */
export function CollabExternalSubPage() {
  const { t } = useI18n();
  useScrollToSettingsAnchor();
  const features = useTargetFeatures();
  const supported = features.has(BOUNDARY_FEATURE) && features.has(EXTERNAL_GRANTS_FEATURE);
  const { security, error, saving, patch } = useAgentSecurity(supported);
  useArchivedAgents(useTargetHostId());
  if (!supported || !security)
    return (
      <Section id={settingsAnchorId("external")}>
        {!supported ? <p className="py-2 text-sm text-subtle">{t("security.unsupported")}</p> : error ? <p className="py-2 text-sm text-danger">{error}</p> : <Loading rows={3} />}
      </Section>
    );
  return (
    <>
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <ExternalGrantsSection security={security} patch={patch} saving={saving} host={security.crossProjectAccess === "host"} />
    </>
  );
}

/** 协作 → 互通的项目: every linked pair, 添加 first. */
export function CollabLinksSubPage() {
  const { t } = useI18n();
  useScrollToSettingsAnchor();
  const boundary = useTargetFeatures().has(BOUNDARY_FEATURE);
  const { security, error, saving, patch } = useAgentSecurity(boundary);
  useArchivedAgents(useTargetHostId());
  if (!boundary || !security)
    return (
      <Section id={settingsAnchorId("links")}>
        {!boundary ? <p className="py-2 text-sm text-subtle">{t("security.unsupported")}</p> : error ? <p className="py-2 text-sm text-danger">{error}</p> : <Loading rows={3} />}
      </Section>
    );
  return (
    <>
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <Section id={settingsAnchorId("links")} title={t("security.links.countMax", { n: security.links.length, max: security.maxLinks ?? DEFAULT_MAX_LINKS })}>
        {security.crossProjectAccess === "host" && <p className="border-b border-border py-2 text-xs text-warn">{t("security.hostModeNote")}</p>}
        <LinksEditor security={security} patch={patch} saving={saving} />
      </Section>
    </>
  );
}
