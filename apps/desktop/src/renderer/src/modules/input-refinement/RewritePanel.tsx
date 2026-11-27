// 输入优化's panel, in the float above the input box (components/ComposerActionLayer; ./useRewrite.ts): the request in flight (Esc cancels it), then the original
// and the shown version side by side with the changes marked, 第 N 版 / 共 M 版 (‹ ›), which Profile / model answered.
// 提示词增强-like templates: 「还可以补充」 as checkboxes (needs-your-words items open an input when checked),
// 直接加上 (appended as is, no model call) and 重新整理 (v2: one more round). 纠错学习-like templates: each change
// numbered, with its category, a one-line explanation and 「取决于你的意思」 choices; 错题本 is a placeholder.
// Enter adopts the shown version, Esc closes. A failure says why per Profile tried. Nothing here changes the draft.
// Layout (owner 2026-11-28): the title row and the 采用 / 取消 row stay put; only the middle (the comparison, the
// numbered changes, 还可以补充) scrolls, within the float's capped height.
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Sparkles, X } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import type { ProfileItem } from "../../../../shared/ipc";
import { cachedProfileList, loadProfileList } from "../../lib/profileSnapshot";
import { useFeatureProfiles } from "../../lib/featureProfiles";
import { useSizeFlags, dataFlags, type SizeTest } from "../../lib/sizeFlags";
import { EntityMention } from "../../components/EntityIcon";
import { tNodes } from "../../lib/textNodes";
import { correctionEdits, diffTexts, type CorrectionEdit, type DiffPart } from "./rewrite";
import { shownVersion, versionText, type EnhanceState, type RewriteVersion } from "./useRewrite";

const FLAGS: Readonly<Record<"wide", SizeTest>> = { wide: (box, rem) => box.width >= 32 * rem };
const BTN = "press-solid inline-flex h-6 items-center gap-1 rounded-md px-2 text-caption/[inherit] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
const QUIET = `${BTN} text-muted hover:bg-surface-2`;
const PRIMARY = `${BTN} bg-accent text-on-accent hover:bg-accent/85`;
const OUTLINE = `${BTN} border border-border text-foreground hover:bg-surface-2 disabled:opacity-50`;

function useProfileNames(hostId: string, wanted: boolean): Map<string, ProfileItem> {
  const [list, setList] = useState<ProfileItem[] | null>(() => cachedProfileList(hostId)?.profiles ?? null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void loadProfileList(hostId).then((r) => { if (live && r) setList(r.profiles); }, () => {});
    return () => { live = false; };
  }, [hostId, wanted]);
  return useMemo(() => new Map((list ?? []).map((p) => [p.id, p])), [list]);
}

function Side({ parts, keep, fallback, label, tone }: { parts: DiffPart[] | null; keep: DiffPart["kind"]; fallback: string; label: string; tone: string }) {
  return (
    <div className="min-w-0">
      <div className="pb-0.5 text-caption/[inherit] text-subtle">{label}</div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-surface-2/60 px-2 py-1 text-sm whitespace-pre-wrap break-words" data-prompt-enhance-side={keep}>
        {parts
          ? parts.filter((p) => p.kind === "same" || p.kind === keep).map((p, i) => p.kind === "same" ? <span key={i}>{p.text}</span> : <mark key={i} className={`rounded-sm text-foreground ${tone}`}>{p.text}</mark>)
          : fallback}
      </div>
    </div>
  );
}

/** One side of a correction version: the spans numbered (1, 2…) so the list below can name them. */
function CorrectionSide({ text, edits, pick, label, tone, side }: { text: string; edits: readonly CorrectionEdit[]; pick(e: CorrectionEdit): string; label: string; tone: string; side: "removed" | "added" }) {
  const nodes: React.ReactNode[] = [];
  let at = 0;
  edits.forEach((e) => {
    const i = e.index;
    nodes.push(<span key={`s${i}`}>{text.slice(at, e.start)}</span>);
    nodes.push(
      <Fragment key={`c${i}`}>
        <mark className={`rounded-sm text-foreground ${tone}`}>{pick(e)}</mark>
        <sup className="px-0.5 font-mono text-[0.7em] text-accent" aria-hidden>{i + 1}</sup>
      </Fragment>,
    );
    at = e.end;
  });
  nodes.push(<span key="tail">{text.slice(at)}</span>);
  return (
    <div className="min-w-0">
      <div className="pb-0.5 text-caption/[inherit] text-subtle">{label}</div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-surface-2/60 px-2 py-1 text-sm whitespace-pre-wrap break-words" data-prompt-enhance-side={side}>{nodes}</div>
    </div>
  );
}

function Corrections({ version, original, wide, onChoose }: { version: RewriteVersion; original: string; wide: boolean; onChoose(index: number, alt: number | null): void }) {
  const { t } = useI18n();
  const cs = version.corrections;
  const { edits, covered } = useMemo(() => correctionEdits(cs, version.choices), [cs, version.choices]);
  const editOf = new Map(edits.map((e) => [e.index, e]));
  return (
    <>
      <div className={`mt-1 grid gap-2 ${wide ? "grid-cols-2" : "grid-cols-1"}`}>
        <CorrectionSide text={original} edits={edits} pick={(e) => e.original} label={t("input-refinement.original")} tone="bg-danger/15 line-through decoration-danger/60" side="removed" />
        <CorrectionSide text={original} edits={edits} pick={(e) => e.replacement} label={t("input-refinement.corrected")} tone="bg-ok/20" side="added" />
      </div>
      <ol className="flex flex-col gap-1.5 pt-1.5" data-testid="input-refinement-corrections" aria-label={t("input-refinement.changes", { n: cs.length })}>
        {cs.map((c, i) => {
          const e = editOf.get(i);
          const by = covered[i];
          return (
            <li key={i} className={`flex gap-2 text-sm ${by === undefined ? "" : "opacity-60"}`} data-correction-category={c.category} data-covered-by={by === undefined ? undefined : by + 1}>
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[0.7rem] text-accent">{i + 1}</span>
              <div className="min-w-0 flex-1">
                {/* The reason runs on after the change, behind a muted 「：」 (owner 2026-11-28: less height); long ones wrap. */}
                <div className="break-words">
                  <span className="mr-1.5 rounded bg-surface-2 px-1 text-caption/[inherit] text-muted">{t(`input-refinement.category.${c.category}` as MessageKey)}</span>
                  {e
                    ? <><span className="text-subtle line-through">{e.original}</span> → <span className="font-medium">{e.replacement}</span></>
                    : <span className="text-subtle line-through">{c.original}</span>}
                  {(by !== undefined || c.explanation.trim()) && <>
                    <span className="text-subtle" data-correction-reason-sep="">{t("input-refinement.reasonSep")}</span>
                    <span className="text-muted" data-correction-reason="">{by !== undefined ? t("input-refinement.coveredBy", { n: by + 1 }) : c.explanation}</span>
                  </>}
                </div>
                {by === undefined && c.alternatives.length > 0 && (
                  <fieldset className="pt-0.5" data-testid="input-refinement-meaning">
                    <legend className="text-caption/[inherit] text-subtle">{t("input-refinement.dependsOnMeaning")}</legend>
                    <label className="flex items-start gap-1.5 text-caption/[inherit]">
                      <input type="radio" className="mt-0.5" name={`ir-meaning-${i}`} checked={version.choices[i] === undefined} onChange={() => onChoose(i, null)} />
                      <span>{t("input-refinement.asSuggested", { text: c.replacement })}</span>
                    </label>
                    {c.alternatives.map((a, j) => (
                      <label key={j} className="flex items-start gap-1.5 text-caption/[inherit]">
                        <input type="radio" className="mt-0.5" name={`ir-meaning-${i}`} checked={version.choices[i] === j} onChange={() => onChoose(i, j)} />
                        <span>{a.span
                          ? t("input-refinement.alternativeWide", { when: a.when, original: a.span.original, text: a.replacement })
                          : t("input-refinement.alternative", { when: a.when, text: a.replacement })}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="pt-1.5 text-caption/[inherit] text-subtle" data-testid="input-refinement-mistake-book">{t("input-refinement.mistakeBook")}</p>
    </>
  );
}

interface Pick { checked: boolean; text: string }

/** 「还可以补充」: one checkbox per item; a needs-your-words item opens an input row when checked. */
function Suggestions({ version, picks, setPicks, regroup, running, onAppend, onRegroup }: {
  version: RewriteVersion; picks: Record<string, Pick>; setPicks(next: Record<string, Pick>): void; regroup: boolean; running: boolean;
  onAppend(): void; onRegroup(): void;
}) {
  const { t } = useI18n();
  const any = version.suggestions.some((s) => picks[s.id]?.checked);
  return (
    <details open className="group pt-1.5" data-testid="prompt-enhance-missing">
      <summary className="flex cursor-pointer list-none items-center gap-0.5 text-caption/[inherit] text-subtle select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        {t("input-refinement.suggestions", { n: version.suggestions.length })}
      </summary>
      <ul className="flex flex-col gap-0.5 pt-0.5">
        {version.suggestions.map((s) => {
          const p = picks[s.id] ?? { checked: false, text: "" };
          return (
            <li key={s.id} data-suggestion-id={s.id}>
              <label className="flex items-start gap-1.5 text-sm text-muted">
                <input type="checkbox" className="mt-1" checked={p.checked} onChange={(e) => setPicks({ ...picks, [s.id]: { ...p, checked: e.currentTarget.checked } })} />
                <span className="min-w-0 break-words">{s.text}{s.needsInput && <span className="pl-1.5 text-caption/[inherit] text-warn-text">{t("input-refinement.needsInput")}</span>}</span>
              </label>
              {p.checked && s.needsInput && (
                <input type="text" value={p.text} maxLength={2000} placeholder={t("input-refinement.answerPlaceholder")} aria-label={s.text}
                  onChange={(e) => setPicks({ ...picks, [s.id]: { ...p, text: e.currentTarget.value } })}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (any) onAppend(); } }}
                  className="mt-0.5 ml-5 h-6 w-[calc(100%-1.25rem)] rounded-md border border-border bg-surface px-1.5 text-sm outline-none focus-visible:border-accent" />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-1.5 pt-1">
        <button type="button" disabled={!any} onClick={onAppend} data-tip={t("input-refinement.appendHint")} className={OUTLINE} data-testid="input-refinement-append">{t("input-refinement.append")}</button>
        {regroup && <button type="button" disabled={!any || running} onClick={onRegroup} data-tip={t("input-refinement.regroupHint")} className={OUTLINE} data-testid="input-refinement-regroup">{t("input-refinement.regroup")}</button>}
      </div>
    </details>
  );
}

export function PromptEnhancePanel({ state, hostId, templateLabel, adoptKey, onAdopt, onCancel, onRetry, onShow, onAppend, onRegroup, onChoose }: {
  state: EnhanceState;
  hostId: string;
  /** The template's name (and its ▾ menu, if any). */
  templateLabel: React.ReactNode;
  adoptKey: string;
  onAdopt(): void;
  onCancel(): void;
  onRetry(): void;
  onShow(index: number): void;
  onAppend(picks: { id: string; text?: string }[]): void;
  /** 重新整理 (v2 hosts); null: not offered. */
  onRegroup: ((answers: { id: string; text?: string }[]) => void) | null;
  onChoose(index: number, alt: number | null): void;
}) {
  const { t } = useI18n();
  const [ref, flags] = useSizeFlags(FLAGS);
  const version = shownVersion(state);
  const used = version?.used ?? null;
  const names = useProfileNames(hostId, !!used || state.phase === "failed");
  const shownIndex = state.phase === "idle" ? 0 : state.shown;
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  // A new version shown: its own checkboxes.
  useEffect(() => setPicks({}), [version]);
  const text = state.phase !== "idle" && version ? versionText(state, version) : "";
  const parts = useMemo(() => (state.phase !== "idle" && state.target && version && !version.corrections.length ? diffTexts(state.target.text, text) : null), [state, version, text]);
  // 功能 Profile IDs (fp-…) are named from their own list, never looked up as agent Profiles.
  const featureIds = used ? [used.profileId] : state.phase === "failed" ? state.attempts.map((a) => a.profileId) : [];
  const features = useFeatureProfiles(hostId, featureIds.some((id) => id.startsWith("fp-"))).list;
  if (state.phase === "idle") return null;
  const profileMention = (id: string) => {
    const f = features?.find((x) => x.id === id);
    if (f) return <span className="font-medium" data-feature-profile-ref={id}>{f.name}</span>;
    const p = names.get(id);
    return <EntityMention entity={p ? { kind: "profile", profile: p, hostId } : { kind: "profile", ref: id, hostId }}>{p?.name ?? id}</EntityMention>;
  };
  const scope = state.target ? t(state.target.whole ? "input-refinement.scope.whole" : "input-refinement.scope.selection") : null;
  const count = state.versions.length;
  const running = state.phase === "running";
  const checked = () => (version?.suggestions ?? []).filter((s) => picks[s.id]?.checked).map((s) => (s.needsInput && picks[s.id]!.text.trim() ? { id: s.id, text: picks[s.id]!.text } : { id: s.id }));
  const correction = !!version && (version.corrections.length > 0 || state.template.kind === "correction");
  const rewriteLabel = !version ? "" : correction ? t("input-refinement.corrected")
    : count > 1 ? t(version.used ? "input-refinement.rewriteVersion" : "input-refinement.rewriteAppended", { n: shownIndex + 1 }) : t("input-refinement.rewrite");
  return (
    <div ref={ref} {...dataFlags(flags)} role="group" aria-label={t("input-refinement.title")} data-testid="prompt-enhance-panel" data-phase={state.phase} data-template-kind={state.template.kind}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); onCancel(); } }}
      className="flex min-h-0 flex-col">
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 px-3 pt-2 pb-1 text-caption/[inherit]" data-prompt-enhance-head="">
        <Sparkles size={12} className="shrink-0 text-accent" aria-hidden />
        <span className="font-medium text-foreground">{t("input-refinement.title")}</span>
        <span className="min-w-0 truncate text-muted" data-testid="input-refinement-template">{templateLabel}</span>
        {scope && <span className="truncate text-subtle">· {scope}</span>}
        <span className="flex-1" />
        {count > 1 && (
          <span className="flex shrink-0 items-center gap-0.5 text-subtle" data-testid="input-refinement-versions">
            <button type="button" disabled={shownIndex === 0} onClick={() => onShow(shownIndex - 1)} aria-label={t("input-refinement.versionPrev")} className="press-solid rounded p-0.5 hover:text-foreground disabled:opacity-40"><ChevronLeft size={12} /></button>
            <span>{t("input-refinement.version", { n: shownIndex + 1, total: count })}</span>
            <button type="button" disabled={shownIndex >= count - 1} onClick={() => onShow(shownIndex + 1)} aria-label={t("input-refinement.versionNext")} className="press-solid rounded p-0.5 hover:text-foreground disabled:opacity-40"><ChevronRight size={12} /></button>
          </span>
        )}
        <button type="button" onClick={onCancel} aria-label={t("input-refinement.close")} data-tip={`${t("input-refinement.close")} · Esc`} className="press-solid rounded p-0.5 text-subtle hover:text-foreground">
          <X size={12} />
        </button>
      </div>

      <div className="float-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-1" data-prompt-enhance-body="">
      {running && (
        <div role="status" className="flex items-center gap-1.5 pt-1 text-sm text-muted" data-testid="prompt-enhance-running">
          <Loader2 size={13} className="animate-spin text-accent" aria-hidden />
          <span>{t(count ? "input-refinement.regrouping" : "input-refinement.running")}</span>
          <span className="text-caption/[inherit] text-subtle">· {t("input-refinement.escCancel")}</span>
        </div>
      )}

      {version && state.target && (
        <>
          {version.corrections.length > 0
            ? <Corrections version={version} original={state.target.text} wide={!!flags.wide} onChoose={onChoose} />
            : (
              <div className={`mt-1 grid gap-2 ${flags.wide ? "grid-cols-2" : "grid-cols-1"}`}>
                <Side parts={parts} keep="removed" fallback={state.target.text} label={t("input-refinement.original")} tone="bg-danger/15 line-through decoration-danger/60" />
                <Side parts={parts} keep="added" fallback={text} label={rewriteLabel} tone="bg-ok/20" />
              </div>
            )}
          {correction && !version.corrections.length && <p className="pt-1 text-caption/[inherit] text-subtle">{t("input-refinement.noChanges")}</p>}
          {state.notice && state.versions.length === 1 && state.shown === 0 && <p className="pt-1 text-caption/[inherit] text-subtle" data-testid="input-refinement-restarted" data-notice={state.notice}>{t(`input-refinement.${state.notice}` as const)}</p>}
          {version.dropped > 0 && <p className="pt-1 text-caption/[inherit] text-subtle" data-testid="input-refinement-dropped">{t("input-refinement.dropped", { n: version.dropped })}</p>}
          {version.suggestions.length > 0 && (
            <Suggestions version={version} picks={picks} setPicks={setPicks} regroup={!!onRegroup} running={running}
              onAppend={() => onAppend(checked())} onRegroup={() => onRegroup?.(checked())} />
          )}
          {state.phase === "done" && state.draftChanged && <div role="alert" className="pt-1 text-caption/[inherit] text-warn-text">{t("input-refinement.draftChanged")}</div>}
          {state.phase === "failed" && <div role="alert" className="pt-1 text-caption/[inherit] text-danger-text">{t(`input-refinement.error.${state.code}` as MessageKey)}</div>}
        </>
      )}
      {state.phase === "failed" && !version && (
        <div role="alert" className="pt-1 text-sm" data-testid="prompt-enhance-failed">
          <div className="text-danger-text">{t(`input-refinement.error.${state.code}` as MessageKey)}</div>
          {state.attempts.length > 0 && (
            <ul className="pt-0.5 text-caption/[inherit] text-muted" data-testid="prompt-enhance-attempts">
              {state.attempts.map((a, i) => (
                <li key={i}>{tNodes(t, "input-refinement.attempt", { profile: profileMention(a.profileId), reason: a.category === "timeout" && a.elapsedMs !== undefined ? t("input-refinement.attempt.timeoutAfter", { n: Math.max(1, Math.round(a.elapsedMs / 1000)) }) : t(`input-refinement.attempt.${a.category}` as MessageKey) })}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      </div>

      {version && state.target && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-3 pt-1.5 pb-2" data-prompt-enhance-foot="">
            <span className="min-w-0 flex-1 truncate text-caption/[inherit] text-subtle" data-testid="prompt-enhance-used">
              {used
                ? <>{tNodes(t, "input-refinement.used", { profile: profileMention(used.profileId), model: used.model ?? used.requestedModel })}{used.fallbackUsed && <span className="text-warn-text"> · {t("input-refinement.fallbackUsed")}</span>}</>
                : t("input-refinement.usedNone")}
            </span>
            <button type="button" onClick={onCancel} className={QUIET}>{t("input-refinement.cancel")} <kbd className="font-mono text-subtle">Esc</kbd></button>
            {state.phase === "done" && state.draftChanged
              ? <button type="button" onClick={onRetry} className={PRIMARY}>{t("input-refinement.retry")}</button>
              : <button type="button" onClick={onAdopt} className={PRIMARY} data-testid="prompt-enhance-adopt">{count > 1 ? t("input-refinement.adoptVersion", { n: shownIndex + 1 }) : t("input-refinement.adopt")} <kbd className="font-mono text-on-accent/80">{adoptKey}</kbd></button>}
          </div>
      )}
      {state.phase === "failed" && !version && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-3 pt-1.5 pb-2" data-prompt-enhance-foot="">
            <button type="button" onClick={onCancel} className={QUIET}>{t("input-refinement.close")}</button>
            {state.code !== "empty" && state.code !== "noRoute" && state.code !== "unsupported" && state.code !== "forbidden" && state.code !== "selectionMoved" && state.code !== "blankSelection" && (
              <button type="button" onClick={onRetry} className={PRIMARY}>{t("input-refinement.retry")}</button>
            )}
          </div>
      )}
    </div>
  );
}
