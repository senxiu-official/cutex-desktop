import { isImeComposing } from "../lib/ime";
// The composer's single 「规则」 chip. Option B (owner 2026-10-26): a header (the agent's avatar, a crown for
// a Director, one line of what the switches mean); Claude agents switch between the Cutex rules and their
// unchanged Claude permission rules with a pill; Codex agents get only the Cutex rules. The popover is as
// tall as its content (its shape is known before the rules arrive). The chip's tip says 「Cutex n · Claude n」.
// The Claude column contains:
// - which tools the agent can reach (its cutex write / command switches; a permission mode never
//   turns a disabled tool on) — a warn dot on the chip while one is off;
// - the persistent "always allow" rules of the agent's workspace (cutex `claude-permission-rules`):
//   listed, removable and addable here. cutex keeps them per working directory (shared by every
//   Claude agent there, never written into the repository) and hands them to running agents;
// - the Claude Code sources note (components/ClaudeCodeSourcesNote).
// The permission menu itself lists only the modes.
import { useEffect, useState } from "react";
import { CircleHelp, Crown, Plus, ShieldCheck, SquareTerminal, X } from "lucide-react";
import type { ClaudePermissionRules } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { CLAUDE_CODE_SOURCES_FEATURE } from "../lib/claudeCodeSources";
import { claudeRulesChipShown, claudeToolsOff } from "../lib/claudePermissionModes";
import { featuresOf, useApp } from "../store";
import { convApi, useConvScope } from "../lib/conversationScope";
import { ClaudeCodeSourcesNote } from "./ClaudeCodeSourcesNote";
import { Popover } from "./Menu";
import { CutexRulesPanel, type CutexRulesPanelProps } from "./CutexRulesChip";
import { cachedClaudeRules, loadApprovalRules, loadClaudeRules, rememberClaudeRules, watchApprovalRules } from "../lib/rulesSnapshot";
import { captureHostAction } from "../lib/hostSwitch";
import { useConvSession } from "../lib/workspaceRowView";
import { Avatar } from "./Avatar";

type Note = { kind: "live" | "nextStart" } | { kind: "failed"; error: string };

export function RulesChip({
  hostId,
  sessionId,
  claude,
  write,
  exec,
  rulesFeature,
  cutex,
  iconOnly = false,
}: {
  hostId: string | null | undefined;
  sessionId: string;
  claude: boolean;
  write: boolean | null;
  exec: boolean | null;
  rulesFeature: boolean;
  cutex?: CutexRulesPanelProps;
  /** A narrow toolbar: the icon (and the warn dot) only, so the permission chip keeps its width. */
  iconOnly?: boolean;
}) {
  const { t } = useI18n();
  const conv = useConvScope();
  const rulesHostId = hostId ?? conv?.hostId ?? "local";
  const sourcesFeature = useApp((s) => featuresOf(s, hostId).has(CLAUDE_CODE_SOURCES_FEATURE));
  const off = claudeToolsOff({ write, exec });
  // The count on the chip: read once per agent, then kept current by the popover's list.
  const [count, setCount] = useState<number | null>(null);
  const [cutexCount, setCutexCount] = useState<number | null>(null);
  const [tab, setTab] = useState<"cutex" | "claude">("cutex");
  const session = useConvSession(rulesHostId, sessionId);
  useEffect(() => {
    setCount(cachedClaudeRules(rulesHostId, sessionId)?.allow.length ?? null);
    if (!claude || !rulesFeature) return;
    let live = true;
    const load = () => { void loadClaudeRules(rulesHostId, sessionId, convApi(conv, sessionId)).then(
      (v) => live && v && setCount(v.allow.length),
      () => undefined, // Unreadable: no count; the popover shows the error.
    ); };
    load();
    const stop = watchApprovalRules(rulesHostId, (change) => {
      if (change === "reset") setCount(null);
      else if (change === "resync") load();
    });
    return () => {
      live = false;
      stop();
    };
  }, [claude, rulesFeature, sessionId, rulesHostId]);
  const cutexApi = cutex?.api;
  useEffect(() => {
    if (!cutexApi) { setCutexCount(null); return; }
    let live = true;
    const load = () => { void loadApprovalRules(rulesHostId, cutexApi).then((v) => {
      if (live && v) setCutexCount(v.rules.filter((rule) => rule.subject.cutexSessionId === sessionId && rule.enabled && !rule.expired).length);
    }, () => {}); };
    load();
    const stop = watchApprovalRules(rulesHostId, (change) => { if (change === "reset") setCutexCount(null); else load(); });
    return () => { live = false; stop(); };
  }, [cutexApi, rulesHostId, sessionId]);
  const showClaude = claudeRulesChipShown({ claude, rulesFeature, toolsOff: off, sourcesFeature });
  if (!showClaude && !cutex) return null;
  const offText = off.length ? t("composer.claude.toolsOff", { tools: off.map((k) => t(k === "write" ? "composer.claude.toolWrite" : "composer.claude.toolExec")).join(t("composer.claude.listSeparator")) }) : null;
  const total = (showClaude ? count ?? 0 : 0) + (cutexCount ?? 0);
  // The count on the chip is the sum; the tip says what it is made of (owner 2026-10-26).
  const parts = [cutex ? t("approvals.rules.chipPart", { name: "Cutex", n: cutexCount ?? 0 }) : null, showClaude ? t("approvals.rules.chipPart", { name: "Claude", n: count ?? 0 }) : null].filter(Boolean).join(" · ");
  const title = [t("composer.claude.rulesChip") + (parts ? `: ${parts}` : ""), showClaude ? offText : null, cutex ? t("approvals.rules.chip.hint") : null].filter(Boolean).join("\n");
  const tabs = !!cutex && showClaude;
  const shown = !cutex ? "claude" : !showClaude ? "cutex" : tab;
  const director = cutex?.identityRole === "director";
  const name = session?.displayName ?? cutex?.displayName ?? sessionId;
  return (
    <Popover
      triggerTitle={title}
      width={cutex ? "w-[40rem] max-w-[calc(100vw-2rem)]" : "w-80 max-w-[calc(100vw-2rem)]"}
      fitViewport
      trigger={
        <span className="relative flex items-center gap-1" data-testid="claude-rules-chip">
          <ShieldCheck size={13} className="shrink-0" aria-hidden />
          {!iconOnly && (
            <span className="trim-cap whitespace-nowrap">
              {t("composer.claude.rulesChip")}
              {total ? <span className="ml-1 tabular-nums">{total}</span> : null}
            </span>
          )}
          {off.length > 0 && <span className="absolute -top-0.5 left-2.5 h-1.5 w-1.5 rounded-full bg-warn" data-testid="claude-rules-tools-off" aria-hidden />}
        </span>
      }
    >
      {() => (
        <div data-rules-panel="" className="p-1.5">
          <div className="flex items-center gap-2.5 px-1 pb-2" data-rules-header="">
            <span className="relative shrink-0">
              <Avatar name={name} avatar={session?.avatar} seed={session?.cutexSessionId ?? sessionId} size={28} />
              {director && <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-surface text-accent" data-rules-crown=""><Crown size={9} aria-hidden /></span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui font-semibold">{t("approvals.rules.title", { name })}</span>
              <span className="block truncate text-caption text-subtle">{t(shown === "claude" ? "approvals.rules.subtitleClaude" : "approvals.rules.subtitle")}</span>
            </span>
            {cutex && <span className="shrink-0 text-subtle" title={t("approvals.rules.explainer")} aria-label={t("approvals.rules.explainer")}><CircleHelp size={14} aria-hidden /></span>}
          </div>
          {tabs && (
            <div role="tablist" className="mb-2 flex rounded-full bg-surface-2 p-0.5" data-rules-tabs="">
              {(["cutex", "claude"] as const).map((id) => (
                <button key={id} type="button" role="tab" aria-selected={shown === id} data-rules-tab={id} onClick={() => setTab(id)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1 text-meta ${shown === id ? "bg-background text-foreground shadow-e1" : "text-muted hover:text-foreground"}`}>
                  {id === "cutex" ? <ShieldCheck size={13} aria-hidden /> : <SquareTerminal size={13} aria-hidden />}
                  {t(id === "cutex" ? "approvals.rules.tabCutex" : "approvals.rules.tabClaude")}
                  <span className={`rounded-full px-1.5 text-caption tabular-nums ${shown === id ? "bg-accent-soft text-accent" : "bg-background/60 text-subtle"}`}>{id === "cutex" ? cutexCount ?? 0 : count ?? 0}</span>
                  {id === "claude" && off.length > 0 && <span className="size-1.5 rounded-full bg-warn" aria-hidden />}
                </button>
              ))}
            </div>
          )}
          {showClaude && shown === "claude" && <div data-testid="claude-rules-panel" className="min-w-0 px-1 text-xs">
            <div className={`mb-2 rounded-inner px-2.5 py-2 ${offText ? "bg-warn/10 text-warn-text" : "bg-surface-2/60 text-muted"}`} data-testid="claude-tools-note">
              <div className="mb-0.5 font-medium">{t("composer.claude.toolsTitle")}</div>
              <p>{offText ?? t("composer.claude.toolsOn")}</p>
            </div>
            {rulesFeature && <ClaudeAllowRules key={`${rulesHostId}:${sessionId}`} hostId={rulesHostId} sessionId={sessionId} onView={(v) => setCount(v.allow.length)} />}
            <ClaudeCodeSourcesNote hostId={hostId} sessionId={sessionId} />
          </div>}
          {cutex && <div hidden={shown !== "cutex"}><CutexRulesPanel key={`${rulesHostId}:${sessionId}`} {...cutex} onCount={setCutexCount} /></div>}
        </div>
      )}
    </Popover>
  );
}

/** Compatibility wrapper for the focused Claude-column tests and callers outside Composer. */
export function ClaudeRulesChip(props: Omit<Parameters<typeof RulesChip>[0], "claude" | "cutex">) {
  return <RulesChip {...props} claude />;
}

export function ClaudeAllowRules({ sessionId, hostId = "local", onView }: { sessionId: string; hostId?: string; /** Every list cutex answered (load / save). */ onView?(view: ClaudePermissionRules): void }) {
  const conv = useConvScope();
  const { t } = useI18n();
  const [view, setView] = useState<ClaudePermissionRules | null>(() => cachedClaudeRules(hostId, sessionId));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setView(cachedClaudeRules(hostId, sessionId));
    setError(null);
    const load = () => { void loadClaudeRules(hostId, sessionId, convApi(conv, sessionId)).then(
      (v) => live && v && setView(v),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    ); };
    load();
    const stop = watchApprovalRules(hostId, (change) => {
      if (change === "reset") { setView(null); setError(null); }
      else if (change === "resync") load();
    });
    return () => {
      live = false;
      stop();
    };
  }, [sessionId, hostId]);

  const save = async (allow: string[]) => {
    if (!view) return;
    const current = captureHostAction(hostId);
    setSaving(true);
    try {
      const next = await convApi(conv, sessionId).setClaudePermissionRules(sessionId, allow, view.revision);
      if (!current()) return;
      setView(next);
      rememberClaudeRules(hostId, sessionId, next);
      const mine = next.sessions?.find((s) => s.cutexSessionId === sessionId);
      setNote({ kind: mine?.status === "live" ? "live" : "nextStart" });
    } catch (e) {
      if (!current()) return;
      setNote({ kind: "failed", error: e instanceof Error ? e.message : String(e) });
      // A conflict or refusal: show what cutex has now.
      void loadClaudeRules(hostId, sessionId, convApi(conv, sessionId), true).then(setView, () => {});
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (view) onView?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const add = () => {
    const rule = draft.trim();
    if (!rule || !view) return;
    if (!view.allow.includes(rule)) void save([...view.allow, rule]);
    setDraft("");
  };

  return (
    <div className="mt-1.5" data-testid="claude-allow-rules">
      <div className="mb-0.5 text-subtle" title={t("composer.claude.rulesHint")}>
        {t("composer.claude.rulesTitle")}
        {view && view.allow.length > 0 && <span className="ml-1 tabular-nums">· {view.allow.length}</span>}
      </div>
      {error && <p className="text-danger">{t("composer.claude.rulesLoadFailed", { error })}</p>}
      {view && !view.supported && <p className="text-warn">{t("composer.claude.rulesUnsupported")}</p>}
      {view && (
        <>
          {view.allow.length === 0 ? (
            <p className="text-subtle">{t("composer.claude.rulesEmpty")}</p>
          ) : (
            <ul className="max-h-36 overflow-auto">
              {view.allow.map((rule) => (
                <li key={rule} className="group flex items-center gap-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-caption/[inherit] text-foreground" title={rule}>{rule}</span>
                  <button
                    onClick={() => void save(view.allow.filter((r) => r !== rule))}
                    disabled={saving}
                    aria-label={t("composer.claude.ruleRemove", { rule })}
                    title={t("composer.claude.ruleRemove", { rule })}
                    className="rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-danger disabled:opacity-50"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex items-center gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                // Keep Enter / digits for this field: the menu would pick an item otherwise.
                e.stopPropagation();
                if (e.key === "Enter") add();
              }}
              placeholder={t("composer.claude.rulePlaceholder")}
              aria-label={t("composer.claude.ruleAdd")}
              disabled={saving}
              className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-caption/[inherit] outline-none focus:border-accent"
            />
            <button onClick={add} disabled={saving || !draft.trim()} title={t("composer.claude.ruleAdd")} aria-label={t("composer.claude.ruleAdd")} className="rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-50">
              <Plus size={13} aria-hidden />
            </button>
          </div>
          <p className="mt-1 truncate text-caption/[inherit] text-subtle" title={view.workspace}>{t("composer.claude.rulesScope", { workspace: view.workspace })}</p>
        </>
      )}
      {note && (
        <p className={`mt-0.5 ${note.kind === "failed" ? "text-danger" : "text-subtle"}`} role={note.kind === "failed" ? "alert" : undefined}>
          {note.kind === "failed" ? t("composer.claude.rulesFailed", { error: note.error }) : note.kind === "live" ? t("composer.claude.rulesLive") : t("composer.claude.rulesNextStart")}
        </p>
      )}
    </div>
  );
}
