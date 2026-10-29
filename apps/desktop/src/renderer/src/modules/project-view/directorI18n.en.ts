// English strings of ./directorI18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { directorZh } from "./directorI18n";

export const directorEn: Record<keyof typeof directorZh, string> = {
  "project-view.directorUi.title": "Project handover",
  "project-view.directorUi.history": "Handover history",
  "project-view.directorUi.dismiss": "Got it",
  "project-view.directorUi.closeHistory": "Close history",
  "project-view.directorUi.none": "Unassigned",
  "project-view.directorUi.cleared": "{{Director}} cleared",
  "project-view.directorUi.vacant":
    "Assign {{a director}} before accepting handovers, approving history scopes or reissuing first messages. You can still read and discard items.",
  "project-view.directorUi.ownerOnly":
    "Only the {{owner}} may decide; the {{director}} cannot accept this item independently.",
  "project-view.directorUi.resolved": "Accepted by: {name}",
  "project-view.directorUi.proposed":
    "Requested by {from}; proposed recipient: {to}",
  "project-view.directorUi.refresh": "Refresh",
  "project-view.directorUi.loading": "Loading…",
  "project-view.directorUi.handovers": "Delegation handovers",
  "project-view.directorUi.starts": "First-message reviews",
  "project-view.directorUi.empty": "No items",
  "project-view.directorUi.quiet": "Nothing to act on",
  "project-view.directorUi.services": "{n} project services now managed by the new {{Director}}",
  "project-view.directorUi.evidence": "Source and evidence",
  "project-view.directorUi.changed":
    "{{Director}} changed from {from} to {to}.",
  "project-view.directorUi.responsibility":
    "Requested by {from}; proposed controller: {to}",
  "project-view.directorUi.source": "Originally requested by {name}",
  "project-view.directorUi.known": "Project provenance confirmed",
  "project-view.directorUi.unverified": "Provenance needs review",
  "project-view.directorUi.ownerScope": "History scope selected by {{owner}}",
  "project-view.directorUi.accept": "Accept handover",
  "project-view.directorUi.adopt": "Reissue",
  "project-view.directorUi.discard": "Discard item",
  "project-view.directorUi.confirm": "Confirm",
  "project-view.directorUi.cancel": "Cancel",
  "project-view.directorUi.confirmHandover":
    "Let the current {{Director}} control this delegation?",
  "project-view.directorUi.confirmAdopt":
    "Issue a new first message using the reviewed content?",
  "project-view.directorUi.confirmDiscard":
    "Discard this item? The member and history will remain.",
  "project-view.directorUi.unknown":
    "Delivery is unknown. Check its status; reissue is unavailable.",
  "project-view.directorUi.conflict":
    "The {{Director}} or item changed. Refreshed; review it before trying again.",
  "project-view.directorUi.uncertain":
    "The outcome is unconfirmed. Refresh and check before submitting again.",
  "project-view.directorUi.scope": "Choose history scope",
  "project-view.directorUi.scopeHelp":
    "Authorize only selected delegation IDs; you can also enter one ID per line.",
  "project-view.directorUi.selected": "{n} selected",
  "project-view.directorUi.confirmScope":
    "Allow the current {{Director}} to review these history handovers?",
  "project-view.directorUi.approveScope": "Approve selected scope",
  "project-view.directorUi.readBrief": "Read original task and delivery status",
  "project-view.directorUi.state.pending": "Pending",
  "project-view.directorUi.state.accepted": "Accepted",
  "project-view.directorUi.state.discarded": "Discarded",
  "project-view.directorUi.state.open": "Pending",
  "project-view.directorUi.state.deliveryUnknown": "Delivery unknown",
  "project-view.directorUi.state.adopted": "Reissued",
  "project-view.directorUi.state.superseded": "Previous handover superseded",
};
