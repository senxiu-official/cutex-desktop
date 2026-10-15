// 委托 (cutex agent-asks): the status category (step 2), the 委托 page and its sidebar entry with the
// needs-you count (step 3). On a cutex without asks the entry is greyed and the project page's 委托
// tab says the host has no delegations. A delegation ref (`delegation`, key = ask id) opens its detail
// on the right side (delegations.detail, DetailView.tsx).
// Timeline: only the delegate call (the 委托 card) is gated here; the other cutex agent-tool lines
// and the received ASK / results rows are core renderers in modules/conversation.
import { ArrowLeftRight } from "lucide-react";
import { DELEGATION_REF_KIND } from "../../lib/delegationRefs";
import { ASKS_FEATURE, delegateCallOf, isDelegateTool } from "../../lib/delegations";
import { isRunning } from "../../lib/workGroups";
import { DelegationCallRow } from "./TimelineRows";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { DelegationsPage } from "./DelegationsPage";
import { DelegationsBody, DelegationsMeta, DelegationsStatusBar } from "./DelegationStatus";
import { useDelegationsBadge } from "./useDelegationsBadge";
import { useDelegationsStatus } from "./useDelegationsStatus";
import { DETAIL, DETAIL_GROUP, DETAIL_STATE_VERSION, detailKey, initDetail, parseDetailParams, restoreDetail, type DetailState } from "./detail";
import { DetailBody, useDetailTab } from "./DetailView";
import { openDelegationRef, useDelegationLink } from "./refTarget";

export default defineModule({
  id: "delegations",
  titleKey: "delegations.title",
  descriptionKey: "delegations.description",
  requires: { capabilities: [ASKS_FEATURE] },
  contributes: {
    "timeline.tool": [{ id: "delegations.tool", order: 100, match: isDelegateTool, Row: DelegationCallRow, standalone: (item) => !isRunning(item) && !!delegateCallOf(item)?.askId }],
    "conversation.status": [
      {
        id: "delegations.status",
        order: 500,
        titleKey: "delegations.statusTitle",
        defaultPlace: "capsule",
        useStatus: useDelegationsStatus,
        Meta: DelegationsMeta,
        Body: DelegationsBody,
        Bar: DelegationsStatusBar,
        icon: ArrowLeftRight,
      },
    ],
    "nav.primary": [{ id: "delegations.nav", order: 500, icon: ArrowLeftRight, titleKey: "delegations.nav", target: { page: "delegations.page" }, useBadge: useDelegationsBadge }],
    "main.page": [{ id: "delegations.page", Page: DelegationsPage, useTitle: pageTitle("delegations.nav") }],
    // One delegation's detail on the right side (owner 2026-10-13: list clicks show it instead of
    // jumping to the timeline card; 跳到委托卡片 stays in the ⋯ / right-click menu).
    "side.component": [
      {
        id: DETAIL,
        titleKey: "delegations.detail",
        icon: ArrowLeftRight,
        instances: "multi",
        // refTarget binds each open to the open agent (detail.ts detailOpenArgs); "host" = no agent open.
        defaultBinding: "host",
        transient: true,
        stateVersion: DETAIL_STATE_VERSION,
        placement: { home: DETAIL_GROUP, prefer: [{ containing: DETAIL }, { group: DETAIL_GROUP }] },
        parseParams: parseDetailParams,
        dedupeKey: detailKey,
        init: initDetail,
        restore: restoreDetail,
        toRef: (state: DetailState) => ({ key: detailKey(state), title: (state.title ?? state.askId).slice(0, 200), params: { askId: state.askId, ...(state.title ? { title: state.title } : {}) } }),
        fromRef: (params) => parseDetailParams({ ...params }),
        useTab: useDetailTab,
        Body: DetailBody,
      },
    ],
    "ref.target": [{ id: "delegations.ref", kind: DELEGATION_REF_KIND, role: "content", open: openDelegationRef, useLink: useDelegationLink }],
  },
});
