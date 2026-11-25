// 提示词增强's panel inside the composer card (lib/usePromptEnhance.ts): the request in flight (Esc cancels it), then
// the original and the rewrite side by side with the changed words marked, what the draft could still say
// (missingDetails), which Profile / model answered and whether a backup did; Enter adopts, Esc closes. A failure says
// why per Profile tried. Nothing here changes the draft: Composer adopts through the input's own undo history.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import type { ProfileItem } from "../../../shared/ipc";
import { cachedProfileList, loadProfileList } from "../lib/profileSnapshot";
import { useFeatureProfiles } from "../lib/featureProfiles";
import { diffTexts, type DiffPart } from "../lib/promptEnhance";
import type { EnhanceState } from "../lib/usePromptEnhance";
import { useSizeFlags, dataFlags, type SizeTest } from "../lib/sizeFlags";
import { EntityMention } from "./EntityIcon";
import { tNodes } from "../lib/textNodes";

const FLAGS: Readonly<Record<"wide", SizeTest>> = { wide: (box, rem) => box.width >= 32 * rem };
const BTN = "press-solid inline-flex h-6 items-center gap-1 rounded-md px-2 text-caption/[inherit] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

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

export function PromptEnhancePanel({ state, hostId, adoptKey, onAdopt, onCancel, onRetry }: {
  state: EnhanceState;
  hostId: string;
  adoptKey: string;
  onAdopt(): void;
  onCancel(): void;
  onRetry(): void;
}) {
  const { t } = useI18n();
  const [ref, flags] = useSizeFlags(FLAGS);
  const names = useProfileNames(hostId, state.phase === "done" || state.phase === "failed");
  const parts = useMemo(() => (state.phase === "done" ? diffTexts(state.target.text, state.rewrittenText) : null), [state]);
  // 功能 Profile IDs (fp-…) are named from their own list, never looked up as agent Profiles.
  const featureIds = state.phase === "done" ? [state.used.profileId] : state.phase === "failed" ? state.attempts.map((a) => a.profileId) : [];
  const features = useFeatureProfiles(hostId, featureIds.some((id) => id.startsWith("fp-"))).list;
  if (state.phase === "idle") return null;
  const profileName = (id: string) => names.get(id)?.name ?? id;
  const profileMention = (id: string) => {
    const f = features?.find((x) => x.id === id);
    if (f) return <span className="font-medium" data-feature-profile-ref={id}>{f.name}</span>;
    const p = names.get(id);
    return <EntityMention entity={p ? { kind: "profile", profile: p, hostId } : { kind: "profile", ref: id, hostId }}>{profileName(id)}</EntityMention>;
  };
  const scope = state.target ? t(state.target.whole ? "promptEnhance.scope.whole" : "promptEnhance.scope.selection") : null;
  return (
    <div ref={ref} {...dataFlags(flags)} role="group" aria-label={t("promptEnhance.title")} data-testid="prompt-enhance-panel" data-phase={state.phase}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); onCancel(); } }}
      className="mb-1.5 rounded-md border border-accent/40 bg-accent/5 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-caption/[inherit]">
        <Sparkles size={12} className="shrink-0 text-accent" aria-hidden />
        <span className="font-medium text-foreground">{t("promptEnhance.title")}</span>
        {scope && <span className="truncate text-subtle">· {scope}</span>}
        <span className="flex-1" />
        <button type="button" onClick={onCancel} aria-label={t("promptEnhance.close")} data-tip={`${t("promptEnhance.close")} · Esc`} className="press-solid rounded p-0.5 text-subtle hover:text-foreground">
          <X size={12} />
        </button>
      </div>

      {state.phase === "running" && (
        <div role="status" className="flex items-center gap-1.5 pt-1 text-sm text-muted" data-testid="prompt-enhance-running">
          <Loader2 size={13} className="animate-spin text-accent" aria-hidden />
          <span>{t("promptEnhance.running")}</span>
          <span className="text-caption/[inherit] text-subtle">· {t("promptEnhance.escCancel")}</span>
        </div>
      )}

      {state.phase === "done" && (
        <>
          <div className={`mt-1 grid gap-2 ${flags.wide ? "grid-cols-2" : "grid-cols-1"}`}>
            <Side parts={parts} keep="removed" fallback={state.target.text} label={t("promptEnhance.original")} tone="bg-danger/15 line-through decoration-danger/60" />
            <Side parts={parts} keep="added" fallback={state.rewrittenText} label={t("promptEnhance.rewrite")} tone="bg-ok/20" />
          </div>
          {state.missingDetails.length > 0 && (
            <div className="pt-1.5" data-testid="prompt-enhance-missing">
              <div className="text-caption/[inherit] text-subtle">{t("promptEnhance.missing")}</div>
              <ul className="list-disc pl-5 text-sm text-muted">
                {state.missingDetails.map((d, i) => <li key={i} className="break-words">{d}</li>)}
              </ul>
            </div>
          )}
          {state.draftChanged && <div role="alert" className="pt-1 text-caption/[inherit] text-warn-text">{t("promptEnhance.draftChanged")}</div>}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1.5">
            <span className="min-w-0 flex-1 truncate text-caption/[inherit] text-subtle" data-testid="prompt-enhance-used">
              {tNodes(t, "promptEnhance.used", { profile: profileMention(state.used.profileId), model: state.used.model ?? state.used.requestedModel })}
              {state.used.fallbackUsed && <span className="text-warn-text"> · {t("promptEnhance.fallbackUsed")}</span>}
            </span>
            <button type="button" onClick={onCancel} className={`${BTN} text-muted hover:bg-surface-2`}>{t("promptEnhance.cancel")} <kbd className="font-mono text-subtle">Esc</kbd></button>
            {state.draftChanged
              ? <button type="button" onClick={onRetry} className={`${BTN} bg-accent text-on-accent hover:bg-accent/85`}>{t("promptEnhance.retry")}</button>
              : <button type="button" onClick={onAdopt} className={`${BTN} bg-accent text-on-accent hover:bg-accent/85`} data-testid="prompt-enhance-adopt">{t("promptEnhance.adopt")} <kbd className="font-mono text-on-accent/80">{adoptKey}</kbd></button>}
          </div>
        </>
      )}

      {state.phase === "failed" && (
        <div role="alert" className="pt-1 text-sm" data-testid="prompt-enhance-failed">
          <div className="text-danger-text">{t(`promptEnhance.error.${state.code}` as MessageKey)}</div>
          {state.attempts.length > 0 && (
            <ul className="pt-0.5 text-caption/[inherit] text-muted" data-testid="prompt-enhance-attempts">
              {state.attempts.map((a, i) => (
                <li key={i}>{tNodes(t, "promptEnhance.attempt", { profile: profileMention(a.profileId), reason: t(`promptEnhance.attempt.${a.category}` as MessageKey) })}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} className={`${BTN} text-muted hover:bg-surface-2`}>{t("promptEnhance.close")}</button>
            {state.code !== "empty" && state.code !== "noRoute" && state.code !== "unsupported" && state.code !== "forbidden" && (
              <button type="button" onClick={onRetry} className={`${BTN} bg-accent text-on-accent hover:bg-accent/85`}>{t("promptEnhance.retry")}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
