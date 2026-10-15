// 「本次运行内一直允许」 (main memory, gone at restart) and this run's automatic claim grants, for the
// Settings page's host. Revoking only reduces authority; nothing here grants.
import { useEffect, useState } from "react";
import type { BrowserClaimAllowView, BrowserClaimAuditView } from "../../../../shared/browser";
import { bridge } from "../../bridge";
import { Section, SettingRow } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useBrowserHostEpoch } from "./hosts";
import { useBrowserEnabled } from "./tabs";

export function BrowserClaimSettings() {
  const { t } = useI18n(), hostId = useTargetHostId(), epoch = useBrowserHostEpoch(hostId);
  const enabled = useBrowserEnabled(), supported = useTargetFeatures().has("browser-relay-v1");
  const available = enabled && supported && !!epoch && !!bridge.browser;
  const [allows, setAllows] = useState<BrowserClaimAllowView[]>([]), [audit, setAudit] = useState<BrowserClaimAuditView[]>([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    if (!available || !bridge.browser) { setAllows([]); setAudit([]); return; }
    const api = bridge.browser.forHost(hostId);
    void Promise.all([api.claimAllows(), api.claimAudit()]).then(([a, b]) => { if (live) { setAllows(a); setAudit(b); } }).catch(() => {});
    // Automatic grants arrive as browser events for this host: re-read.
    const off = bridge.browser.subscribe(event => { if (event.hostId === hostId && event.kind === "claim-granted") setRevision(n => n + 1); });
    return () => { live = false; off(); };
  }, [hostId, available, revision]);
  async function revoke(entry: BrowserClaimAllowView) {
    if (!bridge.browser) return;
    await bridge.browser.forHost(hostId).claimAllowRevoke(entry.sessionId, entry.origin).catch(() => {});
    setRevision(n => n + 1);
  }
  if (!available) return null;
  const reason = (value: BrowserClaimAuditView["reason"]) => t(`browser.claim.reason.${value}` as MessageKey);
  return <Section source="local" title={t("browser.claim.allows")} hint={t("browser.claim.allowsHint")}>
    {allows.length === 0 && <p className="py-2 text-xs text-subtle">{t("browser.claim.allowsEmpty")}</p>}
    {allows.map(entry => <SettingRow key={`${entry.sessionId}\0${entry.origin}`} label={entry.agentName} hint={entry.origin}>
      <button type="button" data-browser-claim-revoke onClick={() => void revoke(entry)} className="rounded-md border border-border px-3 py-1.5 text-xs">{t("browser.claim.allowRevoke")}</button>
    </SettingRow>)}
    <SettingRow label={t("browser.claim.audit")} hint={audit.length ? undefined : t("browser.claim.auditEmpty")}>{null}</SettingRow>
    {audit.length > 0 && <ul className="pb-2 text-xs text-subtle">
      {audit.slice(0, 20).map(entry => <li key={`${entry.approvalId}\0${entry.at}`} className="truncate py-0.5" title={entry.approvalId}>
        {new Date(entry.at).toLocaleTimeString()} · {entry.agentName} · {entry.title || entry.origin} · {reason(entry.reason)}
      </li>)}
    </ul>}
  </Section>;
}
