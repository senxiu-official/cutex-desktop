// 额度重置券 (cutex `profile-reset-credits`, docs/design/012-reset-credits.md): one shared view per host +
// profile, read on demand (a popover / settings row / exhausted strip mounting), never polled: cutex caches
// 60 s per account. Using one = the owner's click → app confirm dialog naming the account → consume with a
// fresh idempotency key → outcome toast → re-read the credits and the quota.
import { create } from "zustand";
import type { MessageKey } from "../i18n";
import { confirmDialog } from "./contextMenu";
import { hostApi } from "./hostLists";
import { showShelfToast } from "./shelves";
import { useApp } from "../store";
import { creditToUse, hasResetCredits as hasCredits, newIdempotencyKey, soonestExpiry, usableCredits, type ResetCreditsView, type ResetOutcome } from "../../../shared/resetCredits";
import { useEffect } from "react";

export { RESET_CREDITS_FEATURE, hasResetCredits } from "../../../shared/resetCredits";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** How long a view is reused before a mount reads again (cutex caches 60 s itself). */
const FRESH_MS = 60_000;

const keyOf = (hostId: string, profile: string) => `${hostId}\u0000${profile}`;

interface ResetState {
  views: Record<string, ResetCreditsView | null>;
  loading: Record<string, boolean>;
  using: Record<string, boolean>;
}

export const useResetCredits = create<ResetState>(() => ({ views: {}, loading: {}, using: {} }));
const loadedAt = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();

export function loadResetCredits(hostId: string, profile: string, refresh = false): Promise<void> {
  const key = keyOf(hostId, profile);
  const running = inflight.get(key);
  if (running && !refresh) return running;
  const at = loadedAt.get(key);
  if (!refresh && at !== undefined && Date.now() - at < FRESH_MS) return Promise.resolve();
  useResetCredits.setState((s) => ({ loading: { ...s.loading, [key]: true } }));
  const p = hostApi(hostId)
    .profileResetCredits(profile, refresh)
    .then(
      (view) => {
        loadedAt.set(key, Date.now());
        useResetCredits.setState((s) => ({ views: { ...s.views, [key]: view } }));
      },
      (e: unknown) => {
        loadedAt.set(key, Date.now());
        const prev = useResetCredits.getState().views[key];
        const error = e instanceof Error ? e.message : String(e);
        // Keep what we knew; show the failure on it.
        if (prev) useResetCredits.setState((s) => ({ views: { ...s.views, [key]: { ...prev, error } } }));
      },
    )
    .finally(() => {
      inflight.delete(key);
      useResetCredits.setState((s) => ({ loading: { ...s.loading, [key]: false } }));
    });
  inflight.set(key, p);
  return p;
}

/** The view for `profile` on `hostId`, read when `enabled` and not fresh. undefined = not read yet. */
export function useProfileResetCredits(hostId: string, profile: string | null, enabled: boolean): { view: ResetCreditsView | null | undefined; loading: boolean; using: boolean } {
  const key = profile ? keyOf(hostId, profile) : "";
  const view = useResetCredits((s) => (key ? s.views[key] : undefined));
  const loading = useResetCredits((s) => !!(key && s.loading[key]));
  const using = useResetCredits((s) => !!(key && s.using[key]));
  useEffect(() => {
    if (enabled && profile) void loadResetCredits(hostId, profile);
  }, [enabled, hostId, profile]);
  return { view: enabled ? view : undefined, loading, using };
}

/** "5月 3日" / "May 3" (+ time when within two days). */
export function expiryText(expiresAt: number, locale: string, now = Date.now()): string {
  const d = new Date(expiresAt * 1000);
  const soon = expiresAt * 1000 - now < 2 * 86_400_000;
  return soon ? d.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** One line: 「重置券 2 张 · 最早 5月 3日 到期」 / 「没有重置券」 / why it is not supported. */
export function summaryText(view: ResetCreditsView, t: T, locale: string): string {
  if (!view.supported) return t(`resets.unsupported.${view.unsupportedReason ?? "provider"}` as MessageKey);
  if (view.availableCount === null) return view.error ? t("resets.unknown") : t("resets.loading");
  if (view.availableCount <= 0) return t("resets.none");
  const soonest = soonestExpiry(view);
  return soonest !== null ? t("resets.countExpiring", { n: view.availableCount, at: expiryText(soonest, locale) }) : t("resets.count", { n: view.availableCount });
}

/** Whose limits a use resets: Codex = this profile's ChatGPT login; Claude = the Claude account (shared by its profiles). */
export function accountText(view: ResetCreditsView, t: T): string {
  if (view.provider === "claude") {
    const id = view.account?.id ?? "default";
    return id === "default" ? t("resets.account.claudeDefault") : t("resets.account.claude", { id });
  }
  return t("resets.account.codex", { profile: view.profile.name });
}

/** The confirm dialog's text (cannot be undone; which account; what is left). */
export function confirmText(view: ResetCreditsView, t: T, locale: string): string {
  const credit = usableCredits(view)[0];
  const lines = [
    t("resets.confirm.title"),
    t("resets.confirm.account", { account: accountText(view, t) }),
    t(view.provider === "claude" ? "resets.confirm.effectClaude" : "resets.confirm.effectCodex"),
    credit?.expiresAt ? t("resets.confirm.leftExpiring", { n: view.availableCount ?? 0, at: expiryText(credit.expiresAt, locale) }) : t("resets.confirm.left", { n: view.availableCount ?? 0 }),
    t("resets.confirm.final"),
  ];
  return [lines[0], lines.slice(1).join("\n")].join("\n\n");
}

export function outcomeText(outcome: ResetOutcome, t: T, left: number | null): string {
  if (outcome === "reset" || outcome === "alreadyRedeemed") return left !== null ? t("resets.outcome.resetLeft", { n: left }) : t("resets.outcome.reset");
  return t(`resets.outcome.${outcome}` as MessageKey);
}

// A click whose reply never came may still have used a credit: its retry reuses the key, so cutex /
// the provider answer alreadyRedeemed instead of using a second one.
const uncertainKeys = new Map<string, { key: string; at: number }>();
const RETRY_KEY_MS = 15 * 60_000;

/** The owner clicked 「用一张」: confirm, use, toast, re-read. Never called without a click. */
export async function spendResetCredit(o: { hostId: string; profile: string; view: ResetCreditsView; t: T; locale: string; afterReset?: () => void }): Promise<void> {
  const { hostId, profile, view, t, locale } = o;
  const key = keyOf(hostId, profile);
  if (useResetCredits.getState().using[key]) return;
  const ok = await confirmDialog(confirmText(view, t, locale), true, { ok: t("resets.confirm.ok"), cancel: t("dialog.cancel") });
  if (!ok) return;
  const pending = uncertainKeys.get(key);
  const idempotencyKey = pending && Date.now() - pending.at < RETRY_KEY_MS ? pending.key : newIdempotencyKey();
  uncertainKeys.set(key, { key: idempotencyKey, at: pending?.key === idempotencyKey ? pending.at : Date.now() });
  useResetCredits.setState((s) => ({ using: { ...s.using, [key]: true } }));
  try {
    const result = await hostApi(hostId).consumeResetCredit(profile, { idempotencyKey, creditId: creditToUse(view) });
    uncertainKeys.delete(key);
    const left = result.resetsLeft ?? (view.availableCount !== null ? Math.max(0, view.availableCount - 1) : null);
    showShelfToast(outcomeText(result.outcome, t, result.outcome === "reset" || result.outcome === "alreadyRedeemed" ? left : null));
    if (result.outcome === "reset" || result.outcome === "alreadyRedeemed") o.afterReset?.();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A refusal before anything ran (bad request / unsupported / one already running) is certain.
    if (/\b(400|409)\b/.test(message)) uncertainKeys.delete(key);
    useApp.getState().notify(t("resets.outcome.failed", { error: message }), "error");
  } finally {
    useResetCredits.setState((s) => ({ using: { ...s.using, [key]: false } }));
    void loadResetCredits(hostId, profile, true);
  }
}

/** The exhausted strip shows: the feature is on, a window is used up, and the account holds credits. */
export function useResetOffer(hostId: string, profile: string | null, enabled: boolean): boolean {
  const { view } = useProfileResetCredits(hostId, profile, enabled);
  return enabled && hasCredits(view);
}
