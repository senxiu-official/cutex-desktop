import { useId, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Tag } from "../../components/Tag";
import { useI18n } from "../../i18n";
import { formatWhen, useClock } from "../../lib/time";
import type { DelegationRef, UpgradeApproval, UpgradeActor, UpgradeIntent, UpgradeNode, UpgradeSectionProps } from "./upgradeTypes";
import { partyName } from "./upgradeParty";
import { APPROVAL_TONE, BLOCK, CHECK, FIELD, GROUP_TITLE, SECTION_TITLE } from "./upgradeLook";

const field = `${FIELD} w-full`;
const modes = ["approvalRequired", "allowlistedOnly", "open"] as const;
const refKey = (ref: DelegationRef) => JSON.stringify([ref.hostId, ref.id]);

export function UpgradeRouting({ snapshot, busy, onAction }: UpgradeSectionProps) {
  const { t, locale } = useI18n();
  const now = useClock();
  const id = useId();
  const [requesterKey, setRequesterKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [rootKey, setRootKey] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const locked = busy || pending;
  const canUpdate = snapshot.policy.allowedActions.update;
  const canCreate = snapshot.grants.allowedActions.create;
  const nodes = snapshot.nodes.filter((node): node is UpgradeNode => node.kind === "delegation");
  const roots = nodes.filter(node => node.closed === null && node.lineageState === "verified" && !node.redactedParent
    && node.parentState === "none" && node.parent === null && node.rootState === "visible"
    && node.root !== null && refKey(node.root) === refKey(node.ref));
  const members = snapshot.parties;
  const reviews = snapshot.approvals;
  const requester = members.find(member => refKey(member) === requesterKey);
  const target = members.find(member => refKey(member) === targetKey);
  const root = roots.find(node => refKey(node.ref) === rootKey);
  const validGrant = requesterKey !== targetKey && requester !== undefined && target !== undefined && root !== undefined;
  const memberName = (ref: DelegationRef) => snapshot.parties.find(member => member.hostId === ref.hostId && member.id === ref.id)?.name
    ?? t("delegations.upgrade.routing.actorUnknown");
  const partyLabel = (ref: DelegationRef) => `${memberName(ref)} (${ref.hostId} · ${ref.id})`;
  function actorLabel(actor: UpgradeActor | null): string {
    if (actor === null) return t("delegations.upgrade.routing.actorUnknown");
    if (actor.kind === "owner") return t("delegations.upgrade.routing.actorOwner");
    if (actor.redacted) return t("delegations.upgrade.routing.actorRedacted");
    // Actor.name is the historical display snapshot, not an authorization source.
    return t("delegations.upgrade.routing.actorVisibleAgent", {
      name: actor.name ?? t("delegations.upgrade.routing.actorUnknown"), host: actor.hostId, id: actor.sessionId,
    });
  }

  async function run(intent: UpgradeIntent) {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    try { await onAction(intent); }
    catch { setFailed(true); }
    finally { inFlight.current = false; setPending(false); }
  }

  // `label: value` lines of an approval's audit (label quiet, value in the foreground).
  const fact = (label: string, value: string, wrap = "break-words", title?: string) => <p className={`${wrap} text-meta text-foreground`} title={title}><span className="text-subtle">{label}:</span> {value}</p>;
  // Decided at: the app's time label (lib/time formatWhen, like the delegation list); the exact ISO stays in the tooltip.
  const when = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? formatWhen(ms / 1000, now, locale) : iso;
  };
  return <section aria-labelledby={`${id}-title`} className="space-y-3">
    <h2 id={`${id}-title`} className={SECTION_TITLE}>{t("delegations.upgrade.routing.title")}</h2>
    {failed && <p role="alert" className="text-meta text-danger">{t("delegations.upgrade.routing.failed")}</p>}
    {reviews.length === 0 && <p className="text-meta text-subtle">{t("delegations.upgrade.routing.empty")}</p>}
    {reviews.map(compact => {
      const node = nodes.find(node => node.ref.hostId === compact.delegationRef.hostId && node.ref.id === compact.delegationRef.id);
      const approval = compact;
      const state = approval?.state ?? compact.state;
      const disabled = locked || state !== "pending" || !approval;
      return <article key={compact.id} className={`space-y-2 ${BLOCK}`}>
        <div className="flex min-w-0 items-start gap-2">
          <h3 className="min-w-0 flex-1 break-words text-ui font-medium">{node?.title ?? compact.id}</h3>
          {state !== "stale" && <Tag tone={APPROVAL_TONE[state]}>{t(`delegations.upgrade.routing.${state}`)}</Tag>}
        </div>
        <p className="break-words text-meta text-muted">{node ? `${partyName(node.requester) || t("delegations.upgrade.routing.actorUnknown")} → ${partyName(node.target) || t("delegations.upgrade.routing.actorUnknown")}` : `${compact.delegationRef.hostId} · ${compact.delegationRef.id}`}</p>
        {state === "stale" && <p className="text-meta text-warn-text">{t("delegations.upgrade.routing.stale")}</p>}
        {approval && <div className="space-y-0.5">
          {fact(t("delegations.upgrade.routing.requestedBy"), actorLabel(approval.requestedBy))}
          {fact(t("delegations.upgrade.routing.decidedBy"), actorLabel(approval.decidedBy))}
          {fact(t("delegations.upgrade.routing.decisionAuthority"), t(approval.decisionAuthority === "owner"
            ? "delegations.upgrade.routing.actorOwner" : approval.decisionAuthority === "director"
              ? "delegations.upgrade.routing.authorityDirector" : "delegations.upgrade.routing.authorityUnknown"))}
          {approval.decidedAt !== null && fact(t("delegations.upgrade.routing.decidedAt"), when(approval.decidedAt), "tabular-nums", approval.decidedAt)}
          {approval.decisionNote !== null && fact(t("delegations.upgrade.routing.decisionNote"), approval.decisionNote)}
        </div>
        }
        {/* Decided / stale approvals keep their (disabled) buttons in the DOM but not on screen: nothing to decide there. */}
        <div className="flex flex-wrap gap-2 pt-1" hidden={state !== "pending"}>
          <Button size="sm" variant="primary" disabled={disabled || !approval?.allowedActions.approve} onClick={() => approval && void run({ kind: "decision", approvalId: approval.id, decision: "approve", expectedDigest: approval.requestDigest, expectedRevision: approval.revision })}>{t("delegations.upgrade.routing.approve")}</Button>
          <Button size="sm" disabled={disabled || !approval?.allowedActions.deny} onClick={() => approval && void run({ kind: "decision", approvalId: approval.id, decision: "deny", expectedDigest: approval.requestDigest, expectedRevision: approval.revision })}>{t("delegations.upgrade.routing.deny")}</Button>
        </div>
      </article>;
    })}
    <fieldset disabled={locked || !canUpdate} className="space-y-1.5 pt-2">
      <legend className={`mb-1.5 ${SECTION_TITLE}`}>{t("delegations.upgrade.routing.policy")}</legend>
      {modes.map(mode => <label key={mode} className="flex w-fit cursor-pointer items-center gap-2 text-ui has-[:disabled]:cursor-default has-[:disabled]:opacity-60">
        <input type="radio" className={CHECK} name={`${id}-policy`} value={mode} checked={snapshot.policy.memberMode === mode} onChange={() => {
          if (canUpdate && !locked && mode !== snapshot.policy.memberMode) void run({ kind: "policy", memberMode: mode, expectedRevision: snapshot.policy.revision });
        }} />{t(`delegations.upgrade.routing.${mode}`)}
      </label>)}
    </fieldset>
    <div className="space-y-0.5">
      <p className="text-meta text-subtle">{t("delegations.upgrade.routing.openHint")}</p>
      <p className="text-meta text-subtle">{t("delegations.upgrade.routing.permissions")}</p>
    </div>
    <form className={`space-y-3 ${BLOCK}`} onSubmit={event => {
      event.preventDefault();
      if (canCreate && !locked && validGrant) void run({ kind: "grant", requesterRef: { hostId: requester.hostId, id: requester.id }, targetRefs: [{ hostId: target.hostId, id: target.id }], rootDelegationRef: root.ref, maxUses: 1 });
    }}>
      <div className="space-y-0.5">
        <h3 className="text-ui font-medium">{t("delegations.upgrade.routing.grantTitle")}</h3>
        <p className="text-meta text-subtle">{t("delegations.upgrade.routing.grantHint")}</p>
      </div>
      <fieldset disabled={locked || !canCreate} className="grid min-w-0 gap-3 sm:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-1 text-meta text-muted">{t("delegations.upgrade.routing.requester")}
          <select aria-label={t("delegations.upgrade.routing.requester")} required className={field} value={requesterKey} onChange={event => setRequesterKey(event.target.value)}>
            <option value="">{t("delegations.upgrade.routing.choose")}</option>
            {members.map(member => <option key={refKey(member)} value={refKey(member)}>{member.name} ({member.hostId} · {member.id})</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-meta text-muted">{t("delegations.upgrade.routing.target")}
          <select aria-label={t("delegations.upgrade.routing.target")} required className={field} value={targetKey} onChange={event => setTargetKey(event.target.value)}>
            <option value="">{t("delegations.upgrade.routing.choose")}</option>
            {members.map(member => <option key={refKey(member)} value={refKey(member)} disabled={refKey(member) === requesterKey}>{member.name} ({member.hostId} · {member.id})</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-meta text-muted">{t("delegations.upgrade.routing.root")}
          <select aria-label={t("delegations.upgrade.routing.root")} required className={field} value={rootKey} onChange={event => setRootKey(event.target.value)}>
            <option value="">{t("delegations.upgrade.routing.choose")}</option>
            {roots.map(node => <option key={refKey(node.ref)} value={refKey(node.ref)}>{node.title} ({node.hostId} · {node.id})</option>)}
          </select>
        </label>
      </fieldset>
      {requesterKey && requesterKey === targetKey && <p role="status" className="text-meta text-muted">{t("delegations.upgrade.routing.selfTarget")}</p>}
      <div className="flex justify-end"><Button type="submit" size="sm" disabled={locked || !canCreate || !validGrant}>{t("delegations.upgrade.routing.grant")}</Button></div>
    </form>
    <div>
      <h3 className={GROUP_TITLE}>{t("delegations.upgrade.routing.grants")}<span className="font-normal text-subtle tabular-nums">{snapshot.grants.items.length}</span></h3>
      {snapshot.grants.items.length === 0 && <p className="text-meta text-subtle">{t("delegations.upgrade.routing.noGrants")}</p>}
      <div className="space-y-2">
        {snapshot.grants.items.map(grant => <div key={grant.id} className={`flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 ${BLOCK}`}>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="break-words text-ui">{partyLabel(grant.requesterRef)} → {grant.targetRefs.map(partyLabel).join(", ")}</p>
            <p className="break-all text-meta text-muted">{t("delegations.upgrade.routing.root")}: {grant.rootDelegationRef.hostId} · {grant.rootDelegationRef.id}</p>
            <p className="text-meta text-muted">{t("delegations.upgrade.routing.remaining", { remaining: Math.max(0, grant.maxUses - grant.usedCount), max: grant.maxUses })}</p>
          </div>
          {grant.revokedAt !== null ? <Tag>{t("delegations.upgrade.routing.revoked")}</Tag> : <Button size="sm" danger disabled={locked || !grant.allowedActions.revoke} onClick={() => void run({ kind: "revoke", grantId: grant.id, expectedRevision: grant.revision })}>{t("delegations.upgrade.routing.revoke")}</Button>}
        </div>)}
      </div>
    </div>
  </section>;
}
