// Settings of 输入优化 (module input-refinement; owner 2026-11-26: on 会话, not a nav row of its own):
// - the card 「输入优化」 in 面板 → 会话 → 输入: the wand button on this desktop, the two shortcuts, and one row to
//   the detail page with what the host offers (InputRefinementCard);
// - the detail page under 会话 (InputRefinementSettings): v2 hosts (text-rewrite-v2): the host's templates (built-ins:
//   model only, 复制一份改; the owner's: a sub-page each, ./TemplateSettings.tsx); v1 hosts: which Profiles 提示词增强 uses — the open agent's own Profile (then backups, in
// order) or one fixed ordered list. With feature-profiles (owner 2026-11-25) the backups / list are 功能 Profiles,
// never agent Profiles; on an older cutex the picker is ordinary Profiles. The two sets of choices are saved apart
// (fallback / profiles vs featureFallback / featureProfiles), so neither is lost when a host gains or loses the
// capability. Saved on this desktop, per host (IDs belong to their host).
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, KeyRound, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ProfileItem } from "../../../../shared/ipc";
import { FEATURE_PROFILES_FEATURE } from "../../../../shared/featureProfiles";
import { TEXT_REWRITE_FEATURE, TEXT_REWRITE_MAX_PROFILES } from "../../../../shared/textRewrite";
import { TEXT_REWRITE_GLOBAL_ROUTE_FEATURE, TEXT_REWRITE_V2_FEATURE, copyOfTemplate, type RewriteTemplate, type RewriteTemplateRoute } from "../../../../shared/textRewriteV2";
import { useFeatureProfiles } from "../../lib/featureProfiles";
import { FEATURE_PROFILES_SECTION } from "../../lib/featureProfilesNav";
import { useOrderedProfiles } from "../../lib/profileOrder";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useBindingLabel } from "../../lib/useKeybindings";
import { useApp } from "../../store";
import { AddButton, Button, EmptyState, ErrorNote, HintAction, IconButton, LinkRow, ListRow, Loading, Notice, Section, Segmented, Select, SettingRow, SubPageRow, Toggle } from "../../components/settings/Form";
import { INPUT_REFINEMENT_SECTION } from "../../lib/inputRefinementNav";
import { EntityIcon } from "../../components/EntityIcon";
import { hostRoute, setHostRoute, setPromptEnhanceEnabled, usePromptEnhancePrefs } from "./rewrite";
import { GLOBAL_ROUTE_SECTION, SETTINGS_PAGE, TEMPLATE_SUB, followsGlobal, putGlobalRoute, templateSummaryKey, setTemplateEdit, templateName, useGlobalRoute, useRouteText, useTemplates } from "./templates";
import { RouteRows } from "./TemplateSettings";

/** The host's ordinary Profiles (older cutex only; `enabled` false: nothing is read). */
function useHostProfiles(enabled: boolean): ProfileItem[] | null {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const [profiles, setProfiles] = useState<ProfileItem[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setProfiles(null);
    api.listProfiles().then((r) => { if (live) setProfiles(r?.profiles ?? []); }, () => { if (live) setProfiles([]); });
    return () => { live = false; };
  }, [hostId, enabled]); // the host decides; its api object is rebuilt per render
  return useOrderedProfiles(profiles, hostId);
}

/** One choosable row of either kind. */
interface Choice { id: string; name: string; model?: string; icon: ReactNode; option?: { kind: "profile"; profile: ProfileItem; hostId: string } }

/** An ordered list of IDs: move, remove, add from the choices not in it yet. */
function OrderList({ ids, max, choices, addLabel, onChange, testId, rowAttr, missingIcon }: {
  ids: string[]; max: number; choices: Choice[] | null; addLabel: string; onChange(next: string[]): void; testId: string;
  rowAttr: "data-profile-id" | "data-feature-profile-id"; missingIcon(id: string): ReactNode;
}) {
  const { t } = useI18n();
  const byId = new Map((choices ?? []).map((c) => [c.id, c]));
  const move = (i: number, by: -1 | 1) => {
    const next = [...ids];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    onChange(next);
  };
  const addable = (choices ?? []).filter((c) => !ids.includes(c.id));
  return (
    <div className="flex w-full flex-col gap-1" data-testid={testId}>
      {ids.length === 0 && <p className="text-xs text-subtle">{t("input-refinement.settings.none")}</p>}
      {ids.map((id, i) => {
        const c = byId.get(id);
        return (
          <div key={id} className="flex min-h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2" {...{ [rowAttr]: id }}>
            <span className="w-4 shrink-0 text-right font-mono text-caption/[inherit] text-subtle">{i + 1}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">{c?.icon ?? missingIcon(id)}<span className="min-w-0 truncate">{c?.name ?? id}</span></span>
            {c?.model && <span className="truncate text-caption/[inherit] text-subtle">{c.model}</span>}
            {choices && !c && <span className="text-caption/[inherit] text-warn-text">{t("input-refinement.settings.missingProfile")}</span>}
            <IconButton label={t("input-refinement.settings.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></IconButton>
            <IconButton label={t("input-refinement.settings.moveDown")} disabled={i === ids.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></IconButton>
            <IconButton label={t("input-refinement.settings.remove")} onClick={() => onChange(ids.filter((x) => x !== id))}><X size={13} /></IconButton>
          </div>
        );
      })}
      {ids.length < max && addable.length > 0 && (
        <Select<string>
          value=""
          label={addLabel}
          options={[{ value: "", label: addLabel }, ...addable.map((c) => ({ value: c.id, label: c.model ? `${c.name} · ${c.model}` : c.name, ...(c.option ? { entity: c.option } : {}) }))]}
          onChange={(v) => { if (v) onChange([...ids, v]); }}
        />
      )}
    </div>
  );
}

const featureIcon = <KeyRound size={13} className="shrink-0 text-muted" aria-hidden />;

/** v1 hosts (no text-rewrite-v2): which Profiles the 提示词增强 call uses, saved on this desktop per host. */
function RouteSection() {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const hostId = useTargetHostId();
  const prefs = usePromptEnhancePrefs();
  const rewrite = features.has(TEXT_REWRITE_FEATURE) && !features.has(TEXT_REWRITE_V2_FEATURE);
  const capable = features.has(FEATURE_PROFILES_FEATURE);
  const { list: featureList } = useFeatureProfiles(hostId, rewrite && capable);
  const profiles = useHostProfiles(rewrite && !capable);
  const openSettings = useApp((s) => s.openSettings);
  if (!rewrite) return null;
  const route = hostRoute(hostId, prefs);
  const choices: Choice[] | null = capable
    ? featureList?.map((p) => ({ id: p.id, name: p.name, model: p.model, icon: featureIcon })) ?? null
    : profiles?.map((p) => ({ id: p.id, name: p.name, model: p.model ?? undefined, icon: <EntityIcon entity={{ kind: "profile", profile: p, hostId }} />, option: { kind: "profile" as const, profile: p, hostId } })) ?? null;
  const missingIcon = (id: string) => (capable ? featureIcon : <EntityIcon entity={{ kind: "profile", ref: id, hostId }} />);
  const manage = capable ? <HintAction onClick={() => openSettings("profiles", { anchor: FEATURE_PROFILES_SECTION })}>{t("input-refinement.settings.manageFeatureProfiles")}</HintAction> : null;
  const none = capable && featureList !== null && featureList.length === 0;
  const rowAttr = capable ? "data-feature-profile-id" as const : "data-profile-id" as const;
  const addLabel = t(capable ? "input-refinement.settings.featureAdd" : "input-refinement.settings.add");
  return (
    <Section id={settingsAnchorId("input-refinement-route")} title={t("input-refinement.settings.route.title")}>
          <SettingRow agents="none" source="local" label={t("input-refinement.settings.route")}
            hint={t(route.mode === "agent"
              ? (capable ? "input-refinement.settings.route.featureAgentHint" : "input-refinement.settings.route.agentHint")
              : (capable ? "input-refinement.settings.route.featureProfileHint" : "input-refinement.settings.route.profileHint"))}>
            <Segmented
              value={route.mode}
              options={[
                { value: "agent" as const, label: t("input-refinement.settings.route.agent") },
                { value: "profile" as const, label: t(capable ? "input-refinement.settings.route.featureProfile" : "input-refinement.settings.route.profile") },
              ]}
              onChange={(mode) => setHostRoute(hostId, { mode })}
            />
          </SettingRow>
          {route.mode === "agent" ? (
            <SettingRow agents="none" source="local" label={t(capable ? "input-refinement.settings.featureFallback" : "input-refinement.settings.fallback")}
              hint={<>{t(none ? "input-refinement.settings.noFeatureProfiles" : "input-refinement.settings.fallbackHint", { n: TEXT_REWRITE_MAX_PROFILES - 1 })}{manage}</>}>
              <OrderList ids={capable ? route.featureFallback : route.fallback} max={TEXT_REWRITE_MAX_PROFILES - 1} choices={choices} addLabel={addLabel} rowAttr={rowAttr} missingIcon={missingIcon}
                onChange={(next) => setHostRoute(hostId, capable ? { featureFallback: next } : { fallback: next })} testId="prompt-enhance-fallback" />
            </SettingRow>
          ) : (
            <SettingRow agents="none" source="local" label={t(capable ? "input-refinement.settings.featureProfiles" : "input-refinement.settings.profiles")}
              hint={<>{t(none ? "input-refinement.settings.noFeatureProfiles" : "input-refinement.settings.profilesHint", { n: TEXT_REWRITE_MAX_PROFILES })}{manage}</>}>
              <OrderList ids={capable ? route.featureProfiles : route.profiles} max={TEXT_REWRITE_MAX_PROFILES} choices={choices} addLabel={addLabel} rowAttr={rowAttr} missingIcon={missingIcon}
                onChange={(next) => setHostRoute(hostId, capable ? { featureProfiles: next } : { profiles: next })} testId="prompt-enhance-profiles" />
            </SettingRow>
          )}
    </Section>
  );
}

/**
 * 面板 → 会话 → 输入 → 输入优化: the wand button (this desktop), the two rebindable keys (设置 → 快捷键), and one row
 * to the detail page: the focus host's templates (v2) or which Profiles 提示词增强 uses (v1).
 */
export function InputRefinementCard() {
  const { t } = useI18n();
  const prefs = usePromptEnhancePrefs();
  const key = useBindingLabel("promptEnhance");
  const pickKey = useBindingLabel("inputRefinementPick");
  const openSettings = useApp((s) => s.openSettings);
  const shortcuts = () => openSettings("shortcuts");
  const features = useTargetFeatures();
  const v2 = features.has(TEXT_REWRITE_V2_FEATURE);
  const v1 = features.has(TEXT_REWRITE_FEATURE);
  const detail = () => openSettings(SETTINGS_PAGE);
  return (
    <Section id={settingsAnchorId(INPUT_REFINEMENT_SECTION)} title={t("input-refinement.page")} hint={t("input-refinement.pageHint")}>
      <SettingRow agents="none" source="local" label={t("input-refinement.settings.button")} hint={t("input-refinement.settings.buttonHint")}>
        <Toggle checked={prefs.enabled} onChange={setPromptEnhanceEnabled} />
      </SettingRow>
      <LinkRow agents="none" source="local" label={t("input-refinement.settings.key")} hint={t("input-refinement.settings.keyRow", { key: key || "—" })} link={t("conversation.sendKeys.shortcutsLink")} onClick={shortcuts} />
      <LinkRow agents="none" source="local" label={t("input-refinement.settings.pickKey")} hint={t("input-refinement.settings.pickKeyRow", { key: pickKey || "—" })} link={t("conversation.sendKeys.shortcutsLink")} onClick={shortcuts} />
      {v2 ? <TemplatesRow onOpen={detail} /> : v1 ? <RouteRow onOpen={detail} /> : <Notice tone="info">{t("input-refinement.error.unsupported")}</Notice>}
    </Section>
  );
}

/** The card's row to the templates: their names, in the host's order. */
function TemplatesRow({ onOpen }: { onOpen(): void }) {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const { list } = useTemplates(hostId, true, useTargetFeatures().has(FEATURE_PROFILES_FEATURE));
  const last = usePromptEnhancePrefs().lastTemplate[hostId];
  const route = useRouteSummary(hostId);
  // The one the wand uses now, and which Profile / model it calls: visible here, one level up from its sub-page.
  const current = list ? list.find((tpl) => tpl.id === last) ?? list[0] : undefined;
  const summary = current ? t("input-refinement.settings.currentRoute", { template: templateName(t, current), route: route(current) }) : undefined;
  return <SubPageRow effect={{ agents: "none", source: "host" }} title={list ? t("input-refinement.settings.templates", { n: list.length }) : t("input-refinement.settings.templatesTitle")} summary={summary} onOpen={onOpen} />;
}

/** The card's row to which Profiles 提示词增强 uses (v1 hosts). */
function RouteRow({ onOpen }: { onOpen(): void }) {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const capable = useTargetFeatures().has(FEATURE_PROFILES_FEATURE);
  const route = hostRoute(hostId, usePromptEnhancePrefs());
  const summary = route.mode === "agent"
    ? t("input-refinement.settings.route.agent")
    : t(capable ? "input-refinement.settings.route.featureProfile" : "input-refinement.settings.route.profile");
  return <SubPageRow effect={{ agents: "none", source: "local" }} title={t("input-refinement.settings.route.title")} summary={summary} onOpen={onOpen} />;
}

/** What a template's route reads as in its list row: 跟随全局 (r298), else its route (useRouteText). */
function useRouteSummary(hostId: string): (tpl: RewriteTemplate) => string {
  const { t } = useI18n();
  const text = useRouteText(hostId);
  return (tpl) => (followsGlobal(tpl) ? t("input-refinement.settings.summary.followGlobal") : text(tpl.route));
}

/** r298: the global Profile order (templates without their own setting use it), saved on the host by PATCH. */
function GlobalRouteSection() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const api = useTargetApi();
  const { route, error } = useGlobalRoute(hostId, true);
  const [draft, setDraft] = useState<RewriteTemplateRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const shown = draft ?? route;
  const empty = shown?.mode === "profiles" && !shown.candidates.length;
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setFailed(null);
    try { putGlobalRoute(hostId, await api.patchTextRewriteRoute(draft)); setDraft(null); }
    catch (e) { setFailed(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Section id={settingsAnchorId(GLOBAL_ROUTE_SECTION)} title={t("input-refinement.settings.global.title")} hint={t("input-refinement.settings.global.hint")}>
      <div data-testid="input-refinement-global">
        {error && !route && <ErrorNote>{t("input-refinement.settings.loadFailed", { message: error })}</ErrorNote>}
        {!shown && !error && <Loading />}
        {shown && <RouteRows hostId={hostId} route={shown} onChange={setDraft} />}
        {failed && <ErrorNote>{t("input-refinement.template.failed", { message: failed })}</ErrorNote>}
        {draft && empty && <Notice>{t("input-refinement.template.badRoute")}</Notice>}
        {draft && (
          <div className="flex justify-end gap-2 pt-1">
            <Button disabled={busy} onClick={() => setDraft(null)}>{t("input-refinement.cancel")}</Button>
            <Button primary disabled={busy || empty || JSON.stringify(draft) === JSON.stringify(route)} onClick={() => void save()}>{t("input-refinement.template.save")}</Button>
          </div>
        )}
      </div>
    </Section>
  );
}

/** v2 hosts: the host's templates, one row each (R6); a row opens its sub-page, built-ins offer 复制一份改. */
function TemplatesSection() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const { list, error } = useTemplates(hostId, true, useTargetFeatures().has(FEATURE_PROFILES_FEATURE));
  const openSettings = useApp((s) => s.openSettings);
  const summary = useRouteSummary(hostId);
  const globalHost = useTargetFeatures().has(TEXT_REWRITE_GLOBAL_ROUTE_FEATURE);
  const open = (edit: Parameters<typeof setTemplateEdit>[0]) => {
    setTemplateEdit(edit);
    openSettings(SETTINGS_PAGE, { sub: TEMPLATE_SUB });
  };
  const copy = (tpl: RewriteTemplate) => open({ hostId, draft: copyOfTemplate(tpl, t("input-refinement.settings.copyName", { name: templateName(t, tpl) })), copiedFrom: templateName(t, tpl) });
  return (
    <Section id={settingsAnchorId("input-refinement-templates")} title={list ? t("input-refinement.settings.templates", { n: list.length }) : t("input-refinement.settings.templatesTitle")}
      hint={t("input-refinement.settings.templatesHint")}
      actions={<AddButton onClick={() => open({ hostId, draft: { kind: "enhance", name: "", prompt: "", route: globalHost ? null : { mode: "agent", model: null, fallback: [] } }, copiedFrom: null })}>{t("input-refinement.settings.new")}</AddButton>}>
      {error && <ErrorNote>{t("input-refinement.settings.loadFailed", { message: error })}</ErrorNote>}
      {!list && !error && <Loading />}
      {list?.length === 0 && <EmptyState>{t("input-refinement.settings.templatesHint")}</EmptyState>}
      <div data-testid="input-refinement-templates">
        {list?.map((tpl) => (
          <ListRow key={tpl.id}
            title={<span className="inline-flex items-center gap-1.5" data-template-id={tpl.id}>{templateName(t, tpl)}{tpl.builtIn && <span className="rounded bg-surface-2 px-1 text-caption/[inherit] text-muted">{t("input-refinement.settings.builtIn")}</span>}</span>}
            detail={`${t(templateSummaryKey(tpl))} · ${summary(tpl)}`}
            actions={<>
              {tpl.builtIn && <Button onClick={() => copy(tpl)}>{t("input-refinement.settings.copy")}</Button>}
              <IconButton label={t("input-refinement.settings.open")} onClick={() => open({ hostId, id: tpl.id })}><ChevronRight size={14} /></IconButton>
            </>}
          />
        ))}
      </div>
    </Section>
  );
}

/** 设置 › 会话 › 输入优化: the detail page (the button and keys are on the card in 会话). */
export function InputRefinementSettings() {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const v2 = features.has(TEXT_REWRITE_V2_FEATURE);
  const v1 = features.has(TEXT_REWRITE_FEATURE);
  const global = features.has(TEXT_REWRITE_GLOBAL_ROUTE_FEATURE);
  return v2 ? <>{global && <GlobalRouteSection />}<TemplatesSection /></> : v1 ? <RouteSection /> : <Notice tone="info">{t("input-refinement.error.unsupported")}</Notice>;
}
