import { useEffect, useRef, useState } from "react";
import type { SessionBadge, SessionResource } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { isImeComposing } from "../lib/ime";
import { BadgeTextInput } from "./BadgeTextInput";
import { BADGE_TINTS, badgeDraft, validBadgeText } from "../lib/sessionBadge";
import { captureHostAction } from "../lib/hostSwitch";
import { closeMenu } from "../lib/contextMenu";
import { updateAgentBadge } from "../lib/menus";
import { showShelfToast } from "../lib/shelves";
import { Button } from "./Button";

/** Mounted only inside this agent's tray menu. Saving closes it at once (the badge is drawn before cutex answers,
 *  lib/menus updateAgentBadge); a failed save puts the old badge back and says why in the app's toast (lib/shelves:
 *  the tray has no conversation, where store `notify` shows). */
export function AgentBadgeEditor({ session, hostId }: { session: SessionResource; hostId: string }) {
  const { t } = useI18n();
  const [text, setText] = useState(session.badge?.text ?? "");
  const [tint, setTint] = useState<NonNullable<SessionBadge["tint"]>>(session.badge?.tint ?? "blue");
  const [composing, setComposing] = useState(false);
  const current = useRef(captureHostAction(hostId));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const live = () => mounted.current && current.current();
  const valid = !composing && validBadgeText(text);
  function save(value: SessionBadge | null) {
    if (!live()) return;
    closeMenu();
    updateAgentBadge(session, hostId, value).catch((e: unknown) => showShelfToast(t("info.badgeFailed", { reason: e instanceof Error ? e.message : String(e) })));
  }
  return <form aria-label={t("info.badgeMenu")} className="w-64 max-w-[calc(100vw-2rem)] space-y-2 p-2" onSubmit={(e) => { e.preventDefault(); if (valid && !isImeComposing(e)) save(badgeDraft(text, tint, session.badge)); }}
    onKeyDown={(e) => { e.stopPropagation(); if (composing || isImeComposing(e)) return; if (e.key === "Escape") { e.preventDefault(); closeMenu(); } }}>
    <label className="block text-xs text-muted">{t("info.badge")}<BadgeTextInput autoFocus aria-label={t("info.badge")} value={text} placeholder={t("info.badgePlaceholder")} onCompositionChange={setComposing}
      onChange={setText} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent" /></label>
    <label className="block text-xs text-muted">{t("info.badgeTint")}<select aria-label={t("info.badgeTint")} value={tint} onChange={(e) => setTint(e.target.value as typeof tint)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
      {BADGE_TINTS.map((c) => <option key={c} value={c}>{t(`info.badgeTint.${c}`)}</option>)}
    </select></label>
    <p className="text-xs text-subtle">{t("info.badgeHint")}</p>
    <div className="flex justify-end gap-1"><Button disabled={!session.badge && !text} onClick={() => save(null)}>{t("info.badgeClear")}</Button><Button type="submit" variant="primary" disabled={!valid}>{t("settings.save")}</Button></div>
  </form>;
}
