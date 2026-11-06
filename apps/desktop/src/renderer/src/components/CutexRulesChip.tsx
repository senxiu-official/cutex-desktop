// Host-owned auto-approval rules (design 047). This is a core composer control;
// the approvals module owns the full Settings surface and audit trail.
// Option B (owner 2026-10-26): one switch per action type, two columns. A switch shows whether any rule
// covers the type for this agent and changes only what it says: on = a new one-type rule (the footer's
// expiry and 仅本项目; high-risk types still ask for the typed confirmation); off = a one-type rule of yours
// is revoked, a multi-type one loses this type where cutex keeps the deadline exactly (这一轮 / 一直), and
// asks before revoking the whole rule where it would not (1 小时 / 今天 on a host without approval-rule-exact-narrow);
// a Director identity grant is paused / resumed as a whole, never deleted.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Crown, FolderOpen, Globe, Infinity as InfinityIcon, MousePointerClick, Send, Server, TriangleAlert, UserCog, Users, Workflow } from "lucide-react";
import type { ApprovalKind, ApprovalRule, ApprovalRuleDraft, ApprovalRuleExpiryMode, ApprovalRulesView, DaemonApi } from "../../../shared/ipc";
import type { Icon } from "../modules/slots";
import { TypedRuleConfirmation } from "./TypedRuleConfirmation";
import { ErrorNote } from "./settings/Form";
import { useI18n, type MessageKey } from "../i18n";
import { approvalRuleDraft, availableApprovalKinds, isDirectorRoleRule, ruleSaveAction, type ApprovalIdentityRole, type ApprovalKindFacts } from "../lib/approvalRuleKinds";
import { cachedProfileList, loadProfileList } from "../lib/profileSnapshot";
import { cachedApprovalRules, loadApprovalRules, rememberApprovalRules, watchApprovalRules } from "../lib/rulesSnapshot";
import { captureHostAction } from "../lib/hostSwitch";

type T = (key: MessageKey, params?: Record<string, string | number>) => string;
const EXPIRIES: readonly ApprovalRuleExpiryMode[] = ["turn", "hour", "today", "revoked"];
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const kindLabel = (t: T, kind: ApprovalKind) => t(`approvals.kind.${kind}` as MessageKey);
const kindHint = (t: T, kind: ApprovalKind) => t(`approvals.rules.kindHint.${kind}` as MessageKey);
const active = (rule: ApprovalRule) => rule.enabled && !rule.expired;
/**
 * Whether a PATCH that drops a type keeps the rule's deadline exactly: always for 这一轮 / 一直; for 1 小时 / 今天 only
 * on a host that keeps the old expiry on a non-expanding replace (`keepsExpiry`: host feature `approval-rule-exact-narrow`,
 * cutex r263); without it cutex recomputes the deadline, so the row asks to revoke the whole rule instead.
 */
const exactNarrowing = (rule: ApprovalRule, keepsExpiry: boolean) => keepsExpiry || rule.expiry.mode === "turn" || rule.expiry.mode === "revoked";

/** Each action type's own icon and hue (a soft tile; the same in light and dark: the hue mixes with the surface). */
const KIND_LOOK: Record<ApprovalKind, [Icon, number]> = {
  managed_service: [Server, 172],
  service_lifetime: [InfinityIcon, 265],
  static_root: [FolderOpen, 35],
  ask_delivery: [Send, 212],
  browser_claim: [MousePointerClick, 345],
  browser_open: [Globe, 196],
  agent_profile: [UserCog, 145],
  workflow_run: [Workflow, 238],
};
const tileStyle = (hue: number): CSSProperties => ({ color: `hsl(${hue} 60% 48%)`, background: `color-mix(in srgb, hsl(${hue} 60% 48%) 15%, transparent)` });

function KindTile({ kind }: { kind: ApprovalKind }) {
  const [KindIcon, hue] = KIND_LOOK[kind] ?? [Users, 220];
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-ctl" style={tileStyle(hue)}><KindIcon size={15} aria-hidden /></span>;
}

export function expiryText(rule: Pick<ApprovalRuleDraft, "expiry">, t: T, locale: string): string {
  if (rule.expiry.mode === "turn") return t("approvals.rules.expiryShort.turn");
  if (rule.expiry.mode === "revoked") return t("approvals.rules.expiryShort.revoked");
  const at = rule.expiry.expiresAt ? new Date(rule.expiry.expiresAt) : null;
  return at && !Number.isNaN(at.valueOf()) ? t("approvals.rules.until", { at: at.toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) }) : t(`approvals.rules.expiryShort.${rule.expiry.mode}` as MessageKey);
}

/** What a switch does for `kind` given the agent's rules: the plan the row carries out (pure, for tests). */
export type KindPlan =
  | { action: "create" }
  | { action: "resume"; rule: ApprovalRule }
  | { action: "pause"; rule: ApprovalRule }
  | { action: "revoke"; rule: ApprovalRule }
  | { action: "narrow"; rule: ApprovalRule; draft: ApprovalRuleDraft }
  | { action: "askRevokeAll"; rule: ApprovalRule; others: ApprovalKind[] };

/** The rows' state: which rules cover `kind` (role grants first), and what the switch does. */
export function kindState(kind: ApprovalKind, rules: readonly ApprovalRule[], keepsExpiry = false): { on: boolean; role: ApprovalRule | null; owner: ApprovalRule[]; plan: KindPlan[] } {
  const role = rules.find((rule) => isDirectorRoleRule(rule) && rule.kinds.includes(kind)) ?? null;
  const owner = rules.filter((rule) => !isDirectorRoleRule(rule) && active(rule) && rule.kinds.includes(kind));
  const on = (!!role && active(role)) || owner.length > 0;
  if (!on) return { on, role, owner, plan: role ? [{ action: "resume", rule: role }] : [{ action: "create" }] };
  const plan: KindPlan[] = [];
  if (role && active(role)) plan.push({ action: "pause", rule: role });
  for (const rule of owner) {
    const others = rule.kinds.filter((k) => k !== kind);
    if (!others.length) plan.push({ action: "revoke", rule });
    else if (exactNarrowing(rule, keepsExpiry)) plan.push({ action: "narrow", rule, draft: { ...approvalRuleDraft(rule), kinds: others, highRiskKindsExplicit: rule.highRiskKindsExplicit.filter((k) => k !== kind) } });
    else plan.push({ action: "askRevokeAll", rule, others });
  }
  return { on, role, owner, plan };
}

export interface CutexRulesPanelProps {
  hostId: string;
  api: DaemonApi;
  sessionId: string;
  displayName: string;
  profile: string | null;
  projectId: string | null;
  runtimeGeneration: number;
  turnId: string | null;
  capabilityFacts: Omit<ApprovalKindFacts, "browserTools">;
  identityRole: ApprovalIdentityRole;
  onOpenProject?(): void;
  onCount?(count: number): void;
}

export const CutexRulesPanel = memo(function CutexRulesPanel({ hostId, api, sessionId, displayName, profile, projectId, runtimeGeneration, turnId, capabilityFacts, identityRole, onOpenProject, onCount }: CutexRulesPanelProps) {
  const { t, locale } = useI18n() as { t: T; locale?: string };
  const [view, setView] = useState<ApprovalRulesView | null>(() => cachedApprovalRules(hostId));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expiry, setExpiry] = useState<ApprovalRuleExpiryMode>(turnId ? "turn" : "hour");
  const [onlyProject, setOnlyProject] = useState(!!projectId);
  const [includeHighDynamic, setIncludeHighDynamic] = useState(false);
  const [confirming, setConfirming] = useState<ApprovalRuleDraft | null>(null);
  const [asking, setAsking] = useState<{ kind: ApprovalKind; rule: ApprovalRule; others: ApprovalKind[] } | null>(null);
  const request = useRef(0);
  const cachedProfiles = cachedProfileList(hostId);
  const [browserCapability, setBrowserCapability] = useState<{ profile: string | null; value: boolean | null }>(() => ({ profile, value: profile ? cachedProfiles?.profiles.find((item) => item.name === profile || item.id === profile)?.browserTools ?? null : false }));
  const browserTools = browserCapability.profile === profile ? browserCapability.value : profile ? cachedProfiles?.profiles.find((item) => item.name === profile || item.id === profile)?.browserTools ?? null : false;
  const availableKinds = useMemo(() => availableApprovalKinds({ ...capabilityFacts, browserTools }), [capabilityFacts, browserTools]);
  const exactNarrow = !!capabilityFacts.hostFeatures?.has("approval-rule-exact-narrow");
  const mine = view?.rules.filter((rule) => rule.subject.cutexSessionId === sessionId) ?? [];
  // Every type the agent may get, plus any a rule of it already covers (shown truthfully even when not offered).
  const kinds = [...availableKinds, ...[...new Set(mine.flatMap((rule) => rule.kinds))].filter((kind) => !availableKinds.includes(kind))];
  const high = useMemo(() => new Set(view?.catalog.filter((item) => item.risk === "high").map((item) => item.kind) ?? []), [view?.catalog]);
  const dynamic = useMemo(() => new Set(view?.catalog.filter((item) => item.risk === "dynamic").map((item) => item.kind) ?? []), [view?.catalog]);
  const changed = (next: ApprovalRulesView) => { rememberApprovalRules(hostId, next); setView(next); onCount?.(next.rules.filter((rule) => rule.subject.cutexSessionId === sessionId && active(rule)).length); };
  const needsProfile = !!profile && !capabilityFacts.declaredTools && !cachedProfiles;
  const load = async (force = false) => {
    const ticket = ++request.current;
    setError(null);
    const profiles = needsProfile ? loadProfileList(hostId).catch(() => null) : Promise.resolve(cachedProfileList(hostId));
    try {
      const next = await loadApprovalRules(hostId, api, force);
      if (next && request.current === ticket) changed(next);
    } catch (e) { if (request.current === ticket) setError(message(e)); }
    const listed = await profiles;
    if (request.current === ticket) setBrowserCapability({ profile, value: profile ? listed?.profiles.find((item) => item.name === profile || item.id === profile)?.browserTools ?? null : false });
  };
  useEffect(() => {
    void load();
    const stop = watchApprovalRules(hostId, (change) => {
      if (change === "reset") { request.current++; setView(null); setError(null); }
      else void load();
    });
    return () => { request.current++; stop(); };
  }, [api, hostId, profile, sessionId, needsProfile]);

  /** One write after another on the latest revision, then a fresh read. */
  const run = async (steps: ((revision: number) => Promise<unknown>)[], note = false) => {
    if (!view) return;
    const current = captureHostAction(hostId);
    setBusy(true); setSaved(false); setError(null);
    try {
      let revision = view.revision;
      for (const step of steps) {
        await step(revision);
        if (!current()) return;
        const next = await loadApprovalRules(hostId, api, true);
        if (!current()) return;
        if (next) { changed(next); revision = next.revision; }
      }
      if (note) setSaved(true);
    } catch (e) {
      if (current()) { setError(message(e)); void load(true); }
    } finally { setBusy(false); }
  };
  const create = (kind: ApprovalKind) => {
    if (expiry === "turn" && !turnId) return;
    const draft: ApprovalRuleDraft = {
      enabled: true,
      subject: { type: "agent", cutexSessionId: sessionId, displayName },
      projectId: onlyProject ? projectId : null,
      kinds: [kind],
      constraints: {},
      expiry: { mode: expiry, ...(expiry === "turn" && turnId ? { turn: { runtimeGeneration, turnId } } : {}) },
      highRiskKindsExplicit: high.has(kind) || (includeHighDynamic && dynamic.has(kind)) ? [kind] : [],
    };
    if (ruleSaveAction(draft) === "confirm") setConfirming(draft);
    else void run([(revision) => api.createApprovalRule(revision, draft)], true);
  };
  const saveConfirmed = async (draft: ApprovalRuleDraft, typed: string) => {
    if (!view) return;
    const current = captureHostAction(hostId);
    setBusy(true); setError(null); setSaved(false);
    try {
      const token = (await api.confirmApprovalRule(draft, typed)).confirmationToken;
      if (!current()) return;
      await api.createApprovalRule(view.revision, draft, token);
      if (!current()) return;
      const next = await loadApprovalRules(hostId, api, true);
      if (next) changed(next);
      setConfirming(null); setSaved(true);
    } catch (e) { if (current()) setError(message(e)); }
    finally { setBusy(false); }
  };
  const flip = (kind: ApprovalKind) => {
    if (busy || !view) return;
    setAsking(null);
    const { plan } = kindState(kind, mine, exactNarrow);
    const ask = plan.find((step) => step.action === "askRevokeAll");
    if (ask && ask.action === "askRevokeAll") { setAsking({ kind, rule: ask.rule, others: ask.others }); return; }
    if (plan[0]?.action === "create") { create(kind); return; }
    void run(plan.map((step) => (revision: number) => {
      switch (step.action) {
        case "pause": return api.patchApprovalRule(step.rule.ruleId, revision, approvalRuleDraft(step.rule, false));
        case "resume": return api.patchApprovalRule(step.rule.ruleId, revision, approvalRuleDraft(step.rule, true));
        case "revoke": return api.deleteApprovalRule(step.rule.ruleId, revision);
        case "narrow": return api.patchApprovalRule(step.rule.ruleId, revision, step.draft);
        default: return Promise.resolve();
      }
    }), plan.some((step) => step.action === "resume"));
  };
  /** 整条撤销 after the question: the whole multi-type rule, plus whatever else covers this type. */
  const revokeAll = () => {
    if (!asking) return;
    const { plan } = kindState(asking.kind, mine, exactNarrow);
    const steps = plan.map((step) => (revision: number) => {
      if (step.action === "pause") return api.patchApprovalRule(step.rule.ruleId, revision, approvalRuleDraft(step.rule, false));
      if (step.action === "narrow") return api.patchApprovalRule(step.rule.ruleId, revision, step.draft);
      if (step.action === "revoke" || step.action === "askRevokeAll") return api.deleteApprovalRule(step.rule.ruleId, revision);
      return Promise.resolve();
    });
    setAsking(null);
    void run(steps);
  };

  const identity = identityRole && (
    <div data-approval-identity={identityRole} className="mb-2 flex items-center gap-2.5 rounded-inner bg-accent-soft px-2.5 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-ctl bg-background text-accent"><Crown size={15} aria-hidden /></span>
      <span className="min-w-0 flex-1 text-meta text-muted">
        <span className="font-semibold text-foreground">{t(`approvals.rules.identity.${identityRole}Title` as MessageKey)}</span>
        {t("approvals.rules.identity.separator")}
        {t(`approvals.rules.identity.${identityRole}Short` as MessageKey)}
      </span>
      {projectId && onOpenProject && <button type="button" onClick={onOpenProject} className="shrink-0 text-meta text-accent hover:underline">{t("approvals.rules.identity.openProject")}</button>}
    </div>
  );

  const row = (kind: ApprovalKind) => {
    const state = view ? kindState(kind, mine, exactNarrow) : null;
    const on = !!state?.on;
    const role = state?.role ?? null;
    const paused = !!role && !active(role);
    const roleOthers = role ? role.kinds.filter((k) => k !== kind) : [];
    const sub: string[] = [];
    if (!state) sub.push("…");
    else {
      if (role) sub.push(t("approvals.rules.state.role") + (paused ? ` · ${t("approvals.rules.state.paused")}` : ""));
      if (role && roleOthers.length) sub.push(t("approvals.rules.state.roleShared", { kinds: roleOthers.map((k) => kindLabel(t, k)).join(t("approvals.rules.listSeparator")) }));
      for (const rule of state.owner) {
        const others = rule.kinds.filter((k) => k !== kind);
        sub.push(t("approvals.rules.state.owner", { expiry: expiryText(rule, t, locale ?? navigator.language) }) + (others.length ? ` · ${t("approvals.rules.state.shared", { kinds: others.map((k) => kindLabel(t, k)).join(t("approvals.rules.listSeparator")) })}` : ""));
      }
      if (!role && !state.owner.length) sub.push(t("approvals.rules.state.ask"));
    }
    const offered = availableKinds.includes(kind);
    const disabled = !view || busy || (!on && !offered) || (!on && !role && expiry === "turn" && !turnId);
    const switchTitle = !state ? "" : on ? t(role && active(role) ? "approvals.rules.pause" : "approvals.rules.turnOff") : t(role ? "approvals.rules.resume" : "approvals.rules.turnOn");
    const isAsking = asking?.kind === kind;
    return (
      <li key={kind} data-rule-kind={kind} data-on={on ? "" : undefined} className={`rounded-inner px-2 py-1.5 ${on ? "bg-surface-2/60" : "hover:bg-surface-2/40"}`}>
        <div className="flex items-center gap-2.5" data-tip={kindHint(t, kind)}>
          <KindTile kind={kind} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-meta">
              <span className={`min-w-0 truncate ${paused && !state?.owner.length ? "text-subtle" : ""}`}>{kindLabel(t, kind)}</span>
              {high.has(kind) && <span data-risk="high" className="flex shrink-0 items-center gap-0.5 rounded-full bg-warn/15 px-1.5 text-caption text-warn-text"><TriangleAlert size={10} aria-hidden />{t("approvals.rules.highShort")}</span>}
            </span>
            <span className="block truncate text-caption text-subtle">{sub.join(" · ")}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`${kindLabel(t, kind)}: ${switchTitle}`}
            data-tip={switchTitle}
            disabled={disabled}
            onClick={() => flip(kind)}
            data-rule-switch={kind}
            className={`relative h-[18px] w-[30px] shrink-0 rounded-full border transition-colors disabled:opacity-40 ${on ? "border-accent bg-accent" : "border-border bg-surface-2"}`}
          >
            <span className={`absolute top-px size-3.5 rounded-full bg-white shadow-e1 transition-[left] ${on ? "left-[13px]" : "left-px"}`} />
          </button>
        </div>
        {isAsking && asking && (
          <div data-rule-ask="" className="mt-1.5 rounded-ctl bg-warn/10 px-2 py-1.5 text-caption text-warn-text">
            <p>{t("approvals.rules.splitAsk", { kinds: asking.others.map((k) => kindLabel(t, k)).join(t("approvals.rules.listSeparator")), expiry: expiryText(asking.rule, t, locale ?? navigator.language) })}</p>
            <div className="mt-1 flex justify-end gap-2">
              <button type="button" onClick={() => setAsking(null)} className="rounded-full px-2 py-0.5 text-muted hover:bg-surface-2">{t("approvals.rules.cancel")}</button>
              <button type="button" onClick={revokeAll} data-rule-revoke-all="" className="rounded-full bg-danger-solid px-2 py-0.5 text-white">{t("approvals.rules.revokeAll")}</button>
            </div>
          </div>
        )}
      </li>
    );
  };

  const anyDynamic = availableKinds.some((kind) => dynamic.has(kind));
  return <div data-approval-rules-panel="" className="min-w-0">
    {identity}
    <ul data-rules-grid="" aria-busy={view ? undefined : true} {...(view ? {} : { "data-rules-skeleton": "" })} className="grid grid-cols-1 gap-x-2 gap-y-1 sm:grid-cols-2">
      {kinds.map(row)}
    </ul>
    {saved && <p role="status" className="mt-1 px-1 text-caption text-ok-text">{t("approvals.rules.saved")}</p>}
    {error && <div className="mt-1"><ErrorNote>{error}</ErrorNote></div>}
    <div data-approval-rule-create="" className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <span className="text-caption text-subtle">{t("approvals.rules.newExpiry")}</span>
      <span role="radiogroup" aria-label={t("approvals.rules.expiry")} className="flex rounded-full bg-surface-2 p-0.5">
        {EXPIRIES.map((mode) => (
          <button key={mode} type="button" role="radio" aria-checked={expiry === mode} disabled={busy || (mode === "turn" && !turnId)} onClick={() => setExpiry(mode)} className={`rounded-full px-2 py-0.5 text-caption disabled:opacity-40 ${expiry === mode ? "bg-background text-foreground shadow-e1" : "text-muted hover:text-foreground"}`}>
            {t(`approvals.rules.expiryShort.${mode}` as MessageKey)}
          </button>
        ))}
      </span>
      {projectId && (
        <label className="flex cursor-pointer items-center gap-1.5 text-caption text-muted">
          <input type="checkbox" checked={onlyProject} disabled={busy} onChange={(event) => setOnlyProject(event.target.checked)} className="accent-accent" />
          {t("approvals.rules.onlyProject")}
        </label>
      )}
      {anyDynamic && (
        <label className="flex cursor-pointer items-center gap-1.5 text-caption text-muted" data-tip={t(includeHighDynamic ? "approvals.rules.dynamicHighHint" : "approvals.rules.dynamicHint")}>
          <input type="checkbox" checked={includeHighDynamic} disabled={busy} onChange={(event) => setIncludeHighDynamic(event.target.checked)} className="accent-accent" />
          {t("approvals.rules.dynamicHighShort")}
        </label>
      )}
    </div>
    {confirming && <TypedRuleConfirmation draft={confirming} busy={busy} close={() => setConfirming(null)} submit={(typed) => void saveConfirmed(confirming, typed)} />}
  </div>;
});
