// Opening Project 视图 and what its rows point at, through the module services (panes / refs) and the
// core's delegation-detail opener — never another module's code.
import { contextProject } from "./context";
import { translate } from "../../i18n";
import { openDelegationDetail } from "../../lib/delegationOpen";
import { useApp } from "../../store";
import { services } from "../app";
import { KIND, type ActivityTarget, type ViewParams } from "./model";
import type { StreamTarget } from "./stream";

const fail = (reason: string) => services.ui.notice(translate("project-view.openFailed", { reason }), "error");

/** The focused conversation's project, else the last project used on this desktop. */
export function focusedProject(): { hostId: string; projectId: string } | null {
  return contextProject(useApp.getState());
}

/** Launcher / ⌘K / 项目 menu: a tab for `project` (default: the focused conversation's project, else the follow tab). */
export function openProjectView(project?: { hostId: string; projectId: string } | null): void {
  const p: ViewParams = project ?? focusedProject() ?? {};
  const r = services.panes.open(KIND, { ...p }, { focus: true });
  if (r.status === "unavailable") fail(r.reason);
}

export function openAgentBeside(hostId: string, sessionId: string): void {
  const r = services.panes.open("core.conversation", { sessionId, hostId }, { beside: true });
  if (r.status === "unavailable") fail(r.reason);
}

/** A 「动态」 row's click (stream.ts rowTarget): the turn (its reference card), the approvals page, else as openTarget. */
export function openStreamTarget(hostId: string, target: StreamTarget): void {
  if (target.kind === "approvals") return services.ui.openPage("approvals.page");
  if (target.kind !== "turn") return openTarget(hostId, target);
  const params: Record<string, string> = { sessionId: target.sessionId, turnId: target.turnId };
  if (target.threadId) params.threadId = target.threadId;
  if (target.agentName) params.agentName = target.agentName;
  void services.refs
    .open({ hostId, kind: "turn", key: `${target.sessionId}:${target.turnId}`, title: target.snippet ?? target.agentName ?? target.sessionId, params, ...(target.snippet ? { snippet: target.snippet } : {}) }, { how: "auto" })
    .then((r) => {
      if (r.status === "unavailable") openAgentBeside(hostId, target.sessionId);
    })
    .catch(() => openAgentBeside(hostId, target.sessionId));
}

/** A row's click: the agent's conversation beside, the delegation's detail, the artifact or the service. */
export function openTarget(hostId: string, target: ActivityTarget): void {
  switch (target.kind) {
    case "agent":
      return openAgentBeside(hostId, target.sessionId);
    case "delegation":
      return openDelegationDetail(hostId, target.askId, { title: target.title });
    case "artifact":
    case "service":
      void services.refs
        .open({ hostId, kind: target.kind, key: target.kind === "artifact" ? target.ref : target.slug, title: target.name, params: {} }, { how: "page" })
        .then((r) => {
          if (r.status === "unavailable") fail(r.reason);
        })
        .catch((e: unknown) => services.ui.notice(e instanceof Error ? e.message : String(e), "error"));
  }
}
