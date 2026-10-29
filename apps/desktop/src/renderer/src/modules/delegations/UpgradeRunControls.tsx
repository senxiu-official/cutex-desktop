import { useLayoutEffect, useRef, useState } from "react";
import { btn, Button } from "../../components/Button";
import { DelegationGlyph } from "../../components/DelegationParts";
import { Tag } from "../../components/Tag";
import { useI18n } from "../../i18n";
import { ARMED_COUNTDOWN, useArmed } from "../../lib/armedConfirm";
import { confirmDialog } from "../../lib/contextMenu";
import type { UpgradeIntent, UpgradeSectionProps } from "./upgradeTypes";
import { BLOCK, CHECK, DANGER_SOLID, GROUP_TITLE, PHASE_TONE, SECTION_TITLE } from "./upgradeLook";

export function UpgradeRunControls(props: UpgradeSectionProps) {
  const { snapshot, busy } = props;
  const { t } = useI18n();
  const run = snapshot.runControl;
  const [directorChoice, setDirectorChoice] = useState({ projectId: snapshot.projectId, checked: false });
  const includeDirector = directorChoice.projectId === snapshot.projectId && directorChoice.checked;
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [armed, setArmed] = useArmed(`${snapshot.projectId}:${run.epoch}:${run.phase}:${run.allowedActions.pause}:${run.allowedActions.pauseAll}:${busy}`);
  // Dialog confirmation must check the current project, epoch and permission, even after a refresh.
  const latest = useRef<UpgradeSectionProps | null>(props);
  const inFlight = useRef(false);
  useLayoutEffect(() => {
    latest.current = props;
    return () => { latest.current = null; };
  }, [props]);

  const disabled = busy || pending;
  const canPause = (includeDirector ? (snapshot.caller.isOwner && run.allowedActions.pauseAll) : run.allowedActions.pause) && !disabled;
  const canResume = run.allowedActions.resume && run.pauseId !== null && !disabled;
  const titles = new Map<string, string>();
  for (const node of snapshot.nodes) {
    if (node.kind === "delegation") titles.set(JSON.stringify([node.ref.hostId, node.ref.id]), node.title);
  }

  const submit = async (intent: UpgradeIntent, interrupt = false) => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    setArmed(false);
    try {
      if (interrupt && !await confirmDialog(
        t(includeDirector ? "delegations.upgrade.run.interruptAll" : "delegations.upgrade.run.interruptMembers"),
        true,
        { ok: t("delegations.upgrade.run.confirmInterrupt"), cancel: t("delegations.upgrade.run.cancel") },
      )) return;
      const current = latest.current;
      if (!current || current.busy || current.snapshot.projectId !== snapshot.projectId) return;
      const control = current.snapshot.runControl;
      if (intent.kind === "pause" && (
        !(intent.scope === "all" ? current.snapshot.caller.isOwner && control.allowedActions.pauseAll : control.allowedActions.pause)
        || control.epoch !== intent.expectedEpoch
      )) return;
      if (intent.kind === "resume" && (control.scope === "all" && !current.snapshot.caller.isOwner || !control.allowedActions.resume || control.epoch !== intent.expectedEpoch || control.pauseId !== intent.pauseId)) return;
      await current.onAction(intent);
    } catch {
      if (latest.current?.snapshot.projectId === snapshot.projectId) setFailed(true);
    } finally {
      inFlight.current = false;
      if (latest.current) setPending(false);
    }
  };

  return (
    <section aria-label={t("delegations.upgrade.run.title")} className={`space-y-2.5 ${BLOCK}`}>
      <div className="flex min-w-0 items-center gap-2">
        <h3 className={`min-w-0 flex-1 truncate ${SECTION_TITLE}`}>{t("delegations.upgrade.run.title")}</h3>
        <Tag role="status" tone={PHASE_TONE[run.phase]}>{t(`delegations.upgrade.run.phase.${run.phase}`)}</Tag>
      </div>
      <p className="text-meta text-subtle">{t("delegations.upgrade.run.membersHint")}</p>
      <label className="flex w-fit cursor-pointer items-center gap-2 text-ui has-[:disabled]:cursor-default">
        <input type="checkbox" className={CHECK} checked={includeDirector} disabled={disabled || (!includeDirector && (!snapshot.caller.isOwner || !run.allowedActions.pauseAll))} onChange={(event) => {
          if (event.target.checked && (!snapshot.caller.isOwner || !run.allowedActions.pauseAll)) return;
          setDirectorChoice({ projectId: snapshot.projectId, checked: event.target.checked });
          setArmed(false);
        }} />
        {t("delegations.upgrade.run.includeDirector")}
      </label>
      <div className="flex flex-wrap gap-2">
        {/* Armed: the app's armed-confirm face (solid danger + countdown), not a restyled secondary button. */}
        <button type="button" disabled={!canPause} className={armed ? `${ARMED_COUNTDOWN} ${DANGER_SOLID}` : btn()} onClick={() => {
          if (!canPause) return;
          if (!armed) { setArmed(true); return; }
          void submit({ kind: "pause", mode: "afterTurn", scope: includeDirector ? "all" : "members", expectedEpoch: run.epoch });
        }}>{t(armed ? "delegations.upgrade.run.confirmPause" : "delegations.upgrade.run.pause")}</button>
        {armed ? <Button variant="ghost" onClick={() => setArmed(false)}>{t("delegations.upgrade.run.cancel")}</Button> : null}
        <Button danger disabled={!canPause} onClick={() => {
          if (canPause) void submit({ kind: "pause", mode: "interrupt", scope: includeDirector ? "all" : "members", expectedEpoch: run.epoch }, true);
        }}>{t("delegations.upgrade.run.interrupt")}</Button>
        <Button variant={canResume ? "primary" : "secondary"} disabled={!canResume} onClick={() => {
          if (canResume && run.pauseId !== null) void submit({ kind: "resume", pauseId: run.pauseId, expectedEpoch: run.epoch });
        }}>{t("delegations.upgrade.run.resume")}</Button>
      </div>
      <p className="text-meta text-subtle">{t("delegations.upgrade.run.resumeHint")}</p>
      {snapshot.interruptedDelegations.length > 0 ? (
        <div>
          <h4 className={GROUP_TITLE}>{t("delegations.upgrade.run.interrupted")}<span className="font-normal text-subtle tabular-nums">{snapshot.interruptedDelegations.length}</span></h4>
          <ul className="space-y-0.5">{snapshot.interruptedDelegations.map((ref) => {
            const key = JSON.stringify([ref.hostId, ref.id]);
            const label = t("delegations.upgrade.run.delegationRef", { host: ref.hostId, id: ref.id });
            return <li key={key} className="flex min-w-0 items-start gap-1.5 text-meta" title={label}><span className="mt-0.5"><DelegationGlyph glyph="ring" tone="neutral" /></span><span className="min-w-0 break-words">{titles.get(key) || label}</span></li>;
          })}</ul>
        </div>
      ) : null}
      {failed ? <p role="alert" className="text-meta text-danger">{t("delegations.upgrade.run.failed")}</p> : null}
    </section>
  );
}
