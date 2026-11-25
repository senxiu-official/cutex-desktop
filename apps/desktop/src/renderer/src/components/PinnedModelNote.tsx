// The conversation's start line when cutex refused to start an old agent because its saved model or reasoning
// effort cannot be used right now (shared/pinnedModel, Z5): no longer offered, or not for this runtime / configuration.
// It says so in plain words and offers 更换模型 / 更换强度: the existing model picker and effort picker, saved with
// `cutex/session/defaults/update` (nothing starts). After saving, 启动运行时 starts it, or the owner sends again; neither
// the save nor a refusal ever starts the agent or re-sends anything. The draft, attachments and the queued or failed
// inputs are not touched here.
//
// - Models: the agent's own Profile catalog. A Claude agent without a Profile (an old subscription agent) uses a
//   Claude Profile's catalog on the same host (the same Claude Code runtime): the host default if it is Claude, else
//   the first. A failed read can be retried; it is never kept as the answer.
// - The edit is bound to the revision the owner reviewed (expectedRevision), not whatever the store holds at Save:
//   another device's change in between is a conflict. After one, the choice stays, the settings read again are shown,
//   and only then can it be saved again (against that revision).
// - An older Claude adapter (`upgradeRequired`) cannot take an offline change of the effort: the hint says so,
//   升级运行时 is offered where the host has it, and the model alone can still be changed. Once the upgrade is applied
//   the effort can be changed again; starting stays a separate click.
import { useEffect, useRef, useState } from "react";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { CatalogModel, DaemonApi } from "../../../shared/ipc";
import { launchSelectionPatch, pinnedModelBlock, type PinnedModelBlock } from "../../../shared/pinnedModel";
import { useI18n, type MessageKey } from "../i18n";
import { hostApi, useApp } from "../store";
import { profileOf, runtimeOf } from "../lib/agentList";
import { isClaudeProfile } from "../lib/newAgentClaude";
import { effortName } from "../lib/effortDisplay";
import { useModelName } from "../lib/modelDisplay";
import { upgradeRuntimeAction } from "../lib/menus";
import { ModelPicker } from "./ModelPicker";
import { EffortPicker } from "./ConversationModelControls";
import { Button, TextLink } from "./settings/Form";

/** `via`: the Claude Profile whose list stands in for a Profile-less Claude agent. `missing`: no list to read. */
type Catalog = { models: CatalogModel[]; via: string | null; error: string | null; missing: MessageKey | null } | null;
/** undefined: keep the saved effort; null: none (the model's default); a string: that effort. */
type EffortChoice = string | null | undefined;
/** What the owner reviewed: the agent's revision and its saved model / effort then. */
type Basis = { revision: number | null; model: string | null; effort: string | null };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
const isConflict = (e: unknown) => /\b(revision_conflict|conflict|stale_revision)\b/.test(errorText(e));
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const revisionOf = (s: SessionResource | null) => (s && typeof s.revision === "number" ? s.revision : null);
/** The model / effort the agent has saved for its next start, as the resource says. */
const savedOf = (s: SessionResource | null) => ({
  model: text(s?.runtimeDefaults?.model) ?? text(s?.effectiveNextLaunch?.model),
  effort: text(s?.runtimeDefaults?.reasoningEffort),
});

class NoList extends Error {
  constructor(readonly key: MessageKey) { super(key); }
}

/** The models to choose from: the agent's Profile, else (a Claude agent without one) a Claude Profile on the host. */
async function readCatalog(api: Pick<DaemonApi, "profileModels" | "listProfiles">, session: SessionResource | null, profile: string | null): Promise<{ models: CatalogModel[]; via: string | null }> {
  if (profile) return { models: (await api.profileModels(profile)).models, via: null };
  if (!session || runtimeOf(session) !== "claude") throw new NoList("pinnedModel.noProfile");
  const list = await api.listProfiles();
  const claude = (list?.profiles ?? []).filter(isClaudeProfile);
  const pick = claude.find((p) => p.name === list?.defaultProfile || p.id === list?.defaultProfile) ?? claude[0];
  if (!pick) throw new NoList("pinnedModel.noClaudeProfile");
  return { models: (await api.profileModels(pick.name)).models, via: pick.name };
}

export function PinnedModelNote({ sessionId, hostId, session, block: started }: { sessionId: string; hostId: string; session: SessionResource | null; block: PinnedModelBlock }) {
  const { t } = useI18n();
  const modelName = useModelName();
  const profile = session ? profileOf(session) : null;
  // A refusal of the save itself (an invalid pair, an old adapter) replaces the start's.
  const [block, setBlock] = useState<PinnedModelBlock>(started);
  // What counts as saved comes from the start's refusal (then from a re-read after a conflict); a later refusal of a
  // save only changes the mode and what is offered.
  const [basis, setBasis] = useState<Basis>(() => ({
    revision: revisionOf(session),
    ...(started.kind === "unavailable" ? { model: started.model, effort: started.effort } : savedOf(session)),
  }));
  // A conflict at this revision: Save waits for the agent read again (and shows it).
  const [conflictAt, setConflictAt] = useState<number | null | undefined>(undefined);
  const [reread, setReread] = useState(false);
  const [upgraded, setUpgraded] = useState(false);
  const modelOnly = block.kind === "upgradeRequired" && !upgraded;
  const effortOnly = !modelOnly && started.kind === "unavailable" && started.reason === "effortUnavailable";
  const needsModel = started.kind === "unavailable" && started.reason === "modelUnavailable";
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>(null);
  const reading = useRef(false);
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<EffortChoice>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // After a conflict: once the agent has been read again (a new revision), that is what the owner now reviews.
  const revision = revisionOf(session);
  useEffect(() => {
    if (conflictAt === undefined || revision === conflictAt) return;
    setBasis({ revision, ...savedOf(session) });
    setConflictAt(undefined);
    setReread(true);
  }, [conflictAt, revision, session]);
  const refreshing = conflictAt !== undefined;

  const loadCatalog = () => {
    // A list in hand stays; a failed read is read again (never cached as the answer).
    if (reading.current || (catalog && !catalog.error && !catalog.missing)) return;
    reading.current = true;
    setCatalog(null);
    readCatalog(hostApi(hostId), session, profile).then(
      (view) => setCatalog({ ...view, error: null, missing: null }),
      (e: unknown) => setCatalog({ models: [], via: null, error: e instanceof NoList ? null : errorText(e), missing: e instanceof NoList ? e.key : null }),
    ).finally(() => { reading.current = false; });
  };
  const listProfile = catalog?.via ?? profile;
  const target = model ?? basis.model;
  const entry = catalog?.models.find((m) => m.id === target);
  // The efforts on offer: cutex's list for a rejected effort on the saved model, else the catalog's for the target.
  const refusedHere = block.kind === "unavailable" && block.reason === "effortUnavailable" && block.model === target && block.offeredEfforts.length ? block.offeredEfforts : null;
  const efforts = refusedHere ?? entry?.supportedReasoningEfforts ?? [];
  const pickModel = (next: string) => {
    setModel(next);
    setProblem(null);
    // The saved effort goes along only where the new model offers it; else its default (or none) is chosen, visibly.
    const m = catalog?.models.find((x) => x.id === next);
    const offered = m?.supportedReasoningEfforts ?? [];
    if (!modelOnly) setEffort(basis.effort && offered.includes(basis.effort) ? undefined : (m?.defaultReasoningEffort ?? null));
  };
  const chosen = effortOnly ? effort !== undefined : needsModel ? !!model : !!model || (!modelOnly && effort !== undefined);
  const ready = !busy && !refreshing && chosen;
  const choiceText = (m: string | null, e: EffortChoice) =>
    [m ? modelName(m, null, listProfile) : null, e === undefined ? null : e === null ? t("pinnedModel.effortNone") : effortName(t, e)].filter(Boolean).join(" · ");

  const save = async () => {
    setBusy(true);
    setProblem(null);
    const patch = launchSelectionPatch({ model: model && model !== basis.model ? model : null, effort: modelOnly ? undefined : effort });
    // Bound to the revision reviewed: a change made elsewhere since then is a conflict, not overwritten.
    const params = basis.revision === null ? { patch } : { patch, expectedRevision: basis.revision };
    try {
      await useApp.getState().sessionAction(sessionId, "cutex/session/defaults/update", params, hostId);
      setSaved(choiceText(model, modelOnly ? undefined : effort));
      setOpen(false);
    } catch (e) {
      const refused = pinnedModelBlock(e);
      if (refused) {
        // cutex refused this pair (or the adapter cannot take it): say why; the choice stays to change.
        setBlock(refused);
        if (refused.kind === "upgradeRequired") setUpgraded(false);
        setProblem(refused.kind === "upgradeRequired" ? t("pinnedModel.upgrade") : t("pinnedModel.rejected"));
      } else if (isConflict(e)) {
        // Changed elsewhere meanwhile: the agent is read again (sessionAction refreshes it); the choice stays, and
        // Save waits until what was read is shown.
        setConflictAt(basis.revision);
        setReread(false);
        setProblem(t("pinnedModel.conflict"));
      } else {
        setProblem(t("pinnedModel.failed", { error: errorText(e) }));
      }
    } finally {
      setBusy(false);
    }
  };
  const start = () => {
    setBusy(true);
    // A failed start shows on this line again (performSessionAction), with its own reason.
    void useApp.getState().sessionAction(sessionId, "cutex/runtime/online", { openVisibleTerminal: false }, hostId).catch(() => {}).finally(() => setBusy(false));
  };

  // 升级运行时: once applied, the effort can be changed again (the pin is read again); nothing starts.
  const upgrade = session && modelOnly ? upgradeRuntimeAction(session, t, hostId, (result) => {
    if (result !== "applied" && result !== "restarted") return;
    setUpgraded(true);
    setProblem(null);
    if (started.kind === "unavailable") setBlock(started);
    void useApp.getState().refreshHostSidebar(hostId).catch(() => {});
  }) : null;
  const headline = modelOnly
    ? t("pinnedModel.upgrade")
    : started.kind === "upgradeRequired"
      ? t("pinnedModel.upgraded")
      : started.reason === "effortUnavailable"
        ? t("pinnedModel.effortGone", { model: started.model ? modelName(started.model, null, listProfile) : "—", effort: started.effort ? effortName(t, started.effort) : "—" })
        : t("pinnedModel.modelGone", { model: started.model ? modelName(started.model, null, listProfile) : "—" });
  const listNote = !catalog
    ? t("pinnedModel.loading")
    : catalog.missing
      ? t(catalog.missing)
      : catalog.error
        ? t("pinnedModel.catalogFailed", { error: catalog.error })
        : catalog.models.length === 0
          ? t("pinnedModel.noModels")
          : undefined;

  return (
    <div data-pinned-model={modelOnly ? "upgrade" : started.kind === "unavailable" ? started.reason : "upgraded"} role="alert" className="side-col px-6 pb-1 text-xs">
      {saved ? (
        <p className="text-foreground" data-pinned-model-saved="">
          {t("pinnedModel.saved", { choice: saved })}
          <span className="ml-2 inline-flex"><Button onClick={start} disabled={busy}>{t("pinnedModel.start")}</Button></span>
        </p>
      ) : (
        <p className="text-warn">
          {headline}
          {!open && (
            <span className="ml-2 inline-flex gap-1.5">
              <TextLink onClick={() => { setOpen(true); loadCatalog(); }}>{t(effortOnly ? "pinnedModel.changeEffort" : "pinnedModel.change")}</TextLink>
              {upgrade && <TextLink onClick={() => void upgrade.onSelect()}>{upgrade.label}</TextLink>}
            </span>
          )}
        </p>
      )}
      {!saved && <p className="mt-0.5 text-subtle">{t("pinnedModel.kept")}</p>}
      {open && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface px-2.5 py-2" data-pinned-model-panel="">
          {(refreshing || reread) && (
            <p className="w-full text-subtle" data-pinned-model-current="">
              {refreshing ? t("pinnedModel.refreshing") : t("pinnedModel.current", { choice: choiceText(basis.model, basis.effort ?? null) || "—" })}
            </p>
          )}
          {!effortOnly && (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-subtle">{t("pinnedModel.model")}</span>
              <ModelPicker
                profile={listProfile}
                models={(catalog?.models ?? []).map((m) => ({ model: m.id, displayName: m.entryDisplayName ?? m.displayName ?? m.id, description: "" }))}
                current={model}
                label={model ? modelName(model, null, listProfile) : t("pinnedModel.pickModel")}
                note={listNote}
                onOpen={loadCatalog}
                onSelect={pickModel}
              />
              {catalog?.error && <TextLink onClick={loadCatalog}>{t("pinnedModel.retry")}</TextLink>}
              {catalog?.via && <span className="text-subtle" data-pinned-model-via="">{t("pinnedModel.via", { profile: catalog.via })}</span>}
            </span>
          )}
          {!modelOnly && (
            <span className="inline-flex items-center gap-1.5" data-pinned-model-effort="">
              <span className="text-subtle">{t("pinnedModel.effort")}</span>
              {efforts.length > 0 ? (
                <EffortPicker effort={effort === undefined ? basis.effort : effort} efforts={efforts} onChange={(e) => { setEffort(e); setProblem(null); }} />
              ) : (
                <span className="text-muted">{effort === undefined ? (basis.effort ? effortName(t, basis.effort) : "—") : t("pinnedModel.effortNone")}</span>
              )}
              {effort !== null && (basis.effort || effort) && <TextLink onClick={() => { setEffort(null); setProblem(null); }}>{t("pinnedModel.clearEffort")}</TextLink>}
            </span>
          )}
          {modelOnly && <span className="text-subtle">{t("pinnedModel.effortKept")}</span>}
          <span className="ml-auto inline-flex gap-1.5">
            <Button onClick={() => { setOpen(false); setProblem(null); }} disabled={busy}>{t("pinnedModel.cancel")}</Button>
            <Button primary onClick={() => void save()} disabled={!ready}>{busy ? t("pinnedModel.saving") : t("pinnedModel.save")}</Button>
          </span>
          <p className="w-full text-subtle">{t("pinnedModel.saveHint")}</p>
        </div>
      )}
      {problem && <p className="mt-0.5 text-danger" data-pinned-model-problem="">{problem}</p>}
    </div>
  );
}
