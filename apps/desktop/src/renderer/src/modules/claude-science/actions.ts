// Claude Science actions: cutex services calls on the page's host (the focus host or another one) and opening an account in an owner
// browser tab (module `browser`, opened by component id, never imported). The tab's view ticket runs
// the account's `loginLinkCommand` on the host, so the page arrives on Claude Science's one-time
// sign-in; the link never passes through the renderer.
import { api, apiFor } from "../../bridge";
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { useApp } from "../../store";
import type { AppModuleContext } from "../slots";
import { registerRequest, slugOf, type AccountSpec } from "./model";

const SERVICE_TAB = "browser.service";
let context: AppModuleContext | null = null;

/** Daemon calls of `hostId`: the focus host keeps `api`, others go through `apiFor`. */
const daemon = (hostId: string) => (hostId === (useApp.getState().hosts?.active ?? LOCAL_HOST_ID) ? api : apiFor(hostId));

export function activateClaudeScience(ctx: AppModuleContext): void {
  context = ctx;
  ctx.signal.addEventListener("abort", () => {
    if (context === ctx) context = null;
  }, { once: true });
}

/** Opens the account (cutex starts it first if it is stopped). False: no browser tab could open. */
export function openAccount(slug: string, hostId: string): boolean {
  const ctx = context;
  if (!ctx || ctx.signal.aborted) return false;
  try {
    const params = { url: `cutex:service/${slug}/` };
    const opts = { binding: { kind: "host" as const, hostId }, reveal: true, focus: true };
    let result = ctx.services.side.open(SERVICE_TAB, params, opts);
    // This independently delivered pack also runs on older desktops that have no service kind.
    if (result.status === "unavailable" && result.reason === "unknown-kind") result = ctx.services.side.open("browser.tab", params, opts);
    return result.status === "opened";
  } catch {
    return false;
  }
}

export async function addAccount(spec: AccountSpec, hostId: string): Promise<void> {
  await daemon(hostId).registerService(registerRequest(spec));
}

export async function accountAction(id: string, action: "start" | "stop" | "restart", hostId: string): Promise<void> {
  await daemon(hostId).serviceAction(slugOf(id), action);
}

/** Unregisters the service (cutex stops it). The account directory stays on the host. */
export async function removeAccount(id: string, hostId: string): Promise<void> {
  await daemon(hostId).deleteService(slugOf(id));
}
