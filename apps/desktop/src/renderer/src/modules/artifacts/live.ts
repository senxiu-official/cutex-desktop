// Module activation: auto-open an agent's live publish / show request beside its conversation (rules
// and the per-host event choice in autoOpen.ts).
// Reads what the pure policy needs from the app (agent in view, composer draft, the owner closing the
// right column), then opens `artifacts.view` for `af-…@latest` bound to that agent — reveal or
// background, never focus — and/or leaves a card in the conversation.
import { artifactRef } from "../../../../shared/artifactStore";
import { bridge } from "../../bridge";
import { clearAgentToasts, pushAgentToast } from "../../lib/agentToasts";
import { useSide } from "../../lib/sideLayoutStore";
import { agentHost, featuresOf, useApp } from "../../store";
import type { AppModuleContext, SideOpenOptions } from "../slots";
import { AUTO_OPEN_PREF, autoOpenEvent, autoOpenSetting, decideAutoOpen, type LivePublish } from "./autoOpen";
import { VIEW } from "./model";

export const TOAST_OWNER = "artifacts";

const key = (hostId: string, sessionId: string) => `${hostId}\u0000${sessionId}`;

/** The agent whose conversation is on screen. */
function viewing(): { hostId: string; sessionId: string } | null {
  const s = useApp.getState();
  if (s.view.kind !== "conversation" || !s.selectedId) return null;
  return { hostId: agentHost(s), sessionId: s.selectedId };
}

/** The composer has focus and something typed in it. */
function typing(): boolean {
  const el = typeof document === "undefined" ? null : document.activeElement;
  return !!el && el.matches?.("[data-composer-input]") && "value" in el && String((el as HTMLTextAreaElement).value).trim() !== "";
}

/**
 * When the owner closed the right column per conversation: an open → closed change of the side
 * layout while the same agent stayed in view (switching agents also swaps the column state; that is
 * not a close). Opening it again forgets the close.
 */
function trackCloses(signal: AbortSignal): Map<string, number> {
  const closed = new Map<string, number>();
  const current = () => viewing();
  let last = current();
  let lastOpen = useSide.getState().layout.open;
  const off = useSide.subscribe((s) => {
    const now = current();
    const open = s.layout.open;
    const same = !!now && !!last && now.hostId === last.hostId && now.sessionId === last.sessionId;
    if (same && now && lastOpen !== open) {
      if (!open) closed.set(key(now.hostId, now.sessionId), Date.now());
      else closed.delete(key(now.hostId, now.sessionId));
    }
    last = now;
    lastOpen = open;
  });
  signal.addEventListener("abort", off, { once: true });
  return closed;
}

export function startAutoOpen(ctx: AppModuleContext): void {
  if (typeof bridge?.on !== "function") return;
  const startedAt = Date.now();
  const closed = trackCloses(ctx.signal);
  const seen = new Set<string>();
  const open = (ev: LivePublish, how: "reveal" | "background") => {
    const opts: SideOpenOptions = { binding: { kind: "agent", hostId: ev.hostId, sessionId: ev.sessionId! }, pin: true, focus: false, ...(how === "reveal" ? { reveal: true } : { background: true }) };
    try {
      return ctx.services.side.open(VIEW, { ref: artifactRef(ev.artifactId, "latest"), name: ev.name }, opts).status === "opened";
    } catch {
      return false; // the module stopped meanwhile
    }
  };
  const card = (ev: LivePublish, opened: boolean) => {
    const label = ev.name.split("/").pop() || ev.name;
    pushAgentToast({
      owner: TOAST_OWNER,
      hostId: ev.hostId,
      sessionId: ev.sessionId!,
      icon: "artifact",
      key: `artifact:${ev.artifactId}`,
      text: ctx.t("artifacts.auto.toast", { agent: ev.agentName ?? ctx.t("artifacts.auto.someAgent"), name: `${label} v${ev.version}` }),
      action: { label: ctx.t(opened ? "artifacts.auto.show" : "artifacts.auto.open"), run: () => void open(ev, "reveal") },
    });
  };
  const off = bridge.on("hostEvent", ({ hostId, envelope }) => {
    // `artifact-show` hosts: only the agent's explicit show request (autoOpen.ts).
    const ev = autoOpenEvent(hostId, envelope, featuresOf(useApp.getState(), hostId));
    if (!ev || seen.has(ev.eventId)) return;
    seen.add(ev.eventId);
    if (seen.size > 500) seen.delete(seen.values().next().value!);
    const now = Date.now();
    const where = viewing();
    const decision = decideAutoOpen(ev, {
      setting: autoOpenSetting(ctx.prefs.get(AUTO_OPEN_PREF, "open")),
      now,
      startedAt,
      viewing: where,
      typing: typing(),
      closedAt: ev.sessionId ? (closed.get(key(hostId, ev.sessionId)) ?? null) : null,
    });
    if (decision.action === "none") return;
    if (decision.action === "notify") return card(ev, false);
    if (decision.action === "reveal") {
      if (!open(ev, "reveal")) card(ev, false);
      return;
    }
    card(ev, open(ev, "background"));
  });
  ctx.signal.addEventListener(
    "abort",
    () => {
      off?.();
      clearAgentToasts(TOAST_OWNER);
    },
    { once: true },
  );
}
