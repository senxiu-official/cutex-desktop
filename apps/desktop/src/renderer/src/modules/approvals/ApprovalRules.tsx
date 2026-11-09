// Host-owned auto-approval rules (design 047). The composer control lives in
// components/CutexRulesChip; this module owns the complete Settings view.
import { useEffect, useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";
import type { ApprovalKind, ApprovalRule, ApprovalRuleAudit, ApprovalRuleAuditPage, ApprovalRuleDraft, ApprovalRulesView, DaemonApi } from "../../../../shared/ipc";
import { Button } from "../../components/Button";
import { TypedRuleConfirmation } from "../../components/TypedRuleConfirmation";
import { ErrorNote, ListFilter, Section, SettingsGroup, SubPageRow } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { approvalRuleDraft, isDirectorRoleRule, ruleSaveAction } from "../../lib/approvalRuleKinds";
import { matchesFilter } from "../../lib/listFilter";
import { useTargetApi, useTargetSidebar } from "../../lib/targetHost";
import { useApp } from "../../store";

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const kindLabel = (t: (key: MessageKey, params?: Record<string, string | number>) => string, kind: ApprovalKind) => t(`approvals.kind.${kind}` as MessageKey);
const kindHint = (t: (key: MessageKey, params?: Record<string, string | number>) => string, kind: ApprovalKind) => t(`approvals.rules.kindHint.${kind}` as MessageKey);

function expiryText(rule: Pick<ApprovalRuleDraft, "expiry">, t: (key: MessageKey, params?: Record<string, string | number>) => string, locale: string): string {
  if (rule.expiry.mode === "turn") return t("approvals.rules.expiry.turn");
  if (rule.expiry.mode === "revoked") return t("approvals.rules.expiry.revoked");
  const at = rule.expiry.expiresAt ? new Date(rule.expiry.expiresAt) : null;
  return at && !Number.isNaN(at.valueOf()) ? at.toLocaleString(locale) : t(`approvals.rules.expiry.${rule.expiry.mode}` as MessageKey);
}

function RuleRow({ api, view, rule, name, refresh }: { api: DaemonApi; view: ApprovalRulesView; rule: ApprovalRule; name: string; refresh(): Promise<void> }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState<ApprovalRuleDraft | null>(null);
  const roleGranted = isDirectorRoleRule(rule);
  const patch = async (draft: ApprovalRuleDraft, typed?: string) => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const token = typed ? (await api.confirmApprovalRule(draft, typed)).confirmationToken : undefined;
      await api.patchApprovalRule(rule.ruleId, view.revision, draft, token); setConfirming(null); await refresh(); setSaved(draft.enabled);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const revoke = async () => { setBusy(true); setError(null); try { await api.deleteApprovalRule(rule.ruleId, view.revision); await refresh(); } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  return <SettingsGroup agents="now" source="host">{decoration => <li {...decoration.attributes} className="border-t border-border py-3 first:border-0" data-approval-rule={rule.ruleId}>
    <div className="flex flex-wrap items-start gap-2"><span className="min-w-0 flex-1"><span className="font-medium">{name}</span>{decoration.marker}{rule.projectId && <span className="ml-2 text-subtle">· {rule.projectId}</span>}{roleGranted && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-caption text-accent">{t("approvals.rules.grantedByDirector")}</span>}<span className="mt-0.5 block text-meta text-muted" title={rule.kinds.map((kind) => `${kindLabel(t, kind)}：${kindHint(t, kind)}`).join("\n")}>{rule.kinds.map((kind) => kindLabel(t, kind)).join("、")} · {expiryText(rule, t, locale)}</span></span>
      <Button size="sm" disabled={busy || rule.expired} onClick={() => {
        setSaved(false);
        const draft = approvalRuleDraft(rule, !rule.enabled);
        if (draft.enabled && ruleSaveAction(draft) === "confirm") setConfirming(draft);
        else void patch(draft);
      }}>{t(rule.enabled ? "approvals.rules.pause" : "approvals.rules.resume")}</Button>
      {!roleGranted && <Button size="sm" danger disabled={busy} onClick={() => void revoke()}>{t("approvals.rules.revoke")}</Button>}
    </div>
    {rule.highRiskKindsExplicit.length > 0 && <p className="mt-1 text-caption text-danger">{t("approvals.rules.highKinds", { kinds: rule.highRiskKindsExplicit.map((kind) => kindLabel(t, kind)).join("、") })}</p>}
    {saved && <p role="status" className="mt-1 text-caption text-ok-text">{t("approvals.rules.saved")}</p>}
    {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
    {confirming && <TypedRuleConfirmation draft={confirming} busy={busy} close={() => setConfirming(null)} submit={(typed) => void patch(confirming, typed)} />}
  </li>}</SettingsGroup>;
}

/** Rows of 规则审计 the 协作 page shows; 全部 is its sub-page. */
const AUDIT_ON_PAGE = 5;

function AuditRow({ row }: { row: ApprovalRuleAudit }) {
  const { t, locale } = useI18n();
  return <li className="flex gap-3 border-t border-border py-2 text-meta first:border-0"><span className="w-36 shrink-0 text-subtle">{new Date(row.at).toLocaleString(locale)}</span><span className="min-w-0 flex-1"><span className="font-medium">{t(`approvals.rules.audit.${row.action}` as MessageKey)}</span>{row.kind && <span> · {kindLabel(t, row.kind)}</span>}<span className="block text-subtle">{row.result}{row.ruleId ? ` · ${row.ruleId}` : ""}</span></span></li>;
}

/** 协作 → 规则审计: what one read returns (the newest 100), with a filter. */
export function ApprovalRuleAuditAll() {
  const { t } = useI18n();
  const api = useTargetApi();
  const [log, setLog] = useState<ApprovalRuleAuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    let live = true;
    setLog(null); setError(null);
    api.approvalRuleAudit(0, 100).then((next) => { if (live) setLog(next); }, (e) => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, [api]);
  const rows = log?.audit ?? [];
  const shown = rows.filter((row) => matchesFilter(filter, t(`approvals.rules.audit.${row.action}` as MessageKey), row.kind && kindLabel(t, row.kind), row.result, row.ruleId));
  return <Section title={log ? t(log.nextCursor !== null ? "approvals.rules.audit.latest" : "approvals.rules.audit.all", { n: rows.length }) : undefined}>
    {error && <ErrorNote>{error}</ErrorNote>}
    {!log && !error && <p className="text-ui text-subtle">…</p>}
    {log && !rows.length && <p className="text-ui text-muted">{t("approvals.rules.audit.empty")}</p>}
    <div role="search" className="contents"><ListFilter count={rows.length} value={filter} onChange={setFilter} /></div>
    {rows.length > 0 && !shown.length && <p className="text-ui text-muted">{t("settings.filterNone")}</p>}
    <ul>{shown.map((row) => <AuditRow key={row.auditId} row={row} />)}</ul>
  </Section>;
}

export function ApprovalRulesSettings() {
  const { t } = useI18n();
  const api = useTargetApi();
  const sidebar = useTargetSidebar();
  const [view, setView] = useState<ApprovalRulesView | null>(null);
  const [audit, setAudit] = useState<ApprovalRuleAudit[]>([]);
  const [auditMore, setAuditMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    try {
      setError(null);
      const [rules, log] = await Promise.all([api.approvalRules(), api.approvalRuleAudit(0, 100)]);
      setView(rules); setAudit(log.audit); setAuditMore(log.nextCursor !== null);
    } catch (e) { setError(message(e)); }
  };
  useEffect(() => { void refresh(); }, [api]);
  const names = useMemo(() => new Map([...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].map((agent) => [agent.cutexSessionId, agent.displayName])), [sidebar]);
  const roleRules = view?.rules.filter(isDirectorRoleRule) ?? [];
  const ownerRules = view?.rules.filter((rule) => !isDirectorRoleRule(rule)) ?? [];
  return <div className="space-y-4" data-approval-rules-settings="">
    <Section title={t("approvals.rules.settings")} hint={t("approvals.rules.settings.hint")} actions={<div className="flex items-center gap-2"><span title={t("approvals.rules.explainer")} aria-label={t("approvals.rules.explainer")} className="text-subtle"><CircleHelp size={15} aria-hidden /></span><SettingsGroup agents="none" source="host" navigation><Button size="sm" onClick={() => void refresh()}>{t("approvals.rules.refresh")}</Button></SettingsGroup></div>}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!view && !error && <p className="text-ui text-subtle">…</p>}
      {view && !view.rules.length && <p className="text-ui text-muted">{t("approvals.rules.none")}</p>}
      {view && roleRules.length > 0 && <div><h4 className="mt-2 text-meta font-medium text-muted">{t("approvals.rules.roleGranted")}</h4><p className="text-caption text-subtle">{t("approvals.rules.roleGrantedHint")}</p><ul>{roleRules.map((rule) => <RuleRow key={rule.ruleId} api={api} view={view} rule={rule} name={names.get(rule.subject.cutexSessionId) ?? rule.subject.displayName ?? rule.subject.cutexSessionId} refresh={refresh} />)}</ul></div>}
      {view && ownerRules.length > 0 && <div><h4 className="mt-3 text-meta font-medium text-muted">{t("approvals.rules.ownerCreated")}</h4><ul>{ownerRules.map((rule) => <RuleRow key={rule.ruleId} api={api} view={view} rule={rule} name={names.get(rule.subject.cutexSessionId) ?? rule.subject.displayName ?? rule.subject.cutexSessionId} refresh={refresh} />)}</ul></div>}
    </Section>
    <Section title={t("approvals.rules.audit")} hint={t("approvals.rules.audit.hint")}>
      {!audit.length && <p className="text-ui text-muted">{t("approvals.rules.audit.empty")}</p>}
      <ul>{audit.slice(0, AUDIT_ON_PAGE).map((row) => <AuditRow key={row.auditId} row={row} />)}</ul>
      {audit.length > AUDIT_ON_PAGE && <SubPageRow title={t(auditMore ? "approvals.rules.audit.latest" : "approvals.rules.audit.all", { n: audit.length })} onOpen={() => useApp.getState().openSettings("collab", { sub: "audit" })} />}
    </Section>
  </div>;
}
