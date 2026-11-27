import { isImeComposing } from "../lib/ime";
// 「复制到…」 (运行时配置 → 技能; owner 2026-11-28 「按推荐」): copies one personal skill between Codex and Claude on the
// settings host through cutex runtime-skill-copy. Preview first (files, the scripts marked as code, setting
// differences, warnings); a taken name is skipped unless the owner picks 覆盖 (which previews again); a write needs the
// daemon's confirm phrase typed. One action id per preview, so 重试 after a lost answer replays instead of copying twice.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Copy, FileCode2, LoaderCircle, TriangleAlert } from "lucide-react";
import type { CutexRefusal, DaemonApi } from "../../../shared/ipc";
import type { CopyRuntime, SkillCopyPreview, SkillCopyResult } from "../../../shared/runtimeSkills";
import { useI18n, type MessageKey } from "../i18n";
import { confirmationOk, formatBytes, frontmatterChanges, knownCopyError, needsFreshPreview, newActionId, previewAction, RUNTIME_NAME, scriptFiles } from "../lib/runtimeSkillsView";
import { useOverlayRoot } from "../lib/ownerContext";
import { Tag } from "./Tag";
import { DetachedSettings, SettingsGroup } from "./settings/Form";

type Skill = { id: string; name: string };
type Failure = { code: string | null; message: string };

export function SkillCopyDialog({ api, hostLabel, source, skill, onClose, onCopied }: { api: DaemonApi; hostLabel: string; source: CopyRuntime; skill: Skill; onClose(): void; onCopied?(): void }) {
  const overlayRoot = useOverlayRoot();
  const { t } = useI18n();
  const target: CopyRuntime = source === "codex" ? "claude" : "codex";
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<SkillCopyPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [result, setResult] = useState<SkillCopyResult | null>(null);
  const [showScripts, setShowScripts] = useState(false);
  // One per preview token: a retry of the same apply reuses it.
  const actionId = useRef<string | null>(null);
  const run = useRef(0);

  const failureOf = (error: CutexRefusal | unknown): Failure => {
    if (error && typeof error === "object" && "code" in error && typeof (error as CutexRefusal).code === "string") {
      const r = error as CutexRefusal;
      return { code: r.code, message: knownCopyError(r.code) ? t(`skillCopy.error.${r.code}` as MessageKey, { message: r.message }) : r.message };
    }
    return { code: null, message: error instanceof Error ? error.message : String(error) };
  };

  const load = async (withOverwrite: boolean) => {
    const mine = ++run.current;
    setLoading(true);
    setFailure(null);
    setTyped("");
    actionId.current = null;
    try {
      const r = await api.previewSkillCopy({ sourceRuntime: source, targetRuntime: target, skillId: skill.id, ...(withOverwrite ? { overwrite: true } : {}) });
      if (mine !== run.current) return;
      if (r.ok) setPreview(r.preview);
      else setFailure(failureOf(r.error));
    } catch (e) {
      if (mine === run.current) setFailure(failureOf(e));
    } finally {
      if (mine === run.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseOverwrite = (on: boolean) => {
    if (on === overwrite) return;
    setOverwrite(on);
    void load(on); // A changed choice needs a fresh preview (and token).
  };

  const action = preview ? previewAction(preview) : "none";
  const apply = async () => {
    if (!preview?.previewToken || busy) return;
    actionId.current ??= newActionId();
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.copySkill({ sourceRuntime: source, targetRuntime: target, skillId: skill.id, ...(overwrite ? { overwrite: true } : {}), actionId: actionId.current, previewToken: preview.previewToken, ...(preview.confirmPhrase ? { confirmation: typed.trim() } : {}) });
      if (r.ok) {
        setResult(r.result);
        if (r.result.outcome !== "skipped") onCopied?.();
      } else {
        // A refusal wrote nothing: the next try is a new request (e.g. a corrected phrase), so a new action id.
        actionId.current = null;
        setFailure(failureOf(r.error));
      }
    } catch (e) {
      // A lost answer: 重试 sends the same action id, so a copy that did happen replays.
      setFailure(failureOf(e));
    } finally {
      setBusy(false);
    }
  };

  const button = "rounded-md px-3 py-1 text-sm disabled:opacity-50";
  const scripts = preview ? scriptFiles(preview) : [];
  const changes = preview ? frontmatterChanges(preview) : [];
  const canApply = !!preview && action !== "none" && confirmationOk(preview, typed) && !busy && !loading;
  const applyLabel = action === "overwrite" ? t("skillCopy.doOverwrite") : action === "skip" ? t("skillCopy.doSkip") : t("skillCopy.doCopy");

  return createPortal(
    <DetachedSettings>
    <div className="fixed inset-0 z-[151] flex items-start justify-center bg-black/30 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-copy-title"
        data-testid="skill-copy-dialog"
        className="flex max-h-[82vh] w-[36rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-surface p-4 shadow-2xl"
        onKeyDown={(e) => !isImeComposing(e) && e.key === "Escape" && !busy && onClose()}
      >
        <div id="skill-copy-title" className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Copy size={16} className="shrink-0 text-muted" />
          {t("skillCopy.title", { name: skill.name, target: RUNTIME_NAME[target] })}
        </div>
        <p className="mb-3 text-xs text-subtle">{t("skillCopy.intro", { host: hostLabel, source: RUNTIME_NAME[source], target: RUNTIME_NAME[target] })}</p>

        {result ? (
          <div role="status" data-skill-copy-result={result.outcome} className="flex flex-col gap-1.5 text-sm">
            <p className={result.outcome === "skipped" ? "text-muted" : "text-foreground"}>{t(`skillCopy.result.${result.outcome}`, { target: RUNTIME_NAME[target] })}</p>
            {result.outcome !== "skipped" && <p className="font-mono text-xs break-all text-subtle">{t("skillCopy.result.where", { destination: result.destination })}</p>}
            {result.replayed && <p className="text-xs text-subtle" data-skill-copy-replayed="">{t("skillCopy.result.replayed")}</p>}
            <div className="mt-2 flex justify-end">
              <button type="button" autoFocus onClick={onClose} className={`${button} press-solid bg-accent text-on-accent enabled:hover:brightness-110`}>{t("skillCopy.close")}</button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            {loading && (
              <p className="flex items-center gap-1.5 text-xs text-subtle" data-skill-copy-loading="">
                <LoaderCircle size={13} className="animate-spin" />
                {t("skillCopy.loading")}
              </p>
            )}
            {preview && !loading && (
              <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1 text-xs">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-subtle">{t("skillCopy.from")}</dt>
                  <dd className="min-w-0 truncate">{RUNTIME_NAME[source]} · {skill.name}</dd>
                  <dt className="text-subtle">{t("skillCopy.to")}</dt>
                  <dd className="min-w-0 font-mono break-all" title={preview.destination}>{RUNTIME_NAME[target]} · {preview.destination}</dd>
                  <dt className="text-subtle">{t("skillCopy.digest")}</dt>
                  <dd className="min-w-0 truncate font-mono text-subtle" title={preview.sourceDigest}>{preview.sourceDigest}</dd>
                </dl>

                <section data-skill-copy-files="">
                  <p className="mb-1 font-medium text-muted">{t("skillCopy.files", { n: preview.files.length })}</p>
                  <ul className="flex flex-col gap-0.5">
                    {preview.files.filter((f) => !f.script).map((f) => (
                      <li key={f.path} className="flex gap-2"><span className="min-w-0 flex-1 truncate font-mono">{f.path}</span><span className="shrink-0 text-subtle tabular-nums">{formatBytes(f.bytes)}</span></li>
                    ))}
                  </ul>
                </section>

                {scripts.length > 0 && (
                  <section data-skill-copy-scripts="" className="rounded-lg border border-warn/40 bg-attention-soft px-2.5 py-2">
                    <button type="button" aria-expanded={showScripts} onClick={() => setShowScripts(!showScripts)} className="flex w-full items-center gap-1.5 text-left font-medium text-warn-text">
                      <FileCode2 size={13} className="shrink-0" />
                      <span className="flex-1">{t("skillCopy.scripts", { n: scripts.length })}</span>
                      <span className="text-subtle">{showScripts ? t("skillCopy.hideScripts") : t("skillCopy.showScripts")}</span>
                      {showScripts ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <p className="mt-1 text-warn-text">{t("skillCopy.scriptsWarn")}</p>
                    {showScripts && (
                      <ul className="mt-1.5 flex flex-col gap-0.5" data-skill-copy-script-list="">
                        {scripts.map((f) => (
                          <li key={f.path} className="flex items-center gap-2"><Tag tone="attention">{t("skillCopy.script")}</Tag><span className="min-w-0 flex-1 truncate font-mono">{f.path}</span><span className="shrink-0 text-subtle tabular-nums">{formatBytes(f.bytes)}</span></li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                <section data-skill-copy-differences="">
                  <p className="mb-1 font-medium text-muted">{t("skillCopy.differences")}</p>
                  {changes.length === 0 ? (
                    <p className="text-subtle">{t("skillCopy.noDifferences")}</p>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {changes.map((c) => (
                        <li key={c.key} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-mono">{c.key}</span><Tag tone={c.change === "remove" ? "danger" : "attention"}>{t(`skillCopy.change.${c.change}` as MessageKey)}</Tag></li>
                      ))}
                    </ul>
                  )}
                </section>

                {preview.disposition === "blocked" && <p className="font-medium text-danger" data-skill-copy-blocked="">{t("skillCopy.blocked")}</p>}
                {preview.warnings.length > 0 && (
                  <section data-skill-copy-warnings="">
                    <p className="mb-1 font-medium text-muted">{t("skillCopy.warnings")}</p>
                    <ul className="flex flex-col gap-1">
                      {preview.warnings.map((w, i) => (
                        <li key={i} className="flex gap-1.5"><TriangleAlert size={12} className="mt-0.5 shrink-0 text-warn" /><span className="min-w-0 break-words">{w}</span></li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* The owner's choices for this write: the target runtime's {{agents}} see the copy from their next launch. */}
                <SettingsGroup agents="next" source="host">{({ attributes }) => (
                <div {...attributes} className="flex flex-col gap-3">
                {preview.destinationExists && preview.disposition !== "blocked" && (
                  <fieldset data-skill-copy-collision="" className="flex flex-col gap-1 rounded-lg bg-surface-2 px-2.5 py-2">
                    <legend className="sr-only">{t("skillCopy.exists", { target: RUNTIME_NAME[target], name: preview.name })}</legend>
                    <p className="mb-0.5">{t("skillCopy.exists", { target: RUNTIME_NAME[target], name: preview.name })}</p>
                    <label className="flex items-center gap-2"><input type="radio" name="skill-copy-collision" checked={!overwrite} disabled={busy} onChange={() => chooseOverwrite(false)} data-skill-copy-skip="" />{t("skillCopy.skip")}</label>
                    <label className="flex items-center gap-2"><input type="radio" name="skill-copy-collision" checked={overwrite} disabled={busy} onChange={() => chooseOverwrite(true)} data-skill-copy-overwrite="" />{t("skillCopy.overwrite", { target: RUNTIME_NAME[target] })}</label>
                  </fieldset>
                )}

                {preview.confirmPhrase && action !== "none" && (
                  <label className="flex flex-col gap-1">
                    <span>{t("skillCopy.confirm", { phrase: preview.confirmPhrase })}</span>
                    <input
                      data-skill-copy-confirm=""
                      value={typed}
                      disabled={busy}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => !isImeComposing(e) && e.key === "Enter" && canApply && void apply()}
                      spellCheck={false}
                      className="h-7 rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-accent"
                    />
                  </label>
                )}
                </div>
                )}</SettingsGroup>
              </div>
            )}
            {failure && (
              <p role="alert" className="text-xs break-words text-danger" data-skill-copy-error={failure.code ?? ""}>{failure.message}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={`${button} press text-muted hover:bg-surface-2`}>{t("skillCopy.cancel")}</button>
              {failure && (!preview || needsFreshPreview(failure.code ?? "")) ? (
                <button type="button" onClick={() => void load(overwrite)} disabled={loading} className={`${button} press-solid bg-accent text-on-accent enabled:hover:brightness-110`} data-skill-copy-repreview="">{t("skillCopy.repreview")}</button>
              ) : (
                action !== "none" && (
                  <button type="button" onClick={() => void apply()} disabled={!canApply} data-skill-copy-apply={action} className={`${button} press-solid ${action === "overwrite" ? "bg-danger-solid text-white" : "bg-accent text-on-accent"} enabled:hover:brightness-110`}>
                    {busy ? t("skillCopy.working") : failure ? t("skillCopy.retry") : applyLabel}
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    </DetachedSettings>,
    overlayRoot,
  );
}
