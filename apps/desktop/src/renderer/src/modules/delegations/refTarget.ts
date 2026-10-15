// `ref.target` kind `delegation` (docs/desktop-modules.md §19.9): opens delegations.detail on the
// right side, on the ref's host (a delegation is a host record; the selected agent's host is never
// substituted), bound to the open agent (detail.ts detailOpenArgs). Core lists open it through
// lib/delegationOpen (refs.open).
import { ArrowLeftRight } from "lucide-react";
import { askIdOfRef, delegationRef } from "../../lib/delegationRefs";
import { useDelegation } from "../../lib/delegationStore";
import { sideShowsHost } from "../../lib/sideServices";
import { taskTag } from "../../lib/tasks";
import { useApp } from "../../store";
import { services } from "../app";
import type { CutexRef, RefLinkView, RefOpenResult } from "../slots";
import { DETAIL, detailOpenArgs, refResult } from "./detail";

export function openDelegationRef(ref: CutexRef, how: "auto" | "peek" | "page"): RefOpenResult {
  // Bound to the open agent (its side view); past the host check below the ref's host is that agent's.
  const args = detailOpenArgs(ref, useApp.getState().selectedId);
  if (!args) return { status: "unavailable", reason: "bad-ref" };
  // The side column only shows the open agent's host: a card of another host would be invisible, so
  // say unavailable and let the caller's fallback (the old jump) run.
  if (!sideShowsHost(ref.hostId)) return { status: "unavailable", reason: "host-offline" };
  // A document-like target: every way opens the right side (no reference card, like artifacts).
  void how;
  return refResult(services.side.open(DETAIL, { ...args.params }, { target: "page", binding: args.binding, focus: true }));
}

/** Open the detail from this module's own rows (the status capsule / chip). */
export function openDelegationDetailHere(hostId: string, askId: string, title?: string): RefOpenResult {
  return openDelegationRef(delegationRef(hostId, askId, title), "page");
}

/** A `cutex:delegation/<askId>` chip: the ⇄ icon, #tag title in the tooltip once the record is known. */
export function useDelegationLink(ref: CutexRef): RefLinkView | null {
  const askId = askIdOfRef(ref);
  const d = useDelegation(ref.hostId, askId);
  if (!askId) return { tone: "muted", tooltip: ref.key };
  return { icon: ArrowLeftRight, tooltip: d ? `${taskTag(askId).label} ${d.title}` : askId };
}
