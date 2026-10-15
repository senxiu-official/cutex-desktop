// Settings → Profiles → 添加: in-page form (cutex `POST /v2/profiles`, feature profile-create).
// Only the rows of the chosen kind show (review UI-04): a login kind (ChatGPT / Claude) is just a name,
// the API key kind adds 服务商 and Base URL. It starts on ChatGPT 登录, the first kind and the one that
// needs nothing pasted. After creating, the page opens the new profile so the user logs in / pastes the key there. With cutex `claude-accounts` a Claude profile also picks its
// Claude 账户 here (default = the shared account; 「+ 添加订阅」 beside it comes from the module).
// API key: the provider list is cutex's (`GET /v2/profile-presets`); an official provider fills in its
// official Base URL, which stays editable (「恢复官方地址」 puts it back); 自定义 = a third-party
// relay, URL required. The request carries `baseUrl` only when it differs from the official one.
// A preset's `quotaReader` (cutex profile-generic-switches) is applied by cutex on create; shown only.
import { useState } from "react";
import { DEFAULT_CLAUDE_ACCOUNT } from "../../../../shared/claudeAccounts";
import type { ProfileCreateKind, ProfileDetail } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { claudeAccountRowShown } from "../../lib/claudeAccounts";
import { createRequestOf } from "../../lib/profileCreate";
import { createUrlState, officialPresets, presetById, relayPresets, urlHost, urlRegion } from "../../lib/profilePresets";
import { quotaPresetLabel } from "../../lib/quota";
import { useProfilePresets } from "../../lib/useProfilePresets";
import { Button, HintAction, SettingRow, Section, Segmented, Select, TextInput } from "./Form";
import { NewClaudeAccountRow } from "./ProfileClaudeAccount";
import { useTargetApi, useTargetFeatures } from "../../lib/targetHost";

export function NewProfileForm({ existing, onCreated, onCancel }: { existing: string[]; onCreated(detail: ProfileDetail): void; onCancel(): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const features = useTargetFeatures();
  const presets = useProfilePresets();
  const providers = officialPresets(presets);
  const relays = relayPresets(presets);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProfileCreateKind>("chatgpt");
  /** Preset id ("" = 自定义); null = not chosen yet (the first provider). */
  const [presetChoice, setPresetChoice] = useState<string | null>(null);
  /** The Base URL input; null = untouched (shows the provider's official URL). */
  const [url, setUrl] = useState<string | null>(null);
  const [claudeAccount, setClaudeAccount] = useState(DEFAULT_CLAUDE_ACCOUNT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const apiKey = kind === "apiKey";
  const accounts = claudeAccountRowShown(features, "claude");
  const presetId = presetChoice ?? providers[0]?.id ?? "";
  const chosen = presetId ? presetById(presetId, presets) : null;
  const baseUrl = url ?? chosen?.baseUrl ?? "";
  const state = createUrlState(chosen, baseUrl, presets);
  const region = (u: string | null | undefined) => {
    const r = urlRegion(u);
    return r ? t(`agent-config.profile.region.${r}`) : null;
  };

  const choosePreset = (id: string) => {
    setPresetChoice(id);
    // An official provider starts from its official URL; 自定义 and relay presets keep a URL typed before.
    if (id && presetById(id, presets)?.baseUrl) setUrl(null);
    else if (url === null) setUrl("");
    setError(null);
  };
  const create = async () => {
    const r = createRequestOf({ name, kind, preset: presetId, baseUrl, ...(accounts ? { claudeAccount } : {}) }, existing, presets);
    if ("error" in r) return setError(t(`agent-config.profiles.new.error.${r.error}` as MessageKey));
    setSaving(true);
    setError(null);
    try {
      onCreated(await api.createProfile(r.request));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const label = chosen ? [chosen.label, region(baseUrl)].filter(Boolean).join(" · ") : "";
  // Emptied or changed to an own URL (another official endpoint is one click below the hint instead).
  const restore = state.restore && (!baseUrl.trim() || !state.official) && (
    <HintAction title={state.restore} onClick={() => (setUrl(null), setError(null))}>
      {t("agent-config.profile.restoreOfficial")}
    </HintAction>
  );
  const urlHint = !chosen ? (
    t("agent-config.profiles.new.baseUrlCustom")
  ) : !chosen.baseUrl ? (
    t("agent-config.profiles.new.baseUrlRelay", { preset: chosen.label })
  ) : !baseUrl.trim() ? (
    <>
      {t("agent-config.profiles.new.baseUrlEmpty", { preset: chosen.label })}
      {restore}
    </>
  ) : state.official ? (
    <>
      {t("agent-config.profiles.new.baseUrlOfficial", { preset: label })}
      {state.choices.length > 0 && (
        <span className="block">
          {t("agent-config.profiles.new.otherOfficial")}
          {state.choices.map((c) => (
            <HintAction key={c.url} title={`${c.preset.label} · ${c.url}`} onClick={() => (setPresetChoice(c.preset.id), setUrl(c.url === c.preset.baseUrl ? null : c.url), setError(null))}>
              {[urlHost(c.url), region(c.url)].filter(Boolean).join(" · ")}
            </HintAction>
          ))}
        </span>
      )}
    </>
  ) : (
    <>
      {t("agent-config.profiles.new.baseUrlEdited", { preset: chosen.label, url: chosen.baseUrl ?? "" })}
      {restore}
    </>
  );

  return (
    <Section
      title={t("settings.profiles.new.title")}
      hint={t("agent-config.profiles.new.hint")}
      actions={
        <>
          <Button onClick={onCancel}>{t("dialog.cancel")}</Button>
          <Button primary disabled={saving} onClick={() => void create()}>{t("agent-config.profiles.new.create")}</Button>
        </>
      }
    >
      <SettingRow label={t("agent-config.profiles.new.name")}>
        <TextInput value={name} onChange={(v) => (setName(v), setError(null))} placeholder="glm-work" />
      </SettingRow>
      <SettingRow label={t("agent-config.profiles.new.kind")}>
        <Segmented
          value={kind}
          options={(["chatgpt", "claude", "apiKey"] as const).map((k) => ({ value: k, label: t(`agent-config.profiles.new.kind.${k}`) }))}
          onChange={(v) => (setKind(v), setError(null))}
        />
      </SettingRow>
      {apiKey && (
        <>
          <SettingRow
            label={t("agent-config.profiles.new.preset")}
            hint={
              <>
                {t("agent-config.profiles.new.presetHint")}
                {/* cutex r222 `autoQuota` (absent on older cutex: say nothing); only true on the official URL. */}
                {/* profile-generic-switches `quotaReader`: cutex turns that reader on itself (official URL only). */}
                {chosen?.quotaReader && state.official ? (
                  <span className="block">{t("agent-config.profiles.new.quotaReader", { reader: quotaPresetLabel(t, chosen.quotaReader) })}</span>
                ) : (
                  chosen?.autoQuota === true && state.official && <span className="block">{t("agent-config.profiles.new.autoQuota")}</span>
                )}
                {/* cutex profile-presets-v2 (absent on older cutex: say nothing). */}
                {chosen?.modelCatalog === true && <span className="block">{t("agent-config.profiles.new.modelCatalog")}</span>}
                {chosen?.webSearch === "disabled" && <span className="block">{t("agent-config.profiles.new.webSearchOff")}</span>}
              </>
            }
          >
            <Select
              width="w-80"
              value={presetId}
              options={[...providers.map((p) => ({ value: p.id, label: p.label })), ...relays.map((p) => ({ value: p.id, label: p.label })), { value: "", label: t("agent-config.profiles.new.preset.custom") }]}
              onChange={choosePreset}
            />
          </SettingRow>
          <SettingRow label={t("agent-config.profiles.new.baseUrl")} hint={urlHint}>
            <TextInput
              mono
              width="w-80"
              value={baseUrl}
              placeholder={chosen?.baseUrl ?? "https://example.com/v1"}
              onChange={(v) => (setUrl(v), setError(null))}
            />
          </SettingRow>
        </>
      )}
      {accounts && kind === "claude" && <NewClaudeAccountRow value={claudeAccount} disabled={false} onChange={(v) => (setClaudeAccount(v), setError(null))} />}
      {/* Fixed-height status line: an error never pushes the form around. */}
      <p className="h-6 truncate pt-1 text-xs text-danger" title={error ?? undefined}>{error}</p>
    </Section>
  );
}
