// Saved passwords in a tab (design browser-profiles v3 §8–§9): main's save / update prompts and fill offers, per tab.
// Display data only (usernames, origins, a field rectangle); passwords never reach the renderer. Every answer is a
// request main re-checks (owner input, origin, grant).
import { create } from "zustand";
import type { MessageKey } from "../../i18n";
import type { BrowserFillOfferView, BrowserIdentityEvent, BrowserPasswordPromptView } from "../../../../shared/browserIdentity";
import { onBrowserIdentityEvent } from "./identities";

export const passwordTabKey = (hostId: string, tabKey: string): string => `${hostId}\n${tabKey}`;

interface PasswordUi {
  prompts: Readonly<Record<string, BrowserPasswordPromptView>>;
  offers: Readonly<Record<string, BrowserFillOfferView>>;
}
export const usePasswordUi = create<PasswordUi>(() => ({ prompts: {}, offers: {} }));

export function applyPasswordEvent(event: BrowserIdentityEvent): void {
  const s = usePasswordUi.getState();
  if (event.kind === "passwordPrompt") {
    usePasswordUi.setState({ prompts: { ...s.prompts, [passwordTabKey(event.prompt.hostId, event.prompt.tabKey)]: event.prompt } });
  } else if (event.kind === "passwordPromptClosed") {
    const prompts = Object.fromEntries(Object.entries(s.prompts).filter(([, p]) => p.promptId !== event.promptId));
    usePasswordUi.setState({ prompts });
  } else if (event.kind === "fillOffer") {
    usePasswordUi.setState({ offers: { ...s.offers, [passwordTabKey(event.offer.hostId, event.offer.tabKey)]: event.offer } });
  } else if (event.kind === "fillOfferClosed") {
    const offers = Object.fromEntries(Object.entries(s.offers).filter(([, o]) => o.offerId !== event.offerId));
    usePasswordUi.setState({ offers });
  }
}

/** Follows main's password events; returns the unsubscribe (and forgets what was shown). */
export function watchPasswordUi(): () => void {
  const off = onBrowserIdentityEvent(applyPasswordEvent);
  return () => { off(); usePasswordUi.setState({ prompts: {}, offers: {} }); };
}

/** Drops a prompt / offer the renderer answered (main's closed event follows). */
export function forgetPasswordUi(kind: "prompt" | "offer", id: string): void {
  applyPasswordEvent(kind === "prompt" ? { kind: "passwordPromptClosed", promptId: id } : { kind: "fillOfferClosed", offerId: id });
}

const REFUSALS = ["auth_cancelled", "auth_unavailable", "key_lost", "tab_granted", "offer_closed", "origin_changed", "field_gone"] as const;
/** A refusal code from main's password service as owner-facing text (unknown codes: a generic line). */
export function passwordErrorKey(error: unknown): MessageKey {
  const raw = error instanceof Error ? error.message : String(error);
  const code = REFUSALS.find((c) => raw.includes(c));
  return (code ? `browser.password.error.${code}` : "browser.password.error.failed") as MessageKey;
}
