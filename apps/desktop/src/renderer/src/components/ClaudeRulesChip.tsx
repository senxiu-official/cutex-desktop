// Composer chip of a Claude agent, right after its permission chip (Claude modes,
// lib/claudePermissionModes): 「规则 3」 opens 「Claude 权限规则」 with
// - which tools the agent can reach (its cutex write / command switches; a permission mode never
//   turns a disabled tool on) — a warn dot on the chip while one is off;
// - the persistent "always allow" rules of the agent's workspace (cutex `claude-permission-rules`):
//   listed, removable and addable here. cutex keeps them per working directory (shared by every
//   Claude agent there, never written into the repository) and hands them to running agents;
// - the Claude Code sources note (components/ClaudeCodeSourcesNote).
// The permission menu itself lists only the modes.
import { useEffect, useState } from "react";
import { Plus, ShieldCheck, X } from "lucide-react";
import type { ClaudePermissionRules } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { CLAUDE_CODE_SOURCES_FEATURE } from "../lib/claudeCodeSources";
import { claudeRulesChipShown, claudeToolsOff } from "../lib/claudePermissionModes";
import { featuresOf, useApp } from "../store";
import { convApi, useConvScope } from "../lib/conversationScope";
import { ClaudeCodeSourcesNote } from "./ClaudeCodeSourcesNote";
import { Popover } from "./Menu";

type Note = { kind: "live" | "nextStart" } | { kind: "failed"; error: string };

export function ClaudeRulesChip({
  hostId,
  sessionId,
  write,
  exec,
  rulesFeature,
  iconOnly = false,
}: {
  hostId: string | null | undefined;
  sessionId: string;
  write: boolean | null;
  exec: boolean | null;
  rulesFeature: boolean;
  /** A narrow toolbar: the icon (and the warn dot) only, so the permission chip keeps its width. */
  iconOnly?: boolean;
}) {
  const { t } = useI18n();
  const conv = useConvScope();
  const sourcesFeature = useApp((s) => featuresOf(s, hostId).has(CLAUDE_CODE_SOURCES_FEATURE));
  const off = claudeToolsOff({ write, exec });
  // The count on the chip: read once per agent, then kept current by the popover's list.
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    if (!rulesFeature) return;
    let live = true;
    convApi(conv, sessionId).claudePermissionRules(sessionId).then(
      (v) => live && setCount(v.allow.length),
      () => undefined, // Unreadable: no count; the popover shows the error.
    );
    return () => {
      live = false;
    };
  }, [rulesFeature, sessionId]);
  if (!claudeRulesChipShown({ claude: true, rulesFeature, toolsOff: off, sourcesFeature })) return null;
  const offText = off.length ? t("composer.claude.toolsOff", { tools: off.map((k) => t(k === "write" ? "composer.claude.toolWrite" : "composer.claude.toolExec")).join(t("composer.claude.listSeparator")) }) : null;
  const title = [t("composer.claude.rulesPanelTitle"), offText, count ? t("composer.claude.rulesChipCount", { n: count }) : null].filter(Boolean).join("\n");
  return (
    <Popover
      triggerTitle={title}
      width="w-80 max-w-[calc(100vw-2rem)]"
      trigger={
        <span className="relative flex items-center gap-1" data-testid="claude-rules-chip">
          <ShieldCheck size={13} className="shrink-0" aria-hidden />
          {!iconOnly && (
            <span className="trim-cap whitespace-nowrap">
              {t("composer.claude.rulesChip")}
              {count ? <span className="ml-1 tabular-nums">{count}</span> : null}
            </span>
          )}
          {off.length > 0 && <span className="absolute -top-0.5 left-2.5 h-1.5 w-1.5 rounded-full bg-warn" data-testid="claude-rules-tools-off" aria-hidden />}
        </span>
      }
    >
      {() => (
        <div data-testid="claude-rules-panel">
          <div className="px-2.5 pt-1.5 pb-1 text-xs text-subtle">{t("composer.claude.rulesPanelTitle")}</div>
          <div className="px-2.5 pb-1 text-xs" data-testid="claude-tools-note">
            <div className="mb-0.5 text-subtle">{t("composer.claude.toolsTitle")}</div>
            <p className={`max-w-72 ${offText ? "text-warn" : "text-muted"}`}>{offText ?? t("composer.claude.toolsOn")}</p>
          </div>
          {rulesFeature && (
            <div className="mt-1 border-t border-border px-2.5 pb-1 text-xs">
              <ClaudeAllowRules sessionId={sessionId} onView={(v) => setCount(v.allow.length)} />
            </div>
          )}
          <ClaudeCodeSourcesNote hostId={hostId} sessionId={sessionId} />
        </div>
      )}
    </Popover>
  );
}

export function ClaudeAllowRules({ sessionId, onView }: { sessionId: string; /** Every list cutex answered (load / save). */ onView?(view: ClaudePermissionRules): void }) {
  const conv = useConvScope();
  const { t } = useI18n();
  const [view, setView] = useState<ClaudePermissionRules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setView(null);
    setError(null);
    convApi(conv, sessionId).claudePermissionRules(sessionId).then(
      (v) => live && setView(v),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [sessionId]);

  const save = async (allow: string[]) => {
    if (!view) return;
    setSaving(true);
    try {
      const next = await convApi(conv, sessionId).setClaudePermissionRules(sessionId, allow, view.revision);
      setView(next);
      const mine = next.sessions?.find((s) => s.cutexSessionId === sessionId);
      setNote({ kind: mine?.status === "live" ? "live" : "nextStart" });
    } catch (e) {
      setNote({ kind: "failed", error: e instanceof Error ? e.message : String(e) });
      // A conflict or refusal: show what cutex has now.
      void convApi(conv, sessionId).claudePermissionRules(sessionId).then(setView, () => {});
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
      {error && <p className="max-w-72 text-danger">{t("composer.claude.rulesLoadFailed", { error })}</p>}
      {view && !view.supported && <p className="max-w-72 text-warn">{t("composer.claude.rulesUnsupported")}</p>}
      {view && (
        <>
          {view.allow.length === 0 ? (
            <p className="max-w-72 text-subtle">{t("composer.claude.rulesEmpty")}</p>
          ) : (
            <ul className="max-h-36 max-w-72 overflow-auto">
              {view.allow.map((rule) => (
                <li key={rule} className="group flex items-center gap-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={rule}>{rule}</span>
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
          <div className="mt-1 flex max-w-72 items-center gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Keep Enter / digits for this field: the menu would pick an item otherwise.
                e.stopPropagation();
                if (e.key === "Enter" && !e.nativeEvent.isComposing) add();
              }}
              placeholder={t("composer.claude.rulePlaceholder")}
              aria-label={t("composer.claude.ruleAdd")}
              disabled={saving}
              className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-accent"
            />
            <button onClick={add} disabled={saving || !draft.trim()} title={t("composer.claude.ruleAdd")} aria-label={t("composer.claude.ruleAdd")} className="rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-50">
              <Plus size={13} aria-hidden />
            </button>
          </div>
          <p className="mt-1 max-w-72 truncate text-[11px] text-subtle" title={view.workspace}>{t("composer.claude.rulesScope", { workspace: view.workspace })}</p>
        </>
      )}
      {note && (
        <p className={`mt-0.5 max-w-72 ${note.kind === "failed" ? "text-danger" : "text-subtle"}`} role={note.kind === "failed" ? "alert" : undefined}>
          {note.kind === "failed" ? t("composer.claude.rulesFailed", { error: note.error }) : note.kind === "live" ? t("composer.claude.rulesLive") : t("composer.claude.rulesNextStart")}
        </p>
      )}
    </div>
  );
}
