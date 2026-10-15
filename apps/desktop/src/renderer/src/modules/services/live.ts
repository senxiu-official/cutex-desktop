// Module activation: an agent's service reveal request → a card in that agent's conversation
// 「Reader 想给你看：Doodle · 打开」. 打开 = an owner browser tab (owner login pool, bound to the host)
// on `cutex:service/<slug><path>`; with the browser module off, the service's usual opener (the
// system browser, lib/services.ts). Nothing opens by itself: a service can be any dev server.
import { bridge } from "../../bridge";
import { clearAgentToasts, pushAgentToast } from "../../lib/agentToasts";
import { hostData } from "../../lib/hostScope";
import { openServiceExternal } from "../../lib/services";
import { sideShowsHost } from "../../lib/sideServices";
import { useApp } from "../../store";
import type { AppModuleContext } from "../slots";
import { parseServiceReveal, revealIsLive, serviceLink, type ServiceReveal } from "./reveal";

export const TOAST_OWNER = "services";
/** The owner browser tab (module `browser`, §18.8: opened by id, never imported). */
const BROWSER_TAB = "browser.tab";
/** A reveal waits in its agent's conversation this long (the owner may be elsewhere). */
const REVEAL_CARD_MS = 30 * 60_000;

export function openRevealed(ctx: AppModuleContext, r: Pick<ServiceReveal, "hostId" | "slug" | "path">): void {
  let opened = false;
  try {
    // Another host than the open agent's would open out of view on the right side: the system browser instead.
    opened = sideShowsHost(r.hostId) && ctx.services.side.open(BROWSER_TAB, { url: serviceLink(r) }, { binding: { kind: "host", hostId: r.hostId }, reveal: true, focus: true }).status === "opened";
  } catch {
    opened = false;
  }
  if (!opened) void openServiceExternal({ slug: r.slug }, r.hostId, r.path).catch((e: unknown) => ctx.services.ui.notice(ctx.t("services.reveal.failed", { error: e instanceof Error ? e.message : String(e) }), "error"));
}

export function startServiceReveals(ctx: AppModuleContext): void {
  if (typeof bridge?.on !== "function") return;
  const startedAt = Date.now();
  const seen = new Set<string>();
  const off = bridge.on("hostEvent", ({ hostId, envelope }) => {
    const r = parseServiceReveal(hostId, envelope);
    if (!r || seen.has(r.eventId) || !revealIsLive(r, Date.now(), startedAt)) return;
    seen.add(r.eventId);
    if (seen.size > 500) seen.delete(seen.values().next().value!);
    const data = hostData(useApp.getState(), hostId);
    const name = data?.services?.find((s) => s.slug === r.slug)?.displayName?.trim() || r.slug;
    const agent = r.sessionId ? data?.sidebar?.active.find((a) => a.cutexSessionId === r.sessionId)?.displayName : undefined;
    const run = () => openRevealed(ctx, r);
    if (!r.sessionId) {
      // No owning agent: no conversation to put the card in.
      ctx.services.ui.notice(ctx.t("services.reveal.noAgent", { name }));
      return;
    }
    pushAgentToast(
      {
        owner: TOAST_OWNER,
        hostId,
        sessionId: r.sessionId,
        icon: "service",
        key: `service:${r.slug}`,
        text: ctx.t("services.reveal.toast", { agent: agent ?? ctx.t("services.reveal.someAgent"), name }),
        action: { label: ctx.t("services.reveal.open"), run },
      },
      REVEAL_CARD_MS,
    );
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
