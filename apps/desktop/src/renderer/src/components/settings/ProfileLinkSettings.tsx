import { useEffect, useState } from "react";
import type { ProfileLinkState } from "../../../../shared/profileLink";
import { api, bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { refreshAccountProfiles } from "../../lib/profileAccountLinks";
import { useHostScope } from "../../lib/useHostScope";
import { Button, SettingsGroup } from "./Form";

export function ProfileLinkSettings() {
  const { t } = useI18n();
  const scope = useHostScope();
  const [state, setState] = useState<ProfileLinkState | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void api.profileLinkState().then((value) => alive && setState(value), () => {});
    const stop = bridge.on("profileLinkState", (value) => { if (alive) setState(value); });
    return () => { alive = false; stop(); };
  }, []);
  const reset = async () => {
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    setFailed(false);
    try { setState(await api.resetProfileLinks()); await refreshAccountProfiles(); }
    catch { setFailed(true); }
    finally { setBusy(false); setArmed(false); }
  };
  const pending = Object.entries(state?.hosts ?? {}).filter(([, value]) => value.state === "pending" || value.state === "error").map(([id]) => scope.host(id)?.label ?? id).join(", ");
  const localRequired = Object.entries(state?.hosts ?? {}).filter(([, value]) => value.code === "owner_local_required").map(([id]) => scope.host(id)?.label ?? id).join(", ");
  const disabledHosts = Object.entries(state?.hosts ?? {}).filter(([, value]) => value.code === "host_disabled").map(([id]) => scope.host(id)?.label ?? id).join(", ");
  return <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3 text-xs" data-profile-link-settings>
    <SettingsGroup agents="none" source="host" allHosts>{decoration =>
    <div {...decoration.attributes} className="flex items-center gap-3"><div className="min-w-0 flex-1"><span className="font-medium text-foreground">{t("settings.profile.link.title")}</span>{decoration.marker}<p className="mt-1 text-subtle">{t(state?.error ? "settings.profile.link.storageError" : "settings.profile.link.explanation")}</p></div><Button disabled={busy} onClick={() => void reset().catch(() => {})}>{t(armed ? "settings.profile.link.resetConfirm" : "settings.profile.link.reset")}</Button>{armed && <Button onClick={() => setArmed(false)}>{t("settings.profile.link.cancel")}</Button>}</div>
    }</SettingsGroup>
    {pending && <p className="mt-2 text-warn">{t("settings.profile.link.pending", { hosts: pending })}</p>}
    {localRequired && <p className="mt-2 text-muted">{t("settings.profile.link.localRequired", { hosts: localRequired })}</p>}
    {disabledHosts && <p className="mt-2 text-subtle">{t("settings.profile.link.hostDisabled", { hosts: disabledHosts })}</p>}
    {failed && <p role="alert" className="mt-2 text-danger">{t("settings.profile.link.failed")}</p>}
    {(pending || failed) && <Button disabled={busy} onClick={() => { setBusy(true); setFailed(false); void api.syncProfileLinks().then(setState, () => setFailed(true)).finally(() => setBusy(false)); }}>{t("settings.profile.link.appearance.retry")}</Button>}
    {armed && <p className="mt-2 text-warn">{t("settings.profile.link.resetHint")}</p>}
  </div>;
}
