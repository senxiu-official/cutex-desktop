// 设置 › 会话 › 输入优化 › 模板 (a sub-page of the detail page; which template: ./templates.ts useTemplateEdit). Host templates (cutex
// text-rewrite-v2): a built-in changes only which model it uses (恢复默认 = PATCH route null; its prompt is read-only,
// 复制一份改 makes an owner template); the owner's own change name, prompt and route, and can be deleted. A new
// template (blank or a copy) picks its type once and is saved by 创建. Each route is ordered: follow the agent (its
// own Profile, then backups) or fixed Profiles; every entry a 功能 Profile or an ordinary Profile, with an optional model.
// r298 hosts (text-rewrite-global-route): a template 跟随全局 (the detail page's 全局顺序, shown read-only here with a way
// there; new templates and 恢复默认 follow it) or 单独设置 (the editor below); switching back to follow = PATCH route null.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ProfileItem } from "../../../../shared/ipc";
import { FEATURE_PROFILES_FEATURE } from "../../../../shared/featureProfiles";
import { TEXT_REWRITE_MAX_PROFILES, utf8Bytes } from "../../../../shared/textRewrite";
import {
  REWRITE_TEMPLATE_MAX_CUSTOM, REWRITE_TEMPLATE_NAME_MAX, REWRITE_TEMPLATE_PROMPT_MAX_BYTES, TEXT_REWRITE_GLOBAL_ROUTE_FEATURE, copyOfTemplate, rewriteTemplateErrorOf, type RewriteCandidate, type RewriteTemplate, type RewriteTemplateCreate, type RewriteTemplateKind,
  type RewriteTemplateRoute,
} from "../../../../shared/textRewriteV2";
import { useFeatureProfiles } from "../../lib/featureProfiles";
import { useTargetApi, useTargetFeatures } from "../../lib/targetHost";
import { useApp } from "../../store";
import { AddButton, ArmedRemove, Button, EmptyState, ErrorNote, HintAction, IconButton, Loading, Notice, Section, Segmented, Select, SettingRow, TextArea, TextInput } from "../../components/settings/Form";
import { GLOBAL_ROUTE_SECTION, SETTINGS_PAGE, dropTemplate, putTemplate, setTemplateEdit, templateName, useGlobalRoute, useRouteText, useTemplateEdit, useTemplates } from "./templates";

const AGENT_ROUTE: RewriteTemplateRoute = { mode: "agent", model: null, fallback: [] };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The host's ordinary Profiles for the candidate pickers. */
function useProfiles(hostId: string): ProfileItem[] | null {
  const api = useTargetApi();
  const [profiles, setProfiles] = useState<ProfileItem[] | null>(null);
  useEffect(() => {
    let live = true;
    api.listProfiles().then((r) => { if (live) setProfiles(r?.profiles ?? []); }, () => { if (live) setProfiles([]); });
    return () => { live = false; };
  }, [hostId]); // the host decides; its api object is rebuilt per render
  return profiles;
}

/** The ordered candidates of a route (fixed list, or the agent's backups). */
function CandidateList({ hostId, list, max, onChange }: { hostId: string; list: RewriteCandidate[]; max: number; onChange(next: RewriteCandidate[]): void }) {
  const { t } = useI18n();
  const hasFeatureProfiles = useTargetFeatures().has(FEATURE_PROFILES_FEATURE);
  const features = useFeatureProfiles(hostId, hasFeatureProfiles).list ?? [];
  const profiles = useProfiles(hostId) ?? [];
  const choices = [
    ...features.map((f) => ({ value: `featureProfile:${f.id}`, label: `${f.name} · ${f.model}`, group: t("input-refinement.template.candidateKind.featureProfile") })),
    ...profiles.map((p) => ({ value: `profile:${p.id}`, label: p.model ? `${p.name} · ${p.model}` : p.name, group: t("input-refinement.template.candidateKind.profile"), entity: { kind: "profile" as const, profile: p, hostId } })),
  ];
  const keyOf = (c: RewriteCandidate) => `${c.kind}:${c.profileId}`;
  const nameOf = (c: RewriteCandidate) => (c.kind === "featureProfile" ? features.find((f) => f.id === c.profileId)?.name : profiles.find((p) => p.id === c.profileId)?.name) ?? c.profileId;
  const set = (i: number, patch: Partial<RewriteCandidate>) => onChange(list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    onChange(next);
  };
  const addable = choices.filter((c) => !list.some((x) => keyOf(x) === c.value));
  return (
    <div className="flex w-full flex-col gap-1" data-testid="input-refinement-candidates">
      {list.map((c, i) => (
        <div key={keyOf(c)} className="flex flex-col gap-1 rounded-md border border-border bg-surface px-2 py-1" data-candidate={keyOf(c)}>
          <div className="flex min-h-7 items-center gap-1.5">
            <span className="w-4 shrink-0 text-right font-mono text-caption/[inherit] text-subtle">{i + 1}</span>
            <span className="shrink-0 text-caption/[inherit] text-subtle">{t(c.kind === "featureProfile" ? "input-refinement.template.candidateKind.featureProfile" : "input-refinement.template.candidateKind.profile")}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{nameOf(c)}</span>
            <IconButton label={t("input-refinement.settings.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></IconButton>
            <IconButton label={t("input-refinement.settings.moveDown")} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></IconButton>
            <IconButton label={t("input-refinement.settings.remove")} onClick={() => onChange(list.filter((_, j) => j !== i))}><X size={13} /></IconButton>
          </div>
          <div className="flex items-center gap-1.5 pl-5.5">
            <span className="shrink-0 text-caption/[inherit] text-subtle">{t("input-refinement.template.model")}</span>
            <TextInput value={c.model ?? ""} width="w-56" mono label={t("input-refinement.template.model")} placeholder={t("input-refinement.template.modelDefault")} maxLength={200} floatingCounter
              onChange={(v) => set(i, { model: v.trim() ? v.trim() : null })} />
          </div>
        </div>
      ))}
      {list.length < max && addable.length > 0 && (
        <Select<string> value="" label={t("input-refinement.template.add")}
          options={[{ value: "", label: t("input-refinement.template.add") }, ...addable]}
          onChange={(v) => {
            const at = v.indexOf(":");
            if (at < 0) return;
            onChange([...list, { kind: v.slice(0, at) as RewriteCandidate["kind"], profileId: v.slice(at + 1) }]);
          }} />
      )}
    </div>
  );
}

export function RouteRows({ hostId, route, onChange }: { hostId: string; route: RewriteTemplateRoute; onChange(next: RewriteTemplateRoute): void }) {
  const { t } = useI18n();
  return (
    <>
      <SettingRow agents="none" source="host" label={t("input-refinement.template.mode")}
        hint={route.mode === "agent" ? t("input-refinement.template.mode.agentHint") : undefined}>
        <Segmented value={route.mode}
          options={[{ value: "agent" as const, label: t("input-refinement.template.mode.agent") }, { value: "profiles" as const, label: t("input-refinement.template.mode.profiles") }]}
          onChange={(mode) => onChange(mode === "agent"
            ? { mode: "agent", model: null, fallback: (route.mode === "agent" ? route.fallback : route.candidates).slice(0, TEXT_REWRITE_MAX_PROFILES - 1) }
            : { mode: "profiles", candidates: route.mode === "agent" ? route.fallback : route.candidates })} />
      </SettingRow>
      <SettingRow agents="none" source="host" label={t(route.mode === "agent" ? "input-refinement.template.fallbacks" : "input-refinement.template.candidates")}
        hint={t("input-refinement.template.routeHint", { n: route.mode === "agent" ? TEXT_REWRITE_MAX_PROFILES - 1 : TEXT_REWRITE_MAX_PROFILES })}
        sample={route.mode === "agent"
          ? <CandidateList hostId={hostId} list={route.fallback} max={TEXT_REWRITE_MAX_PROFILES - 1} onChange={(fallback) => onChange({ mode: "agent", model: null, fallback })} />
          : <CandidateList hostId={hostId} list={route.candidates} max={TEXT_REWRITE_MAX_PROFILES} onChange={(candidates) => onChange({ mode: "profiles", candidates })} />} />
    </>
  );
}

const KIB = 1024;
const PROMPT_KIB = REWRITE_TEMPLATE_PROMPT_MAX_BYTES / KIB;

/**
 * What's wrong with a draft (null: savable). Lengths as cutex counts them: the name in characters (a longer name saved
 * before the limit may stay as it is), the prompt in UTF-8 bytes.
 */
function problem(draft: RewriteTemplateCreate, builtIn: boolean, savedName: string | null): "badName" | "badPrompt" | "badPromptLong" | "badRoute" | null {
  if (!builtIn && (!draft.name.trim() || ([...draft.name].length > REWRITE_TEMPLATE_NAME_MAX && draft.name !== savedName))) return "badName";
  if (!builtIn && !draft.prompt.trim()) return "badPrompt";
  if (!builtIn && utf8Bytes(draft.prompt) > REWRITE_TEMPLATE_PROMPT_MAX_BYTES) return "badPromptLong";
  if (draft.route?.mode === "profiles" && !draft.route.candidates.length) return "badRoute";
  return null;
}

function Editor({ hostId, template, initial, copiedFrom, globalHost }: { hostId: string; template: RewriteTemplate | null; initial: RewriteTemplateCreate; copiedFrom: string | null; globalHost: boolean }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const openSettings = useApp((s) => s.openSettings);
  const [draft, setDraft] = useState<RewriteTemplateCreate>(initial);
  const global = useGlobalRoute(hostId, globalHost).route;
  const routeText = useRouteText(hostId);
  // 单独设置 starts from the template's own route if it had one, else from the global order.
  const [own, setOwn] = useState<RewriteTemplateRoute | null>(initial.route ?? (template && template.routeOverride !== null ? template.route : null));
  const setRoute = (route: RewriteTemplateRoute | null) => { if (route) setOwn(route); setDraft({ ...draft, route }); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const builtIn = !!template?.builtIn;
  const bad = problem(draft, builtIn, template?.name ?? null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (e) { setError(refusal(e)); } finally { setBusy(false); }
  };
  /** A refusal cutex names (r297: name / prompt too long, too many templates) in plain words; anything else as it came. */
  const refusal = (e: unknown) => {
    switch (rewriteTemplateErrorOf(e)) {
      case "rewrite_template_name_too_long": return t("input-refinement.template.nameTooLong", { n: REWRITE_TEMPLATE_NAME_MAX });
      case "rewrite_template_prompt_too_long": return t("input-refinement.template.promptTooLong", { kib: PROMPT_KIB });
      case "rewrite_template_capacity": return t("input-refinement.template.capacity", { n: REWRITE_TEMPLATE_MAX_CUSTOM });
      default: return t("input-refinement.template.failed", { message: errorText(e) });
    }
  };
  const save = () => run(async () => {
    if (!template) {
      const created = await api.createTextRewriteTemplate(draft);
      putTemplate(hostId, created);
      setTemplateEdit({ hostId, id: created.id });
      return;
    }
    const patch = builtIn ? { route: draft.route } : {
      ...(draft.name !== template.name ? { name: draft.name } : {}),
      ...(draft.prompt !== template.prompt ? { prompt: draft.prompt } : {}),
      ...(JSON.stringify(draft.route) !== JSON.stringify(template.route) ? { route: draft.route } : {}),
    };
    putTemplate(hostId, await api.patchTextRewriteTemplate(template.id, patch));
  });
  const restore = () => run(async () => { if (template) putTemplate(hostId, await api.patchTextRewriteTemplate(template.id, { route: null })); });
  const following = globalHost && draft.route === null;
  const remove = () => run(async () => {
    if (!template) return;
    await api.deleteTextRewriteTemplate(template.id);
    dropTemplate(hostId, template.id);
    setTemplateEdit(null);
    openSettings(SETTINGS_PAGE);
  });
  const copy = () => { if (template) setTemplateEdit({ hostId, draft: copyOfTemplate(template, t("input-refinement.settings.copyName", { name: templateName(t, template) })), copiedFrom: templateName(t, template) }); };
  const title = template ? templateName(t, template) : (draft.name.trim() || t("input-refinement.settings.new"));
  return (
    <>
      <Section title={title} hint={copiedFrom ? t("input-refinement.template.copiedFrom", { name: copiedFrom }) : undefined}
        actions={<>
          {builtIn && <Button onClick={copy}>{t("input-refinement.settings.copy")}</Button>}
          {builtIn && !(globalHost && template?.routeOverride === null) && <Button disabled={busy} onClick={() => void restore()} title={t(globalHost ? "input-refinement.template.restoreGlobalHint" : "input-refinement.template.restoreHint")}>{t("input-refinement.template.restore")}</Button>}
          {template && !builtIn && <ArmedRemove title={t("input-refinement.template.delete")} armedLabel={t("input-refinement.template.deleteArmed")} disabled={busy} onRemove={() => void remove()} />}
        </>}>
        <SettingRow agents="none" source="host" label={t("input-refinement.template.name")}>
          {builtIn ? <span className="text-sm">{title}</span>
            : <TextInput value={draft.name} label={t("input-refinement.template.name")} maxLength={REWRITE_TEMPLATE_NAME_MAX} floatingCounter onChange={(name) => setDraft({ ...draft, name })} />}
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("input-refinement.template.kind")} hint={t("input-refinement.template.kindFixed")}>
          {template ? <span className="text-sm">{t(draft.kind === "correction" ? "input-refinement.template.kind.correction" : "input-refinement.template.kind.enhance")}</span>
            : <Segmented<RewriteTemplateKind> value={draft.kind} options={[{ value: "enhance", label: t("input-refinement.template.enhance") }, { value: "correction", label: t("input-refinement.template.correction") }]} onChange={(kind) => setDraft({ ...draft, kind })} />}
        </SettingRow>
      </Section>
      <Section title={t("input-refinement.template.route")}>
        {globalHost && (
          <SettingRow agents="none" source="host" label={t("input-refinement.template.routeSource")}>
            <Segmented<"global" | "own"> value={following ? "global" : "own"}
              options={[{ value: "global", label: t("input-refinement.template.followGlobal") }, { value: "own", label: t("input-refinement.template.ownRoute") }]}
              onChange={(v) => setRoute(v === "global" ? null : structuredClone(own ?? global ?? AGENT_ROUTE))} />
          </SettingRow>
        )}
        {following
          ? (
            <SettingRow agents="none" source="host" label={t("input-refinement.template.globalNow")}
              hint={<HintAction onClick={() => openSettings(SETTINGS_PAGE, { anchor: GLOBAL_ROUTE_SECTION })}>{t("input-refinement.template.editGlobal")}</HintAction>}>
              <span className="text-sm text-muted" data-testid="input-refinement-global-shown">{global ? routeText(global) : "…"}</span>
            </SettingRow>
          )
          : <RouteRows hostId={hostId} route={draft.route ?? AGENT_ROUTE} onChange={(route) => setRoute(route)} />}
      </Section>
      <Section title={t("input-refinement.template.prompt")} hint={builtIn ? t("input-refinement.template.builtInPrompt") : t("input-refinement.template.promptHint")}>
        <SettingRow agents="none" source="host" label={t("input-refinement.template.prompt")}
          sample={<TextArea value={draft.prompt} rows={8} width="w-full" mono disabled={builtIn} label={t("input-refinement.template.prompt")} onChange={(prompt) => setDraft({ ...draft, prompt })} />} />
      </Section>
      {error && <ErrorNote>{error}</ErrorNote>}
      {bad && dirty && <Notice>{t(`input-refinement.template.${bad}` as const, { n: REWRITE_TEMPLATE_NAME_MAX, kib: PROMPT_KIB, now: (Math.ceil(utf8Bytes(draft.prompt) / KIB * 10) / 10).toString() })}</Notice>}
      <div className="flex justify-end gap-2" data-testid="input-refinement-template-save">
        <Button primary disabled={busy || !!bad || (!!template && !dirty)} onClick={() => void save()}>{t(template ? "input-refinement.template.save" : "input-refinement.template.create")}</Button>
      </div>
    </>
  );
}

/** The sub-page (设置 › 会话 › 输入优化 › 模板). */
export function TemplateSettings() {
  const { t } = useI18n();
  const edit = useTemplateEdit();
  const openSettings = useApp((s) => s.openSettings);
  const hostId = edit?.hostId ?? "";
  const features = useTargetFeatures();
  const globalHost = features.has(TEXT_REWRITE_GLOBAL_ROUTE_FEATURE);
  const { list, error } = useTemplates(hostId, !!edit && "id" in edit, features.has(FEATURE_PROFILES_FEATURE));
  if (!edit) return <EmptyState action={<AddButton onClick={() => openSettings(SETTINGS_PAGE)}>{t("input-refinement.page")}</AddButton>}>{t("input-refinement.template.gone")}</EmptyState>;
  if (!("id" in edit)) return <Editor key={`new:${JSON.stringify(edit.draft)}`} hostId={hostId} template={null} initial={edit.draft} copiedFrom={edit.copiedFrom} globalHost={globalHost} />;
  if (error && !list) return <ErrorNote>{t("input-refinement.settings.loadFailed", { message: error })}</ErrorNote>;
  if (!list) return <Loading />;
  const template = list.find((x) => x.id === edit.id);
  if (!template) return <EmptyState>{t("input-refinement.template.gone")}</EmptyState>;
  // r298: a template that follows the global order edits as route null (跟随全局); its own route otherwise.
  const route = globalHost && template.routeOverride === null ? null : (template.routeOverride ?? template.route);
  const initial: RewriteTemplateCreate = { kind: template.kind, name: template.name, prompt: template.prompt, route };
  return <Editor key={`${template.id}:${JSON.stringify(template)}`} hostId={hostId} template={template} initial={initial} copiedFrom={null} globalHost={globalHost} />;
}

