// 运行时配置 (owner 2026-11-28 「按推荐」; .claude/reports/runtime-config-pages-20261128.md): the codex-config module's
// pages under 主机与运行时. The overview (Codex: 插件, 钩子, 「Codex 跟随主机共享配置」; every runtime: 技能, MCP 服务器) and
// 技能 by runtime: one list per runtime from cutex runtime-skills (Codex, Claude; DSH / Kimi read-only behind their
// flags), each skill under its origin's card, 「复制到…」 on every Codex / Claude row (disabled with why where it does not
// apply). The settings host is the header's picker (one for all of Settings).
import { useCallback, useEffect, useState } from "react";
import type { RuntimeSkill, RuntimeSkillList, SkillRuntime, CopyRuntime } from "../../../../shared/runtimeSkills";
import { SKILL_RUNTIMES } from "../../../../shared/runtimeSkills";
import type { CutexRefusal } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { byOrigin, copyBlockedReason, isReadOnlyRuntime, listBlockedReason, otherRuntime, RUNTIME_NAME, sourceLabel } from "../../lib/runtimeSkillsView";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";
import { SkillCopyDialog } from "../SkillCopyDialog";
import { Tag } from "../Tag";
import { FollowSharedSection } from "./FollowShared";
import { Button, EmptyState, ErrorNote, LinkRow, ListRow, Loading, Notice, RefreshButton, Section, Segmented } from "./Form";
import { SkillsPage as CodexSkillsPage } from "./CapabilitiesSettings";

/** 运行时配置's own page: where each part is, and the Codex switch that covers all of them. */
export function RuntimeConfigPage() {
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  return (
    <>
      <Section id={settingsAnchorId("codex")} title={t("runtimeConfig.codex")} hint={t("runtimeConfig.codexHint")}>
        <LinkRow agents="next" source="codex" label={t("runtimeConfig.plugins")} hint={t("runtimeConfig.pluginsHint")} link={t("runtimeConfig.open")} onClick={() => openSettings("plugins")} />
        <LinkRow agents="next" source="codex" label={t("runtimeConfig.hooks")} hint={t("runtimeConfig.hooksHint")} link={t("runtimeConfig.open")} onClick={() => openSettings("hooks")} />
      </Section>
      <FollowSharedSection />
      <Section id={settingsAnchorId("shared")} title={t("runtimeConfig.shared")} hint={t("runtimeConfig.sharedHint")}>
        <LinkRow agents="next" source="host" label={t("runtimeConfig.skills")} hint={t("runtimeConfig.skillsHint")} link={t("runtimeConfig.open")} onClick={() => openSettings("skills")} />
        <LinkRow agents="next" source="codex" label={t("runtimeConfig.mcp")} hint={t("runtimeConfig.mcpHint")} link={t("runtimeConfig.open")} onClick={() => openSettings("mcp")} />
      </Section>
    </>
  );
}

type Loaded = { runtime: SkillRuntime; list: RuntimeSkillList | null; refusal: CutexRefusal | null; error: string | null };

function useRuntimeSkills(runtime: SkillRuntime, enabled: boolean) {
  const api = useTargetApi();
  const host = useTargetHostId();
  const [state, setState] = useState<Loaded | null>(null);
  const reload = useCallback(() => {
    if (!enabled) return;
    let live = true;
    setState(null);
    api.runtimeSkills(runtime).then(
      (r) => live && setState(r.ok ? { runtime, list: r.list, refusal: null, error: null } : { runtime, list: null, refusal: r.error, error: null }),
      (e: unknown) => live && setState({ runtime, list: null, refusal: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, enabled, host]);
  useEffect(reload, [reload]);
  return { state: state?.runtime === runtime ? state : null, reload };
}

/** 技能: the runtime filter, then that runtime's one list. */
export function RuntimeSkillsPage() {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const [runtime, setRuntime] = useState<SkillRuntime>("codex");
  const inventory = features.has("runtime-skills");
  // No inventory on this host's cutex: the Codex page as before, with why.
  if (!inventory) {
    return (
      <>
        <Section><Notice tone="info">{t("runtimeConfig.skills.noInventory")}</Notice></Section>
        <CodexSkillsPage />
      </>
    );
  }
  return (
    <>
      <Section id={settingsAnchorId("byRuntime")} title={t("runtimeConfig.skills.byRuntime")} hint={t("runtimeConfig.skills.byRuntimeHint")}>
        <div className="py-2" role="toolbar" aria-label={t("runtimeConfig.skills.runtime")} data-runtime-skills-filter="">
          <Segmented<SkillRuntime>
            label={t("runtimeConfig.skills.runtime")}
            value={runtime}
            onChange={setRuntime}
            options={SKILL_RUNTIMES.map((r) => ({ value: r, label: RUNTIME_NAME[r], title: isReadOnlyRuntime(r) ? t("runtimeConfig.skills.readOnlyTip", { runtime: RUNTIME_NAME[r] }) : undefined }))}
          />
        </div>
      </Section>
      {/* Codex: its own rows (查看 · 归档 · 默认启用, rules §5) with 「复制到…」 from the host list, one list; the
          other runtimes: the host list. */}
      {runtime === "codex" ? <CodexSkills /> : <RuntimeSkillList runtime={runtime} />}
    </>
  );
}

const pathKey = (path: string) => path.replaceAll("\\", "/").toLowerCase();

/** The Codex rows, each with 「复制到 Claude…」 matched to the host list by its SKILL.md path. */
function CodexSkills() {
  const features = useTargetFeatures();
  const { state, reload } = useRuntimeSkills("codex", true);
  const { copying, setCopying, dialog } = useCopyDialog("codex", () => reload());
  const listed = new Map((state?.list?.skills ?? []).map((s) => [pathKey(s.path), s]));
  return (
    <>
      <CodexSkillsPage
        copyTo={(native) => {
          const skill = listed.get(pathKey(native.path));
          const why = !state ? "loading" : skill ? copyBlockedReason("codex", skill, features) : "notListed";
          return <CopyButton runtime="codex" why={why} onCopy={() => skill && setCopying(skill)} />;
        }}
      />
      {copying && dialog}
    </>
  );
}

function useCopyDialog(runtime: SkillRuntime, onCopied: () => void) {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const hostLabel = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId);
  const [copying, setCopying] = useState<RuntimeSkill | null>(null);
  const dialog = copying && !isReadOnlyRuntime(runtime) ? (
    <SkillCopyDialog api={api} hostLabel={hostLabel} source={runtime as CopyRuntime} skill={copying} onClose={() => setCopying(null)} onCopied={onCopied} />
  ) : null;
  return { copying, setCopying, dialog };
}

/** 「复制到…」, in the same place on every Codex / Claude row; disabled with why where it does not apply (rules §5). */
function CopyButton({ runtime, why, onCopy }: { runtime: SkillRuntime; why: string | null; onCopy(): void }) {
  const { t } = useI18n();
  const title = why && why !== "loading" ? t(`runtimeConfig.skills.copyBlocked.${why}` as MessageKey, { runtime: RUNTIME_NAME[runtime] }) : undefined;
  return (
    <span title={title} data-runtime-skill-copy={why ?? "ok"}>
      <Button disabled={!!why} onClick={onCopy}>{t("runtimeConfig.skills.copyTo", { target: RUNTIME_NAME[otherRuntime(runtime as CopyRuntime)] })}</Button>
    </span>
  );
}

function RuntimeSkillList({ runtime }: { runtime: SkillRuntime }) {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const blocked = listBlockedReason(runtime, features);
  const { state, reload } = useRuntimeSkills(runtime, !blocked);
  const { setCopying, dialog } = useCopyDialog(runtime, reload);
  const name = RUNTIME_NAME[runtime];
  const readOnly = isReadOnlyRuntime(runtime);

  if (blocked) return <div data-runtime-skills-blocked={runtime}><Section><Notice tone="info">{t("runtimeConfig.skills.noFlag", { runtime: name })}</Notice></Section></div>;
  if (!state) return <Section><Loading rows={3} /></Section>;
  if (state.error) return <Section actions={<RefreshButton onClick={reload} />}><ErrorNote>{state.error}</ErrorNote></Section>;
  if (state.refusal) {
    return (
      <Section actions={<RefreshButton onClick={reload} />}>
        <Notice tone="info">{state.refusal.code === "unsupported_runtime" ? t("runtimeConfig.skills.unsupported", { runtime: name }) : state.refusal.message}</Notice>
      </Section>
    );
  }
  const list = state.list!;
  const groups = byOrigin(list.skills);
  const notes = (
    <>
      {list.coverage === "partial" && (
        <Notice tone="info">
          <span data-runtime-skills-partial="">{t("runtimeConfig.skills.partial")}</span>
          {list.limits.length > 0 && <span className="block">{list.limits.join(" · ")}</span>}
        </Notice>
      )}
      {list.truncated && <Notice tone="info">{t("runtimeConfig.skills.truncated")}</Notice>}
    </>
  );
  return (
    <div data-runtime-skills={runtime}>
      {groups.length === 0 && (
        <Section actions={<RefreshButton onClick={reload} />}>
          <EmptyState>{t("runtimeConfig.skills.none", { runtime: name })}</EmptyState>
          {notes}
        </Section>
      )}
      {groups.map((g, i) => (
        <Section
          key={g.origin}
          title={`${name} · ${t(`runtimeConfig.skills.origin.${g.origin}` as MessageKey)}`}
          tag={readOnly ? { label: t("runtimeConfig.skills.readOnly"), title: t("runtimeConfig.skills.readOnlyTip", { runtime: name }) } : undefined}
          actions={i === 0 ? <RefreshButton onClick={reload} /> : undefined}
        >
          {g.skills.map((s) => <SkillRow key={s.id} runtime={runtime} skill={s} onCopy={() => setCopying(s)} features={features} />)}
          {i === groups.length - 1 && notes}
        </Section>
      ))}
      {dialog}
    </div>
  );
}

function SkillRow({ runtime, skill, onCopy, features }: { runtime: SkillRuntime; skill: RuntimeSkill; onCopy(): void; features: ReadonlySet<string> }) {
  const { t } = useI18n();
  const source = sourceLabel(skill);
  const why = copyBlockedReason(runtime, skill, features);
  const readOnly = isReadOnlyRuntime(runtime);
  const state = skill.state === "unknown" ? null : t(`runtimeConfig.skills.state.${skill.state}` as MessageKey);
  return (
    <div data-runtime-skill={skill.name}>
      <ListRow
        title={<span title={skill.path}>{skill.name}</span>}
        detail={skill.description}
        actions={
          <>
            {source && <span className="max-w-40 truncate text-caption/[inherit] text-subtle" title={source.title} data-runtime-skill-source="">{source.label}</span>}
            {skill.compatibility.status === "review" && (
              <span title={t("runtimeConfig.skills.reviewTip", { fields: skill.compatibility.fields.join(", ") })}><Tag tone="attention">{t("runtimeConfig.skills.review")}</Tag></span>
            )}
            {state && <span className="text-caption/[inherit] text-subtle" data-runtime-skill-state={skill.state}>{state}</span>}
            {!readOnly && <CopyButton runtime={runtime} why={why} onCopy={onCopy} />}
          </>
        }
      />
    </div>
  );
}
