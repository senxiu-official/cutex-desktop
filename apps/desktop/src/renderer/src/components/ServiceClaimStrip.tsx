// 认领候选 of a project (cutex `services-project-scope`, owner; lib/projectServices claimCandidates): the
// project's session services whose registrant is a former Director, archived, gone or no longer a
// member — one click (armed: medium risk) turns one, or all, into a project service the current Director
// manages. Shown in the Shelf project view and on the project page's 服务 tab; nothing on older hosts or
// when there is nothing to claim. Its keys live in the services module's catalog like the service menu's.
import { useMemo, useState } from "react";
import { useArchivedAgents } from "../lib/useArchivedAgents";
import { Globe } from "lucide-react";
import { apiFor } from "../bridge";
import { useI18n, type MessageKey } from "../i18n";
import { SERVICES_PROJECT_SCOPE_FEATURE } from "../../../shared/servicesSettings";
import { claimCandidates, scopePatch, type ClaimCandidate } from "../lib/projectServices";
import { useHostData } from "../lib/useHostScope";
import { ArmedButton } from "./ArmedButton";

const SHAPE = "shrink-0 rounded-md px-2 py-0.5 text-caption/[inherit]";
const IDLE = "border border-border text-muted hover:bg-hover hover:text-foreground disabled:opacity-50";

export function ServiceClaimStrip({ hostId, projectId, formerDirectors, className = "" }: { hostId: string; projectId: string; formerDirectors?: ReadonlySet<string>; className?: string }) {
  const { t } = useI18n();
  const data = useHostData(hostId);
  useArchivedAgents(hostId);
  const supported = data?.features.has(SERVICES_PROJECT_SCOPE_FEATURE) ?? false;
  const candidates = useMemo(() => (supported ? claimCandidates(data?.services, projectId, data?.sidebar, formerDirectors) : []), [supported, data?.services, data?.sidebar, projectId, formerDirectors]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!candidates.length) return null;
  const nameOf = (id: string | null) => (id && [...(data?.sidebar?.active ?? []), ...(data?.sidebar?.retired ?? [])].find((s) => s.cutexSessionId === id)?.displayName) || id;
  const claim = async (items: readonly ClaimCandidate[]) => {
    setBusy(true);
    setError("");
    const results = await Promise.allSettled(items.map(({ service }) => apiFor(hostId).patchService(service.slug, scopePatch(service, "project")!)));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) setError(failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
    setBusy(false);
  };
  return (
    <section data-testid="service-claims" aria-label={t("services.claim.title")} className={`rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-meta/[inherit] ${className}`}>
      <div className="flex items-center gap-2">
        <Globe size={13} className="shrink-0 text-warn-text" aria-hidden />
        <b className="min-w-0 flex-1 truncate">{t("services.claim.title")} · {candidates.length}</b>
        {candidates.length > 1 && (
          <ArmedButton shape={SHAPE} idle={IDLE} disabled={busy} testId="service-claim-all" hint={t("services.claim.allArmed", { n: candidates.length })} onConfirm={() => void claim(candidates)}>
            {t("services.claim.all")}
          </ArmedButton>
        )}
      </div>
      <p className="mt-0.5 text-caption/[inherit] text-subtle">{t("services.claim.hint")}</p>
      <ul className="mt-1.5">
        {candidates.map((c) => (
          <li key={c.service.slug} data-claim={c.service.slug} className="flex min-w-0 items-center gap-2 border-t border-border/60 py-1 first:border-t-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground">{c.service.displayName || c.service.slug}</span>
              <span className="block truncate text-caption/[inherit] text-subtle">
                {c.service.ownerCutexSessionId ? t("services.owner", { name: nameOf(c.service.ownerCutexSessionId) ?? "" }) + " · " : ""}
                {t(`services.claim.reason.${c.reason}` as MessageKey)}
              </span>
            </span>
            <ArmedButton shape={SHAPE} idle={IDLE} disabled={busy} testId={`service-claim-${c.service.slug}`} hint={t("services.claim.armed")} onConfirm={() => void claim([c])}>
              {t("services.claim.one")}
            </ArmedButton>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 text-warn-text">{error}</p>}
    </section>
  );
}
