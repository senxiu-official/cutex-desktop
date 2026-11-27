// 「更新项目记忆 · <name>」 (owner 2026-11-28): a turn's project memory edits as one row of their own (timeline.tool with
// `gather`, modules/projects/memoryEdits), outside the folded work group. One line: the verb, the entries' names, how
// many, 「及索引」 when MEMORY.md changed too, the +/− counts. Expanded: each file with its diff (as a file change row),
// and 「在记忆页打开」 when the files are this conversation's project memory (the host's memory `dir`).
import { useEffect, useMemo, useState } from "react";
import { BookMarked, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import type { ProjectMemoryView } from "../../../../shared/ipc";
import type { RawItem } from "../../lib/timeline";
import { changeAsDiff, countChange } from "../../lib/turnSummary";
import { useConvHost } from "../../lib/conversationScope";
import { useUserLayoutToggle } from "../../lib/userLayoutToggle";
import { hostPageParam } from "../../lib/targetHost";
import { hostApi, sidebarOf, useApp } from "../../store";
import { useI18n, type MessageKey } from "../../i18n";
import { UnifiedDiff } from "../../components/UnifiedDiff";
import { services } from "../app";
import { memoryEditsOf, memoryRow, sameMemoryDir, type MemoryChangeKind, type MemoryEdit, type MemoryRowModel } from "./memoryEdits";

const VERB: Record<MemoryRowModel["verb"], MessageKey> = {
  add: "projects.memoryEdit.add",
  update: "projects.memoryEdit.update",
  delete: "projects.memoryEdit.delete",
  index: "projects.memoryEdit.index",
};
const KIND: Record<MemoryChangeKind, MessageKey> = {
  add: "projects.memoryEdit.kind.add",
  update: "projects.memoryEdit.kind.update",
  delete: "projects.memoryEdit.kind.delete",
};

// The project's memory as the host reports it (its directory, the entries' current names), shared by the rows of a
// conversation and read again after a while (entries renamed meanwhile).
const VIEW_TTL_MS = 15_000;
const views = new Map<string, { at: number; view: Promise<ProjectMemoryView | null> }>();
function memoryView(hostId: string, projectId: string): Promise<ProjectMemoryView | null> {
  const key = `${hostId}\u0000${projectId}`;
  const hit = views.get(key);
  if (hit && Date.now() - hit.at < VIEW_TTL_MS) return hit.view;
  const view = hostApi(hostId).projectMemory(projectId).catch(() => null);
  views.set(key, { at: Date.now(), view });
  return view;
}

/** The conversation's project memory, when it is where these edits went; null = another / unknown directory. */
function useOwnMemory(sessionId: string, dir: string | null): { projectId: string; view: ProjectMemoryView } | null {
  const hostId = useConvHost();
  const projectId = useApp((s) => sidebarOf(s, hostId)?.hostRows[sessionId]?.projectId ?? null);
  const [view, setView] = useState<ProjectMemoryView | null>(null);
  useEffect(() => {
    if (!projectId || !dir) return;
    let live = true;
    void memoryView(hostId, projectId).then((v) => live && setView(v));
    return () => {
      live = false;
    };
    // A new entry's name comes with its text (memoryEdits), so a list read before it was written is still enough.
  }, [hostId, projectId, dir]);
  return projectId && dir && view && sameMemoryDir(view.dir, dir) ? { projectId, view } : null;
}

function Counts({ edits }: { edits: readonly MemoryEdit[] }) {
  let added = 0;
  let removed = 0;
  for (const e of edits) {
    if (!e.change.diff) continue;
    const n = countChange(e.change);
    added += n.added;
    removed += n.deleted;
  }
  if (!added && !removed) return null;
  return (
    <span data-tool-counts="" className="shrink-0 font-mono text-caption/[inherit] tabular-nums">
      <span className="text-ok">+{added}</span> <span className="text-danger/80">−{removed}</span>
    </span>
  );
}

function FileDiff({ edits }: { edits: readonly MemoryEdit[] }) {
  const text = useMemo(() => edits.filter((e) => e.change.diff).map((e) => changeAsDiff(e.change)).join("\n"), [edits]);
  if (!text) return null;
  return (
    <div data-memory-edit-diff="" className="mt-1 max-h-96 overflow-auto rounded-md border border-border/60">
      <UnifiedDiff text={text} />
    </div>
  );
}

export function MemoryEditRow({ item, items, sessionId }: { item: RawItem; sessionId: string; items?: readonly RawItem[] }) {
  const { t } = useI18n();
  const hostId = useConvHost();
  const userToggle = useUserLayoutToggle();
  const [open, setOpen] = useState(false);
  const edits = useMemo(() => (items ?? [item]).flatMap((x) => memoryEditsOf(x) ?? []), [items, item]);
  const own = useOwnMemory(sessionId, edits[0]?.dir ?? null);
  const known = useMemo(() => (own ? new Map(own.view.entries.map((e) => [e.file, { name: e.name, description: e.description ?? null }])) : undefined), [own]);
  const row = useMemo(() => memoryRow(edits, known), [edits, known]);
  if (!row) return null;
  const running = row.status === "running";
  const failed = row.status === "failed";
  const labels = row.files.map((f) => f.label).join(t("projects.memoryEdit.separator"));
  const title = row.files.map((f) => `${f.file}${f.description ? ` — ${f.description}` : ""}`).join("\n");
  return (
    <div className="my-0.5 min-w-0 max-w-full text-xs" data-tool-row="memoryEdit" data-memory-verb={row.verb}>
      <div className="flex min-w-0 max-w-full items-center gap-1.5 text-muted">
        <button aria-expanded={open} onClick={() => userToggle(() => setOpen(!open))} className="flex min-w-0 items-center gap-1.5 hover:text-foreground">
          {running ? <Loader2 size={13} className="shrink-0 animate-spin text-accent" /> : failed ? <X size={13} className="shrink-0 text-danger" /> : <BookMarked size={13} className="shrink-0 text-accent" />}
          <span className="shrink-0 font-medium">{t(VERB[row.verb])}</span>
          {labels && <span data-memory-names="" className="min-w-0 truncate text-subtle" title={title}>· {labels}</span>}
          {open ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
        </button>
        {row.files.length > 1 && <span data-memory-count="" className="shrink-0 text-subtle">· {t("projects.memoryEdit.count", { n: row.files.length })}</span>}
        {row.index && row.files.length > 0 && <span data-memory-index="" className="shrink-0 text-subtle">· {t("projects.memoryEdit.andIndex")}</span>}
        {failed && <span className="shrink-0 text-danger">· {t("projects.memoryEdit.failed")}</span>}
        <Counts edits={edits} />
      </div>
      {open && (
        <div className="mt-1 ml-5 min-w-0 space-y-2" data-memory-edit-details="">
          {row.files.map((f) => (
            <div key={f.file} data-memory-file={f.file} className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 text-muted">
                <span className="shrink-0 text-subtle">{t(KIND[f.kind])}</span>
                <span className="shrink-0 font-medium text-foreground/80">{f.label}</span>
                <code className="min-w-0 truncate font-mono text-subtle" title={f.edits[0]!.path}>{f.file}</code>
                {f.status === "failed" && <span className="shrink-0 text-danger">· {t("projects.memoryEdit.failed")}</span>}
                <Counts edits={f.edits} />
              </div>
              {f.description && f.description !== f.label && <div className="text-subtle">{f.description}</div>}
              <FileDiff edits={f.edits} />
            </div>
          ))}
          {row.index && (
            <div data-memory-file="MEMORY.md" className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 text-muted">
                <span className="shrink-0 font-medium text-foreground/80">{t("projects.memoryEdit.indexFile")}</span>
                <code className="min-w-0 truncate font-mono text-subtle" title={row.indexEdits[0]!.path}>MEMORY.md</code>
                <Counts edits={row.indexEdits} />
              </div>
              <FileDiff edits={row.indexEdits} />
            </div>
          )}
          {own && (
            <button
              type="button"
              data-memory-open=""
              onClick={() => services.ui.openPage("projects.page", { project: own.projectId, tab: "memory", ...hostPageParam(hostId) })}
              className="text-accent hover:underline"
            >
              {t("projects.memoryEdit.open")} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
