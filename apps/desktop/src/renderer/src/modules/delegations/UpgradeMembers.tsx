import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/Button";
import { Tag } from "../../components/Tag";
import { useI18n } from "../../i18n";
import type { PermanentRetirementReview, UpgradeIntent, UpgradeMember, UpgradeSectionProps, UpgradeSnapshot } from "./upgradeTypes";
import type {} from "./upgradeMemberMessages";
import { AgentAvatar } from "./UpgradeParts";
import { CHECK, CHOICE, DANGER_SOLID, DIALOG, FIELD, GROUP_TITLE, SECTION_TITLE } from "./upgradeLook";
import { useOverlayRoot } from "../../lib/ownerContext";

const groups = ["active", "soft", "permanent", "unknown"] as const;
const groupKeys = {
  active: "delegations.upgrade.members.active",
  soft: "delegations.upgrade.members.soft",
  permanent: "delegations.upgrade.members.permanent",
  unknown: "delegations.upgrade.members.unknown",
} as const;
const identity = (member: UpgradeMember) => JSON.stringify([member.hostId, member.id]);
const clearlyIdle = (member: UpgradeMember) => member.activityStatus === "idle"
  && typeof member.lastActivityAt === "string" && typeof member.observedAt === "string"
  && Date.parse(member.observedAt) - Date.parse(member.lastActivityAt) >= 7_200_000;
type Caller = UpgradeSnapshot["caller"];
const canArchive = (member: UpgradeMember, caller: Caller, supported = false) => supported && caller.canManageMembers && member.archiveKind === "active" && member.allowedActions?.includes("archive");
const canRetire = (member: UpgradeMember, caller: Caller, supported = false) => supported && caller.isOwner
  && (member.archiveKind === "active" || member.archiveKind === "soft") && member.allowedActions?.includes("permanentRetire");
const blockerKey = (code: string) => {
  switch (code) {
    case "preview_runtime_unavailable":
    case "runtime_unavailable": return "delegations.upgrade.members.blocker.runtime";
    case "owns_services": return "delegations.upgrade.members.blocker.services";
    case "active_delegations": return "delegations.upgrade.members.blocker.delegations";
    case "permission_denied": return "delegations.upgrade.members.blocker.permission";
    case "agent_name_taken": return "delegations.upgrade.members.blocker.nameTaken";
    case "restore_project_first": return "delegations.upgrade.members.blocker.project";
    case "archive_state_unavailable": return "delegations.upgrade.members.blocker.archiveState";
    case "permanently_closed": return "delegations.upgrade.members.blocker.permanent";
    case "runtime_not_offline": return "delegations.upgrade.members.blocker.offline";
    case "not_archived": return "delegations.upgrade.members.blocker.notArchived";
    default: return "delegations.upgrade.members.blocker.unknown";
  }
};
type Mode = "archive" | "retire";
const reviewValid = (review: PermanentRetirementReview | undefined, memberId: string) => !!review
  && review.cutex_session_id === memberId && typeof review.confirmation_token === "string" && review.confirmation_token.length > 0
  && typeof review.formal_name === "string" && review.formal_name.length > 0
  && Number.isSafeInteger(review.revision) && review.revision >= 0
  && Number.isSafeInteger(review.runtime_generation) && review.runtime_generation >= 0
  && Number.isSafeInteger(review.expires_at_unix) && review.expires_at_unix > Date.now() / 1000;
const confirmationFailures = new Set([
  "archive_confirmation_invalid", "archive_confirmation_expired", "archive_confirmation_stale",
  "archive_confirmation_target_revision_mismatch", "archive_confirmation_occurrence_changed",
  "archive_confirmation_already_used", "archive_confirmation_capacity", "permanent_retirement_name_confirmation_required",
]);
const needsReview = (error: unknown) => {
  if (error instanceof Error && confirmationFailures.has(error.message)) return true;
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" && confirmationFailures.has(error.code);
};

function ArchiveDialog({ targets, snapshot, busy, onAction, reviewRetirement, archiveSupported = false, onClose, onCompleted }: UpgradeSectionProps & {
  targets: UpgradeMember[]; onClose(): void; onCompleted(key: string): void;
}) {
  const overlayRoot = useOverlayRoot();
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const latest = useRef({ snapshot, archiveSupported, reviewRetirement });
  latest.current = { snapshot, archiveSupported, reviewRetirement };
  const titleId = useId();
  const hintId = useId();
  const [mode, setMode] = useState<Mode>("archive");
  const [names, setNames] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviews, setReviews] = useState<Record<string, PermanentRetirementReview>>({});
  const reviewSequence = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const remaining = targets.filter(member => !completed.has(identity(member)));
  const current = (target: UpgradeMember) => snapshot.members.find(member => identity(member) === identity(target) && member.name === target.name);
  const permitted = (target: UpgradeMember, choice: Mode) => {
    const member = current(target);
    return !!member && (choice === "archive" ? canArchive(member, snapshot.caller, archiveSupported) : !!reviewRetirement && canRetire(member, snapshot.caller, archiveSupported));
  };
  const softAllowed = remaining.every(member => permitted(member, "archive"));
  const retireAllowed = remaining.every(member => permitted(member, "retire"));
  const valid = remaining.length > 0 && remaining.every(member => (mode === "archive"
    || (reviewValid(reviews[identity(member)], member.id) && names[identity(member)] === reviews[identity(member)]?.formal_name)) && permitted(member, mode));
  const disabled = busy || sending || reviewing;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => { reviewSequence.current += 1; element.close(); };
  }, []);
  useEffect(() => {
    const values = Object.values(reviews);
    if (mode !== "retire" || values.length === 0) return;
    const delay = Math.max(0, Math.min(...values.map(review => review.expires_at_unix * 1000)) - Date.now());
    const timer = setTimeout(() => {
      setReviews({});
      setNames({});
      setError(t("delegations.upgrade.members.reviewAgain"));
    }, delay);
    return () => clearTimeout(timer);
  }, [mode, reviews, t]);
  const changeMode = async (choice: Mode) => {
    if (disabled || lock.current) return;
    setMode(choice);
    setReviews({});
    setNames({});
    setError(null);
    const sequence = ++reviewSequence.current;
    if (choice !== "retire") return;
    if (!reviewRetirement || !retireAllowed) {
      setError(t("delegations.upgrade.members.reviewAgain"));
      return;
    }
    lock.current = true;
    setReviewing(true);
    try {
      const next: Record<string, PermanentRetirementReview> = {};
      for (const member of remaining) {
        const live = latest.current.snapshot.members.find(value => identity(value) === identity(member) && value.name === member.name);
        if (!live || !canRetire(live, latest.current.snapshot.caller, latest.current.archiveSupported) || !latest.current.reviewRetirement) throw new Error("archive_confirmation_stale");
        const review = await reviewRetirement({ cutex_session_id: member.id });
        if (sequence !== reviewSequence.current) return;
        const after = latest.current.snapshot.members.find(value => identity(value) === identity(member) && value.name === member.name);
        if (!after || !canRetire(after, latest.current.snapshot.caller, latest.current.archiveSupported) || !latest.current.reviewRetirement || !reviewValid(review, member.id)) throw new Error("archive_confirmation_stale");
        // Tokens stay in this mounted dialog only. Copy the six contract fields, never persist them.
        next[identity(member)] = {
          confirmation_token: review.confirmation_token, cutex_session_id: review.cutex_session_id,
          formal_name: review.formal_name, revision: review.revision, runtime_generation: review.runtime_generation,
          expires_at_unix: Math.min(review.expires_at_unix, Math.floor(Date.now() / 1000) + 300),
        };
      }
      setReviews(next);
    } catch (cause) {
      const pending = (cause instanceof Error && cause.message === "permanent_retirement_pending")
        || (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "permanent_retirement_pending");
      if (sequence === reviewSequence.current) setError(t(pending
        ? "delegations.upgrade.members.retirementFailed" : "delegations.upgrade.members.reviewAgain"));
    } finally {
      lock.current = false;
      if (sequence === reviewSequence.current) setReviewing(false);
    }
  };
  const submit = async () => {
    if (disabled || lock.current || !valid) return;
    lock.current = true;
    setSending(true);
    setError(null);
    try {
      for (const member of remaining) {
        const live = latest.current.snapshot.members.find(value => identity(value) === identity(member) && value.name === member.name);
        if (!live || !(mode === "archive" ? canArchive(live, latest.current.snapshot.caller, latest.current.archiveSupported)
          : !!latest.current.reviewRetirement && canRetire(live, latest.current.snapshot.caller, latest.current.archiveSupported))) {
          setError(t("delegations.upgrade.members.changed"));
          return;
        }
        if (mode === "archive") {
          await onAction({ kind: "archive", memberId: member.id });
        } else {
          const review = reviews[identity(member)];
          if (!reviewValid(review, member.id) || !review || names[identity(member)] !== review.formal_name) {
            setReviews({}); setNames({});
            setError(t("delegations.upgrade.members.reviewAgain"));
            return;
          }
          await onAction({ kind: "retire", payload: {
            cutex_session_id: member.id, confirmed_name: names[identity(member)]!,
            confirmation_token: review.confirmation_token, expected_revision: review.revision,
          } });
        }
        setCompleted(previous => new Set([...previous, identity(member)]));
        onCompleted(identity(member));
      }
      onClose();
    } catch (cause) {
      if (mode === "retire") { setReviews({}); setNames({}); }
      setError(t(mode === "retire" && needsReview(cause) ? "delegations.upgrade.members.reviewAgain"
        : mode === "retire" ? "delegations.upgrade.members.retirementFailed" : "delegations.upgrade.members.failed"));
    } finally {
      lock.current = false;
      setSending(false);
    }
  };
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} aria-describedby={hintId}
    onCancel={event => { event.preventDefault(); if (!disabled) onClose(); }}
    className={DIALOG}>
    <h2 id={titleId} className="text-title">{t("delegations.upgrade.members.confirmTitle")}</h2>
    <fieldset disabled={disabled} className="mt-4 space-y-2">
      <legend className="mb-2 text-meta text-muted">{t("delegations.upgrade.members.mode")}</legend>
      <label className={CHOICE}><input type="radio" className={CHECK} name={titleId} checked={mode === "archive"} disabled={!softAllowed} onChange={() => void changeMode("archive")} />{t("delegations.upgrade.members.softChoice")}</label>
      {snapshot.caller.isOwner && <label className={`${CHOICE} has-[:checked]:border-danger has-[:checked]:bg-danger-soft`}><input type="radio" className={CHECK} name={titleId} checked={mode === "retire"} disabled={!retireAllowed} onChange={() => void changeMode("retire")} />{t("delegations.upgrade.members.permanentChoice")}</label>}
    </fieldset>
    <p id={hintId} className="mt-3 text-meta text-muted">{t(mode === "archive" ? "delegations.upgrade.members.softHint" : "delegations.upgrade.members.namesHint")}</p>
    {mode === "archive" ? <ul className="mt-3 space-y-1">{remaining.map(member => <li key={identity(member)} className="flex min-w-0 items-center gap-2 break-words rounded-ctl bg-background px-2.5 py-1.5"><AgentAvatar id={member.id} name={member.name} size={20} /><span className="min-w-0 break-words"><span className="font-medium">{member.name}</span><span className="text-muted"> · {member.hostId}</span></span></li>)}</ul> : remaining.map(member => <label key={identity(member)} className="mt-3 block break-words text-meta text-muted">
      {t("delegations.upgrade.members.confirmName", { name: reviews[identity(member)]?.formal_name ?? member.name, host: member.hostId })}
      <input value={names[identity(member)] ?? ""} disabled={disabled || !reviewValid(reviews[identity(member)], member.id)} autoComplete="off" spellCheck={false}
        onChange={event => setNames(previous => ({ ...previous, [identity(member)]: event.target.value }))}
        className={`${FIELD} mt-1 block w-full`} />
    </label>)}
    {!softAllowed && !retireAllowed && <p role="status" className="mt-3 text-meta text-muted">{t("delegations.upgrade.members.changed")}</p>}
    {error && <p role="alert" className="mt-3 text-meta text-danger">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <Button disabled={disabled} onClick={onClose}>{t("delegations.upgrade.members.cancel")}</Button>
      {mode === "archive"
        ? <Button variant="primary" disabled={disabled || !valid} onClick={() => void submit()}>{t("delegations.upgrade.members.submitSoft")}</Button>
        : <button type="button" className={DANGER_SOLID} disabled={disabled || !valid} onClick={() => void submit()}>{t("delegations.upgrade.members.submitPermanent")}</button>}
    </div>
  </dialog>, overlayRoot);
}

const statusTone = { busy: "accent", idle: "attention" } as const;

export function UpgradeMembers(props: UpgradeSectionProps) {
  const { snapshot, busy, onAction } = props;
  const { t } = useI18n();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [targets, setTargets] = useState<UpgradeMember[] | null>(null);
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || sending;
  const candidates = snapshot.members.filter(member => selected.has(identity(member)) && (canArchive(member, snapshot.caller, props.archiveSupported) || (!!props.reviewRetirement && canRetire(member, snapshot.caller, props.archiveSupported))));
  const removeSelection = (key: string) => setSelected(previous => new Set([...previous].filter(value => value !== key)));
  const act = async (intent: UpgradeIntent) => {
    if (disabled || lock.current) return;
    lock.current = true;
    setSending(true);
    setError(null);
    try { await onAction(intent); }
    catch { setError(t("delegations.upgrade.members.failed")); }
    finally { lock.current = false; setSending(false); }
  };
  return <section aria-label={t("delegations.upgrade.members.title")} className="space-y-3">
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
      <h2 className={SECTION_TITLE}>{t("delegations.upgrade.members.title")}</h2>
      <Button size="sm" disabled={disabled || candidates.length === 0} onClick={() => setTargets(candidates)}>{t("delegations.upgrade.members.batch", { n: candidates.length })}</Button>
    </div>
    {error && <p role="alert" className="text-meta text-danger">{error}</p>}
    {groups.map(group => {
      const members = snapshot.members.filter(member => (member.archiveKind ?? "unknown") === group);
      return <section key={group} aria-label={t(groupKeys[group])}>
        <h3 className={GROUP_TITLE}>{t(groupKeys[group])}<span className="font-normal text-subtle tabular-nums">{members.length}</span></h3>
        {members.length === 0 ? <p className="px-2 text-meta text-subtle">{t("delegations.upgrade.members.empty")}</p> : <ul className="space-y-px">{members.map(member => {
          const idle = props.activitySupported === true && snapshot.caller.canOfflineMembers && clearlyIdle(member);
          const archivable = canArchive(member, snapshot.caller, props.archiveSupported) || (!!props.reviewRetirement && canRetire(member, snapshot.caller, props.archiveSupported));
          const statusKey = idle ? "delegations.upgrade.members.idle" : member.activityStatus === "busy" ? "delegations.upgrade.members.busy"
            : member.activityStatus === "idle" ? "delegations.upgrade.members.idleRecent" : member.activityStatus === "offline" ? "delegations.upgrade.members.offlineStatus" : "delegations.upgrade.members.activityUnknown";
          const tone = idle ? statusTone.idle : member.activityStatus === "busy" ? statusTone.busy : null;
          return <li key={identity(member)} className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-ctl px-2 py-1 hover:bg-hover">
            {archivable ? <input type="checkbox" className={CHECK} aria-label={t("delegations.upgrade.members.select", { name: member.name, host: member.hostId })}
              checked={selected.has(identity(member))} disabled={disabled} onChange={event => {
                const checked = event.target.checked;
                setSelected(previous => { const next = new Set(previous); if (checked) next.add(identity(member)); else next.delete(identity(member)); return next; });
              }} /> : <span className="size-3.5 shrink-0" aria-hidden />}
            <span className={group === "active" ? "" : "opacity-60 grayscale"}><AgentAvatar id={member.id} name={member.name} size={20} /></span>
            <span className="min-w-0 truncate text-ui font-medium">{member.name}</span>
            <span className="min-w-0 truncate text-meta text-subtle">{member.hostId}</span>
            {member.director && <Tag>{t("delegations.upgrade.members.director")}</Tag>}
            {props.activitySupported && (group === "active" || !props.archiveSupported) && (tone
              ? <Tag data-idle={idle} tone={tone}>{t(statusKey)}</Tag>
              : <span data-idle={idle} className="min-w-0 truncate text-meta text-subtle">{t(statusKey)}</span>)}
            <div className="ml-auto flex shrink-0 gap-1.5">
              {(member.archiveKind === undefined || member.archiveKind === "active") && idle && snapshot.caller.canOfflineMembers && <Button size="sm" disabled={disabled} onClick={() => void act({ kind: "offline", memberId: member.id })}>{t("delegations.upgrade.members.offline")}</Button>}
              {archivable && <Button size="sm" disabled={disabled} onClick={() => setTargets([member])}>{t("delegations.upgrade.members.archive")}</Button>}
              {props.archiveSupported === true && group === "soft" && member.restorable && member.allowedActions?.includes("restore") && (member.restoreBlockers?.length ?? 0) === 0 && snapshot.caller.canManageMembers && <Button size="sm" disabled={disabled} onClick={() => void act({ kind: "restore", memberId: member.id })}>{t("delegations.upgrade.members.restore")}</Button>}
            </div>
            {group === "soft" && (member.restoreBlockers?.length ?? 0) > 0 && <p className="w-full pl-[3.125rem] text-meta text-warn-text">{t("delegations.upgrade.members.blockers", { reasons: [...new Set((member.restoreBlockers ?? []).map(code => t(blockerKey(code))))].join(" · ") })}</p>}
          </li>;
        })}</ul>}
      </section>;
    })}
    {targets && <ArchiveDialog {...props} busy={disabled} targets={targets} onClose={() => setTargets(null)} onCompleted={removeSelection} />}
  </section>;
}
