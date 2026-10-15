// Non-component workspace hooks (kept out of component files so React Fast Refresh works).
// The workspace is the selected agent's, on that agent's host (multi-host P1: an agent of another host
// in the scope opens in place, so its files / git / watch go to `apiFor(thatHost)`).
import { createContext, useContext, useEffect, useState } from "react";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import type { DaemonApi, GitStatus, WorkspaceScope } from "../../../shared/ipc";
import { api, bridge } from "../bridge";
import { agentHost, hostApi, selectedSidebar, useApp } from "../store";
import { hostKey } from "./hostKeys";
import { onHostSwitch } from "./hostSwitch";
import { scopeFor, scopeKey, workspaceErrorText } from "./workspace";
import { translate } from "../i18n";

/** A workspace read error for display (`workspace_root_too_broad` in words). */
export function workspaceError(error: unknown): string {
  return workspaceErrorText(error, () => translate("workspace.tooBroad"));
}

/** Workspace scope of the selected agent (from its host's sidebar). */
export function useSelectedScope(): WorkspaceScope | null {
  const sidebar = useApp(selectedSidebar);
  const selectedId = useApp((s) => s.selectedId);
  const hostId = useApp(agentHost);
  const scope = scopeFor(sidebar, selectedId);
  const key = scope ? hostKey(hostId, scopeKey(scope)) : null;
  // Stable identity per key so effects don't re-run on every sidebar refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useStableScope(key, scope);
}

/** The selected agent's host (the focus host when none is selected). */
export const useSelectedHost = (): string => useApp(agentHost);

const scopeCache = new Map<string, WorkspaceScope>();
onHostSwitch(() => scopeCache.clear());
function useStableScope(key: string | null, scope: WorkspaceScope | null): WorkspaceScope | null {
  if (!key || !scope) return null;
  if (!scopeCache.has(key)) scopeCache.set(key, scope);
  return scopeCache.get(key)!;
}

/**
 * Watch the scope on `hostId` while mounted: `revision` bumps on any file change, git status reloads
 * when files or `.git` change. Errors (e.g. old cutex without workspace routes) surface as `error`.
 */
export function useWorkspace(scope: WorkspaceScope | null, hostId: string) {
  const [revision, setRevision] = useState(0);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGit(null);
    setError(null);
    if (!scope) return;
    const daemon = hostApi(hostId);
    let watchId: string | null = null;
    let cancelled = false;
    const loadGit = () =>
      daemon.gitStatus(scope).then(
        (g) => !cancelled && setGit(g),
        (e: unknown) => !cancelled && setError(workspaceError(e)),
      );
    void loadGit();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = bridge.on("workspaceChanged", (event) => {
      if (event.watchId !== watchId || (event.hostId ?? LOCAL_HOST_ID) !== hostId) return;
      setRevision((r) => r + 1);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadGit(), 300);
    });
    void daemon.watchWorkspace(scope).then((id) => {
      if (cancelled) void daemon.unwatchWorkspace(id).catch(() => {});
      else watchId = id;
    }, () => {});
    return () => {
      cancelled = true;
      off();
      if (timer) clearTimeout(timer);
      if (watchId) void daemon.unwatchWorkspace(watchId).catch(() => {});
    };
  }, [scope, hostId]);

  return { revision, git, error };
}

/**
 * The selected agent's workspace and its one watch (App): the title bar git chip and the right side's
 * cards. `hostId` / `api`: the agent's host and its daemon calls (file reads, diffs, terminals).
 */
export interface SelectedWorkspace {
  hostId: string;
  api: DaemonApi;
  scope: WorkspaceScope | null;
  revision: number;
  git: GitStatus | null;
  error: string | null;
}

export const WorkspaceContext = createContext<SelectedWorkspace>({ hostId: LOCAL_HOST_ID, api, scope: null, revision: 0, git: null, error: null });
export function useSelectedWorkspace(): SelectedWorkspace {
  return useContext(WorkspaceContext);
}

/** Sum of +/− over working-tree and staged changes. */
export function diffTotals(git: GitStatus | null): { files: number; added: number; deleted: number } {
  if (!git) return { files: 0, added: 0, deleted: 0 };
  const paths = new Set(git.files.map((f) => f.path));
  return {
    files: paths.size,
    added: git.files.reduce((a, f) => a + (f.added ?? 0), 0),
    deleted: git.files.reduce((a, f) => a + (f.deleted ?? 0), 0),
  };
}
