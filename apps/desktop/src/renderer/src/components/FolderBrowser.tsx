// In-app folder browser for remote hosts (cutex `GET /v2/fs/dirs`, feature fs-dir-browse): the
// native dialog would show this machine's disk, not the host's. Shown in the overlay dialog slot
// (lib/contextMenu `folderDialog`). Fixed list height so navigating never resizes the dialog.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Folder, HardDrive, Home, Loader2 } from "lucide-react";
import type { DirBrowse } from "../../../shared/ipc";
import { api, apiFor } from "../bridge";
import { useI18n } from "../i18n";
import { closeDialog } from "../lib/contextMenu";

/** `hostId`: whose disk (null = the focus host). */
export function FolderBrowser({ start, hostId, resolve }: { start: string | null; hostId: string | null; resolve(value: string | null): void }) {
  const { t } = useI18n();
  const [dir, setDir] = useState<DirBrowse | null>(null);
  const [input, setInput] = useState(start ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const done = (value: string | null) => {
    closeDialog();
    resolve(value);
  };

  const go = (path: string | undefined) => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    (hostId ? apiFor(hostId) : api).browseDirs(path).then(
      (r) => {
        if (n !== seq.current) return;
        setLoading(false);
        if (!r) {
          setError(t("folder.unsupported"));
          return;
        }
        setDir(r);
        setInput(r.path);
      },
      (e: unknown) => {
        if (n !== seq.current) return;
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
        // A start path that no longer exists: fall back to the host's home once.
        if (!dir && path) go(undefined);
      },
    );
  };

  useEffect(() => {
    go(start ?? undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirs = dir?.entries.filter((e) => e.isDir) ?? [];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">{t("folder.title")}</div>
      <div className="flex items-center gap-1">
        <button title={t("folder.up")} disabled={!dir?.parent || loading} onClick={() => dir?.parent && go(dir.parent)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 disabled:opacity-40">
          <ArrowUp size={14} />
        </button>
        <button title={t("folder.home")} disabled={!dir?.home || loading} onClick={() => dir?.home && go(dir.home)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 disabled:opacity-40">
          <Home size={14} />
        </button>
        <input
          value={input}
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(input.trim() || undefined);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-accent"
        />
      </div>
      {dir && dir.roots.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {dir.roots.map((root) => (
            <button key={root} onClick={() => go(root)} className="flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted hover:text-foreground">
              <HardDrive size={11} />
              {root}
            </button>
          ))}
        </div>
      )}
      <div className={`relative h-72 overflow-y-auto rounded-lg border border-border bg-background ${loading ? "opacity-60" : ""}`}>
        {dirs.map((entry) => (
          <button key={entry.path} onClick={() => go(entry.path)} className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-sm hover:bg-surface-2">
            <Folder size={14} className="shrink-0 text-subtle" />
            <span className={`truncate ${entry.hidden ? "text-subtle" : ""}`}>{entry.name}</span>
          </button>
        ))}
        {dir && dirs.length === 0 && !loading && <p className="px-2.5 py-2 text-xs text-subtle">{t("folder.empty")}</p>}
        {loading && !dir && (
          <div className="flex h-full items-center justify-center text-subtle">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
      </div>
      {/* One fixed line for errors / the truncated note, so they never push the buttons. */}
      <p className={`h-4 truncate text-xs ${error ? "text-danger" : "text-subtle"}`} title={error ?? undefined}>
        {error ?? (dir?.truncated ? t("folder.truncated") : "")}
      </p>
      <div className="flex items-center justify-end gap-2">
        <button onClick={() => done(null)} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-surface-2">
          {t("dialog.cancel")}
        </button>
        <button disabled={!dir || loading} onClick={() => dir && done(dir.path)} className="rounded-md bg-accent px-3 py-1 text-sm text-white disabled:opacity-40">
          {t("folder.choose")}
        </button>
      </div>
    </div>
  );
}
