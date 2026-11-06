import { useEffect, useMemo, useState } from "react";
import { byNameThenId, useNameOrderKey } from "./rosterOrder";
import type { ProfileItem, ProfileModelsView } from "../../../shared/ipc";
import { apiFor } from "../bridge";
import { useI18n } from "../i18n";
import { cachedProfile, cachedProfileList, loadProfileList } from "./profileSnapshot";
import { defaultVariantOf, RUNTIME_LABEL } from "./profileVariants";
import { profileProvider } from "./provider";
import { profileMentionModelChoices, type ProfileMentionModel } from "./profileMentionModels";
import { finishProfileCascade, profileCascadeQuery, profileMentionAt, profileMentionText, type ProfileMentionCascade } from "./profileMentions";

type ProfileList = NonNullable<ReturnType<typeof cachedProfileList>>;
interface Cascade extends ProfileMentionCascade { item: ProfileItem; stage: "model" | "effort"; choice?: ProfileMentionModel; hostId: string; sessionId: string }
export interface ProfileMentionRow { key: string; label: string; description?: string; tag?: string; profile?: ProfileItem; model?: ProfileMentionModel; effort?: { id: string | null } }
/** In the combined `@` panel each group shows at most this many rows (agents, profiles); typing narrows them. */
export const AT_GROUP_ROWS = 5;
/** The agent rows the `@` panel shows: all of them without a profile group, else at most AT_GROUP_ROWS (the header says how many of how many). */
export function atAgentRows<T>(agents: readonly T[], profileRows: number): { shown: readonly T[]; total: number; cut: boolean } {
  const shown = profileRows ? agents.slice(0, AT_GROUP_ROWS) : agents;
  return { shown, total: agents.length, cut: shown.length < agents.length };
}
interface Options {
  /** A plain `@` mention open at the caret (Composer): its profile rows join the agents in one panel. */
  at?: { start: number; end: number; query: string } | null;
  text: string; caret: number; hostId: string; sessionId: string; currentProfile: string | null;
  runtime: string | null; features: ReadonlySet<string>; enabled: boolean;
  onChange(text: string, caret: number): void; focusAt(caret: number): void;
}
export function useProfileMentions(options: Options) {
  const { text, caret, hostId, sessionId, currentProfile, runtime, features, enabled } = options;
  const at = enabled ? options.at ?? null : null;
  const { t } = useI18n();
  const [picked, setPicked] = useState<Cascade | null>(null);
  const cascade = picked?.hostId === hostId && picked.sessionId === sessionId ? picked : null;
  const cascadeQuery = cascade ? profileCascadeQuery(text, caret, cascade) : null;
  const trigger = profileMentionAt(text, caret);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const triggerKey = trigger ? `${hostId}:${sessionId}:${trigger.start}:${trigger.kind}:${trigger.query}` : null;
  const validCascade = !!cascade && cascadeQuery !== null;
  const open = enabled && (validCascade || !!trigger && dismissed !== triggerKey);
  const effortStep = validCascade && cascade!.stage === "effort";
  const modelStep = validCascade || trigger?.kind === "model";
  const query = validCascade ? cascadeQuery! : trigger?.query ?? "";
  const [profiles, setProfiles] = useState<{ host: string; data: ProfileList | null; loading: boolean; error: boolean }>(() => ({ host: hostId, data: cachedProfileList(hostId), loading: false, error: false }));
  const list = profiles.host === hostId ? profiles.data : cachedProfileList(hostId);
  // The profile list loads for `p@`, a cascade, and a plain `@` (its profile group).
  const wantList = open || !!at;
  useEffect(() => {
    if (!wantList) return;
    let alive = true;
    setProfiles(old => ({ host: hostId, data: old.host === hostId ? old.data : cachedProfileList(hostId), loading: true, error: false }));
    loadProfileList(hostId).then(data => { if (alive) setProfiles({ host: hostId, data, loading: false, error: false }); }, () => { if (alive) setProfiles({ host: hostId, data: null, loading: false, error: true }); });
    return () => { alive = false; };
  }, [wantList, hostId]);
  useEffect(() => { if (picked && (!cascade || cascadeQuery === null)) setPicked(null); }, [picked, cascade, cascadeQuery]);
  const target = validCascade ? cascade!.item : modelStep ? list?.profiles.find(p => p.id === currentProfile || p.name === currentProfile) ?? null : null;
  const [models, setModels] = useState<{ host: string; profile: string; data: ProfileModelsView | null; loading: boolean; error: boolean } | null>(null);
  useEffect(() => {
    if (!open || !modelStep || !target) return;
    let alive = true;
    setModels({ host: hostId, profile: target.id, data: cachedProfile(target.id, hostId)?.models ?? null, loading: true, error: false });
    apiFor(hostId).profileModels(target.id).then(data => { if (alive) setModels({ host: hostId, profile: target.id, data, loading: false, error: false }); }, () => { if (alive) setModels({ host: hostId, profile: target.id, data: null, loading: false, error: true }); });
    return () => { alive = false; };
  }, [open, modelStep, hostId, target?.id]);
  const catalog = models?.host === hostId && models.profile === target?.id ? models.data : target ? cachedProfile(target.id, hostId)?.models ?? null : null;
  const profileRow = (profile: ProfileItem): ProfileMentionRow & { profile: ProfileItem } => {
    const kind = defaultVariantOf(profile)?.runtime ?? profile.cliKind;
    const description = [profile.provider ?? profile.modelProvider ?? profileProvider(profile), RUNTIME_LABEL[kind as keyof typeof RUNTIME_LABEL] ?? kind].filter(Boolean).join(" · ");
    return { key: `profile:${profile.id}`, label: profile.name || profile.id, description, profile };
  };
  const nameOrder = useNameOrderKey();
  const profileMatches = (needle: string) => [...(list?.profiles ?? [])]
    .sort(byNameThenId(p => p.name || p.id, p => p.id))
    .map(profileRow).filter(row => !needle || [row.label, row.profile.id, row.description].some(value => value?.toLocaleLowerCase().includes(needle)));
  // Plain `@`: the host's profiles in the owner's name order (lib/rosterOrder), at most AT_GROUP_ROWS; none while the list is unavailable
  // (loading the first time, failed, or a host without profiles): then the panel is agents only, as before.
  const atAll = useMemo(() => (at && !open ? profileMatches(at.query.toLocaleLowerCase()) : []), [at?.query, open, list, nameOrder]);
  const atRows = atAll.slice(0, AT_GROUP_ROWS);
  const rows = useMemo<ProfileMentionRow[]>(() => {
    if (!open) return [];
    const needle = query.toLocaleLowerCase();
    if (effortStep) {
      const effortName = (id: string) => {
        const key = `composer.effort.${id}` as Parameters<typeof t>[0];
        return t(key) === key ? id : t(key);
      };
      return [
        { key: "effort:default", label: t("mention.defaultEffort"), description: cascade!.choice?.defaultEffort ? effortName(cascade!.choice.defaultEffort) : undefined, effort: { id: null } },
        ...(cascade!.choice?.efforts ?? []).map(id => ({ key: `effort:${id}`, label: effortName(id), description: id, effort: { id } })),
      ].filter(row => !needle || (row.effort.id === null ? [row.label] : [row.label, row.description]).some(value => value?.toLocaleLowerCase().includes(needle)));
    }
    if (modelStep) {
      if (!target) return [];
      return profileMentionModelChoices(target, catalog, features, t, validCascade ? null : runtime)
        .filter(model => (validCascade || model.id !== null) && (!needle || [model.id, model.name].some(value => value?.toLocaleLowerCase().includes(needle))))
        .slice(0, 100).map(model => ({ key: `model:${model.id ?? "default"}`, label: model.name, description: model.id && model.id !== model.name ? model.id : undefined, tag: model.isDefault ? t("mention.defaultModel") : undefined, model }));
    }
    return profileMatches(needle).slice(0, 100);
  }, [open, query, effortStep, cascade, modelStep, target, catalog, features, t, validCascade, runtime, list, nameOrder]);
  const commit = (next: { text: string; caret: number }) => { options.onChange(next.text, next.caret); options.focusAt(next.caret); };
  /** A profile replaces the trigger text (`p@…` or `@…`) and opens its model step. */
  function pickProfile(profile: ProfileItem, range: { start: number; end: number }) {
    const raw = profileMentionText(profile.id), next = { text: text.slice(0, range.start) + raw + text.slice(range.end), caret: range.start + raw.length };
    setPicked({ profile: profile.id, item: profile, start: range.start, end: next.caret, raw, stage: "model", hostId, sessionId });
    commit(next);
  }
  function pickAt(index: number) {
    const row = atRows[index];
    if (row && at) pickProfile(row.profile, at);
  }
  function pick(index: number) {
    const row = rows[index];
    if (!row) return;
    if (row.profile && trigger) pickProfile(row.profile, trigger);
    else if (row.model) {
      const profileId = validCascade ? cascade!.profile : null;
      const start = validCascade ? cascade!.start : trigger?.start;
      if (start === undefined || !target) return;
      const nextEffort = !!row.model.id && row.model.efforts.length > 0;
      const raw = profileMentionText(profileId, row.model.id);
      const end = validCascade ? caret : trigger!.end;
      const after = text.slice(end), separator = !nextEffort && !after.startsWith(" ") ? " " : "";
      if (nextEffort) setPicked({ profile: profileId, model: row.model.id, item: target, stage: "effort", choice: row.model, start, end: start + raw.length, raw, hostId, sessionId });
      else setPicked(null);
      commit({ text: text.slice(0, start) + raw + separator + after, caret: start + raw.length + separator.length });
    } else if (row.effort && validCascade) {
      setPicked(null);
      commit(finishProfileCascade(text, caret, cascade!, cascade!.model ?? null, true, row.effort.id));
    }
  }

  function exit(space = false) {
    if (validCascade) { setPicked(null); commit(finishProfileCascade(text, caret, cascade!, cascade!.model ?? null, space)); }
    else setDismissed(triggerKey);
  }
  function change(next: string, at: number) {
    if (cascade) {
      const filter = profileCascadeQuery(next, at, cascade);
      const whitespace = filter?.search(/\s/);
      if (filter !== null && whitespace !== undefined && whitespace >= 0) {
        const suffix = filter.slice(whitespace);
        setPicked(null);
        options.onChange(next.slice(0, cascade.end) + suffix + next.slice(at), cascade.end + suffix.length);
        return;
      }
    }
    options.onChange(next, at);
  }
  const loading = effortStep ? false : modelStep ? !!target && (!models || models.host !== hostId || models.profile !== target.id || models.loading) : profiles.host !== hostId || profiles.loading;
  const error = modelStep ? models?.host === hostId && models.profile === target?.id && models.error : profiles.host === hostId && profiles.error;
  const empty = loading ? t("common.loading") : modelStep && !target ? t("mention.noCurrentProfile") : error ? t(modelStep ? "mention.loadModelsFailed" : "mention.loadProfilesFailed") : t(effortStep ? "mention.noEfforts" : modelStep ? "mention.noModels" : "mention.noProfiles");
  return { open, modelStep, effortStep, cascade: validCascade, query, rows, pick, exit, change, empty, atRows, atTotal: atAll.length, pickAt,
    title: effortStep ? t("mention.effortsFor", { model: cascade!.model ?? "—" }) : modelStep ? t("mention.modelsFor", { profile: target?.name ?? currentProfile ?? "—" }) : t("mention.profiles"),
    footer: t(effortStep ? "mention.effortFooter" : validCascade ? "mention.modelFooter" : modelStep ? "mention.modelOnlyFooter" : "mention.footer"),
    sendText: () => validCascade ? finishProfileCascade(text, caret, cascade!, cascade!.model ?? null, false).text : text,
  };
}
