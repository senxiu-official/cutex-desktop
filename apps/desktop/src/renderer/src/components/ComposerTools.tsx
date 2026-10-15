// The composer's "+" (DESIGN §4.3): what goes into the next message (输入) and which tools this
// session has (本会话工具). Persistent state stays in the bottom row; session management stays in
// the title bar ⋯; everything here is also reachable via `/`.
//   输入:       添加图片 · 引用文件 (@) · 引用技能 › ($name)
//   本会话工具: 计划模式 (switch) · 目标 · 记忆 › (项目记忆 / agent 记忆) · 技能 › (per-skill switch) · MCP › (status)
// Skills / MCP go through cutex `POST /v2/codex/requests` (shared CODEX_HOME config, no runtime
// needed); plan mode and goal need the live native thread. Project memory comes from cutex
// `GET /v2/projects/{id}/memory` (read-only here; edited on the Projects page).
import { useState, type ReactNode } from "react";
import { AtSign, BookOpen, Brain, ChevronRight, Flag, FolderKanban, ImagePlus, ListChecks, Plug, Plus, Sparkles, Wand2 } from "lucide-react";
import type { ListMcpServerStatusResponse, McpServerStatus, SkillMetadata } from "@cutex-desktop/protocol/codex/v2";
import { useI18n, type MessageKey } from "../i18n";
import { mcpState, mcpSummary, skillsSummary, sortSkills, type McpTone } from "../lib/composerTools";
import { Popover } from "./Menu";
import { Toggle } from "./settings/Form";
import { hostApi } from "../store";
import { useComposerHost } from "../lib/targetHost";

type FlyoutId = "skillRef" | "memory" | "skills" | "mcp";

const TONE: Record<McpTone, string> = { ok: "text-ok", warn: "text-warn", error: "text-danger", muted: "text-subtle" };

function Row({ icon, label, hint, oneLine, right, chevron, active, disabled, onClick }: { icon: ReactNode; label: string; hint?: string; oneLine?: boolean; right?: ReactNode; chevron?: boolean; active?: boolean; disabled?: boolean; onClick?(): void }) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && onClick?.()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none ${disabled ? "opacity-40" : "hover:bg-surface-2 focus-visible:bg-surface-2"} ${active ? "bg-surface-2" : ""}`}
    >
      <span className="flex w-4 justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{label}</span>
        {hint && (
          <span className={`block text-xs text-subtle ${oneLine ? "truncate" : ""}`} title={oneLine ? hint : undefined}>
            {hint}
          </span>
        )}
      </span>
      {right}
      {chevron && <ChevronRight size={14} className="shrink-0 text-subtle" />}
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <div className="px-2.5 pt-1.5 pb-1 text-xs text-subtle">{title}</div>;
}

/** Hover / click row that opens a panel to its right (the "+" sits at the left edge). */
function FlyoutRow({ id, open, setOpen, row, header, footer, children }: { id: FlyoutId; open: FlyoutId | null; setOpen(id: FlyoutId | null): void; row: (active: boolean, toggle: () => void) => ReactNode; header?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const active = open === id;
  return (
    <div className="relative" onMouseEnter={() => setOpen(id)} onMouseLeave={() => setOpen(null)}>
      {row(active, () => setOpen(active ? null : id))}
      {active && (
        // Padding (not margin) bridges the gap so the pointer can travel into the flyout.
        <div className="absolute bottom-0 left-full z-30 pl-1">
          <div className="flex max-h-96 w-80 flex-col rounded-xl border border-border bg-surface p-1 shadow-xl">
            {header}
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            {footer && <div className="mt-1 border-t border-border pt-1">{footer}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export interface ComposerToolsProps {
  canImages: boolean;
  /** Why picking image files is unavailable although the model takes images (remote cutex without uploads); pasting still works. */
  imagePickBlocked?: string | null;
  canFiles: boolean;
  /** Why @file is unavailable (default: the cutex has no workspace browsing), e.g. "available once created". */
  filesDisabledReason?: string;
  onPickImages(): void;
  onMention(): void;
  /** All skills (enabled and disabled) from `skills/list`; null while loading / not loaded. */
  skills: SkillMetadata[] | null;
  skillsError: string | null;
  onLoadSkills(): void;
  onInsertSkill(skill: SkillMetadata): void;
  /** Why skill inputs are unavailable for this agent (Claude: `skillInput: false`); null = available. */
  skillRefDisabledReason?: string | null;
  plan: { available: boolean; on: boolean; disabledReason: string | null; set(on: boolean): void };
  /** Omitted (a Claude-profile draft: that runtime has no goals) → the 目标 row is hidden. */
  goal?: { label: string; disabledReason: string | null; onClick(): void };
  /** Omitted (new-chat draft: no project, no agent yet) → the 记忆 row is hidden. */
  memory?: {
    /** The agent's project; null for independent agents (项目记忆 is then disabled). */
    project: { id: string; name: string } | null;
    /** Why agent memory (the /memories panel) is unavailable, e.g. offline. */
    agentDisabledReason: string | null;
    onProject(): void;
    onAgent(): void;
    /** 管理…: the project's Projects page, or the memories panel for independent agents (the Projects page's memory tab when offline). */
    onManage(): void;
  };
  onManage(tab: "skills" | "mcp"): void;
}

export function ComposerTools({ canImages, imagePickBlocked, canFiles, filesDisabledReason, onPickImages, onMention, skills, skillsError, onLoadSkills, onInsertSkill, skillRefDisabledReason, plan, goal, memory, onManage }: ComposerToolsProps) {
  const { t } = useI18n();
  const [fly, setFly] = useState<FlyoutId | null>(null);
  const [mcp, setMcp] = useState<McpServerStatus[] | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);
  // The open agent's host's shared CODEX_HOME (it may not be the focus host).
  const hostId = useComposerHost();
  const api = hostApi(hostId);

  const loadMcp = () => {
    setMcpError(null);
    api.codexRequest("mcpServerStatus/list", { detail: "toolsAndAuthOnly" }).then(
      (r) => setMcp([...(r as ListMcpServerStatusResponse).data].sort((a, b) => a.name.localeCompare(b.name))),
      (e: unknown) => setMcpError(e instanceof Error ? e.message : String(e)),
    );
  };

  const toggleSkill = async (skill: SkillMetadata, enabled: boolean) => {
    setToggleError(null);
    setPending((p) => new Set(p).add(skill.path));
    try {
      await api.codexRequest("skills/config/write", { path: skill.path, enabled });
      onLoadSkills();
    } catch (e) {
      setToggleError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(skill.path);
        return next;
      });
    }
  };

  const sorted = skills ? sortSkills(skills) : null;
  const enabled = sorted?.filter((s) => s.enabled) ?? null;
  const skillDesc = (s: SkillMetadata) => s.interface?.shortDescription ?? s.shortDescription ?? s.description;
  const mcpSum = mcpSummary(mcp);
  const loading = <p className="px-2.5 py-1.5 text-xs text-subtle">{t("common.loading")}</p>;

  return (
    <Popover
      triggerTitle={t("composer.attach")}
      trigger={<Plus size={15} strokeWidth={2} className="block" />}
      width="w-72"
      overflowVisible
      onOpen={() => {
        setFly(null);
        setToggleError(null);
        onLoadSkills();
        loadMcp();
      }}
    >
      {(close) => (
        <>
          <Section title={t("composer.tools.input")} />
          <Row
            icon={<ImagePlus size={14} />}
            label={t("composer.attachImage")}
            hint={!canImages ? t("composer.image.unsupported") : (imagePickBlocked ?? t("composer.image.hint"))}
            disabled={!canImages || !!imagePickBlocked}
            onClick={() => {
              close();
              onPickImages();
            }}
          />
          <Row
            icon={<AtSign size={14} />}
            label={t("composer.attachFile")}
            hint={canFiles ? t("composer.attachFileHint") : (filesDisabledReason ?? t("composer.tools.filesUnavailable"))}
            disabled={!canFiles}
            onClick={() => {
              close();
              onMention();
            }}
          />
          {skillRefDisabledReason ? (
            <Row icon={<Sparkles size={14} />} label={t("composer.tools.skillRef")} hint={skillRefDisabledReason} disabled />
          ) : (
          <FlyoutRow
            id="skillRef"
            open={fly}
            setOpen={setFly}
            row={(active, toggle) => <Row icon={<Sparkles size={14} />} label={t("composer.tools.skillRef")} hint={t("composer.tools.skillRefHint")} chevron active={active} onClick={toggle} />}
            header={<Section title={t("composer.tools.skillRefTitle")} />}
          >
            {skillsError && <p className="px-2.5 py-1.5 text-xs text-danger">{skillsError}</p>}
            {!enabled && !skillsError && loading}
            {enabled?.length === 0 && <p className="px-2.5 py-1.5 text-xs text-subtle">{t("composer.tools.noSkills")}</p>}
            {enabled?.map((s) => (
              <Row
                key={s.path}
                icon={<span className="text-xs">$</span>}
                label={s.interface?.displayName ?? s.name}
                hint={skillDesc(s)}
                oneLine
                onClick={() => {
                  close();
                  onInsertSkill(s);
                }}
              />
            ))}
          </FlyoutRow>
          )}

          <div className="mt-1 border-t border-border pt-1">
            <Section title={t("composer.tools.session")} />
            {plan.available && (
              <Row
                icon={<ListChecks size={14} />}
                label={t("composer.tools.plan")}
                hint={plan.disabledReason ?? t("composer.collab.planHint")}
                disabled={!!plan.disabledReason}
                onClick={() => plan.set(!plan.on)}
                right={
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle checked={plan.on} disabled={!!plan.disabledReason} onChange={(v) => plan.set(v)} />
                  </span>
                }
              />
            )}
            {goal && (
              <Row
                icon={<Flag size={14} />}
                label={t("composer.tools.goal")}
                hint={goal.disabledReason ?? undefined}
                disabled={!!goal.disabledReason}
                right={<span className="max-w-28 truncate text-xs text-subtle">{goal.label}</span>}
                onClick={() => {
                  close();
                  goal.onClick();
                }}
              />
            )}
            {memory && (
            <FlyoutRow
              id="memory"
              open={fly}
              setOpen={setFly}
              row={(active, toggle) => <Row icon={<Brain size={14} />} label={t("composer.tools.memory")} chevron active={active} onClick={toggle} />}
              header={<Section title={t("composer.tools.memory")} />}
              footer={
                <Row
                  icon={<ChevronRight size={14} />}
                  label={t("composer.tools.manage")}
                  onClick={() => {
                    close();
                    memory.onManage();
                  }}
                />
              }
            >
              <Row
                icon={<FolderKanban size={14} />}
                label={t("composer.tools.memory.project")}
                hint={memory.project ? t("composer.tools.memory.projectHint", { name: memory.project.name }) : t("composer.tools.memory.noProject")}
                disabled={!memory.project}
                onClick={() => {
                  close();
                  memory.onProject();
                }}
              />
              <Row
                icon={<BookOpen size={14} />}
                label={t("composer.tools.memory.agent")}
                hint={memory.agentDisabledReason ?? t("composer.tools.memory.agentHint")}
                disabled={!!memory.agentDisabledReason}
                onClick={() => {
                  close();
                  memory.onAgent();
                }}
              />
            </FlyoutRow>
            )}
            <FlyoutRow
              id="skills"
              open={fly}
              setOpen={setFly}
              row={(active, toggle) => (
                <Row icon={<Wand2 size={14} />} label={t("composer.tools.skills")} chevron active={active} onClick={toggle} right={<span className="text-xs text-subtle tabular-nums">{skillsSummary(skills) ?? ""}</span>} />
              )}
              header={
                <div className="px-2.5 pt-1.5 pb-1">
                  <div className="text-xs text-subtle">{t("composer.tools.skills")}</div>
                  <div className="text-[11px] text-subtle">{t("composer.tools.skillsScope")}</div>
                </div>
              }
              footer={<Row
                  icon={<ChevronRight size={14} />}
                  label={t("composer.tools.manage")}
                  onClick={() => {
                    close();
                    onManage("skills");
                  }}
                />}
            >
              {(skillsError ?? toggleError) && <p className="px-2.5 py-1.5 text-xs text-danger">{skillsError ?? toggleError}</p>}
              {!sorted && !skillsError && loading}
              {sorted?.length === 0 && <p className="px-2.5 py-1.5 text-xs text-subtle">{t("composer.tools.noSkills")}</p>}
              {sorted?.map((s) => (
                <div key={s.path} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${s.enabled ? "" : "text-muted"}`}>{s.interface?.displayName ?? s.name}</span>
                    <span className="block truncate text-xs text-subtle" title={skillDesc(s)}>
                      {s.scope}
                      {s.pluginId ? ` · ${s.pluginId}` : ""} · {skillDesc(s)}
                    </span>
                  </span>
                  <Toggle checked={s.enabled} disabled={pending.has(s.path)} onChange={(v) => void toggleSkill(s, v)} />
                </div>
              ))}
            </FlyoutRow>
            <FlyoutRow
              id="mcp"
              open={fly}
              setOpen={setFly}
              row={(active, toggle) => (
                <Row
                  icon={<Plug size={14} />}
                  label="MCP"
                  chevron
                  active={active}
                  onClick={toggle}
                  right={mcpSum ? <span className={`text-xs tabular-nums ${TONE[mcpSum.tone]}`}>{mcpSum.text}</span> : mcpError ? <span className="text-xs text-danger">!</span> : null}
                />
              )}
              header={
                <div className="px-2.5 pt-1.5 pb-1">
                  <div className="text-xs text-subtle">{t("composer.tools.mcpTitle")}</div>
                  <div className="text-[11px] text-subtle">{t("composer.tools.mcpScope")}</div>
                </div>
              }
              footer={<Row
                  icon={<ChevronRight size={14} />}
                  label={t("composer.tools.manage")}
                  onClick={() => {
                    close();
                    onManage("mcp");
                  }}
                />}
            >
              {mcpError && <p className="px-2.5 py-1.5 text-xs text-danger">{mcpError}</p>}
              {!mcp && !mcpError && loading}
              {mcp?.length === 0 && <p className="px-2.5 py-1.5 text-xs text-subtle">{t("composer.tools.noMcp")}</p>}
              {mcp?.map((s) => {
                const st = mcpState(s);
                return (
                  <div key={s.name} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-surface-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full bg-current ${TONE[st.tone]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{s.name}</span>
                      <span className="block truncate text-xs text-subtle" title={s.toolsError ?? undefined}>
                        {s.toolsError ?? (st.tools > 0 ? t("settings.mcp.tools", { n: st.tools }) : (s.httpOrigin ?? ""))}
                      </span>
                    </span>
                    <span className={`text-xs ${TONE[st.tone]}`}>{t(`composer.tools.mcp.state.${st.key}` as MessageKey)}</span>
                  </div>
                );
              })}
            </FlyoutRow>
          </div>
        </>
      )}
    </Popover>
  );
}
