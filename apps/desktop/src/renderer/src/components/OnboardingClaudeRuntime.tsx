// Onboarding owns the explanation; shared component state/actions own runtime installation.
import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { CLAUDE_RUNTIME_COMPONENT } from "../lib/componentCard";
import { loadComponents } from "../lib/componentStore";
import { useComponentState } from "../lib/componentView";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../lib/targetHost";
import { useClaudeAccountList } from "../lib/useClaudeAccountList";
import { useHostData } from "../lib/useHostScope";
import { ComponentCard } from "./ComponentCard";
import { Button } from "./settings/Form";
import { OnboardingClaudeCli } from "./OnboardingClaudeCli";

/** Mounted only after choosing Claude: Codex users do not fetch Claude setup state. */
export function OnboardingClaudeRuntime() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const features = useTargetFeatures();
  const api = useTargetApi();
  const checkingAccount = useRef(false);
  const [failedHost, setFailedHost] = useState<string | null>(null);
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const { state, entry } = useComponentState(hostId, CLAUDE_RUNTIME_COMPONENT);
  const { list, loadError, load } = useClaudeAccountList(features.has("claude-accounts"));
  const recheckAccount = async () => {
    if (!features.has("claude-accounts") || checkingAccount.current) return;
    checkingAccount.current = true;
    setFailedHost(null);
    try {
      const result = await api.checkClaudeAccount("default");
      if (!result.ok) setFailedHost(hostId);
      await load();
    } catch { setFailedHost(hostId); }
    finally { checkingAccount.current = false; }
  };
  const status = list?.find(account => account.id === "default")?.status;
  const checked = connected && failedHost !== hostId && !!status?.checkedAt && !status.error;
  const cliChoice = entry.list?.components.find(component => component.name === CLAUDE_RUNTIME_COMPONENT)?.claudeCli;
  const source = cliChoice ? <OnboardingClaudeCli key={hostId} hostId={hostId} disabled={!connected || state.kind === "askOwner" || state.kind === "installing"} choice={{
    selected: cliChoice.selected, bundledVersion: cliChoice.bundled.version, systemVersion: cliChoice.system?.version ?? null, systemDetected: !!cliChoice.system,
  }} /> : null;
  if (state.kind === "body" && connected && checked && status?.loggedIn) {
    return <div className="mt-3 text-sm text-subtle" data-onboarding-claude="ready"><p>{t("onboarding.claudeRuntime.ready")}</p>{source}</div>;
  }
  const cli = failedHost === hostId || loadError || status?.error ? "checkFailed" : checked ? "verified" : "unknown";
  const login = checked ? status?.loggedIn ? "signedIn" : "signedOut" : "unknown";
  return <div className="mt-3 space-y-2" data-onboarding-claude={state.kind}>
    {!cliChoice && <p className="text-sm text-muted">{t("onboarding.claudeRuntime.intro")}</p>}
    {state.kind === "body" ? <p className="text-sm text-subtle">{t(connected ? "onboarding.claudeRuntime.runtimeReady" : "onboarding.claudeRuntime.checking")}</p>
      : state.kind === "waiting" ? <p className="text-sm text-subtle" role="status">{t("onboarding.claudeRuntime.checking")}</p>
      : <ComponentCard name={CLAUDE_RUNTIME_COMPONENT} hostId={hostId} state={state} refusal={entry.refusal?.name === CLAUDE_RUNTIME_COMPONENT ? entry.refusal.error : null} variant="compact" afterRecheck={recheckAccount} />}
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-subtle">
      <div><dt className="inline">{t("onboarding.claudeRuntime.cli")}: </dt><dd className="inline">{t(`onboarding.claudeRuntime.${cli}`)}</dd></div>
      <div><dt className="inline">{t("onboarding.claudeRuntime.login")}: </dt><dd className="inline">{t(`onboarding.claudeRuntime.${login}`)}</dd></div>
    </dl>
    {source}
    {state.kind === "body" && connected && <Button onClick={() => { void loadComponents(hostId); void recheckAccount(); }}>{t("modules.component.recheck")}</Button>}
  </div>;
}
