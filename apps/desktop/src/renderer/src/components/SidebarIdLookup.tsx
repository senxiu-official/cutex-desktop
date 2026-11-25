// The sidebar search's delegation-id results (lib/delegationIdSearch): each delegation of that id on the hosts in view,
// with its status. The row opens its detail on the right side; the parties open their agents and 跳到委托卡片 goes to
// the card in the requesting agent's conversation. Always the record's host and ask id, never a match by title.
import { ArrowLeftRight, ArrowRight, Loader2 } from "lucide-react";
import { useI18n } from "../i18n";
import { useApp } from "../store";
import type { HostLook } from "../lib/hostScope";
import { delegationStatus, isOwnerRequest, requesterName, requesterSession } from "../lib/delegations";
import { openDelegationDetail } from "../lib/delegationOpen";
import { focusDelegation } from "../lib/focusRequest";
import { LIST_LIMIT, useDelegationIdSearch, type DelegationIdHit } from "../lib/delegationIdSearch";
import { DelegationStatusMark, DelegationTag } from "./DelegationParts";

/** The id lookup results in the sidebar (components/Sidebar names no feature). */
export function IdLookupResults({ lookOf, multi }: { lookOf: (hostId: string) => HostLook | undefined; multi: boolean }) {
  const { t } = useI18n();
  const run = useDelegationIdSearch((s) => s.run);
  const hits = useDelegationIdSearch((s) => s.hits);
  if (!run) return null;
  const pending = run.pending.length > 0;
  return (
    <section data-delegation-id="" className="mb-1.5 flex flex-col border-b border-border pb-1.5">
      <div className="flex items-center gap-1 px-2 pt-1">
        <span className="min-w-0 flex-1 truncate text-caption font-semibold text-muted">{t("sidebar.delegationId.title", { id: `#${run.query.text}` })}</span>
        {hits.length > 1 && <span className="text-caption text-subtle tabular-nums">{hits.length}</span>}
      </div>
      <ul role="list" className="flex flex-col">
        {hits.map((hit) => <DelegationIdRow key={`${hit.hostId}\n${hit.d.askId}`} hit={hit} host={multi ? lookOf(hit.hostId) : undefined} />)}
      </ul>
      <div data-delegation-id-status="" className="flex flex-col gap-0.5 px-2 pb-1 text-caption text-subtle" aria-live="polite">
        {pending && <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden />{t("sidebar.delegationId.searching")}</span>}
        {!pending && hits.length === 0 && run.failed.length === 0 && <span data-delegation-id-none="">{t("sidebar.delegationId.none")}</span>}
        {!pending && run.truncated && <span data-delegation-id-truncated="">{t("sidebar.delegationId.truncated", { n: LIST_LIMIT })}</span>}
        {/* r296: a host cut its short-id candidates — a longer id narrows them (shown while others still answer too). */}
        {run.hasMore && <span data-delegation-id-more="">{t("sidebar.delegationId.hasMore")}</span>}
        {run.failed.length > 0 && <span data-delegation-id-failed="">{t("sidebar.delegationId.failed", { hosts: run.failed.map((id) => lookOf(id)?.label ?? id).join("、") })}</span>}
      </div>
    </section>
  );
}

function DelegationIdRow({ hit, host }: { hit: DelegationIdHit; host: HostLook | undefined }) {
  const { t } = useI18n();
  const { hostId, d } = hit;
  const requester = requesterSession(d.requester);
  const fromAgent = d.requester.kind === "agent" && !!requester;
  const targetName = d.targetName || d.target;
  const openAgent = (sessionId: string) => void useApp.getState().openAgent(sessionId, hostId);
  // Its card is in the requesting agent's conversation; the detail first, the card when the detail cannot open here.
  const openDetail = () => openDelegationDetail(hostId, d.askId, { title: d.title, fallback: () => (fromAgent ? focusDelegation(requester!, d.askId, hostId) : openAgent(d.target)) });
  const party = "min-w-0 truncate rounded-sm hover:text-foreground hover:underline";
  return (
    <li className="flex min-w-0 flex-col gap-0.5 rounded-ctl px-2 py-1 hover:bg-hover" data-delegation-id-hit={d.askId}>
      <div className="flex min-w-0 items-center gap-1.5">
        <ArrowLeftRight size={13} className="shrink-0 text-accent" aria-hidden />
        <button type="button" onClick={openDetail} data-tip={t("sidebar.delegationId.openDetail")} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-ui">
          <DelegationTag askId={d.askId} />
          <span className="min-w-0 truncate font-medium">{d.title || d.askId}</span>
        </button>
        <DelegationStatusMark status={delegationStatus(d)} name={targetName} className="shrink-0" />
      </div>
      <div className="flex min-w-0 items-center gap-1 pl-5 text-caption text-subtle">
        {isOwnerRequest(d.requester) ? (
          <span className="shrink-0">{t("delegation.you")}</span>
        ) : fromAgent ? (
          <button type="button" className={party} data-tip={t("delegation.open", { name: requesterName(d.requester) ?? requester! })} onClick={() => openAgent(requester!)} data-delegation-id-requester="">{requesterName(d.requester) ?? requester}</button>
        ) : (
          <span className="min-w-0 truncate">{requesterName(d.requester) ?? ""}</span>
        )}
        <ArrowRight size={10} className="shrink-0" aria-hidden />
        {d.target && !d.remote ? (
          <button type="button" className={party} data-tip={t("delegation.open", { name: targetName })} onClick={() => openAgent(d.target)} data-delegation-id-target="">{targetName}</button>
        ) : (
          <span className="min-w-0 truncate">{d.remote?.targetName || targetName}</span>
        )}
        {host && (
          <>
            <span aria-hidden>·</span>
            <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ backgroundColor: host.color }} aria-hidden />
            <span className="truncate">{host.label}</span>
          </>
        )}
        {fromAgent && (
          <button type="button" className="ml-auto shrink-0 text-accent hover:underline" onClick={() => focusDelegation(requester!, d.askId, hostId)} data-delegation-id-card="">{t("delegation.jumpCard")}</button>
        )}
      </div>
    </li>
  );
}
