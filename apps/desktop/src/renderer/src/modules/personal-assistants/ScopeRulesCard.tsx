// 范围规则 (owner 2026-11-27): each project's role for this assistant — 只看 / 协调 / 代你确认 (代你确认 off unless a rule
// says so) — set per project or by a rule over a scope: 全部项目, a project group (a sidebar folder such as 「科研
// Research」), a host. The most specific scope wins. Every project shows its role in effect and which rule set it; a
// save that turns 代你确认 on for projects lists them first and asks again. Contract: ./phase1Contract (cutex shared types).
import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { Button, Section, Select } from "../../components/settings/Form";
import type { PaView } from "../../../../shared/personalAssistants";
import { openMenuFrom, type MenuEntry } from "../../lib/contextMenu";
import { assistantRefs, newActionId, paErrorCode, refKey, STALE_CODES, type PaProjectRef } from "../../lib/personalAssistants";
import { useUiPrefs } from "../../lib/prefs";
import { phase1 } from "./phase1Api";
import { PA_ROLES, type PaRole, type PaScope, type PaScopeRule, type PaScopeRuleSet } from "./phase1Contract";
import { paErrorText, projectName, type PaHost } from "./paHooks";
import { affectedBy, effectiveRoles, groupScopes, newlyConfirmForYou, newRuleId, refreshGroupRule, withProjectRole } from "./scopeRules";

const roleKey = (r: PaRole) => `personal-assistants.role.${r}` as MessageKey;

export function ScopeRulesCard({ hostId, view, hosts, readOnly }: { hostId: string; view: PaView; hosts: readonly PaHost[]; readOnly: boolean }) {
  const { t } = useI18n();
  const a = view.assistant;
  const host = hosts.find((h) => h.hostId === hostId);
  const [set, setSet] = useState<PaScopeRuleSet | null | undefined>(undefined);
  const [draft, setDraft] = useState<PaScopeRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<PaProjectRef[] | null>(null);
  const { sidebarSections } = useUiPrefs();
  const refs = useMemo(() => assistantRefs(a), [a]);
  const online = !!host?.online;
  const load = () =>
    phase1.scopeRules(hostId, host?.featureSet, a.id).then(
      (s) => (setSet(s), setDraft(s?.rules ?? []), setNote(null)),
      (e: unknown) => (setSet(null), setNote({ tone: "error", text: paErrorText(e, t) })),
    );
  useEffect(() => {
    if (online) void load();
  }, [hostId, a.id, online, host?.featureSet]); // eslint-disable-line react-hooks/exhaustive-deps -- read on open
  const where = (ref: PaProjectRef) => hosts.find((h) => h.instanceId === ref.instanceId);
  const groups = useMemo(() => groupScopes(sidebarSections, (id) => hosts.find((h) => h.hostId === id)?.instanceId ?? null, refs), [sidebarSections, hosts, refs]);
  // A folder that changed since the rule was saved: its members are re-read for the draft (saved with the next save).
  const rules = useMemo(() => draft.map((r) => refreshGroupRule(r, groups)), [draft, groups]);
  const effective = useMemo(() => effectiveRoles(rules, refs), [rules, refs]);
  if (set === undefined && online) return <Section title={t("personal-assistants.scope.title")}><div className="py-1.5 text-ui/[inherit] text-subtle">{t("personal-assistants.rail.loading")}</div></Section>;
  if (!set) {
    return (
      <Section title={t("personal-assistants.scope.title")}>
        <div className="py-1.5 text-ui/[inherit] text-subtle" data-pa-scope-unsupported="">{note?.text ?? t(online ? "personal-assistants.scope.unsupported" : "personal-assistants.scope.offline")}</div>
      </Section>
    );
  }
  const saved = set.rules;
  const changed = JSON.stringify(rules) !== JSON.stringify(saved);
  const scopeText = (s: PaScope) =>
    s.kind === "all" ? t("personal-assistants.scope.all")
      : s.kind === "group" ? t("personal-assistants.scope.group", { name: s.name })
        : s.kind === "host" ? t("personal-assistants.scope.host", { host: hosts.find((h) => h.instanceId === s.instanceId)?.label ?? s.instanceId })
          : t("personal-assistants.scope.project");
  const sourceText = (ruleId: string | null) => {
    const r = ruleId ? rules.find((x) => x.id === ruleId) : null;
    if (!r) return t("personal-assistants.scope.fromDefault", { role: t(roleKey("coordinate")) });
    return r.scope.kind === "project" ? t("personal-assistants.scope.fromOwn") : t("personal-assistants.scope.fromRule", { scope: scopeText(r.scope) });
  };
  const write = async () => {
    setBusy(true);
    setNote(null);
    setConfirming(null);
    try {
      const next = await phase1.saveScopeRules(hostId, a.id, { actionId: newActionId("scope-rules"), expectedRevision: set.revision, rules });
      setSet(next);
      setDraft(next.rules);
      setNote({ tone: "ok", text: t("personal-assistants.form.saved") });
    } catch (e) {
      if (STALE_CODES.has(paErrorCode(e) ?? "")) {
        await load();
        setNote({ tone: "warn", text: t("personal-assistants.form.stale") });
      } else setNote({ tone: "error", text: paErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const newly = newlyConfirmForYou(saved, rules, refs);
    if (newly.length) setConfirming(newly);
    else void write();
  };
  const broad = rules.filter((r) => r.scope.kind !== "project");
  const setRule = (id: string, role: PaRole) => setDraft(rules.map((r) => (r.id === id ? { ...r, role } : r)));
  const has = (s: PaScope) => broad.some((r) => JSON.stringify(scopeId(r.scope)) === JSON.stringify(scopeId(s)));
  const addable = ([
    { kind: "all" } as PaScope,
    ...groups,
    ...[...new Set(refs.map((r) => r.instanceId))].map((instanceId): PaScope => ({ kind: "host", instanceId })),
  ] as PaScope[]).filter((s) => !has(s));
  const openAdd = (el: HTMLElement) =>
    openMenuFrom(el, addable.length
      ? addable.map((s): MenuEntry => ({ label: scopeText(s), hint: t("personal-assistants.scope.covers", { n: affectedBy(rules, { id: "_", scope: s, role: "coordinate" }, refs).length }), onSelect: () => setDraft([...rules, { id: newRuleId(), scope: s, role: "coordinate" }]) }))
      : [{ label: t("personal-assistants.scope.nothingToAdd"), note: true, disabled: true, onSelect: () => {} }]);
  const roleOptions = PA_ROLES.map((r) => ({ value: r, label: t(roleKey(r)) }));
  const off = readOnly || busy || !!confirming;
  return (
    <div data-pa-scope-rules="">
      <Section title={t("personal-assistants.scope.title")} hint={t("personal-assistants.scope.hint")} actions={<Button primary disabled={off || !changed} onClick={save}>{t("personal-assistants.form.save")}</Button>}>
        {note && <div className={`mb-2 text-caption/[inherit] ${note.tone === "ok" ? "text-subtle" : note.tone === "warn" ? "text-warn" : "text-danger"}`} role="status" data-pa-scope-note={note.tone}>{note.text}</div>}
        {confirming && (
          <div className="mb-3 rounded-lg border border-attention/40 bg-attention/5 px-3 py-2" role="alertdialog" data-pa-scope-confirm={confirming.length}>
            <div className="text-ui/[inherit] font-medium">{t("personal-assistants.scope.confirmTitle", { n: confirming.length })}</div>
            <div className="mt-0.5 text-caption/[inherit] text-muted">{t("personal-assistants.scope.confirmHint")}</div>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {confirming.map((ref) => (
                <li key={refKey(ref)} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-caption/[inherit]">
                  {projectName(where(ref), ref.projectId)}
                  <span className="text-subtle"> · {where(ref)?.label ?? ref.instanceId}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button primary disabled={busy} onClick={() => void write()}>{t("personal-assistants.scope.confirmSave")}</Button>
              <Button disabled={busy} onClick={() => setConfirming(null)}>{t("personal-assistants.scope.confirmBack")}</Button>
            </div>
          </div>
        )}
        <h4 className="mt-1 mb-1 text-caption/[inherit] font-semibold text-subtle">{t("personal-assistants.scope.broadTitle")}</h4>
        <ul className="divide-y divide-border rounded-lg border border-border" data-pa-scope-broad="">
          {broad.length === 0 && <li className="px-3 py-2 text-ui/[inherit] text-subtle">{t("personal-assistants.scope.broadNone")}</li>}
          {broad.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center gap-2 px-3 py-1.5" data-pa-scope-rule={r.scope.kind}>
              <span className="min-w-0 flex-1 truncate text-ui/[inherit]">{scopeText(r.scope)}</span>
              <span className="shrink-0 text-caption/[inherit] text-subtle" data-pa-scope-decides="">{t("personal-assistants.scope.decides", { n: affectedBy(rules, r, refs).length })}</span>
              <Select value={r.role} disabled={off} label={scopeText(r.scope)} width="w-32" onChange={(v) => setRule(r.id, v)} options={roleOptions} />
              <button type="button" className="press flex size-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-50" disabled={off} title={t("personal-assistants.scope.remove")} aria-label={t("personal-assistants.scope.remove")} onClick={() => setDraft(rules.filter((x) => x.id !== r.id))}>
                <X size={13} />
              </button>
            </li>
          ))}
          <li className="px-2 py-1">
            <button type="button" className="press flex items-center gap-1 rounded-md px-1.5 py-1 text-ui/[inherit] text-accent disabled:text-subtle" disabled={off} onClick={(e) => openAdd(e.currentTarget)} data-pa-scope-add="">
              <Plus size={13} aria-hidden />
              {t("personal-assistants.scope.add")}
            </button>
          </li>
        </ul>
        <h4 className="mt-3 mb-1 text-caption/[inherit] font-semibold text-subtle">{t("personal-assistants.scope.projectsTitle", { n: refs.length })}</h4>
        <ul className="divide-y divide-border rounded-lg border border-border" data-pa-scope-projects="">
          {refs.length === 0 && <li className="px-3 py-2 text-ui/[inherit] text-subtle">{t("personal-assistants.projectsNone")}</li>}
          {effective.map((p) => {
            const h = where(p.ref);
            return (
              <li key={refKey(p.ref)} className="flex min-w-0 items-center gap-2 px-3 py-1.5" data-pa-scope-project={p.ref.projectId} data-pa-scope-role={p.role}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui/[inherit]">
                    {projectName(h, p.ref.projectId)}
                    <span className="text-subtle"> · {h?.label ?? p.ref.instanceId}</span>
                  </span>
                  <span className="block truncate text-caption/[inherit] text-subtle" data-pa-scope-source={p.ruleId ?? "default"}>{sourceText(p.ruleId)}</span>
                </span>
                <Select value={p.role} disabled={off} label={projectName(h, p.ref.projectId)} width="w-32" onChange={(v) => setDraft(withProjectRole(rules, p.ref, v, newRuleId))} options={roleOptions} />
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

/** What makes two broad scopes the same (a folder by id, a host by instance). */
function scopeId(s: PaScope): unknown {
  return s.kind === "group" ? ["group", s.groupId] : s.kind === "host" ? ["host", s.instanceId] : s.kind === "project" ? ["project", refKey(s.ref)] : ["all"];
}
