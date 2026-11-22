// 项目看板 → main window (main/board.ts sends `boardOpen` after showing this window): open the project's 项目视图
// (with its 主管 as the conversation), an agent, or a delegation's detail. 需要你: showing the window is the answer —
// its 需要你 strip is where those are handled.
import type { BoardTarget } from "../../../shared/board";
// store.ts imports this file at start: everything that reaches modules/app (delegation detail, 项目视图) is loaded
// lazily, on a click, so the app's module start order stays as it was.
import { bridge } from "../bridge";
import { sidebarOf, useApp } from "../store";

function openAgent(hostId: string, sessionId: string): Promise<unknown> {
  const s = useApp.getState();
  return Promise.resolve(s.openAgent ? s.openAgent(sessionId, hostId) : s.select(sessionId)).catch(() => undefined);
}

export function openBoardTarget(target: BoardTarget): void {
  switch (target.kind) {
    case "agent":
      void openAgent(target.hostId, target.sessionId);
      return;
    case "delegation":
      void import("./delegationOpen").then((m) => m.openDelegationDetail(target.hostId, target.askId));
      return;
    case "project": {
      const projects = sidebarOf(useApp.getState(), target.hostId)?.projects?.projects ?? [];
      const director = projects.find((p) => p.project_id === target.projectId)?.director_cutex_session_id;
      // The 主管's conversation first, then the project's 项目视图 in its Shelf.
      void (director ? openAgent(target.hostId, director) : Promise.resolve())
        .then(() => import("../modules/project-view/open"))
        .then((m) => m.openProjectView({ hostId: target.hostId, projectId: target.projectId }));
      return;
    }
    case "needsYou":
      return;
  }
}

let started = false;
/** Follow the board's clicks (store.ts init). */
export function startBoardLink(): void {
  if (started) return;
  started = true;
  bridge.on("boardOpen", ({ target }) => openBoardTarget(target));
}
