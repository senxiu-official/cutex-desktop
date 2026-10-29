// Profile editor → 服务与凭证 (cutex profile-runtime-variants, docs/design/042): the provider and its interfaces, and the
// Profile's ONE credential — where it comes from and whether it is set (已设置 / 未设置, a version), never the value.
// Replace / remove act at once (write-only `PATCH {apiKey}`; the field empties right after the send); a DSH Profile may
// read a named host variable instead (Advanced; no fallback). Says who is affected: this Profile's bound agents at their
// next start (running ones keep their key), or — for a Claude account — the other Profiles sharing it.
import { useState } from "react";
import type { ProfileDetail } from "../../../../shared/ipc";
import { credentialEnvName } from "../../../../shared/profileVariants";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { boundAgents } from "../../lib/profileVariants";
import { useClaudeAccountList } from "../../lib/useClaudeAccountList";
import { useTargetApi } from "../../lib/targetHost";
import { Tag } from "../Tag";
import { Button, Details, Section, SettingRow, TextInput, Toggle } from "./Form";
import { useKimiAccountList } from "../../lib/kimiAccounts";
import { KimiAccountSelect } from "./KimiAccountSelect";

/** A Kimi-kind Profile (r266): its credential is a Kimi account; changing it applies to new agents only. */
function KimiCredential({ detail, accountId, busy, onPick }: { detail: ProfileDetail; accountId: string | null; busy: boolean; onPick(id: string): void }) {
  const { t } = useI18n();
  const { list, load } = useKimiAccountList();
  const account = list?.find((a) => a.id === accountId) ?? null;
  const others = (account?.profiles ?? []).filter((p) => p.id !== detail.id && p.name !== detail.id).map((p) => p.name);
  return (
    <>
      <KimiAccountSelect list={list} value={accountId ?? ""} disabled={busy} onReload={() => void load()} onChange={(id) => { if (id && id !== accountId) onPick(id); }} />
      {accountId && <p className="py-1 text-xs text-subtle" data-credential-kimi="">{t("variants.credential.kimiAffects", { account: account?.label ?? accountId, profiles: others.length ? others.join("、") : "—" })}</p>}
    </>
  );
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ClaudeShared({ accountId, profile }: { accountId: string; profile: string }) {
  const { t } = useI18n();
  const { list } = useClaudeAccountList();
  const account = list?.find((a) => a.id === accountId) ?? null;
  const others = (account?.profiles ?? []).filter((p) => p.id !== profile && p.name !== profile).map((p) => p.name);
  return (
    <p className="py-1 text-xs text-subtle" data-credential-claude="">
      {t("variants.credential.claudeAffects", { account: account?.label ?? (accountId === "default" ? t("variants.credential.sharedClaude") : accountId), profiles: others.length ? others.join("、") : "—" })}
    </p>
  );
}

export function ProfileCredentialSection({ detail, onChanged }: { detail: ProfileDetail; onChanged(next?: ProfileDetail): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const cred = detail.credential;
  const [key, setKey] = useState("");
  const [envDraft, setEnvDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [removeArmed, setRemoveArmed] = useArmed(`${detail.id}:${cred?.version ?? 0}`);
  if (!cred) return null;
  const dsh = detail.cliKind === "dsh";
  const agents = boundAgents(detail);
  const run = async (patch: Parameters<typeof api.patchProfile>[1], done: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const next = await api.patchProfile(detail.id, patch);
      setStatus({ text: done, error: false });
      onChanged(next);
    } catch (e) {
      setStatus({ text: errorText(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const saveKey = () => {
    const value = key;
    // Sent once: the field empties now, whatever cutex answers.
    setKey("");
    void run({ apiKey: value }, t("variants.credential.saved"));
  };
  const sourceText = cred.source === "env" ? t("variants.credential.source.env", { name: cred.envName ?? "—" }) : t(`variants.credential.source.${cred.source}` as MessageKey);
  const presence = cred.source === "env"
    ? <Tag tone={cred.present ? "ok" : "attention"}>{t(cred.present ? "variants.credential.envSet" : "variants.credential.envMissing")}</Tag>
    : cred.source === "kimiAccount" ? <Tag tone={cred.present ? "ok" : "attention"}>{t(cred.present ? "variants.credential.kimiSignedIn" : "variants.credential.kimiSignedOut")}</Tag>
    : cred.source === "stored" || cred.source === "none" ? <Tag tone={cred.present ? "ok" : "attention"}>{t(cred.present ? "variants.credential.set" : "variants.credential.notSet")}</Tag> : null;
  const envProblem = envDraft !== null && envDraft.trim() !== "" && !credentialEnvName(envDraft);
  return (
    <Section title={t("variants.credential.title")} hint={t("variants.credential.sectionHint")}>
      <div data-profile-credential={cred.source}>
        <SettingRow agents="none" source="host" readOnly label={t("variants.credential.provider")}>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
            <span>{detail.providerFamilyLabel ?? detail.provider ?? "—"}</span>
            {(detail.providerInterfaces ?? []).map((i) => (
              <Tag key={`${i.kind}:${i.baseUrl ?? ""}`} title={i.baseUrl ?? undefined}>{t(`variants.iface.${i.kind}` as MessageKey) === `variants.iface.${i.kind}` ? i.kind : t(`variants.iface.${i.kind}` as MessageKey)}</Tag>
            ))}
          </span>
        </SettingRow>
        <SettingRow agents="next" source="host" readOnly label={t("variants.credential.source")}>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
            <span>{sourceText}</span>
            {presence}
            {cred.version !== null && cred.present && <span className="text-xs text-subtle">{t("variants.credential.version", { n: cred.version })}</span>}
          </span>
        </SettingRow>
        {cred.writable && cred.source !== "env" && (
          <SettingRow agents="next" source="host" label={t(cred.present ? "variants.credential.replace" : "variants.credential.setKey")}>
            <TextInput mono type="password" width="w-64" label={t("variants.credential.key")} value={key} disabled={busy} placeholder={cred.present ? t("variants.credential.replacePlaceholder") : "sk-…"} onChange={setKey}
              onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) saveKey(); }} />
            <Button primary disabled={busy || !key.trim()} onClick={saveKey}>{t(cred.present ? "variants.credential.replace" : "variants.credential.setKey")}</Button>
            {/* Removing is a DSH stored key's action only (cutex cannot clear a Codex profile's key). */}
            {dsh && cred.source === "stored" && cred.present && (removeArmed ? (
              <button className={ARMED_FORM_BUTTON} disabled={busy} onClick={() => { setRemoveArmed(false); void run({ apiKey: null }, t("variants.credential.removed")); }}>{t("variants.credential.removeAgain")}</button>
            ) : (
              <Button disabled={busy} onClick={() => setRemoveArmed(true)}>{t("variants.credential.remove")}</Button>
            ))}
          </SettingRow>
        )}
        {cred.source === "claudeAccount" && cred.claudeAccountId && <ClaudeShared accountId={cred.claudeAccountId} profile={detail.id} />}
        {(cred.source === "kimiAccount" || detail.cliKind === "kimi") && <KimiCredential detail={detail} accountId={cred.kimiAccountId ?? detail.kimiAccount ?? null} busy={busy} onPick={(id) => void run({ kimiAccount: id }, t("variants.credential.kimiChanged"))} />}
        {cred.source === "chatgptLogin" && <p className="py-1 text-xs text-subtle">{t("variants.credential.chatgptHint")}</p>}
        {dsh && (
          <Details label={t("variants.credential.advanced")}>
            <SettingRow agents="next" source="host" label={t("variants.credential.useEnv")} hint={t("variants.credential.envHint")}>
              <Toggle checked={cred.source === "env" || envDraft !== null} disabled={busy} label={t("variants.credential.useEnv")}
                onChange={(on) => {
                  if (on) setEnvDraft(cred.envName ?? "");
                  else if (cred.source === "env") void run({ credential: { source: "stored" } }, t("variants.credential.sourceSaved")).then(() => setEnvDraft(null));
                  else setEnvDraft(null);
                }} />
            </SettingRow>
            {(envDraft !== null || cred.source === "env") && (
              <SettingRow agents="next" source="host" label={t("variants.credential.envName")} hint={envProblem ? <span className="text-danger">{t("variants.credential.envInvalid")}</span> : undefined}>
                <TextInput mono width="w-64" label={t("variants.credential.envName")} value={envDraft ?? cred.envName ?? ""} placeholder="DEEPSEEK_API_KEY" disabled={busy} onChange={setEnvDraft} />
                <Button disabled={busy || envProblem || !(envDraft ?? "").trim() || envDraft?.trim() === cred.envName} onClick={() => void run({ credential: { source: "env", envName: envDraft!.trim() } }, t("variants.credential.sourceSaved")).then(() => setEnvDraft(null))}>{t("variants.credential.envSave")}</Button>
              </SettingRow>
            )}
          </Details>
        )}
        {cred.source !== "claudeAccount" && cred.source !== "kimiAccount" && <p className="py-1 text-xs text-subtle" data-credential-affects={agents}>{agents ? t("variants.credential.affects", { n: agents }) : t("variants.credential.affectsNone")}</p>}
        {status && <p role="status" className={`py-1 text-xs ${status.error ? "text-danger" : "text-ok-text"}`}>{status.text}</p>}
      </div>
    </Section>
  );
}
