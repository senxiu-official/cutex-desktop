// The cross-host part of a delegation card (cutex peers-v2): for an outgoing mirror the remote sync
// state in words (+ the sanitized diagnostic) and the destination's last reported state; a late
// answer (arrived after the mirror closed here: never delivered, opened from its local artifact);
// for an incoming one the requester's claimed caps (display only) and an undeliverable result. With
// peer-delivery-receipts-v1 (and a record that carries one) the receipt replaces the sync-state words.
import { useState } from "react";
import type { AskSummary } from "../../../shared/ipc";
import { parseArtifactRef } from "../../../shared/artifactStore";
import { useI18n, type MessageKey } from "../i18n";
import { lateAnswerOf, peerStateKey, remoteSyncKey, requesterPeer } from "../lib/delegations";
import { delegationApi } from "../lib/delegationStore";
import { singleLine } from "../lib/peerText";
import { services } from "../modules/app";
import { Markdown } from "./Markdown";
import { ClaimedCaps } from "./PeerParty";
import { CrossHostReceipt } from "./CrossHostReceipt";
import { useCrossHost } from "../lib/useCrossHost";

function LateAnswer({ d, label, hostId }: { d: AskSummary; label: string; hostId: string }) {
  const { t } = useI18n();
  const late = lateAnswerOf(d);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (!late) return null;
  const id = late.artifactId ?? null;
  const open = async () => {
    if (!id) return;
    // An artifact-store id opens through the artifacts module's ref; an ask artifact (`art-…`) is read here.
    const ref = `${id}@latest`;
    if (parseArtifactRef(ref)) {
      const r = await services.refs.open({ hostId, kind: "artifact", key: ref, title: t("delegation.peer.lateAnswer"), params: {} });
      if (r.status === "opened") return;
    }
    try {
      const a = await delegationApi(hostId).artifact(id);
      setText(a && a.encoding === "utf8" ? a.content : "");
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="mt-2" data-testid="late-answer">
      <div className="mb-0.5 text-caption/[inherit] text-subtle" title={t("delegation.peer.lateAnswerHint", { label })}>
        {t("delegation.peer.lateAnswer")}
      </div>
      {text === null && late.preview && <div className="selectable text-ui/[inherit] whitespace-pre-wrap text-muted">{late.preview}</div>}
      {text !== null && <Markdown text={text} streaming={false} />}
      <div className="mt-0.5 text-caption/[inherit] text-subtle">{t("delegation.peer.lateAnswerHint", { label })}</div>
      {id && text === null && (
        <button onClick={() => void open()} className="mt-1 text-accent hover:underline">
          {t("delegation.peer.openLateAnswer")}
        </button>
      )}
      {failed && <div className="text-caption/[inherit] text-danger">{id}</div>}
    </div>
  );
}

/** `hostId`: the host whose record `d` is (the late answer's artifact lives there). */
export function DelegationPeerSection({ d, hostId, detail = false }: { d: AskSummary; hostId: string; detail?: boolean }) {
  const { t } = useI18n();
  const peer = requesterPeer(d.requester);
  const remote = d.remote ?? null;
  const ch = useCrossHost(d, hostId);
  const label = remote?.label ?? peer?.label ?? ch?.peer.label ?? "";
  if (!remote && !peer && !ch) return null;
  // The receipt says how far delivery got; the older sync words are not read as a receipt.
  const sync = ch ? null : remoteSyncKey(remote);
  const err = singleLine(remote?.lastError);
  const remoteExec = remote?.remoteState?.execution ?? null;
  const remoteHold = remote?.remoteState?.hold?.raw ?? remote?.remoteState?.hold?.reason ?? null;
  const stateWord = (state: string) => {
    const word = peerStateKey(state);
    // The destination's pendingReview waits for that host's owner, not for you.
    const key = word === "pendingReview" && remote ? "remoteReview" : word;
    return key ? t(`delegation.status.${key}` as MessageKey, { name: remote?.targetName ?? d.targetName ?? d.target, host: label }) : state;
  };
  return (
    <div className="mt-2 first:mt-0" data-testid="delegation-peer">
      <div className="mb-0.5 text-caption/[inherit] text-subtle">{t("delegation.peer.remoteTitle")}</div>
      {ch && <CrossHostReceipt ch={ch} hostId={hostId} askId={d.askId} detail={detail} />}
      {sync && (
        <div className={`text-xs ${sync === "queued" ? "text-muted" : "text-warn"}`}>
          {t(`delegation.peer.sync.${sync}` as MessageKey, { label, state: remote?.syncState ?? "" })}
        </div>
      )}
      {err && <div className="truncate text-caption/[inherit] text-subtle" title={err}>{err}</div>}
      {remoteExec && <div className="text-caption/[inherit] text-subtle">{t("delegation.peer.remoteState", { state: [stateWord(remoteExec), remoteHold ? stateWord(remoteHold) : null].filter(Boolean).join(" · ") })}</div>}
      {peer && <ClaimedCaps caps={peer.claimedCaps} />}
      {d.resultUndeliverable && <div className="text-xs text-danger">{t("delegation.peer.resultUndeliverable", { label })}</div>}
      <LateAnswer d={d} label={label} hostId={hostId} />
    </div>
  );
}
