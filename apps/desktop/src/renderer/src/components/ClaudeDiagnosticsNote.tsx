// claude-runtime-diagnostics-v1 (cutex r295): a connected Claude runtime's startup warnings and a hook that has
// run for a while, in the conversation's runtime status area (above the input; hidden while an approval waits,
// since the composer block is). Older hosts / runtimes send nothing: no line.
import { useEffect, useReducer } from "react";
import type { SessionRuntime } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { useApp } from "../store";
import { formatElapsed } from "../lib/agentAttention";
import { setSettingsHost } from "../lib/settingsHost";
import { CLAUDE_DIAGNOSTICS_FEATURE, nextSlowHookIn, slowestHook, type ClaudeWarning } from "../../../shared/claudeDiagnostics";

const MCP_WARNINGS: ReadonlySet<ClaudeWarning> = new Set(["mcpConnectionFailed", "mcpAuthenticationRequired"]);

/** The current time, read on every render (a new snapshot is judged against now, not an earlier render's time);
 *  re-renders when the next hook crosses the threshold, and every second while one is shown. */
function useHookClock(runtime: SessionRuntime | undefined): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const now = Date.now();
  const d = runtime?.claudeDiagnostics;
  const shown = !!slowestHook(d, now);
  const wait = shown ? 1000 : nextSlowHookIn(d, now);
  useEffect(() => {
    if (wait === null) return;
    const timer = setTimeout(bump, Math.min(Math.max(wait, 50), 60_000));
    return () => clearTimeout(timer);
    // Rescheduled for each snapshot and each tick; `wait` is computed at that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, tick, wait === null]);
  return now;
}

export function ClaudeDiagnosticsNote({ runtime, features, hostId, profile }: { runtime: SessionRuntime | undefined; features: ReadonlySet<string>; hostId: string; profile: string | null }) {
  const { t } = useI18n();
  const now = useHookClock(runtime);
  const d = runtime?.claudeDiagnostics;
  // Only a connected runtime's facts (a lost host connection also clears them from the rows: store forgetShownDiagnostics).
  if (!features.has(CLAUDE_DIAGNOSTICS_FEATURE) || runtime?.status !== "online" || runtime.appServerConnected === false || !d) return null;
  const warnings = d.warnings as ClaudeWarning[];
  const hook = slowestHook(d, now);
  if (!warnings.length && !hook) return null;
  const open = (tab: "profiles" | "mcp") => {
    setSettingsHost(hostId);
    if (tab === "profiles") useApp.getState().openSettings("profiles", profile ? { profile } : undefined);
    else useApp.getState().openSettings("mcp");
  };
  const mcp = warnings.some((w) => MCP_WARNINGS.has(w));
  const config = warnings.some((w) => !MCP_WARNINGS.has(w));
  return (
    <div data-claude-diagnostics="" className="side-col flex flex-col gap-0.5 px-6 pb-1 text-xs">
      {warnings.length > 0 && (
        <p data-claude-warnings={warnings.join(" ")} className="text-warn-text" title={t("claudeDiag.warningsHint")}>
          {warnings.map((w) => t(`claudeDiag.warning.${w}`)).join(" · ")}
          {config && <button type="button" onClick={() => open("profiles")} className="ml-2 text-accent hover:underline">{t("claudeDiag.openProfile")}</button>}
          {mcp && <button type="button" onClick={() => open("mcp")} className="ml-2 text-accent hover:underline">{t("claudeDiag.openMcp")}</button>}
        </p>
      )}
      {hook && (
        <p data-claude-hook={hook.event ?? "other"} className="text-subtle" title={t("claudeDiag.hookHint")}>
          {hook.event ? t("claudeDiag.hookNamed", { hook: hook.event, elapsed: formatElapsed(hook.elapsedMs) }) : t("claudeDiag.hook", { elapsed: formatElapsed(hook.elapsedMs) })}
        </p>
      )}
    </div>
  );
}
