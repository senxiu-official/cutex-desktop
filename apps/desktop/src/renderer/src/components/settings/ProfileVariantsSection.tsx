// Profile editor → 运行时变体 (cutex profile-runtime-variants, docs/design/042): the Profile's variants with their
// default model / effort (the primary's are the Profile's own model fields, edited below as before), which one new
// agents get, how many agents are bound; 添加变体 offers what cutex's compatibility allows (需要安装 included); removing
// is refused for the primary and while agents (archived included) are bound — cutex decides, the row says why first.
// Every change applies to agents created afterwards only.
import { useState } from "react";
import type { CutexRefusal, ProfileDetail } from "../../../../shared/ipc";
import type { ProfileRuntimeVariant, RuntimeCompatibility, VariantDefaults } from "../../../../shared/profileVariants";
import { useI18n, type MessageKey } from "../../i18n";
import { addableRuntimes, defaultVariantOf, RUNTIME_LABEL, statusKey, variantsOf, variantStatus } from "../../lib/profileVariants";
import { useTargetApi } from "../../lib/targetHost";
import { Tag } from "../Tag";
import { DSH_EFFORTS } from "../../lib/dshModels";
import { ACP_RUNTIME_INFO, isAcpRuntime } from "../../lib/acpRuntimes";
import { runtimeDefaultModel, runtimeEfforts, runtimeModelChoices } from "../../lib/runtimeChoices";
import { ArmedRemove, Button, Section, Select, SettingsGroup, TextInput } from "./Form";


function refusalText(t: ReturnType<typeof useI18n>["t"], e: CutexRefusal): string {
  if (e.code === "variant_in_use") return t("variants.deleteBlockedInUse", { n: e.count ?? e.sessions?.length ?? 1 });
  const key = `variants.refusal.${e.code}` as MessageKey;
  return t(key) === key ? e.message : t(key);
}

function VariantRow({ profile, variant, isDefault, compat, onChanged, onStatus }: { profile: string; variant: ProfileRuntimeVariant; isDefault: boolean; compat: RuntimeCompatibility | null; onChanged(next?: ProfileDetail): void; onStatus(s: { text: string; error: boolean } | null): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const [draft, setDraft] = useState<Partial<VariantDefaults>>({});
  const [busy, setBusy] = useState(false);
  const model = draft.model !== undefined ? draft.model : variant.defaults.model;
  const effort = draft.reasoningEffort !== undefined ? draft.reasoningEffort : variant.defaults.reasoningEffort;
  const dirty = Object.keys(draft).length > 0;
  const act = async (run: () => Promise<{ ok: true; profile?: ProfileDetail } | { ok: false; error: CutexRefusal }>, done: string) => {
    setBusy(true);
    onStatus(null);
    try {
      const r = await run();
      if (r.ok) {
        setDraft({});
        onStatus({ text: done, error: false });
        onChanged(r.profile);
      } else onStatus({ text: refusalText(t, r.error), error: true });
    } catch (e) {
      onStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const deleteBlocked = variant.primary ? t("variants.deleteBlockedPrimary") : variant.inUse > 0 ? t("variants.deleteBlockedInUse", { n: variant.inUse }) : null;
  const effortOptions = [{ value: "", label: t("agent-config.profile.effortDefault") }, ...(runtimeEfforts(variant.runtime) ?? DSH_EFFORTS).map((value) => ({ value, label: t(`composer.effort.${value}` as MessageKey) }))];
  // A Kimi-kind Profile has no Profile model fields: its primary (kimi) variant's defaults are edited in this row.
  const editable = !variant.primary || variant.runtime === "kimi";
  // The models cutex lists for this variant (`runtimeVariants[].models`, labelled by their display names); the
  // runtime's own fallback names only without them (r265 R2 QA, for every ACP runtime).
  const choices = runtimeModelChoices(variant.runtime, variant, model);
  const catalogDefault = variant.models?.find((m) => m.isDefault)?.id ?? variant.models?.[0]?.id ?? null;
  // DSH always runs a model (catalog default, else its own); Kimi without a stored model uses the account's default.
  const shownDefault = runtimeDefaultModel(variant.runtime) !== null ? catalogDefault ?? runtimeDefaultModel(variant.runtime) : null;
  const modelLabel = (id: string) => variant.models?.find((r) => r.id === id)?.displayName || id;
  const acp = isAcpRuntime(variant.runtime) ? ACP_RUNTIME_INFO[variant.runtime] : null;
  return (
    <div className="border-b border-border/60 py-2.5 last:border-b-0" data-variant-row={variant.id} data-variant-default={isDefault ? "" : undefined}>
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">{RUNTIME_LABEL[variant.runtime]}</span>
        {variant.primary && <Tag>{t("variants.primary")}</Tag>}
        {isDefault && <Tag tone="accent">{t("variants.default")}</Tag>}
        {acp?.notRecommended && <Tag tone="attention" data-dsh-not-recommended="" data-runtime-not-recommended={variant.runtime} title={t(acp.notRecommendedText)}>{t("variants.notRecommendedShort")}</Tag>}
        {compat && compat.status !== "supported" && <Tag tone="attention" title={compat.reason ?? undefined}>{t(statusKey(compat.status))}</Tag>}
        <span className="text-xs text-subtle" data-variant-in-use={variant.inUse}>{variant.inUse ? t("variants.inUse", { n: variant.inUse }) : t("variants.notUsed")}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {!isDefault && <Button disabled={busy} onClick={() => void act(async () => ({ ok: true as const, profile: await api.patchProfile(profile, { defaultVariant: variant.primary ? null : variant.id }) }), t("variants.saved"))}>{t("variants.makeDefault")}</Button>}
          {/* The reason shows before anyone tries; cutex refuses again if it changed meanwhile. */}
          <span title={deleteBlocked ?? undefined}>
            <ArmedRemove title={deleteBlocked ?? t("variants.delete")} armedLabel={t("variants.deleteAgain")} disabled={busy || !!deleteBlocked}
              onRemove={() => void act(async () => { const r = await api.deleteProfileVariant(profile, variant.id); return r.ok ? { ok: true as const, profile: r.profile } : r; }, t("variants.saved"))} />
          </span>
        </span>
      </div>
      <SettingsGroup agents="newAgents" source="host"><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{t("agent-config.profile.model")}</span>
        {!editable ? (
          <span className="font-mono">{variant.defaults.model ?? "—"}</span>
        ) : choices ? (
          <Select width="w-48" label={t("agent-config.profile.model")} value={model ?? shownDefault ?? ""} options={[...(shownDefault ? [] : [{ value: "", label: t("variants.defaults.modelRuntimeDefault") }]), ...choices.map((m) => ({ value: m, label: modelLabel(m) }))]} onChange={(v) => setDraft((d) => ({ ...d, model: v || null }))} />
        ) : (
          <TextInput mono width="w-48" label={t("agent-config.profile.model")} value={model ?? ""} placeholder={t(variant.runtime === "kimi" ? "variants.defaults.modelKimiPlaceholder" : "variants.defaults.modelPlaceholder")} onChange={(v) => setDraft((d) => ({ ...d, model: v || null }))} />
        )}
        <span className="ml-2">{t("agent-config.profile.effort")}</span>
        {!editable ? (
          <span>{variant.defaults.reasoningEffort ? t(`composer.effort.${variant.defaults.reasoningEffort}` as MessageKey) : t("agent-config.profile.effortDefault")}</span>
        ) : (
          <Select width="w-36" label={t("agent-config.profile.effort")} value={effort ?? ""} options={effortOptions} onChange={(v) => setDraft((d) => ({ ...d, reasoningEffort: v || null }))} />
        )}
        {dirty && <Button primary disabled={busy} onClick={() => void act(() => api.patchProfileVariant(profile, variant.id, draft), t("variants.saved"))}>{t("variants.save")}</Button>}
      </div></SettingsGroup>
    </div>
  );
}

export function ProfileVariantsSection({ detail, onChanged }: { detail: ProfileDetail; onChanged(next?: ProfileDetail): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const variants = variantsOf(detail);
  if (!variants) return null;
  const defaultId = defaultVariantOf(detail)?.id ?? null;
  const addable = addableRuntimes(detail);
  const add = async (runtime: ProfileRuntimeVariant["runtime"]) => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.addProfileVariant(detail.id, { runtime });
      if (r.ok) {
        setStatus({ text: t("variants.saved"), error: false });
        onChanged(r.profile);
      } else setStatus({ text: refusalText(t, r.error), error: true });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("variants.list.title")} hint={t("variants.list.hint")}>
      <div data-profile-variants="">
        {variants.map((v) => <VariantRow key={v.id} profile={detail.id} variant={v} isDefault={v.id === defaultId} compat={variantStatus(detail, v.runtime)} onChanged={onChanged} onStatus={setStatus} />)}
        <div className="flex flex-wrap items-center gap-2 py-2.5">
          <span className="text-xs text-muted">{t("variants.add")}</span>
          {addable.length === 0 && <span className="text-xs text-subtle">{t("variants.noneAddable")}</span>}
          {addable.map((c) => (
            <span key={c.runtime} className="flex items-center gap-1" data-variant-add={c.runtime}>
              <Button disabled={busy} onClick={() => void add(c.runtime)}>{t("variants.addRuntime", { runtime: RUNTIME_LABEL[c.runtime] })}</Button>
              {c.status !== "supported" && <Tag tone="attention">{t(statusKey(c.status))}</Tag>}
            </span>
          ))}
        </div>
        {status && <p role="status" className={`pb-1 text-xs ${status.error ? "text-danger" : "text-ok-text"}`}>{status.text}</p>}
      </div>
    </Section>
  );
}
