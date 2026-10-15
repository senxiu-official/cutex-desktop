// Settings → 协作 (cutex `agentSecurity`, docs/agent-tool-security.md §4): agents of different
// projects are isolated by default. The owner can grant a project one external agent (可见的外部
// agent, `agent-external-grants`; only projects with grants are listed, the section header adds), link two whole domains (互通, `links`), or switch the host back to
// host-wide visibility. Removing is click-twice (lib/armedConfirm). The per-project grants also show
// on the project's settings page (ExternalAgentsSection). Then agent 间消息格式 and the
// `settings.section` items targeting "collab": policy (轮换主管, 服务审批, 消息投递) first, the
// agent-bus module's collapsed 「高级」 card (消息总线, 卡住的消息) last.
import { useState } from "react";
import { ArrowLeftRight, FolderKanban, User } from "lucide-react";
import type { AgentSecurity, AgentSecurityPatch, DomainKey } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { openMenuFrom, type MenuEntry } from "../../lib/contextMenu";
import { addGrant, addLink, BOUNDARY_FEATURE, DEFAULT_MAX_EXTERNAL, DEFAULT_MAX_LINKS, domainLabel, domainOptions, externalCandidates, EXTERNAL_GRANTS_FEATURE, grantedProjects, grantsFor, removeGrant, removeLink, type ListError } from "../../lib/agentSecurity";
import { useAgentSecurity } from "../../lib/agentSecurityView";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useApp } from "../../store";
import { Avatar } from "../Avatar";
import { SettingsSections } from "../../modules/Outlet";
import { MessageTemplatesSection } from "./GlobalSettings";
import { AddButton, ArmedRemove, Button, EmptyState, ErrorNote, Loading, Notice, SettingRow, Section, Segmented, Select } from "./Form";
import { useTargetFeatures, useTargetHostId, useTargetSelect, useTargetSidebar } from "../../lib/targetHost";
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

type Patch = (p: AgentSecurityPatch) => Promise<boolean>;

/**
 * Menu rows of the agents a project can be granted (lib/agentSecurity externalCandidates); picking one
 * adds the grant, or reports why not (duplicate / max) through `onError`. Shared by a project's own
 * 添加 and the section header's project → agent picker.
 */
function useGrantMenu(security: AgentSecurity, patch: Patch, onError: (text: string | null) => void) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const grants = security.externalAgents ?? [];
  const max = security.maxExternalAgents ?? DEFAULT_MAX_EXTERNAL;
  return (projectId: string): MenuEntry[] =>
    externalCandidates(sidebar, projectId, grants).map((c) => ({
      label: c.name,
      hint: c.projectName ?? t("security.independent"),
      onSelect: () => {
        const next = addGrant(grants, projectId, c.id, max);
        if (typeof next === "string") return onError(t(listErrorKey[next], { max }));
        onError(null);
        void patch({ externalAgents: next });
      },
    }));
}

/** Granted external agents of one project, with click-twice remove; on the project's page also 添加 (menu of agents outside it). */
function ProjectGrants({ projectId, security, patch, saving, showProject }: { projectId: string; security: AgentSecurity; patch: Patch; saving: boolean; showProject: boolean }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const hostId = useTargetHostId();
  const select = useTargetSelect();
  const [error, setError] = useState<string | null>(null);
  const grants = security.externalAgents ?? [];
  const mine = grantsFor(grants, projectId);
  const project = sidebar?.projects?.projects.find((p) => p.project_id === projectId);
  const icon = projectIcon(useUiPrefs().projectIcons, hostId, projectId);
  const menu = useGrantMenu(security, patch, setError)(projectId);
  const all = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
  const add = (el: HTMLElement) => openMenuFrom(el, menu);
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <div className="flex h-7 items-center gap-2">
        {showProject && project && <ProjectBadge icon={icon} badge={project.presentation.badge_label || project.presentation.display_name.slice(0, 1)} color={project.presentation.color} />}
        {showProject && <span className="min-w-0 truncate text-sm font-medium">{project?.presentation.display_name ?? projectId}</span>}
        <span className="text-xs text-subtle">{t("security.external.count", { n: mine.length })}</span>
        {/* The collab page adds from its section header (project → agent); a project's own page adds here. */}
        {!showProject && (
          <span className="ml-auto">
            <AddButton disabled={saving || menu.length === 0} onClick={(e) => add(e.currentTarget)}>
              {t("security.external.add")}
            </AddButton>
          </span>
        )}
      </div>
      {mine.map((g) => {
        const s = all.find((x) => x.cutexSessionId === g.agent);
        const pid = sidebar?.hostRows[g.agent]?.projectId ?? null;
        const where = pid ? (sidebar?.projects?.projects.find((p) => p.project_id === pid)?.presentation.display_name ?? pid) : t("security.independent");
        return (
          <div key={g.agent} className="flex h-8 items-center gap-2 pl-1">
            <Avatar name={s?.displayName ?? g.agent} avatar={s?.avatar} seed={g.agent} size={18} />
            <button disabled={!s} onClick={() => void select(g.agent)} className="min-w-0 truncate text-left text-sm enabled:hover:underline" title={g.agent}>
              {s?.displayName ?? g.agent}
            </button>
            <span className="shrink-0 text-xs text-subtle">· {s ? where : t("security.unknownAgent")}</span>
            <span className="ml-auto" />
            <ArmedRemove title={t("security.external.remove")} disabled={saving} onRemove={() => void patch({ externalAgents: removeGrant(grants, projectId, g.agent) })} />
          </div>
        );
      })}
      {error && <p className="pt-1 text-xs text-danger">{error}</p>}
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
    <Section title={t("security.external")} hint={t("security.external.hint")} actions={<Button onClick={() => openSettings("collab")}>{t("security.openSettings")}</Button>}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {security?.crossProjectAccess === "host" && <Notice>{t("security.hostModeNote")}</Notice>}
      {security ? <ProjectGrants projectId={projectId} security={security} patch={patch} saving={saving} showProject={false} /> : !error && <Loading rows={1} />}
    </Section>
  );
}

function LinksEditor({ security, patch, saving }: { security: AgentSecurity; patch: Patch; saving: boolean }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState<string | null>(null);
  const options = domainOptions(sidebar);
  const label = (o: (typeof options)[number]) => `${o.kind === "project" ? t("security.domain.project") : t("security.domain.agent")} · ${o.label}`;
  const selectOptions = [{ value: "", label: t("security.links.pick") }, ...options.map((o) => ({ value: o.key, label: label(o) }))];
  const max = security.maxLinks ?? DEFAULT_MAX_LINKS;
  const add = () => {
    const next = addLink(security.links, a, b, max);
    if (typeof next === "string") return setError(t(listErrorKey[next], { max }));
    setError(null);
    void patch({ links: next }).then((ok) => ok && (setA(""), setB("")));
  };
  return (
    <>
      {security.links.length === 0 && <p className="py-2 text-xs text-subtle">{t("security.links.none")}</p>}
      {security.links.map((link) => (
        <div key={link.join("|")} className="flex items-center gap-2 border-b border-border py-2 text-sm">
          <DomainName domain={link[0]} />
          <ArrowLeftRight size={13} className="shrink-0 text-subtle" />
          <DomainName domain={link[1]} />
          <span className="ml-auto" />
          <ArmedRemove title={t("security.links.remove")} disabled={saving} onRemove={() => void patch({ links: removeLink(security.links, link) })} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 py-2.5">
        <Select value={a} options={selectOptions} onChange={setA} width="w-56" />
        <ArrowLeftRight size={13} className="shrink-0 text-subtle" />
        <Select value={b} options={selectOptions} onChange={setB} width="w-56" />
        <Button disabled={saving || !a || !b} onClick={add}>
          {t("security.links.add")}
        </Button>
      </div>
      {/* Reserved line: an error never moves the section below. */}
      <p className="h-5 truncate text-xs text-danger">{error}</p>
    </>
  );
}

/**
 * 可见的外部 agent on the collab page (settings audit 2026-10-15, lead decision 5): only the projects
 * that have grants (in sidebar order, then ids the sidebar does not know); the header's 添加 picks a
 * project, then the external agent; no grants at all = one sentence.
 */
function ExternalGrantsSection({ security, patch, saving, host }: { security: AgentSecurity; patch: Patch; saving: boolean; host: boolean }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const [error, setError] = useState<string | null>(null);
  const menuFor = useGrantMenu(security, patch, setError);
  const projects = sidebar?.projects?.projects ?? [];
  const listed = grantedProjects(sidebar, security.externalAgents);
  const activeProjects = projects.filter((p) => (p.lifecycle ?? "active") === "active");
  const pick = (el: HTMLElement) =>
    openMenuFrom(
      el,
      activeProjects.map((p) => {
        const items = menuFor(p.project_id);
        return items.length > 0
          ? { label: p.presentation.display_name, submenu: items, onSelect: () => {} }
          : { label: p.presentation.display_name, hint: t("security.external.noCandidates"), disabled: true, onSelect: () => {} };
      }),
    );
  return (
    <Section
      id={settingsAnchorId("external")}
      title={t("security.external")}
      hint={t("security.external.hint")}
      actions={
        <AddButton disabled={saving || activeProjects.length === 0} title={activeProjects.length === 0 ? t("security.external.noProjects") : undefined} onClick={(e) => pick(e.currentTarget)}>
          {t("security.external.add")}
        </AddButton>
      }
    >
      {host && <p className="border-b border-border py-2 text-xs text-warn">{t("security.hostModeNote")}</p>}
      {listed.length === 0 && <EmptyState>{t("security.external.none")}</EmptyState>}
      {listed.map((id) => (
        <ProjectGrants key={id} projectId={id} security={security} patch={patch} saving={saving} showProject />
      ))}
      {error && <p className="py-1 text-xs text-danger">{error}</p>}
    </Section>
  );
}

export function CollabPage() {
  return (
    <>
      <BoundarySections />
      <MessageTemplatesSection />
      <SettingsSections page="collab" />
    </>
  );
}

/** 项目边界 / 外部 agent / 互通的项目 (cutex agent-project-boundary). */
function BoundarySections() {
  const { t } = useI18n();
  const boundary = useTargetFeatures().has(BOUNDARY_FEATURE);
  const grantsSupported = useTargetFeatures().has(EXTERNAL_GRANTS_FEATURE);
  const { security, error, saving, patch } = useAgentSecurity(boundary);
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
      <Section id={settingsAnchorId("boundary")} title={t("security.boundary")} hint={t("security.boundary.hint")}>
        <SettingRow label={t("security.crossProject")} hint={t(host ? "security.crossProject.hostHint" : "security.crossProject.isolatedHint")}>
          <Segmented<"isolated" | "host">
            value={security.crossProjectAccess}
            options={(security.crossProjectAccessOptions ?? ["isolated", "host"]).map((v) => ({ value: v, label: `${t(`security.crossProject.${v}` as MessageKey)}${v === def ? ` ${t("security.default")}` : ""}` }))}
            onChange={(v) => void patch({ crossProjectAccess: v })}
          />
        </SettingRow>
      </Section>
      {grantsSupported && <ExternalGrantsSection security={security} patch={patch} saving={saving} host={host} />}
      <Section id={settingsAnchorId("links")} title={t("security.links")} hint={t("security.links.hint")}>
        {host && <p className="border-b border-border py-2 text-xs text-warn">{t("security.hostModeNote")}</p>}
        <LinksEditor security={security} patch={patch} saving={saving} />
      </Section>
    </>
  );
}
