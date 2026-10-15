// 文件 card (workspace.files): the selected agent's workspace tree + search. All data from cutex
// workspace routes (fs/dir, fs/search), so it works for offline agents and remote hosts.
import { enterModifiers, openModifiers } from "../../lib/openModifiers";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, FolderOpen } from "lucide-react";
import { fileKind } from "../../lib/fileKinds";
import { FILE_KIND_ICON } from "../../lib/fileKindIcons";
import type { FsEntry, WorkspaceScope } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { openFile } from "../../lib/sideOpen";
import { useSelectedWorkspace, workspaceError } from "../../lib/workspaceView";
import type { SideBodyProps } from "../slots";
import { PREVIEW, useCurrentField, useFileMenu } from "./shared";

export type FilesState = { q: string };

/** The row's kind icon (lib/fileKindIcons; a folder shows open while expanded). */
function EntryIcon({ path, isDir, open = false }: { path: string; isDir: boolean; open?: boolean }) {
  const Icon = isDir ? (open ? FolderOpen : FILE_KIND_ICON.folder) : FILE_KIND_ICON[fileKind(path)];
  return <Icon aria-hidden size={14} strokeWidth={1.75} className={`shrink-0 ${isDir ? "text-accent/80" : "text-subtle"}`} />;
}

function DirNode({ scope, entry, depth, revision, current }: { scope: WorkspaceScope; entry: FsEntry; depth: number; revision: number; current: string | null }) {
  const [open, setOpen] = useState(false);
  const isDir = entry.kind === "dir" || entry.targetKind === "dir";
  const menu = useFileMenu(scope);
  return (
    <>
      <button
        onClick={(e) => (isDir ? setOpen(!open) : void openFile(entry.path, null, "browse", openModifiers(e)))}
        onAuxClick={(e) => {
          if (isDir || e.button !== 1) return;
          e.preventDefault();
          void openFile(entry.path, null, "browse", openModifiers(e));
        }}
        onKeyDown={(e) => {
          const mods = isDir ? null : enterModifiers(e);
          if (!mods) return;
          e.preventDefault();
          void openFile(entry.path, null, "browse", mods);
        }}
        onContextMenu={menu(entry.path, { isDir })}
        className={`flex w-full items-center gap-1.5 rounded px-1 py-[3px] text-left text-[13px] hover:bg-surface-2 ${entry.ignored ? "opacity-50" : ""} ${current === entry.path ? "bg-surface-2" : ""}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        title={entry.path}
      >
        <span className="flex w-3 shrink-0 justify-center text-subtle">{isDir && <ChevronRight size={11} className={`transition-transform ${open ? "rotate-90" : ""}`} />}</span>
        <EntryIcon path={entry.path} isDir={isDir} open={open} />
        <span className="truncate">{entry.name}</span>
      </button>
      {isDir && open && <DirChildren scope={scope} path={entry.path} depth={depth + 1} revision={revision} current={current} />}
    </>
  );
}

function DirChildren({ scope, path, depth, revision, current }: { scope: WorkspaceScope; path: string; depth: number; revision: number; current: string | null }) {
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { api } = useSelectedWorkspace();
  useEffect(() => {
    let cancelled = false;
    api.fsDir(scope, path).then(
      (d) => !cancelled && setEntries(d.entries),
      (e: unknown) => !cancelled && setError(workspaceError(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [api, scope, path, revision]);
  if (error) return <div className="px-2 py-1 text-xs text-danger" style={{ paddingLeft: 8 + depth * 12 }}>{error}</div>;
  if (!entries) return <div className="px-2 py-1 text-xs text-subtle" style={{ paddingLeft: 8 + depth * 12 }}>…</div>;
  return (
    <>
      {entries.map((entry) => (
        <DirNode key={entry.path} scope={scope} entry={entry} depth={depth} revision={revision} current={current} />
      ))}
    </>
  );
}

export function FilesBody({ instance, setState }: SideBodyProps<FilesState>) {
  const { t } = useI18n();
  const { api, scope, revision, error } = useSelectedWorkspace();
  const current = useCurrentField(PREVIEW, "path");
  // Typing stays local; the query is kept in the instance state (restored on remount) a moment later.
  const [query, setQuery] = useState(instance.state.q ?? "");
  const saved = useRef(query);
  useEffect(() => {
    if (query === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = query;
      setState({ q: query });
    }, 400);
    return () => clearTimeout(timer);
  }, [query, setState]);
  const [results, setResults] = useState<string[] | null>(null);
  useEffect(() => {
    if (!scope || !query.trim()) {
      setResults(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api.fsSearch(scope, query, 50).then(
        (r) => live && setResults(r.results.map((x) => x.path)),
        () => live && setResults([]),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, scope, query, revision]);
  const menu = useFileMenu(scope);
  if (!scope) return <p className="p-3 text-xs text-subtle">{t("workspace.noScope")}</p>;
  if (error) return <p className="p-3 text-xs text-danger">{error}</p>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
            }
          }}
          placeholder={t("workspace.searchFiles")}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {results ? (
          results.map((p) => (
            <button key={p} onClick={(e) => void openFile(p, null, "browse", openModifiers(e))} onAuxClick={(e) => e.button === 1 && void openFile(p, null, "browse", openModifiers(e))} onKeyDown={(e) => { const mods = enterModifiers(e); if (mods) { e.preventDefault(); void openFile(p, null, "browse", mods); } }} onContextMenu={menu(p)} className="flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-[3px] text-left text-[13px] hover:bg-surface-2" title={p}>
              <EntryIcon path={p} isDir={false} />
              <span className="shrink-0">{p.split("/").pop()}</span> <span className="min-w-0 truncate text-xs text-subtle">{p}</span>
            </button>
          ))
        ) : (
          <DirChildren scope={scope} path="" depth={0} revision={revision} current={current} />
        )}
      </div>
    </div>
  );
}
