// NCI (Gadi PBS) checks in plain words on the 作业 page (cutex r296 `GET /v2/nci-verification`): when the host last
// verified a job with Gadi, and its estimate of the next check; completion notices waiting to be delivered and the last
// delivery error apart. Read for the focus host while the page is shown and the window visible (every minute). Hosts
// without the fields show only what they have; an unconfigured check shows nothing (its settings page says how).
import { useEffect, useState } from "react";
import type { NciVerificationStatus } from "../../../../shared/remoteJobs";
import { api } from "../../bridge";
import { useI18n, type Locale } from "../../i18n";
import { useOwnerWindow } from "../../lib/ownerContext";
import { formatAbsolute, formatAt, formatWhen, useClock } from "../../lib/time";

const POLL_MS = 60_000;

/** The words of an NCI check status (pure; test/jobsPhase1.test.ts): modules/jobs i18n keys with their values. `now` in ms. */
export function nciCheckWords(s: NciVerificationStatus, now: number, locale: Locale): { key: string; vars?: Record<string, string | number>; tone?: "danger" | "muted"; title?: string }[] {
  if (!s.configured) return [];
  if (!s.enabled) return [{ key: "jobs.nci.off", tone: "muted" }];
  const out: { key: string; vars?: Record<string, string | number>; tone?: "danger" | "muted"; title?: string }[] = [];
  const last = s.lastVerifiedAt ?? s.lastSuccessAt ?? null;
  out.push(last ? { key: "jobs.nci.lastVerified", vars: { at: formatWhen(last, now, locale) }, title: formatAbsolute(last) } : { key: "jobs.nci.neverVerified" });
  if (s.nextCheckAt !== undefined) out.push(s.nextCheckAt ? { key: "jobs.nci.nextCheck", vars: { at: formatAt(s.nextCheckAt, now) }, title: formatAbsolute(s.nextCheckAt) } : { key: "jobs.nci.noNextCheck", tone: "muted" });
  if (s.errorCode) out.push({ key: "jobs.nci.checkError", vars: { code: s.errorCode }, tone: "danger" });
  if ((s.pendingDeliveries ?? 0) > 0) out.push({ key: "jobs.nci.pending", vars: { n: s.pendingDeliveries! } });
  if (s.deliveryErrorCode) out.push({ key: "jobs.nci.deliveryError", vars: { code: s.deliveryErrorCode }, tone: "danger" });
  return out;
}

export function NciCheckLine() {
  const { t, locale } = useI18n();
  const win = useOwnerWindow();
  const now = useClock();
  const [status, setStatus] = useState<NciVerificationStatus | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      if (win.document.hidden) return;
      void api.nciVerification().then((r) => live && r.ok && setStatus(r.value)).catch(() => {});
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [win]);
  const words = status ? nciCheckWords(status, now, locale) : [];
  if (!words.length) return null;
  return (
    <p className="mb-1 flex flex-wrap items-center gap-x-1 px-1 text-xs text-muted" data-jobs-nci="">
      <span className="font-medium text-foreground">{t("jobs.nci.label")}</span>
      {words.map((w, i) => (
        <span key={w.key} title={w.title} className={w.tone === "danger" ? "text-danger" : w.tone === "muted" ? "text-subtle" : undefined}>
          {i > 0 ? "· " : ""}{t(w.key as Parameters<typeof t>[0], w.vars)}
        </span>
      ))}
    </p>
  );
}
