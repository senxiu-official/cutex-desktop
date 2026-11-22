import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, ShieldAlert, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { browserErrorKey } from "./browserState";
import { ownerNoticeHost, type BrowserOwnerNotice as Notice } from "./ownerNotices";

interface Props {
  notice: Notice;
  /** Redeems main's one-use item for exactly this notice (main keeps the target and decides again). */
  open(): Promise<void>;
  disabled: boolean;
}

/**
 * Something main stopped in this tab that the owner may still allow (ownerNotices.ts): one line with the one action.
 * × hides it here only — mount it keyed by the notice id, so the next one shows again.
 */
export function BrowserOwnerNotice({ notice, open, disabled }: Props) {
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
  const host = ownerNoticeHost(notice.url);
  const text = notice.kind === "certificate" ? t("browser.ownerNotice.certificate", { host })
    : notice.kind === "download" ? t("browser.ownerNotice.download", { file: notice.detail ?? host }) : t("browser.ownerNotice.popup", { host });
  const action = t(notice.kind === "certificate" ? "browser.ownerNotice.certificateOpen" : notice.kind === "download" ? "browser.ownerNotice.downloadOpen" : "browser.ownerNotice.popupOpen");
  const hint = notice.kind === "certificate" ? t("browser.ownerNotice.certificateHint", { url: notice.url, fingerprint: notice.detail ?? "" })
    : t(notice.kind === "download" ? "browser.ownerNotice.downloadHint" : "browser.ownerNotice.popupHint", { url: notice.url });
  const Icon = notice.kind === "certificate" ? ShieldAlert : notice.kind === "download" ? Download : ExternalLink;
  return <div data-browser-owner-notice={notice.kind} data-browser-owner-notice-id={notice.id} role="status"
    className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface-2 py-1 pr-1.5 pl-3 text-xs text-muted">
    <Icon size={13} aria-hidden="true" className="shrink-0 text-subtle" />
    <span className="min-w-0 flex-1 truncate" title={notice.url} data-browser-owner-notice-text="">{text}</span>
    <button type="button" data-browser-owner-notice-open="" disabled={disabled || pending} title={hint}
      className="shrink-0 rounded-md px-1.5 py-0.5 text-accent hover:bg-hover disabled:opacity-40" aria-busy={pending || undefined}
      onClick={() => void run()}>{pending ? t("browser.blockedNav.opening") : action}</button>
    <button type="button" data-browser-owner-notice-dismiss="" aria-label={t("browser.blockedNav.dismiss")} title={t("browser.blockedNav.dismiss")}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground" onClick={() => setHidden(true)}>
      <X size={13} aria-hidden="true" />
    </button>
    {failure !== null && <p role="alert" className="order-last w-full pb-0.5 pl-5 text-danger" data-browser-owner-notice-error="">
      {t("browser.actionFailed", { reason: t(browserErrorKey(failure)) })}</p>}
  </div>;
}
