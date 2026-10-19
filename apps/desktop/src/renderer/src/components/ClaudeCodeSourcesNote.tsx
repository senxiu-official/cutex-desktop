// Composer permission menu footer, Claude agents (cutex `claude-code-sources`): which Claude Code
// settings sources (project CLAUDE.md / .claude, the account's user settings), claude.ai connectors and
// external MCP servers this agent actually has, from `GET /v2/sessions/{id}/claude-code`. Shows what the
// running adapter was launched with (else what the next launch passes) and a restart hint when the
// profile / MCP layers changed since. Read-only: the switches live on the Profile page and in MCP settings.
import { useEffect, useState } from "react";
import type { ClaudeCodeLaunchSummary, ClaudeCodeSources } from "../../../shared/ipc";
import { useI18n, type MessageKey } from "../i18n";
import { runtimeOf } from "../lib/agentList";
import { CLAUDE_CODE_SOURCES_FEATURE, claudeCodeShown } from "../lib/claudeCodeSources";
import { featuresOf, useApp } from "../store";
import { convApi, convSidebarOf, useConvScope } from "../lib/conversationScope";

export function ClaudeCodeSourcesNote({ hostId, sessionId }: { hostId: string | null | undefined; sessionId: string }) {
  const { t } = useI18n();
  const supported = useApp((s) => featuresOf(s, hostId).has(CLAUDE_CODE_SOURCES_FEATURE));
  const conv = useConvScope();
  const claude = useApp((s) => {
    const row = [...(convSidebarOf(conv, s)?.active ?? []), ...(convSidebarOf(conv, s)?.retired ?? [])].find((r) => r.cutexSessionId === sessionId);
    return !!row && runtimeOf(row) === "claude";
  });
  const [view, setView] = useState<ClaudeCodeSources | null>(null);
  useEffect(() => {
    if (!supported || !claude) return;
    let live = true;
    convApi(conv, sessionId).claudeCodeSources(sessionId).then(
      (v) => live && setView(v),
      () => undefined, // An unreadable answer: no note (the permission lines stay).
    );
    return () => {
      live = false;
    };
  }, [supported, claude, sessionId]);
  if (!supported || !claude || !view) return null;
  const shown: ClaudeCodeLaunchSummary = claudeCodeShown(view);
  const none = t("agent-config.claudeCode.none");
  const sources = shown.settingSources.length ? shown.settingSources.map((s) => t(`agent-config.claudeCode.source.${s}` as MessageKey)).join(t("agent-config.claudeCode.separator")) : none;
  const servers = shown.mcpServers.length ? shown.mcpServers.join(t("agent-config.claudeCode.separator")) : none;
  const older = !view.adapterSupports.settingSources || !view.adapterSupports.mcpServers;
  return (
    <div className="mt-1 max-w-72 border-t border-border px-2.5 pt-1.5 pb-1 text-xs" data-testid="claude-code-sources">
      <div className="mb-0.5 text-subtle">{t("agent-config.claudeCode.title")}</div>
      <div className="text-muted" title={t("agent-config.claudeCode.sourcesHint")}>{t("agent-config.claudeCode.sources", { list: sources })}</div>
      <div className="truncate text-muted" title={view.servers.filter((s) => s.status !== "included").map((s) => `${s.name}: ${t(`agent-config.claudeCode.reason.${s.reason ?? "unknown"}` as MessageKey)}`).join("\n") || undefined}>
        {t("agent-config.claudeCode.mcp", { list: servers })}
      </div>
      {shown.claudeAiConnectors && <div className="text-muted">{t("agent-config.claudeCode.connectorsOn")}</div>}
      {view.restartNeeded && <div className="mt-0.5 text-warn">{t("agent-config.claudeCode.restartNeeded")}</div>}
      {!view.running && !view.launched && <div className="mt-0.5 text-subtle">{t("agent-config.claudeCode.nextLaunch")}</div>}
      {older && <div className="mt-0.5 text-subtle">{t("agent-config.claudeCode.olderRuntime")}</div>}
    </div>
  );
}
