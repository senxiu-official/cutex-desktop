// Saved passwords in an owner tab (design browser-profiles v3 §8–§9, sketches save.png / fill.png / fill-granted.png):
// the save / update card under the address bar, the login list at the field the owner clicked, and the key in the
// address bar that reopens either. Windows Hello runs in main before every fill; nothing here sees a password.
import { useState } from "react";
import { KeyRound, Lock, UserRound, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { btn } from "../../components/Button";
import { bridge } from "../../bridge";
import type { BrowserFillOfferView, BrowserPasswordPromptChoice, BrowserPasswordPromptView } from "../../../../shared/browserIdentity";
import { identityRequest, useIdentity } from "./identities";
import { forgetPasswordUi, passwordErrorKey, passwordTabKey, usePasswordUi } from "./passwordUi";
import { browserCache } from "./browserCache";

const siteOf = (origin: string) => { try { return new URL(origin).host; } catch { return origin; } };

/** The key at the end of the address box while this tab has a prompt or a fill offer; a click shows it again. */
export function PasswordKey({ hostId, tabKey, open, onToggle }: { hostId: string; tabKey: string; open: boolean; onToggle(): void }) {
  const { t } = useI18n();
  const has = usePasswordUi((s) => !!s.prompts[passwordTabKey(hostId, tabKey)] || !!s.offers[passwordTabKey(hostId, tabKey)]);
  if (!has) return null;
  return (
    <button type="button" data-browser-password-key aria-pressed={open} title={t("browser.password.key")} aria-label={t("browser.password.key")} onClick={onToggle}
      className={`flex size-6 shrink-0 items-center justify-center rounded-md ${open ? "bg-accent/15 text-accent" : "text-subtle hover:bg-hover hover:text-foreground"}`}>
      <KeyRound size={13} />
    </button>
  );
}

/** 保存这个密码到「工作 Outlook」？ — under the address bar, right-aligned. */
export function PasswordPromptCard({ prompt, onHide }: { prompt: BrowserPasswordPromptView; onHide(): void }) {
  const { t } = useI18n();
  const identity = useIdentity(prompt.identityId);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function answer(choice: BrowserPasswordPromptChoice) {
    setBusy(true); setError(null);
    try { await identityRequest((ids) => ids.promptAnswer(prompt.promptId, choice)); forgetPasswordUi("prompt", prompt.promptId); }
    catch (e) { setError(t(passwordErrorKey(e))); }
    finally { setBusy(false); }
  }
  const name = identity?.name ?? t("browser.identity.defaultName");
  return (
    <div role="dialog" aria-label={t(prompt.kind === "update" ? "browser.password.updateTitle" : "browser.password.saveTitle", { identity: name })} data-browser-password-prompt={prompt.kind}
      className="float absolute top-1 right-2 z-30 w-[19rem] max-w-[calc(100%-1rem)] p-3 text-xs">
      <div className="flex items-start gap-2">
        <KeyRound size={14} className="mt-0.5 shrink-0 text-accent" />
        <p className="min-w-0 flex-1 font-medium text-foreground">{t(prompt.kind === "update" ? "browser.password.updateTitle" : "browser.password.saveTitle", { identity: name })}</p>
        <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={onHide} className="shrink-0 rounded p-0.5 text-subtle hover:bg-hover hover:text-foreground"><X size={13} /></button>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
        <dt>{t("browser.password.site")}</dt><dd className="min-w-0 truncate text-foreground">{siteOf(prompt.origin)}</dd>
        <dt>{t("browser.password.username")}</dt><dd className="min-w-0 truncate text-foreground">{prompt.username || t("browser.password.noUsername")}</dd>
        <dt>{t("browser.password.password")}</dt><dd className="text-foreground" aria-label={t("browser.password.hidden")}>••••••••</dd>
      </dl>
      <p className="mt-2 flex items-start gap-1.5 text-caption text-subtle"><Lock size={11} className="mt-0.5 shrink-0" />{t("browser.password.whereStored")}</p>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-1.5">
        {prompt.kind === "save" && <button type="button" data-browser-password-never className={btn({ variant: "ghost", size: "sm" })} disabled={busy} onClick={() => void answer("never")}>{t("browser.password.never")}</button>}
        <button type="button" data-browser-password-not-now className={btn({ size: "sm" })} disabled={busy} onClick={() => void answer("notNow")}>{t("browser.password.notNow")}</button>
        <button type="button" data-browser-password-save className={btn({ variant: "primary", size: "sm" })} disabled={busy} onClick={() => void answer("save")}>{t(prompt.kind === "update" ? "browser.password.update" : "browser.password.save")}</button>
      </div>
    </div>
  );
}

/** The logins main can fill, at the field the owner clicked (CSS px of the guest viewport). */
export function FillOfferList({ offer, onHide }: { offer: BrowserFillOfferView; onHide(): void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const granted = offer.grantedTo;
  async function fill(loginId: string, takeBack: boolean) {
    setBusy(true); setError(null);
    try {
      if (takeBack) {
        const lease = browserCache.get(offer.hostId, offer.tabKey)?.lease;
        if (lease && bridge.browser) await bridge.browser.forHost(offer.hostId).releaseLease(offer.tabKey, lease.leaseId, true);
      }
      await identityRequest((ids) => ids.fill(offer.offerId, loginId));
      forgetPasswordUi("offer", offer.offerId);
    } catch (e) { setError(t(passwordErrorKey(e))); }
    finally { setBusy(false); }
  }
  function dismiss() {
    void identityRequest((ids) => ids.dismissOffer(offer.offerId)).catch(() => {});
    forgetPasswordUi("offer", offer.offerId);
    onHide();
  }
  return (
    <div role="listbox" aria-label={t("browser.password.fillTitle")} data-browser-fill-offer={offer.offerId} data-browser-fill-granted={granted ? "" : undefined}
      className="float absolute z-30 w-[17rem] p-1 text-xs"
      style={{ left: Math.max(4, offer.field.x), top: offer.field.y + offer.field.height + 4, minWidth: Math.min(offer.field.width, 320) }}
      onKeyDown={(e) => { if (e.key === "Escape") dismiss(); }}>
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-caption text-subtle">
        <KeyRound size={11} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{t("browser.password.fillTitle")} · {siteOf(offer.origin)}</span>
        <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={dismiss} className="shrink-0 rounded p-0.5 hover:bg-hover hover:text-foreground"><X size={12} /></button>
      </div>
      {granted && <p role="note" className="px-2 pb-1.5 text-caption text-warn-text">{t("browser.password.grantedNote", { name: granted.agentName })}</p>}
      {offer.logins.map((login) => (
        <div key={login.id} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-hover">
          <UserRound size={13} className={`shrink-0 ${granted ? "text-subtle/60" : "text-subtle"}`} />
          <button type="button" role="option" aria-selected="false" data-browser-fill-login={login.id} disabled={busy || !!granted} onClick={() => void fill(login.id, false)}
            className="min-w-0 flex-1 truncate text-left text-foreground disabled:text-subtle">{login.username || t("browser.password.noUsername")}</button>
          {granted && <button type="button" data-browser-fill-take-back={login.id} disabled={busy} onClick={() => void fill(login.id, true)} className={`${btn({ size: "sm" })} shrink-0`}>{t("browser.password.takeBackAndFill")}</button>}
        </div>
      ))}
      <p className="px-2 pt-1 pb-0.5 text-caption text-subtle">{t("browser.password.helloNote")}</p>
      {error && <p role="alert" className="px-2 pb-1 text-danger">{error}</p>}
    </div>
  );
}
