// Non-component workspace hooks (kept out of component files so React Fast Refresh works).
// The workspace is the selected agent's, on that agent's host (multi-host P1: an agent of another host
// in the scope opens in place, so its files / git / watch go to `apiFor(thatHost)`).
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import type { DaemonApi, GitStatus, WorkspaceScope } from "../../../shared/ipc";
import { api, bridge } from "../bridge";
import { agentHost, hostApi, selectedSidebar, sidebarOf, useApp } from "../store";
import { hostKey } from "./hostKeys";
import { onHostSwitch } from "./hostSwitch";
import { rootFor, scopeFor, scopeKey, workspaceErrorText } from "./workspace";
import { ALL_DIRS, ChangeBatcher, changeForPaths, DirVersions, dirsForPaths, fileChangePaths, itemMayWrite } from "./workspaceRefresh";
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

/** The tree's versions when no workspace is shown (nothing ever invalidates it). */
export const NO_DIR_VERSIONS = new DirVersions();

/** Whether `sessionId` of `hostId` works in `scope` (its own cwd, or a member of the project). */
function sessionInScope(scope: WorkspaceScope, hostId: string, sessionId: string): boolean {
  if (scope.kind === "session") return sessionId === scope.id;
  return sidebarOf(useApp.getState(), hostId)?.hostRows[sessionId]?.projectId === scope.id;
}

/**
 * Watch the scope on `hostId` while mounted: `revision` bumps on any file change, `dirs` says which
 * open folders of the 文件 tree to reload (lib/workspaceRefresh.ts), git status reloads when files or
 * `.git` change. Sources: cutex's watch (re-opened after the host reconnects, everything reloaded
 * then), and the agents of this workspace: a completed `fileChange` item reloads its folders, a turn's
 * end everything open (shell commands; hosts whose watcher misses changes). Errors (e.g. old cutex
 * without workspace routes) surface as `error`.
 */
export function useWorkspace(scope: WorkspaceScope | null, hostId: string) {
  const [revision, setRevision] = useState(0);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirs, setDirs] = useState<DirVersions>(NO_DIR_VERSIONS);

  useEffect(() => {
    setGit(null);
    setError(null);
    if (!scope) {
      setDirs(NO_DIR_VERSIONS);
      return;
    }
    const versions = new DirVersions();
    setDirs(versions);
    const daemon = hostApi(hostId);
    let watchId: string | null = null;
    let cancelled = false;
    const loadGit = () =>
      daemon.gitStatus(scope).then(
        (g) => !cancelled && setGit(g),
        (e: unknown) => !cancelled && setError(workspaceError(e)),
      );
    void loadGit();
    let gitTimer: ReturnType<typeof setTimeout> | null = null;
    const reloadGitSoon = () => {
      if (gitTimer) clearTimeout(gitTimer);
      gitTimer = setTimeout(() => void loadGit(), 300);
    };
    const batcher = new ChangeBatcher((change) => {
      if (cancelled) return;
      versions.invalidate(change);
      setRevision((r) => r + 1);
    });
    const ours = (tag: string | undefined) => (tag ?? LOCAL_HOST_ID) === hostId;
    const offWatch = bridge.on("workspaceChanged", (event) => {
      if (event.watchId !== watchId || !ours(event.hostId)) return;
      if (event.overflow) batcher.add(ALL_DIRS);
      else if (event.paths.length) batcher.add({ all: false, dirs: dirsForPaths(event.paths) });
      reloadGitSoon();
    });
    // An agent's own edits, as its turn reports them (works whatever the host's watcher sees). A turn
    // seen from its start whose items cannot write files (lib/workspaceRefresh.ts) ends without a
    // reload; any other turn's end (a command ran, or it started before this view) reloads all.
    const quietTurns = new Map<string, boolean>();
    const offSession = bridge.on("sessionEvent", (event) => {
      const message = event.envelope.native?.message;
      if (!message || !ours(event.hostId) || !sessionInScope(scope, hostId, event.sessionId)) return;
      if (message.method === "turn/started") quietTurns.set(event.sessionId, true);
      else if (message.method === "item/completed") {
        const item = (message.params as { item?: unknown } | undefined)?.item;
        if (itemMayWrite(item)) quietTurns.set(event.sessionId, false);
        const paths = fileChangePaths(item);
        if (!paths.length) return;
        batcher.add(changeForPaths(rootFor(sidebarOf(useApp.getState(), hostId), scope), paths));
        reloadGitSoon();
      } else if (message.method === "turn/completed") {
        const quiet = quietTurns.get(event.sessionId) === true;
        quietTurns.delete(event.sessionId);
        if (quiet) return;
        batcher.add(ALL_DIRS);
        reloadGitSoon();
      }
    });
    const watch = () =>
      void daemon.watchWorkspace(scope).then((id) => {
        if (cancelled) void daemon.unwatchWorkspace(id).catch(() => {});
        else watchId = id;
      }, () => {});
    // The host connection went and came back: main dropped its watches with it. Watch again and
    // reload what is shown (changes in the gap were not seen).
    let lost = false;
    const offState = bridge.on("daemonState", (event) => {
      if (!ours(event.hostId)) return;
      if (event.state.kind !== "connected") {
        lost = true;
        return;
      }
      if (!lost) return;
      lost = false;
      const old = watchId;
      watchId = null;
      if (old) void daemon.unwatchWorkspace(old).catch(() => {});
      watch();
      batcher.add(ALL_DIRS);
      reloadGitSoon();
    });
    watch();
    return () => {
      cancelled = true;
      offWatch();
      offSession();
      offState();
      batcher.dispose();
      if (gitTimer) clearTimeout(gitTimer);
      if (watchId) void daemon.unwatchWorkspace(watchId).catch(() => {});
    };
  }, [scope, hostId]);

  return { revision, git, error, dirs };
}

/** The 文件 tree's reload version of the open folder `path` (changes when it or everything changed). */
export function useDirVersion(dirs: DirVersions, path: string): number {
  return useSyncExternalStore(dirs.subscribe, () => dirs.version(path));
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
  /** Which open folders of the 文件 tree to reload (`useDirVersion`). */
  dirs: DirVersions;
}

export const WorkspaceContext = createContext<SelectedWorkspace>({ hostId: LOCAL_HOST_ID, api, scope: null, revision: 0, git: null, error: null, dirs: NO_DIR_VERSIONS });
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
