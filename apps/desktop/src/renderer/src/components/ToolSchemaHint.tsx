// Inside a failed turn's error row (Timeline TurnErrorRow): the provider refused a tool's parameter schema and the
// agent's Profile has 工具参数严格模式 off (lib/toolSchemaHint). 「打开并重试」 turns it on for the Profile — a
// 下次启动生效 setting, so an online agent is restarted (confirmed first while it works) — and sends the failed
// turn's message again; 「去 Profile 设置」 opens the Profile; 「不再提示」 hides it for this Profile.
import { useEffect, useRef, useState } from "react";
import { apiFor } from "../bridge";
import { useI18n } from "../i18n";
import { sessionProfileName } from "../lib/agentLook";
import { confirmDialog } from "../lib/contextMenu";
import { hostData } from "../lib/hostScope";
import { fieldOffered } from "../lib/profileKind";
import { updateCachedProfile } from "../lib/profileSnapshot";
import { dismissToolSchemaHint, PROFILE_TOOL_SCHEMA_COMPAT_FEATURE, useToolSchemaHintDismissed } from "../lib/toolSchemaHint";
import { viewRow } from "../lib/viewHost";
import { isHostBusyActionPending } from "../lib/hostBusyActions";
import { useApp } from "../store";

type Phase = { kind: "idle" } | { kind: "working" } | { kind: "pending" } | { kind: "done"; resent: boolean } | { kind: "failed"; message: string };

export function ToolSchemaHint({ hostId, sessionId, retryText }: { hostId: string; sessionId: string; /** The failed turn's message (sent again), if it had one. */ retryText: string | null }) {
  const { t } = useI18n();
  const session = useApp((s) => viewRow(s, hostId, sessionId));
  const profile = session ? sessionProfileName(session) : null;
  const supported = useApp((s) => hostData(s, hostId)?.features.has(PROFILE_TOOL_SCHEMA_COMPAT_FEATURE) ?? false);
  const dismissed = useToolSchemaHintDismissed(hostId, profile);
  // The Profile as the host has it now: hidden while unknown, when strict mode is already on, or not offered.
  const [offered, setOffered] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const scope = JSON.stringify([hostId, sessionId, profile]);
  const progress = useRef({ scope, configured: false, stopped: false, started: false, resent: false, running: false, startRequired: false });
  if (progress.current.scope !== scope) {
    progress.current = { scope, configured: false, stopped: false, started: false, resent: false, running: false, startRequired: false };
    setPhase({ kind: "idle" });
  }
  const ask = supported && !!profile && !dismissed;
  useEffect(() => {
    if (!ask || !profile) return;
    let live = true;
    apiFor(hostId).getProfile(profile).then(
      (detail) => live && setOffered(detail.toolSchemaCompat !== "strict" && fieldOffered(detail, "toolSchemaCompat")),
      () => live && setOffered(false),
    );
    return () => { live = false; };
  }, [ask, hostId, profile]);
  if (!ask || !profile || (!offered && phase.kind !== "done")) return null;

  const enable = async () => {
    const steps = progress.current;
    if (steps.running || phase.kind === "done") return;
    steps.running = true;
    const busy = !!session?.runtime.activeTurnId;
    const online = session?.runtime.status === "online";
    try {
      if (!steps.stopped && online && busy && !(await confirmDialog(t("toolSchemaHint.restartBusy", { name: session.displayName }), true))) return;
      if (progress.current !== steps) return;
      steps.startRequired ||= !!retryText || online;
      setPhase({ kind: "working" });
      if (!steps.configured) {
        const detail = await apiFor(hostId).patchProfile(profile, { toolSchemaCompat: "strict" });
        updateCachedProfile(profile, { detail }, hostId);
        steps.configured = true;
      }
      if (progress.current !== steps) return;
      const app = useApp.getState();
      // 下次启动生效: restart the agent so it runs with the stricter tool schemas, then send the message again.
      if (!steps.stopped) {
        if (online) await app.sessionAction(sessionId, "cutex/runtime/offline", { expectedRuntimeGeneration: session.runtime.runtimeGeneration }, hostId);
        steps.stopped = true;
      }
      if (progress.current !== steps) return;
      if (!steps.started && steps.startRequired) {
        await app.sessionAction(sessionId, "cutex/runtime/online", { openVisibleTerminal: false }, hostId);
        steps.started = true;
      }
      if (progress.current !== steps) return;
      if (retryText && !steps.resent) {
        await app.submit(retryText, "auto", undefined, { sessionId, hostId });
        steps.resent = true;
      }
      if (progress.current !== steps) return;
      setPhase({ kind: "done", resent: !!retryText });
    } catch (reason) {
      if (progress.current !== steps) return;
      // The persistent action row retries only online. It must never silently resend this
      // message. An explicit click here resumes after the already-completed patch/stop steps.
      if (isHostBusyActionPending(reason)) setPhase({ kind: "pending" });
      else setPhase({ kind: "failed", message: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      steps.running = false;
    }
  };

  const button = "rounded border px-2 py-0.5 text-xs disabled:opacity-50";
  return (
    <div data-tool-schema-hint="" className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-xs text-foreground">
      {phase.kind === "done" ? (
        <div data-tool-schema-hint-done="">{t(phase.resent ? "toolSchemaHint.doneResent" : "toolSchemaHint.done", { profile })}</div>
      ) : (
        <>
          <div className="font-medium">{t("toolSchemaHint.title", { setting: t("agent-config.profile.toolSchemaCompat") })}</div>
          <div className="mt-0.5 text-muted">{t("toolSchemaHint.restartNote", { profile })}</div>
          {phase.kind === "failed" && <div role="alert" className="mt-1 break-words text-danger">{phase.message}</div>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" data-tool-schema-hint-action="enable" disabled={phase.kind === "working"} onClick={() => void enable()} className={`${button} border-accent bg-accent text-accent-foreground`}>
              {phase.kind === "working" ? t("toolSchemaHint.working") : phase.kind === "pending" ? t("hostAction.retry") : t("toolSchemaHint.enable")}
            </button>
            <button type="button" data-tool-schema-hint-action="settings" onClick={() => useApp.getState().openSettings("profiles", { profile })} className={`${button} border-border bg-surface hover:bg-hover`}>
              {t("toolSchemaHint.settings")}
            </button>
            <button type="button" data-tool-schema-hint-action="dismiss" onClick={() => dismissToolSchemaHint(hostId, profile)} className={`${button} border-transparent text-muted hover:bg-hover hover:text-foreground`}>
              {t("toolSchemaHint.dismiss")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
