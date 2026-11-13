import { useEffect, useRef, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { browserErrorKey } from "./browserState";
import type { BrowserBlockedNavigation as Blocked } from "./blockedNavigation";
import { blockedNavigationHost } from "./blockedNavigation";

interface Props {
  blocked: Blocked;
  /** Redeems main's one-use retry for exactly this refusal (main keeps the URL and checks it). */
  open(): Promise<void>;
  disabled: boolean;
}

/**
 * Main refused a top-level navigation into a private origin it could not tie to an owner gesture. The page stays as it
 * was; this one line says so and lets the owner continue with one click (仍然打开, when main allows it). × hides it here
 * only — mount it keyed by the refusal id, so the next refusal shows again.
 */
export function BrowserBlockedNavigation({ blocked, open, disabled }: Props) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const active = useRef(true), busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (hidden) return null;
  async function run() {
    if (disabled || busy.current) return;
    busy.current = true; setPending(true); setFailure(null);
    try { await open(); } catch (reason) { if (active.current) setFailure(reason ?? "internal_error"); }
    finally { busy.current = false; if (active.current) setPending(false); }
  }
  return <div data-browser-blocked-navigation={blocked.id} role="status"
    className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface-2 py-1 pr-1.5 pl-3 text-xs text-muted">
    <ShieldAlert size={13} aria-hidden="true" className="shrink-0 text-subtle" />
    <span className="min-w-0 flex-1 truncate" title={blocked.url} data-browser-blocked-navigation-text="">
      {t("browser.blockedNav.notice", { host: blockedNavigationHost(blocked.url) })}
    </span>
    {blocked.canOpen && <button type="button" data-browser-blocked-navigation-open="" data-desktop-loopback={blocked.desktopLoopback || undefined} disabled={disabled || pending}
      title={blocked.desktopLoopback ? t("browser.blockedNav.desktopLoopbackHint", { url: blocked.url }) : blocked.url}
      className="shrink-0 rounded-md px-1.5 py-0.5 text-accent hover:bg-hover disabled:opacity-40" aria-busy={pending || undefined}
      onClick={() => void run()}>{t(pending ? "browser.blockedNav.opening" : blocked.desktopLoopback ? "browser.blockedNav.openDesktop" : "browser.blockedNav.open")}</button>}
    <button type="button" data-browser-blocked-navigation-dismiss="" aria-label={t("browser.blockedNav.dismiss")} title={t("browser.blockedNav.dismiss")}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground" onClick={() => setHidden(true)}>
      <X size={13} aria-hidden="true" />
    </button>
    {/* Its own line under the notice: a narrow card keeps the notice and its buttons readable. */}
    {failure !== null && <p role="alert" className="order-last w-full pb-0.5 pl-5 text-danger" data-browser-blocked-navigation-error="">
      {t("browser.actionFailed", { reason: t(browserErrorKey(failure)) })}</p>}
  </div>;
}
