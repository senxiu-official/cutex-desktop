// A command a runtime safety check stopped under full access (claude-safety-grants, cutex
// docs/SAFETY-GRANTS.md), in its agent's timeline: an owner notice (origin system, systemKind
// safetyBlock) that counts in 需要你 until the owner decides. While blocked it is a card with the
// agent, the exact command (monospace, wrapped), Claude Code's own reason, the grant rule and
// 批准一次 / 不批准; once decided a quiet row that says what happened (批准一次 → used / expired, or
// 未批准). The agent never waited for it: its turn went on (or ended) when the check declined.
import { useState } from "react";
import { Check, ShieldAlert, ShieldCheck, ShieldX, X } from "lucide-react";
import type { OwnerNotification, SafetyBlock } from "@cutex-desktop/protocol";
import { useI18n, type MessageKey } from "../i18n";
import { safetyBlockState } from "../lib/ownerNotify";
import { safetyCheckAct } from "../lib/ownerNotifyStore";
import { formatAbsolute, formatWhen, useClock } from "../lib/time";
import { useApp } from "../store";
import { convNotify, convSidebarOf, useConvScope } from "../lib/conversationScope";
import { rowsOf } from "../lib/viewHost";
import { ClampBox } from "./ClampBox";
import { SystemAvatar } from "./SystemAvatar";

const REFUSALS: Record<string, MessageKey> = {
  session_offline: "safetyBlock.error.offline",
  safety_grants_unsupported: "safetyBlock.error.unsupported",
  safety_block_closed: "safetyBlock.error.closed",
  safety_block_not_found: "safetyBlock.error.closed",
};

/** `hostId`: the agent's host; the decision goes there (components/OwnerNotifyCard). */
export function SafetyBlockCard({ record: r, block, hostId }: { record: OwnerNotification; block: SafetyBlock; hostId: string }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const conv = useConvScope();
  const notify = (text: string, tone?: "info" | "error") => convNotify(conv, text, tone);
  const agentName = useApp((s) => rowsOf(s.sidebar, convSidebarOf(conv, s)).find((x) => x.cutexSessionId === r.agentId)?.displayName ?? r.agentName ?? r.agentId);
  const [busy, setBusy] = useState<null | "grant" | "dismiss">(null);
  const state = safetyBlockState(block, now);
  const open = state === "blocked";
  const created = Date.parse(r.createdAt) / 1000;
  const minutes = Math.max(1, Math.round(block.grantSeconds / 60));
  const expires = block.expiresAt ? Date.parse(block.expiresAt) / 1000 : NaN;

  const decide = async (decision: "grant" | "dismiss") => {
    setBusy(decision);
    try {
      const result = await safetyCheckAct(r, decision, hostId);
      if (!result.ok) notify(REFUSALS[result.error.code] ? t(REFUSALS[result.error.code]!) : result.error.message || result.error.code, "error");
      else if (result.submitError) notify(t("safetyBlock.error.message", { error: result.submitError.message || result.submitError.code }), "error");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const StateIcon = state === "dismissed" ? ShieldX : open ? ShieldAlert : ShieldCheck;
  const stateLine =
    state === "granted"
      ? t("safetyBlock.state.granted", { time: Number.isFinite(expires) ? formatAbsolute(expires) : "" })
      : t(`safetyBlock.state.${state}` as MessageKey);

  return (
    <div
      data-owner-note={r.notificationId}
      data-origin="system"
      data-safety-block={block.blockId}
      data-safety-state={state}
      data-note-look={open ? "card" : "row"}
      className={open ? "my-3 rounded-xl border border-warn/40 bg-warn/5 px-3.5 py-2.5" : "my-2 border-l-2 border-border py-0.5 pl-3"}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        <SystemAvatar kind="cutex" size={open ? 16 : 14} />
        <span className={open ? "font-medium text-foreground" : "text-muted"}>{t("system.cutex")}</span>
        <span className="min-w-0 truncate text-muted">{t("ownerNotify.aboutAgent", { name: agentName })}</span>
        {open ? (
          <span className="rounded-full bg-warn/15 px-1.5 py-px text-[11px] font-semibold text-warn-text">{t("safetyBlock.badge")}</span>
        ) : (
          <span className="text-subtle">· {t("safetyBlock.badge")}</span>
        )}
        <span className="text-subtle" title={Number.isFinite(created) ? formatAbsolute(created) : undefined}>
          · {Number.isFinite(created) ? formatWhen(created, now, locale) : ""}
        </span>
        <span className={`ml-auto flex shrink-0 items-center gap-1 ${state === "granted" || state === "used" ? "text-ok-text" : "text-subtle"}`}>
          <StateIcon size={13} aria-hidden />
          {stateLine}
        </span>
      </div>
      {open && <div className="mt-1.5 text-[13.5px]">{t("safetyBlock.lead", { tool: block.toolName })}</div>}
      <ClampBox lines={open ? 10 : 3} resetKey={block.blockId} className={open ? "mt-1.5" : "mt-0.5"}>
        <pre data-safety-command="" className={`font-mono whitespace-pre-wrap break-all rounded-lg bg-surface-2/70 px-2.5 py-1.5 ${open ? "text-[12.5px] text-foreground" : "text-[12px] text-muted"}`}>
          {block.command}
        </pre>
      </ClampBox>
      {open && (
        <>
          {block.reason && (
            <div className="mt-1.5 text-[12.5px] text-muted">
              <span className="text-subtle">{t("safetyBlock.reason")}</span> <span className="break-words">{block.reason}</span>
            </div>
          )}
          <div className="mt-1 text-[11.5px] text-subtle">{t("safetyBlock.rule", { minutes })}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => void decide("grant")}
              disabled={!!busy}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
            >
              <Check size={13} />
              {busy === "grant" ? t("safetyBlock.granting") : t("safetyBlock.grant")}
            </button>
            <button
              onClick={() => void decide("dismiss")}
              disabled={!!busy}
              className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
            >
              <X size={13} />
              {t("safetyBlock.dismiss")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
