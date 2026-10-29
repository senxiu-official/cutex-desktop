// Settings → Profiles → 添加, provider-first (design .claude/previews/profile-new-flow.md §3, phase P1):
// ① provider cards → ② login method (each with what it leads to) + key + 接口地址 → ③ the runtime it
// leads to → ④ default model → ⑤ name and colour, then a summary line. Cards, options, addresses and
// the requests come from lib/newProfileModel (cutex's presets `GET /v2/profile-presets` + capability
// flags); cutex validates everything again.
// Keys are write-only: an API key goes into `POST /v2/profiles {apiKey}`; an Anthropic key (own or a
// provider's Anthropic-compatible one, decisions 4 / 5) into a new Claude API account
// (`POST /v2/claude/accounts {kind:"api", apiKey}`) that the Claude Profile then uses. The field is
// cleared once submitted. Create order: account → Profile → colour; a failed later step keeps what
// was created and says which step failed (the Profile, if created, still opens).
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CLAUDE_ACCOUNT } from "../../../../shared/claudeAccounts";
import type { ProfileCreateKind, ProfileDetail } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { markGuideSeen } from "../../lib/guides";
import { choiceFor, choiceForPreset, createKindOf, createPlanOf, defaultChoice, needsClaudeAccount, providerCards, resolveChoice, RUNTIME_LABEL, takesKey, type NewProfileChoice } from "../../lib/newProfileModel";
import { summaryLine } from "../../lib/newProfileText";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useProfilePresets } from "../../lib/useProfilePresets";
import { InlineGuide } from "../InlineGuide";
import { Button, Section, SettingRow, SettingsGroup, TextInput } from "./Form";
import { AddressRow } from "./newProfile/AddressRow";
import { AuthStep } from "./newProfile/AuthStep";
import { NameStep, SummaryLine } from "./newProfile/NameStep";
import { ProviderCards, ProviderHeader } from "./newProfile/ProviderCards";
import { RuntimeStep } from "./newProfile/RuntimeStep";
import { StepTitle } from "./newProfile/StepTitle";
import { NewClaudeAccountRow } from "./ProfileClaudeAccount";

/** Existing Profile kinds suppress their guide; 「用这个服务商新建」 (editor) preselects its preset. */
export function NewProfileForm({ existing, haveKinds, onCreated, onCancel, initialPreset }: { existing: string[]; haveKinds?: ReadonlySet<ProfileCreateKind> | null; onCreated(detail: ProfileDetail): void; onCancel(): void; initialPreset?: string }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const features = useTargetFeatures();
  const hostId = useTargetHostId();
  const presets = useProfilePresets();
  const cards = useMemo(() => providerCards(presets, features), [presets, features]);
  const [choice, setChoice] = useState<NewProfileChoice | null>(() => (initialPreset ? choiceForPreset(cards, initialPreset) : null));
  const [address, setAddress] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [claudeAccount, setClaudeAccount] = useState(DEFAULT_CLAUDE_ACCOUNT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const resolved = choice ? resolveChoice(cards, choice) : null;
  const unavailable = !!choice && resolved?.option.id !== choice.option;
  // 「用这个服务商新建」 before the host's presets arrived: pick it once they do (unless the owner chose already).
  const touched = useRef(false);
  useEffect(() => {
    if (initialPreset && !touched.current && !choice) setChoice(choiceForPreset(cards, initialPreset));
  }, [cards, initialPreset, choice]);

  /** Another provider / method / key kind / region: its own address and key (keys don't carry over). */
  const choose = (next: NewProfileChoice | null) => {
    touched.current = true;
    setChoice(next);
    setAddress(null);
    setApiKey("");
    setModel("");
    setError(null);
  };

  const create = async () => {
    if (!resolved || unavailable) return;
    const r = createPlanOf(resolved, { name, address, apiKey, model, color, claudeAccount }, existing);
    if ("error" in r) {
      const key = r.error === "baseUrlMissing" || r.error === "accountLabelInvalid" ? `newProfile.error.${r.error}` : `agent-config.profiles.new.error.${r.error}`;
      return setError(t(key as MessageKey));
    }
    const { plan } = r;
    setSaving(true);
    setError(null);
    // The key is in the plan now; the field never keeps it past a submit.
    setApiKey("");
    const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
    try {
      if (plan.account) {
        const created = await api.createClaudeAccount(plan.account).catch((e: unknown) => ({ ok: false as const, error: { code: "", message: message(e) } }));
        if (!created.ok) {
          const why = created.error.message ? (created.error.code ? `${created.error.message} (${created.error.code})` : created.error.message) : created.error.code;
          return setError(t("newProfile.error.step", { step: t("newProfile.error.step.account"), message: why }));
        }
        plan.profile.claudeAccount = created.account.id;
      }
      let detail: ProfileDetail;
      try {
        detail = await api.createProfile(plan.profile);
      } catch (e) {
        return setError(plan.account ? t("newProfile.error.accountKept", { label: plan.account.label, message: message(e) }) : t("newProfile.error.step", { step: t("newProfile.error.step.profile"), message: message(e) }));
      }
      markGuideSeen(`inline.profile.${plan.profile.kind}`);
      if (plan.color) {
        try {
          detail = await api.patchProfile(detail.name, { color: plan.color });
        } catch (e) {
          // The Profile exists: open it anyway; the page says what didn't stick.
          setError(t("newProfile.error.colorFailed", { name: detail.name, message: message(e) }));
        }
      }
      onCreated(detail);
    } finally {
      setSaving(false);
    }
  };

  const kind = resolved ? createKindOf(resolved.option.auth) : null;
  const runtime = resolved?.option.runtime ?? null;
  const status = <p className="h-6 truncate pt-1 text-xs text-danger" title={error ?? undefined} data-new-profile-error="">{error}</p>;

  return (
    <Section title={t("settings.profiles.new.title")} hint={t("newProfile.hint")}>
      {kind && kind !== "dsh" && haveKinds !== null && <InlineGuide key={kind} id={`inline.profile.${kind}`} done={haveKinds?.has(kind)} />}
      <StepTitle n={1}>{t("newProfile.step.provider")}</StepTitle>
      {!resolved ? (
        <>
          <SettingsGroup navigation agents="none" source="host">
            <div>
              <ProviderCards cards={cards} disabled={saving} onPick={(card) => choose(defaultChoice(card))} />
            </div>
          </SettingsGroup>
          <p className="pb-1 text-xs text-subtle">{t("newProfile.cardsHint")}</p>
          <div className="mt-2 flex justify-end border-t border-border pt-3">
            <Button onClick={onCancel}>{t("dialog.cancel")}</Button>
          </div>
        </>
      ) : (
        <>
          <SettingsGroup navigation agents="none" source="host">
            <div>
              <ProviderHeader card={resolved.card} disabled={saving} onChange={() => choose(null)} />
            </div>
          </SettingsGroup>
          <AuthStep
            resolved={resolved}
            disabled={saving}
            onOption={(option) => choose(choiceFor(resolved.card, option))}
            onGroup={(key) => choose(choiceFor(resolved.card, resolved.option, key))}
            onPreset={(id) => choose({ ...choiceFor(resolved.card, resolved.option, resolved.group?.key), preset: id })}
          />
          {takesKey(resolved.option.auth) && (
            <SettingRow agents="newAgents" source="host" label={t("newProfile.key.label")} hint={needsClaudeAccount(resolved.option.auth) ? t("newProfile.key.hintClaude", { env: resolved.option.auth === "anthropicKey" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN" }) : t("newProfile.key.hint")}>
              <TextInput mono type="password" width="w-80" label={t("newProfile.key.label")} value={apiKey} disabled={saving} placeholder="sk-…" onChange={(v) => (setApiKey(v), setError(null))} />
            </SettingRow>
          )}
          <AddressRow resolved={resolved} value={address} disabled={saving} onChange={(v) => (setAddress(v), setError(null))} />
          {resolved.option.auth === "claudeSubscription" && features.has("claude-accounts") && <NewClaudeAccountRow value={claudeAccount} disabled={saving} onChange={(v) => (setClaudeAccount(v), setError(null))} />}
          {needsClaudeAccount(resolved.option.auth) && <p className="py-2 text-xs text-subtle" data-claude-account-note="">{t("newProfile.claudeAccount.note", { label: name.trim() || "…" })}</p>}
          <StepTitle n={3}>{t("newProfile.step.runtime")}</StepTitle>
          <RuntimeStep resolved={resolved} address={address} hostId={hostId} />
          <StepTitle n={4}>{t("newProfile.step.models")}</StepTitle>
          {runtime === "dsh" ? (
            <SettingRow source="host" agents="newAgents" readOnly label={t("newProfile.model.label", { runtime: RUNTIME_LABEL.dsh })} hint={t("dsh.credentials", { env: "DEEPSEEK_API_KEY" })}>
              <span className="font-mono text-xs">deepseek-v4-flash</span>
            </SettingRow>
          ) : (
            <SettingRow agents="newAgents" source="host" label={t("newProfile.model.label", { runtime: RUNTIME_LABEL[runtime!] })} hint={t("newProfile.model.hint")}>
              <TextInput
                mono
                label={t("newProfile.model.label", { runtime: RUNTIME_LABEL[runtime!] })}
                value={model}
                disabled={saving}
                placeholder={resolved.option.auth === "apiKey" && resolved.preset?.defaultModel ? t("newProfile.model.placeholderDefault", { model: resolved.preset.defaultModel }) : t("newProfile.model.placeholder")}
                onChange={(v) => (setModel(v), setError(null))}
              />
            </SettingRow>
          )}
          <StepTitle n={5}>{t("newProfile.step.name")}</StepTitle>
          <NameStep name={name} onName={(v) => (setName(v), setError(null))} color={color} onColor={setColor} placeholder={resolved.card.id === "more" && resolved.group ? resolved.group.key : resolved.card.id} />
          {status}
          <SummaryLine text={summaryLine(t, resolved, address)} saving={saving || unavailable} onCancel={onCancel} onCreate={() => void create()} cancelLabel={t("dialog.cancel")} />
        </>
      )}
    </Section>
  );
}
