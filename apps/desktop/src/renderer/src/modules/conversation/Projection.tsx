// A projection (conversation.projection; docs/desktop-modules.md §24.13, canvas principles §7, owner 2026-10-21;
// prototype .claude/preview-workspaces.html #project): another agent's live conversation as a pane in the
// focused conversation's Shelf — the agent itself, not a copy (its timeline, approvals / questions, the
// 「接下来」 queue and a slim composer whose sends go to it only), without its Shelf. The header's
// 「投影 · 在旁边打开」 makes it the workspace beside (lib/workspaces promoteProjection); the card's × removes it.
// Shown as a workspace on screen already: a placeholder with 切过去 instead of a second live copy.
import { useEffect } from "react";
import { ArrowRightToLine } from "lucide-react";
import { useI18n } from "../../i18n";
import { markSeenOn } from "../../lib/turnUnread";
import { agentRetraction, retractNotify } from "../../lib/notifyEvents";
import { paneShowing } from "../../lib/paneLayout";
import { focusConversationPane, usePanes } from "../../lib/paneStore";
import type { ProjectionParams } from "../../lib/sideKinds";
import { promoteProjection } from "../../lib/workspaces";
import { useApp } from "../../store";
import { useShownInWindow } from "../../lib/windowScope";
import { viewKey } from "../../lib/viewKey";
import { Avatar } from "../../components/Avatar";
import type { SideBodyProps } from "../slots";
import { SideAgentConversation } from "./SideAgent";
import { useAgentResource } from "./sideAgentData";
import { Tag } from "../../components/Tag";
import { useOwnerWindow } from "../../lib/ownerContext";

/** The header's 「投影 · 在旁边打开」 (prototype: the projection's blue chip). */
export function ProjectionActions({ instance }: SideBodyProps<ProjectionParams>) {
  const { t } = useI18n();
  const { hostId, sessionId } = instance.state;
  const resource = useAgentResource(hostId, sessionId);
  const name = resource?.displayName ?? sessionId;
  return (
    <button
      data-side-nodrag
      data-projection-promote=""
      title={t("conversation.projection.besideHint", { name })}
      onClick={() => promoteProjection(instance.id, hostId, sessionId)}
      className="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,#3b82f6_12%,transparent)] pr-2 pl-1 text-meta/[inherit] font-medium text-[color-mix(in_srgb,#3b82f6_85%,var(--fg))] hover:bg-[color-mix(in_srgb,#3b82f6_20%,transparent)]"
    >
      <Tag tone="accent">{t("conversation.projection.label")}</Tag>
      <ArrowRightToLine size={12} />
      {t("conversation.projection.beside")}
    </button>
  );
}

export function ProjectionBody({ instance, visible }: SideBodyProps<ProjectionParams>) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const { hostId, sessionId } = instance.state;
  const resource = useAgentResource(hostId, sessionId);
  const name = resource?.displayName ?? sessionId;
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const conn = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.conn?.epoch ?? null);
  const ready = useApp((s) => (hostId === focus ? s.daemon : s.byHost[hostId]?.daemon)?.kind === "connected");
  // On screen as a workspace already (it was opened beside meanwhile): one live copy is enough.
  const pane = usePanes((p) => paneShowing(p.layout, hostId, sessionId));
  // Live while mounted (store retainView, the same feed a conversation pane holds).
  useEffect(() => (ready && !pane ? useApp.getState().retainView(hostId, sessionId) : undefined), [ready, hostId, sessionId, conn, focus, pane]);
  const live = useApp((s) => !!s.views[viewKey(hostId, sessionId)]);
  const shown = visible && !pane;
  useEffect(() => {
    if (live) useApp.getState().setViewVisible(hostId, sessionId, shown);
  }, [live, hostId, sessionId, shown]);
  useShownInWindow(hostId, sessionId, live && shown);
  // Looking at it takes back its alerts and its done / failed mark, like a conversation pane.
  useEffect(() => {
    if (!shown) return;
    const look = () => {
      if (!win.document.hasFocus()) return;
      markSeenOn(hostId, sessionId);
      retractNotify(agentRetraction(sessionId));
    };
    look();
    win.addEventListener("focus", look);
    return () => win.removeEventListener("focus", look);
  }, [shown, hostId, sessionId, win]);
  if (pane) {
    return (
      <div data-projection={sessionId} className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
        <Avatar name={name} avatar={resource?.avatar} seed={sessionId} size={28} />
        <p>{t("conversation.projection.onScreen", { name })}</p>
        <button onClick={() => focusConversationPane(pane)} className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-hover">
          {t("conversation.projection.focus")}
        </button>
      </div>
    );
  }
  return (
    <div data-projection={sessionId} data-projection-host={hostId} className="flex h-full min-h-0 flex-col">
      <SideAgentConversation sessionId={sessionId} hostId={hostId} name={name} resource={resource} />
    </div>
  );
}
