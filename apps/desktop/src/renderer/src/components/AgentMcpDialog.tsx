// 设置 › MCP 服务器…: this agent's MCP servers, one switch each (cutex `scoped-mcp`, lib/agentMcp). Each row keeps
// two things apart: 配置 — where the server comes from (shared CODEX_HOME config, project, this agent, cutex
// built-in) and whether the agent launches with it — and 当前 — what the running agent reported (the last native
// startup status seen this run; lib/agentMcpLive). A switch writes the agent layer's `disabled` list; cutex
// applies it at the agent's next launch, so a row whose config and running state differ says 下次启动生效.
import { useEffect, useRef, useState } from "react";
import { Loader2, Plug } from "lucide-react";
import type { AgentMcpServer, AgentMcpView, McpStartupStatus } from "../../../shared/sessionMcp";
import { switchable } from "../../../shared/sessionMcp";
import { apiFor } from "../bridge";
import { useI18n, type MessageKey } from "../i18n";
import { sidebarOf, useApp } from "../store";
import { closeDialog } from "../lib/contextMenu";
import { captureHostAction, onHostReset } from "../lib/hostSwitch";
import { agentMcpKey, liveStatusOf, useAgentMcpLive } from "../lib/agentMcpLive";
import { Toggle } from "./settings/Form";
import { Button } from "./Button";

const LAYERS = new Set(["builtin", "global", "project", "agent"]);
const ERRORS = new Set(["unsupported", "revision_conflict", "session_not_found", "scoped_mcp_store_unavailable", "unreachable"]);

function LiveText({ live }: { live: McpStartupStatus | "unknown" | null }) {
  const { t } = useI18n();
  if (live === null) return <span className="text-subtle">{t("agent-config.mcp.live.offline")}</span>;
  if (live === "unknown") return <span className="text-subtle" title={t("agent-config.mcp.live.unknownHint")}>{t("agent-config.mcp.live.unknown")}</span>;
  const tone = live.status === "ready" ? "text-ok-text" : live.status === "failed" ? "text-danger-text" : "text-muted";
  return (
    <span className={tone} title={live.error ?? undefined}>
      {t(`agent-config.mcp.live.${live.status}` as MessageKey)}
      {live.error && <span className="text-subtle">{` · ${live.error}`}</span>}
    </span>
  );
}

export function AgentMcpDialog({ sessionId, hostId, resolve }: { sessionId: string; hostId: string; resolve(value: null): void }) {
  const { t } = useI18n();
  const session = useApp((s) => sidebarOf(s, hostId)?.active.find((r) => r.cutexSessionId === sessionId) ?? null);
  const live = useAgentMcpLive((s) => s.byKey[agentMcpKey(hostId, sessionId)]);
  const [view, setView] = useState<AgentMcpView | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  /** Names switched in this dialog: their change waits for the next launch. */
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const current = useRef(captureHostAction(hostId));
  const mounted = useRef(true);
  const alive = () => mounted.current && current.current();
  const done = () => { closeDialog(); resolve(null); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => onHostReset((host) => { if (host === hostId) done(); }), [hostId]);
  const load = (note?: { code: string; message: string }) =>
    apiFor(hostId).agentMcp(sessionId).then((r) => {
      if (!alive()) return;
      if (r.ok) { setView(r.view); setError(note ?? null); }
      else setError({ code: r.code, message: r.message });
    }, (e: unknown) => alive() && setError({ code: "other", message: String((e as Error)?.message ?? e) }));
  useEffect(() => { void load(); }, [hostId, sessionId]);

  const flip = async (server: AgentMcpServer, on: boolean) => {
    if (!view || saving) return;
    const disabled = on ? view.disabled.filter((n) => n !== server.name) : [...view.disabled, server.name];
    setSaving(server.name);
    try {
      const r = await apiFor(hostId).setAgentMcpDisabled(sessionId, disabled, view.revision);
      if (!alive()) return;
      if (r.ok) {
        setView(r.view);
        setError(null);
        setChanged((c) => new Set(c).add(server.name));
      } else if (r.code === "revision_conflict") await load({ code: r.code, message: r.message });
      else setError({ code: r.code, message: r.message });
    } catch (e) {
      if (alive()) setError({ code: "other", message: String((e as Error)?.message ?? e) });
    } finally {
      if (alive()) setSaving(null);
    }
  };

  const online = session?.runtime?.status === "online";
  const errorText = error && (ERRORS.has(error.code) ? t(`agent-config.mcp.error.${error.code}` as MessageKey) : t("agent-config.mcp.error.other", { message: error.message }));
  return (
    <div className="space-y-3 text-sm" data-testid="agent-mcp-dialog">
      <div>
        <h2 className="flex items-center gap-1.5 font-medium text-foreground">
          <Plug size={14} className="text-subtle" />
          {t("agent-config.mcp.title", { name: session?.displayName ?? sessionId })}
        </h2>
        <p className="mt-1 text-xs text-muted">{t("agent-config.mcp.hint")}</p>
        {view?.appliesOn && <p className="mt-0.5 text-xs text-muted">{t("agent-config.mcp.appliesNextLaunch")}</p>}
      </div>
      {errorText && <p className={`text-xs ${error!.code === "revision_conflict" ? "text-warn-text" : "text-danger-text"}`} role="alert">{errorText}</p>}
      {!view && !error && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" />
          {t("agent-config.mcp.loading")}
        </p>
      )}
      {view && view.servers.length === 0 && <p className="text-xs text-muted">{t("agent-config.mcp.empty")}</p>}
      {view && view.servers.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {view.servers.map((server) => {
            const canSwitch = switchable(view, server);
            const own = view.disabled.includes(server.name);
            const shown = session ? liveStatusOf(live, session, server.name) : null;
            const running = shown !== null && shown !== "unknown" && (shown.status === "ready" || shown.status === "starting");
            // Switched here while the agent runs, or still connected although its config is now off: the next launch applies it.
            const pending = online && (changed.has(server.name) || (running && !server.enabled));
            const layer = LAYERS.has(server.layer) ? t(`agent-config.mcp.layer.${server.layer}` as MessageKey) : server.layer;
            const config = server.enabled
              ? t("agent-config.mcp.config.on")
              : server.disabledBy === "agent" ? t("agent-config.mcp.config.offHere") : server.disabledBy === "config" ? t("agent-config.mcp.config.offShared") : t("agent-config.mcp.config.offCutex");
            return (
              <li key={server.name} className="flex items-start gap-3 px-3 py-2" data-mcp-server={server.name}>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium text-foreground">{server.name}</span>
                    <span className="shrink-0 rounded bg-surface-2 px-1 text-caption text-muted" title={server.layers.length > 1 ? t("agent-config.mcp.layers", { layers: server.layers.map((l) => (LAYERS.has(l) ? t(`agent-config.mcp.layer.${l}` as MessageKey) : l)).join(" < ") }) : undefined}>
                      {layer}
                    </span>
                    {server.transport && <span className="shrink-0 text-caption text-subtle">{server.transport}</span>}
                    {pending && <span className="shrink-0 rounded bg-attention-soft px-1 text-caption text-warn-text" data-mcp-pending="">{t("agent-config.mcp.pending")}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    <span className="text-muted">{t("agent-config.mcp.configLabel")}{config}</span>
                    <span className="text-muted">{t("agent-config.mcp.liveLabel")}<LiveText live={shown} /></span>
                  </div>
                </div>
                <div className="flex h-5 shrink-0 items-center gap-1.5">
                  {saving === server.name && <Loader2 size={12} className="animate-spin text-subtle" />}
                  {canSwitch ? (
                    <Toggle checked={!own && server.disabledBy !== "config"} disabled={!!saving || (server.disabledBy === "config" && !own)} onChange={(on) => void flip(server, on)} label={t("agent-config.mcp.switch", { name: server.name })} />
                  ) : (
                    <span className="text-caption text-subtle" title={t(server.layer === "builtin" ? "agent-config.mcp.fixedBuiltinHint" : "agent-config.mcp.fixedOwnHint")}>{t("agent-config.mcp.fixed")}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={done}>{t("agent-config.mcp.close")}</Button>
      </div>
    </div>
  );
}
