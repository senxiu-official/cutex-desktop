// 额度重置券 rows (docs/design/012-reset-credits.md): the composer quota popover line, the settings 额度
// row and the exhausted-quota strip in the composer tray. Reading happens when one of them mounts (cached,
// lib/resetCredits); using one always goes through the confirm dialog (spendResetCredit).
import { useState } from "react";
import { Ticket } from "lucide-react";
import { addTombstone, hasTombstone, tombstoneKey, useTombstones } from "../lib/inputLedger/nextUpTombstones";
import { NEXT_UP_PANEL_CONTROLS, langOf } from "../lib/inputLedger/nextUpRegistry";
import type { QuotaGauge } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { expiryText, hasResetCredits, spendResetCredit, summaryText, useProfileResetCredits } from "../lib/resetCredits";
import { usableCredits, type ResetCreditsView } from "../../../shared/resetCredits";

/** A window gauge at 0 % left (and not stale): the limit is used up. */
export function quotaExhausted(gauges: readonly QuotaGauge[] | undefined): boolean {
  return !!gauges?.some((g) => g.kind === "window" && !g.stale && g.remainingPercent !== null && g.remainingPercent !== undefined && g.remainingPercent <= 0);
}

function UseButton({ onClick, busy, compact }: { onClick(): void; busy: boolean; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <button
      disabled={busy}
      onClick={onClick}
      data-testid="reset-credit-use"
      className={`shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs whitespace-nowrap text-foreground hover:text-accent disabled:opacity-50 ${compact ? "" : "border border-border"}`}
    >
      {busy ? t("resets.using") : t(compact ? "resets.useShort" : "resets.use")}
    </button>
  );
}

/** What the popover line says before / without a view: reading, could not read, or the provider has none. */
export function resetLineState(view: ResetCreditsView | null | undefined, error: string | null): "loading" | "error" | "unsupported" | "ready" {
  if (view === undefined) return error ? "error" : "loading";
  if (view === null || !view.supported) return "unsupported";
  return "ready";
}

/**
 * Composer quota popover: one line under the gauges, there from the moment the card opens (owner 2026-11-24: it used to
 * appear after the read and push the card). Its height never changes: 正在读取重置券… → 没有重置券 / 重置券 N 张 · 用一张
 * / 读不到重置券 / why this account has none, in place. An account already known to have none when the card opens
 * (an earlier read, cached) gets no line, as before; one found out while the card is open keeps its line (no shrink).
 */
export function ResetCreditsLine({ hostId, profile, afterReset }: { hostId: string; profile: string; afterReset(): void }) {
  const { t, locale } = useI18n();
  const { view, error, using } = useProfileResetCredits(hostId, profile, true);
  const state = resetLineState(view, error);
  // Decided per host + Profile, when that pair first shows here: an open card switched to another Profile asks again
  // (review 2026-11-24: B's coupons stayed hidden after A was known to have none).
  const shownFor = `${hostId}\u0000${profile}`;
  const [known, setKnown] = useState({ shownFor, unsupported: state === "unsupported" });
  if (known.shownFor !== shownFor) setKnown({ shownFor, unsupported: state === "unsupported" });
  if (known.shownFor === shownFor ? known.unsupported : state === "unsupported") return null;
  const text =
    state === "loading" ? t("resets.loading") : state === "error" ? t("resets.unknown") : view ? summaryText(view, t, locale) : t("resets.unsupported.provider");
  const has = state === "ready" && hasResetCredits(view);
  return (
    <div className="border-t border-border pt-2 text-xs" data-testid="reset-credits-line" data-reset-state={state} aria-busy={state === "loading" || undefined}>
      <div className="flex h-6 items-center gap-2">
        <Ticket size={13} className="shrink-0 text-subtle" />
        <span className={`min-w-0 flex-1 truncate ${has ? "" : "text-subtle"}`} title={(state === "error" ? error : view?.error) ?? text}>
          {text}
        </span>
        {has && view && <UseButton compact busy={using} onClick={() => void spendResetCredit({ hostId, profile, view, t, locale, afterReset })} />}
      </div>
    </div>
  );
}

/** Settings → 配置 → 额度: count, each credit's expiry, 「用一张」; unsupported accounts say why. */
export function ResetCreditsDetail({ hostId, profile, afterReset }: { hostId: string; profile: string; afterReset(): void }) {
  const { t, locale } = useI18n();
  const { view, error, using } = useProfileResetCredits(hostId, profile, true);
  if (view === undefined) return <span className="text-xs text-subtle" title={error ?? undefined}>{t(error ? "resets.unknown" : "resets.loading")}</span>;
  if (view === null) return <span className="text-xs text-subtle">{t("resets.unsupported.provider")}</span>;
  const rows = usableCredits(view);
  return (
    <span className="flex max-w-96 flex-col items-end gap-1 text-right" data-testid="reset-credits-detail">
      <span className="flex items-center gap-2">
        <span className={`text-sm ${view.supported && hasResetCredits(view) ? "" : "text-subtle"}`}>{summaryText(view, t, locale)}</span>
        {hasResetCredits(view) && <UseButton busy={using} onClick={() => void spendResetCredit({ hostId, profile, view, t, locale, afterReset })} />}
      </span>
      {rows.length > 0 && (
        <span className="flex flex-col items-end text-xs text-subtle">
          {rows.map((c) => (
            <span key={c.id}>
              {[c.title ?? t("resets.creditTitle"), c.resetsLeft > 1 ? t("resets.timesLeft", { n: c.resetsLeft }) : null, c.expiresAt ? t("resets.expires", { at: expiryText(c.expiresAt, locale) }) : t("resets.noExpiry")].filter(Boolean).join(" · ")}
            </span>
          ))}
          {!view.detailsComplete && (view.availableCount ?? 0) > rows.length && <span>{t("resets.more", { n: (view.availableCount ?? 0) - rows.length })}</span>}
        </span>
      )}
      {view.error && <span className="text-xs break-words text-danger">{view.error}</span>}
    </span>
  );
}

/** Composer tray strip when a window is used up and the account holds reset credits:
 *  「额度用完 · 有 2 张重置券 · 用一张重置券 · 收起」. 收起 (Next Up registry 1.4 §三) moves it away without using a
 *  credit; it is remembered on this computer until the number of credits changes. */
export function ResetOfferSection({ hostId, profile, afterReset }: { hostId: string; profile: string; afterReset(): void }) {
  const { t, locale } = useI18n();
  const { view, using } = useProfileResetCredits(hostId, profile, true);
  useTombstones();
  const hideKey = tombstoneKey(hostId, profile, "resetOffer", String(view?.availableCount ?? 0));
  if (!view || !hasResetCredits(view) || hasTombstone(hideKey)) return null;
  const hide = NEXT_UP_PANEL_CONTROLS.resetCredit.buttons[1][langOf(locale)];
  return (
    <div className="flex h-6 items-center gap-2 px-2 text-caption/[inherit] text-warn-text" data-testid="reset-offer">
      <Ticket size={12} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{t("resets.offer", { n: view.availableCount ?? 0 })}</span>
      <UseButton compact busy={using} onClick={() => void spendResetCredit({ hostId, profile, view, t, locale, afterReset })} />
      <button type="button" className="h-5 shrink-0 rounded px-1 text-subtle hover:bg-surface-2" data-testid="reset-offer-hide" onClick={() => addTombstone(hideKey)}>{hide}</button>
    </div>
  );
}

/** API-key profiles: only GLM / Z.ai get a line, saying their reset credits live in ZCode (nothing to use here). */
export function ResetCreditsUnsupportedRow({ hostId, profile }: { hostId: string; profile: string }) {
  const { t } = useI18n();
  const { view } = useProfileResetCredits(hostId, profile, true);
  if (view?.unsupportedReason !== "zcodeOnly") return null;
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm" data-testid="reset-credits-zcode">
      <span>{t("resets.title")}</span>
      <span className="text-right text-xs text-subtle">{t("resets.unsupported.zcodeOnly")}</span>
    </div>
  );
}
