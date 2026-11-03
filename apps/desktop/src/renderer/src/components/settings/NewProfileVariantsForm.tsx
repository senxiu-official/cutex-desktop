// Settings → Profiles → 添加 on a host with cutex `profile-runtime-variants` (docs/design/042): provider → credential
// (write-only key; Advanced: a named host variable, DSH only) → runtime variants (cutex's compatibility; 需要安装 differs
// from 不支持) → default model per variant → name / colour. Older hosts keep NewProfileForm. The create is
// `POST /v2/profiles` and then `POST …/variants` / `PATCH {defaultVariant, color}` (contract §9.2: no atomic create);
// a later step that fails leaves the profile and says what is left to do on its page.
import { useEffect, useMemo, useRef, useState } from "react";
import { claudeAccountRowShown } from "../../lib/claudeAccounts";
import { useApp } from "../../store";
import { DEFAULT_CLAUDE_ACCOUNT } from "../../../../shared/claudeAccounts";
import type { ProfileDetail } from "../../../../shared/ipc";
import type { RuntimeCompatibility, VariantRuntime } from "../../../../shared/profileVariants";
import { credentialEnvName } from "../../../../shared/profileVariants";
import { useI18n, type MessageKey } from "../../i18n";
import { createRequestOf } from "../../lib/profileCreate";
import { presetById } from "../../lib/profilePresets";
import { initialRuntimes, newProfilePlan, plannedDefault, previewCompatibility, reasonKey, RUNTIME_LABEL, statusKey, variantStatus, type NewProfileDraft, type NewProfileProvider } from "../../lib/profileVariants";
import { useProfilePresets } from "../../lib/useProfilePresets";
import { Button, Checkbox, Details, FormFields, Notice, Section, Select, SettingRow, SettingsGroup, TextInput, Toggle } from "./Form";
import { AddressRow } from "./newProfile/AddressRow";
import { AuthStep } from "./newProfile/AuthStep";
import { ProviderCards, ProviderHeader } from "./newProfile/ProviderCards";
import { NameStep } from "./newProfile/NameStep";
import { addressSpecOf, choiceFor, choiceForPreset, createPlanOf, defaultChoice, needsClaudeAccount, providerCards, resolveChoice, type NewProfileChoice } from "../../lib/newProfileModel";
import { NewClaudeAccountRow } from "./ProfileClaudeAccount";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { CLAUDE_RUNTIME_COMPONENT, componentBlocks, DSH_RUNTIME_COMPONENT, KIMI_RUNTIME_COMPONENT } from "../../lib/componentCard";
import { useComponentState } from "../../lib/componentView";
import { ComponentNotice } from "../ComponentCard";
import { CreationRuntimeTag } from "../CreationRuntimeTag";
import { Tag } from "../Tag";
import { DSH_DEFAULT_MODEL, DSH_EFFORTS, dshModelIds } from "../../lib/dshModels";
import { ACP_RUNTIME_INFO, isAcpRuntime } from "../../lib/acpRuntimes";
import { KIMI_ACCOUNTS_FEATURE, KIMI_EFFORTS, KIMI_RUNTIME_PROFILES_FEATURE } from "../../../../shared/kimiAccounts";
import { KimiAccountSelect } from "./KimiAccountSelect";
import { useKimiAccountList } from "../../lib/kimiAccounts";
import { runtimeModelChoices } from "../../lib/runtimeChoices";
import { optionLabel, providerName } from "../../lib/newProfileText";
import { addressState, relayHost } from "../../lib/newProfileModel";


function StepTitle({ children }: { children: string }) {
  return <h3 className="mt-4 mb-1 text-xs font-semibold text-muted first:mt-1">{children}</h3>;
}

/** One runtime row of step 3: a checkbox, the runtime, what it is, and cutex's status / reason. */
function RuntimeChoice({ row, checked, onChange, isDefault, experimentalAllowed }: { row: RuntimeCompatibility; checked: boolean; onChange(v: boolean): void; isDefault: boolean; experimentalAllowed: boolean }) {
  const { t } = useI18n();
  const unsupported = row.status === "unsupported";
  const reason = reasonKey(row.reason);
  const why = unsupported ? (reason ? t(reason) : t("variants.reason.unknown", { reason: row.reason ?? "—" })) : null;
  return (
    <div className={`flex min-h-9 items-center gap-2.5 border-b border-border/60 py-1.5 last:border-b-0 ${unsupported ? "opacity-60" : ""}`} data-variant-choice={row.runtime} data-variant-status={row.status}>
      <Checkbox checked={checked} disabled={unsupported} label={RUNTIME_LABEL[row.runtime]} onChange={onChange} />
      <span className="w-24 shrink-0 text-sm">{RUNTIME_LABEL[row.runtime]}</span>
      <CreationRuntimeTag runtime={row.runtime} enabled={experimentalAllowed && !unsupported} />
      <span className="min-w-0 flex-1 truncate text-xs text-subtle">{why ?? t(`variants.runtime.${row.runtime}.what` as MessageKey)}</span>
      {isAcpRuntime(row.runtime) && ACP_RUNTIME_INFO[row.runtime].notRecommended && !unsupported && <Tag tone="attention" data-dsh-not-recommended="" data-runtime-not-recommended={row.runtime} title={t(ACP_RUNTIME_INFO[row.runtime].notRecommendedText)}>{t("variants.notRecommendedShort")}</Tag>}
      {checked && isDefault && <Tag tone="accent">{t("variants.default")}</Tag>}
      <Tag tone={row.status === "supported" ? "ok" : row.status === "componentNotInstalled" ? "attention" : "neutral"}>{t(statusKey(row.status))}</Tag>
    </div>
  );
}

export function NewProfileVariantsForm({ existing, onCreated, onCancel, initialPreset, initialKimiAccount }: {
  existing: string[]; onCreated(detail: ProfileDetail): void; onCancel(): void; initialPreset?: string;
  /** Kimi accounts → 用这个账户新建 Profile: the form opens on the Kimi provider with this account chosen. */
  initialKimiAccount?: string;
}) {
  const api = useTargetApi();
  const { t } = useI18n();
  const features = useTargetFeatures();
  const hostId = useTargetHostId();
  const presets = useProfilePresets();
  const cards = useMemo(() => providerCards(presets, features), [presets, features]);
  const initialChoice = () => initialKimiAccount ? { card: "kimi" as const, option: "kimiAccount", group: "", preset: "" } : initialPreset ? choiceForPreset(cards, initialPreset) : null;
  const [choice, setChoice] = useState<NewProfileChoice | null>(initialChoice);
  const resolved = choice ? resolveChoice(cards, choice) : null;
  const provider: NewProfileProvider = resolved?.option.auth === "kimiAccount" ? "kimi" : resolved?.option.auth === "chatgpt" ? "chatgpt" : resolved?.option.runtime === "claude" ? "claude" : "apiKey";
  const [url, setUrl] = useState<string | null>(null);
  // The key lives only here until the create sends it; cleared right after (never in a draft / notice / error).
  const [apiKey, setApiKey] = useState("");
  const [envName, setEnvName] = useState<string | null>(null);
  const [claudeAccount, setClaudeAccount] = useState(DEFAULT_CLAUDE_ACCOUNT);
  const kimiProfiles = features.has(KIMI_RUNTIME_PROFILES_FEATURE);
  const kimiAccountsOn = kimiProfiles && features.has(KIMI_ACCOUNTS_FEATURE);
  const kimiAccounts = useKimiAccountList(kimiAccountsOn && provider === "kimi");
  const [kimiAccount, setKimiAccount] = useState(initialKimiAccount ?? "");
  const [picked, setPicked] = useState<VariantRuntime[] | null>(null);
  const [defaults, setDefaults] = useState<NewProfileDraft["defaults"]>({});
  const [variantBaseUrls, setVariantBaseUrls] = useState<NonNullable<NewProfileDraft["variantBaseUrls"]>>({});
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const touched = useRef(false);
  useEffect(() => { if (!touched.current && !choice && initialPreset) setChoice(choiceForPreset(cards, initialPreset)); }, [cards, initialPreset, choice]);
  const accounts = claudeAccountRowShown(features, "claude");
  const presetId = resolved?.option.auth === "dshEnv" ? (presets.find((preset) => preset.providerId === "deepseek")?.id ?? "deepseek") : resolved?.preset?.id ?? "";
  const chosen = presetId ? presetById(presetId, presets) : null;
  const baseUrl = url ?? (resolved ? addressSpecOf(resolved)?.official : null) ?? "";
  const dshComponent = useComponentState(hostId, DSH_RUNTIME_COMPONENT, { active: provider === "apiKey" });
  const claudeComponent = useComponentState(hostId, CLAUDE_RUNTIME_COMPONENT, { active: provider === "claude" });
  const kimiComponent = useComponentState(hostId, KIMI_RUNTIME_COMPONENT, { active: kimiProfiles && (provider === "apiKey" || provider === "kimi") });
  const rows = previewCompatibility({ provider, envName, baseUrl }, provider === "apiKey" ? chosen : null, {
    dshInstalled: features.has("dsh-runtime") && !componentBlocks(dshComponent.state),
    claudeInstalled: !componentBlocks(claudeComponent.state),
    kimiProfiles,
    relayRuntimes: features.has("profile-relay-runtimes"),
    kimiInstalled: features.has(ACP_RUNTIME_INFO.kimi.capability) && !componentBlocks(kimiComponent.state),
  });
  const offered = (r: VariantRuntime) => rows.some((x) => x.runtime === r && x.status !== "unsupported");
  const runtimes = (picked ?? initialRuntimes(rows)).filter(offered);
  const shownDefault = plannedDefault(runtimes);
  const dshOffered = offered("dsh");
  const envProblem = envName !== null && envName.trim() !== "" && !credentialEnvName(envName);

  const toggle = (r: VariantRuntime, on: boolean) => {
    setPicked(on ? [...new Set([...runtimes, r])] : runtimes.filter((x) => x !== r));
    setError(null);
  };
  const setDefault = (r: VariantRuntime, patch: Partial<{ model: string; reasoningEffort: string }>) =>
    setDefaults((d) => ({ ...d, [r]: { model: "", reasoningEffort: "", ...d[r], ...patch } }));
  const choose = (next: NewProfileChoice | null) => {
    touched.current = true;
    setChoice(next); setUrl(null); setApiKey("");
    setPicked(next?.option === "dshEnv" ? ["dsh"] : null);
    setEnvName(next?.option === "dshEnv" ? "DEEPSEEK_API_KEY" : null);
    setDefaults({}); setVariantBaseUrls({}); setError(null);
  };
  const useEnv = (on: boolean) => {
    setEnvName(on ? "" : null);
    // A host variable is a DSH-profile source: DSH alone (contract §3).
    if (on) setPicked(["dsh"]);
    setError(null);
  };

  const create = async () => {
    if (!resolved) return;
    const accountPlan = needsClaudeAccount(resolved.option.auth) ? createPlanOf(resolved, { name, address: url, apiKey, model: "", color, claudeAccount }, existing) : null;
    if (accountPlan && "error" in accountPlan) return setError(t((accountPlan.error === "accountLabelInvalid" || accountPlan.error === "baseUrlMissing" ? `newProfile.error.${accountPlan.error}` : `agent-config.profiles.new.error.${accountPlan.error}`) as MessageKey));
    const spec = addressSpecOf(resolved);
    // P1's official aliases (DeepSeek /v1) restore the preset default on the wire too.
    const createBaseUrl = spec && addressState(spec, url).official ? (spec.official ?? baseUrl) : baseUrl;
    const base = createRequestOf({ name, kind: provider, preset: presetId, baseUrl: createBaseUrl, ...(accounts ? { claudeAccount } : {}) }, existing, presets);
    if ("error" in base) return setError(t(`agent-config.profiles.new.error.${base.error}` as MessageKey));
    const draft: NewProfileDraft = { provider, preset: presetId, baseUrl, apiKey, envName, claudeAccount, kimiAccount, runtimes, defaults, variantBaseUrls, name, color };
    const r = newProfilePlan(draft, base.request, rows, { dshBaseUrlRequired: features.has("profile-relay-runtimes") && !!spec && addressState(spec, url).relay });
    if ("error" in r) return setError(t(`variants.error.${r.error}` as MessageKey));
    const { plan } = r;
    setSaving(true);
    setError(null);
    // Sent once: the field empties now, whatever happens next.
    setApiKey("");
    let detail: ProfileDetail;
    let createdAccountLabel: string | null = null;
    try {
      if (accountPlan && "plan" in accountPlan && accountPlan.plan.account) {
        const account = await api.createClaudeAccount(accountPlan.plan.account);
        if (!account.ok) throw new Error(account.error.message);
        plan.create.claudeAccount = account.account.id;
        createdAccountLabel = accountPlan.plan.account.label;
      }
      if (provider === "claude" && defaults.claude?.model.trim()) plan.create.model = defaults.claude.model.trim();
      detail = await api.createProfile(plan.create);
    } catch (e) {
      setSaving(false);
      const message = e instanceof Error ? e.message : String(e);
      return setError(createdAccountLabel ? t("newProfile.error.accountKept", { label: createdAccountLabel, message }) : message);
    }
    // Later steps: the profile exists; a failure is reported and the profile opens anyway.
    const partial = (step: string, why: string) => useApp.getState().notify(t("variants.error.partial", { name: detail.name, step, error: why }), "error");
    for (const v of plan.addVariants) {
      const step = t("variants.error.step.variant", { runtime: RUNTIME_LABEL[v.runtime] });
      const status = variantStatus(detail, v.runtime);
      if (status && status.status === "unsupported") {
        partial(step, t("variants.error.mismatch", { runtime: RUNTIME_LABEL[v.runtime], reason: reasonKey(status.reason) ? t(reasonKey(status.reason)!) : (status.reason ?? "—") }));
        continue;
      }
      try {
        const added = await api.addProfileVariant(detail.id, v);
        if (added.ok) detail = added.profile;
        else partial(step, added.error.message);
      } catch (e) {
        partial(step, e instanceof Error ? e.message : String(e));
      }
    }
    // A Kimi-kind Profile's default model / effort live on its primary variant (no Profile model fields).
    if (plan.primaryDefaults) {
      try {
        const r = await api.patchProfileVariant(detail.id, plan.primaryDefaults.variantId, plan.primaryDefaults.defaults);
        if (r.ok) detail = r.profile;
        else partial(t("variants.error.step.defaults"), r.error.message);
      } catch (e) {
        partial(t("variants.error.step.defaults"), e instanceof Error ? e.message : String(e));
      }
    }
    if (plan.defaultVariant && detail.runtimeVariants?.some((v) => v.id === plan.defaultVariant)) {
      try { detail = await api.patchProfile(detail.id, { defaultVariant: plan.defaultVariant }); }
      catch (e) { partial(t("variants.error.step.default"), e instanceof Error ? e.message : String(e)); }
    }
    if (plan.color) {
      try { detail = await api.patchProfile(detail.id, { color: plan.color }); }
      catch (e) { partial(t("variants.error.step.color"), e instanceof Error ? e.message : String(e)); }
    }
    setSaving(false);
    onCreated(detail);
  };

  const effortOptions = [{ value: "", label: t("agent-config.profile.effortDefault") }, ...DSH_EFFORTS.map((value) => ({ value, label: t(`composer.effort.${value}`) }))];
  const kimiEffortOptions = [{ value: "", label: t("agent-config.profile.effortDefault") }, ...KIMI_EFFORTS.map((value) => ({ value, label: t(`composer.effort.${value}`) }))];
  // A Kimi account's provisioned catalog (after its first login); API-key Kimi variants take free text.
  const kimiChoices = provider === "kimi" ? runtimeModelChoices("kimi", kimiAccounts.list?.find((a) => a.id === kimiAccount) ?? null, defaults.kimi?.model) : null;
  // The first ticked runtime whose component this host still needs (its install entry below step 3).
  const needsInstall = (["dsh", "kimi", "claude"] as const).filter((r) => runtimes.includes(r) && rows.some((x) => x.runtime === r && x.status === "componentNotInstalled")).map((r) => (r === "dsh" ? DSH_RUNTIME_COMPONENT : r === "kimi" ? KIMI_RUNTIME_COMPONENT : CLAUDE_RUNTIME_COMPONENT))[0] ?? null;
  return (
    <FormFields><Section
      title={t("settings.profiles.new.title")}
      hint={t("variants.new.hint")}

    >
      <div data-new-profile-variants="">
        <StepTitle>{t("newProfile.step.provider")}</StepTitle>
        {!resolved ? <>
          <SettingsGroup navigation agents="none" source="host"><div><ProviderCards cards={cards} disabled={saving} onPick={(card) => choose(defaultChoice(card))} /></div></SettingsGroup>
          <div className="flex justify-end pt-3"><Button onClick={onCancel}>{t("dialog.cancel")}</Button></div>
        </> : <>
        <SettingsGroup navigation agents="none" source="host"><div><ProviderHeader card={resolved.card} disabled={saving} onChange={() => choose(null)} /></div></SettingsGroup>
        <AuthStep variants resolved={resolved} disabled={saving}
          onOption={(option) => choose(choiceFor(resolved.card, option))}
          onGroup={(key) => choose(choiceFor(resolved.card, resolved.option, key))}
          onPreset={(id) => choose({ ...choice!, preset: id })} />
        {needsClaudeAccount(resolved.option.auth) && <SettingRow agents="newAgents" source="host" label={t("newProfile.key.label")} hint={t("newProfile.claudeAccount.note", { label: name.trim() || "…" })}>
          <TextInput mono type="password" label={t("newProfile.key.label")} value={apiKey} disabled={saving} onChange={setApiKey} />
        </SettingRow>}
        {provider === "chatgpt" && <p className="py-2 text-xs text-subtle">{t("variants.credential.chatgpt")}</p>}
        {provider === "claude" && (
          <>
            <p className="py-2 text-xs text-subtle">{t("variants.credential.claudeNote")}</p>
            {accounts && !needsClaudeAccount(resolved.option.auth) && <NewClaudeAccountRow value={claudeAccount} disabled={saving} onChange={(v) => (setClaudeAccount(v), setError(null))} />}
          </>
        )}
        {provider === "kimi" && (
          <>
            <p className="py-2 text-xs text-subtle">{t("variants.credential.kimiNote")}</p>
            <KimiAccountSelect list={kimiAccounts.list} value={kimiAccount} disabled={saving} onChange={(v) => (setKimiAccount(v), setError(null))} onReload={() => void kimiAccounts.load()} />
          </>
        )}
        {provider === "apiKey" && (
          <>
            {envName === null && (
              <SettingRow agents="next" source="host" label={t("variants.credential.key")} hint={t("variants.credential.keyHint")}>
                <TextInput mono type="password" width="w-80" label={t("variants.credential.key")} value={apiKey} placeholder="sk-…" disabled={saving} onChange={(v) => (setApiKey(v), setError(null))} />
              </SettingRow>
            )}
            {dshOffered && (
              <Details label={t("variants.credential.advanced")}>
                <SettingRow agents="next" source="host" label={t("variants.credential.useEnv")}>
                  <Toggle checked={envName !== null} label={t("variants.credential.useEnv")} onChange={useEnv} />
                </SettingRow>
                {envName !== null && (
                  <SettingRow agents="next" source="host" label={t("variants.credential.envName")} hint={envProblem ? <span className="text-danger">{t("variants.credential.envInvalid")}</span> : t("variants.credential.envHint")}>
                    <TextInput mono width="w-64" label={t("variants.credential.envName")} value={envName} placeholder="DEEPSEEK_API_KEY" onChange={(v) => (setEnvName(v), setError(null))} />
                  </SettingRow>
                )}
              </Details>
            )}
          </>
        )}

        <AddressRow resolved={resolved} value={url} disabled={saving} onChange={(value) => (setUrl(value), setPicked(null), setError(null))} />
        <StepTitle>{t("variants.step.runtimes")}</StepTitle>
        {/* The effect marker sits on the hint line: inside the bordered list it took a row of its own above the first runtime. */}
        <SettingsGroup agents="none" source="host">{({ attributes, marker }) => (
          <div {...attributes}>
            <p className="flex items-center gap-1 pb-1 text-xs text-subtle">{t("variants.runtimes.hint")}{marker}</p>
            <div className="rounded-md border border-border px-3" role="group" aria-label={t("variants.step.runtimes")}>
              {rows.map((row) => <RuntimeChoice key={row.runtime} row={row} experimentalAllowed={row.runtime === "dsh" ? features.has("dsh-runtime") : kimiProfiles} checked={runtimes.includes(row.runtime)} isDefault={runtimes.length > 1 && shownDefault === row.runtime} onChange={(v) => toggle(row.runtime, v)} />)}
            </div>
          </div>
        )}</SettingsGroup>
        {runtimes.length > 1 && shownDefault && <p className="pt-1 text-xs text-subtle">{t("variants.defaultNote", { runtime: RUNTIME_LABEL[shownDefault] })}</p>}
        {needsInstall && (
          <>
            <p className="pt-1 text-xs text-warn-text">{t("variants.needsInstallHint", { component: t(`modules.component.${needsInstall}.name` as MessageKey) })}</p>
            <ComponentNotice name={needsInstall} hostId={hostId} className="py-2" />
          </>
        )}
        <p className="pt-1 text-caption/[inherit] text-subtle">{t("variants.runtimes.previewNote")}</p>
        {features.has("profile-relay-runtimes") && provider === "apiKey" && runtimes.includes("dsh") && (
          <SettingRow agents="newAgents" source="host" label={`DSH · ${t("agent-config.profiles.new.baseUrl")}`} hint={t("variants.error.variantBaseUrlMissing")}>
            <TextInput mono width="w-80" label={`DSH · ${t("agent-config.profiles.new.baseUrl")}`} value={variantBaseUrls.dsh ?? ""} placeholder="https://api.deepseek.com/anthropic" onChange={(value) => (setVariantBaseUrls({ dsh: value }), setError(null))} />
          </SettingRow>
        )}

        <StepTitle>{t("variants.step.defaults")}</StepTitle>
        {provider === "claude" && <SettingRow agents="newAgents" source="host" label={t("newProfile.model.label", { runtime: "Claude" })} hint={t("newProfile.model.hint")}>
          <TextInput mono value={defaults.claude?.model ?? ""} onChange={(model) => setDefault("claude", { model })} />
        </SettingRow>}
        {provider === "apiKey" && runtimes.includes("codex") && (
          <SettingRow agents="newAgents" source="host" label={t("variants.defaults.model", { runtime: RUNTIME_LABEL.codex })} hint={t("variants.defaults.hint")}>
            <TextInput mono width="w-64" value={defaults.codex?.model ?? ""} placeholder={chosen?.defaultModel ?? t("variants.defaults.modelPlaceholder")} onChange={(model) => setDefault("codex", { model })} />
          </SettingRow>
        )}
        {runtimes.includes("dsh") && (
          <>
            <SettingRow agents="newAgents" source="host" label={t("variants.defaults.model", { runtime: RUNTIME_LABEL.dsh })}>
              <Select value={defaults.dsh?.model || DSH_DEFAULT_MODEL} options={dshModelIds(null, defaults.dsh?.model).map((m) => ({ value: m, label: m }))} onChange={(model) => setDefault("dsh", { model })} />
            </SettingRow>
            <SettingRow agents="newAgents" source="host" label={t("variants.defaults.effort", { runtime: RUNTIME_LABEL.dsh })}>
              <Select value={defaults.dsh?.reasoningEffort ?? ""} options={effortOptions} onChange={(reasoningEffort) => setDefault("dsh", { reasoningEffort })} />
            </SettingRow>
          </>
        )}
        {runtimes.includes("kimi") && (
          <>
            <SettingRow agents="newAgents" source="host" label={t("variants.defaults.model", { runtime: RUNTIME_LABEL.kimi })} hint={provider === "kimi" ? t("variants.defaults.kimiAccountModelHint") : undefined}>
              {kimiChoices ? (
                <Select value={defaults.kimi?.model ?? ""} options={[{ value: "", label: t("variants.defaults.modelRuntimeDefault") }, ...kimiChoices.map((m) => ({ value: m, label: m }))]} onChange={(model) => setDefault("kimi", { model })} />
              ) : (
                <TextInput mono width="w-64" value={defaults.kimi?.model ?? ""} placeholder={provider === "apiKey" ? (chosen?.defaultModel ?? t("variants.defaults.modelKimiPlaceholder")) : t("variants.defaults.modelRuntimeDefault")} onChange={(model) => setDefault("kimi", { model })} />
              )}
            </SettingRow>
            <SettingRow agents="newAgents" source="host" label={t("variants.defaults.effort", { runtime: RUNTIME_LABEL.kimi })}>
              <Select value={defaults.kimi?.reasoningEffort ?? ""} options={kimiEffortOptions} onChange={(reasoningEffort) => setDefault("kimi", { reasoningEffort })} />
            </SettingRow>
          </>
        )}
        {!(provider === "apiKey" && runtimes.includes("codex")) && !runtimes.includes("dsh") && !runtimes.includes("kimi") && <p className="py-2 text-xs text-subtle">{t("variants.defaults.hint")}</p>}

        <StepTitle>{t("variants.step.name")}</StepTitle>
        <NameStep name={name} onName={(value) => (setName(value), setError(null))} color={color} onColor={setColor} placeholder={resolved.card.id} />
        {provider === "claude" && <ComponentNotice name={CLAUDE_RUNTIME_COMPONENT} hostId={hostId} className="py-2" />}
        {saving && <Notice tone="info">{t("variants.creating")}</Notice>}
        <p className="h-6 truncate pt-1 text-xs text-danger" title={error ?? undefined}>{error}</p>
        <p className="pt-2 text-xs text-subtle" data-new-profile-summary="">{[providerName(t, resolved), optionLabel(t, resolved.option), relayHost(resolved, url) ? t("newProfile.summary.via", { host: relayHost(resolved, url)! }) : null, runtimes.map((runtime) => RUNTIME_LABEL[runtime]).join(" · ")].filter(Boolean).join(" · ")}</p>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button onClick={onCancel}>{t("dialog.cancel")}</Button>
          <Button primary disabled={saving || envProblem} onClick={() => void create()}>{saving ? t("variants.creating") : t("newProfile.create")}</Button>
        </div>
        </>}
      </div>
    </Section></FormFields>
  );
}
