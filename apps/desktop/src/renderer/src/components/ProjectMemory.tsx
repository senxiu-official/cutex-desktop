// Read-only view of a project's shared memory (cutex `GET /v2/projects/{id}/memory` + one file per
// entry via `GET /v2/projects/{id}/memory/{file}`). Used by the Projects page memory tab and by the
// composer's "+" → 记忆 → 项目记忆 panel, so both show exactly the same content.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProjectMemoryView } from "../../../shared/ipc";
import { hostApi, useApp } from "../store";
import { useI18n } from "../i18n";
import { Markdown } from "./Markdown";

function MemoryEntry({ hostId, projectId, entry }: { hostId: string; projectId: string; entry: ProjectMemoryView["entries"][number] }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const toggle = () => {
    if (!open && content === null)
      hostApi(hostId).projectMemoryFile(projectId, entry.file).then(
        (d) => setContent(d.content),
        (e: unknown) => setContent(`> ${e instanceof Error ? e.message : String(e)}`),
      );
    setOpen(!open);
  };
  return (
    <div className="border-b border-border last:border-b-0">
      <button onClick={toggle} className="flex w-full items-center gap-2 py-2 text-left">
        {open ? <ChevronDown size={13} className="shrink-0 text-subtle" /> : <ChevronRight size={13} className="shrink-0 text-subtle" />}
        <span className="shrink-0 text-sm">{entry.name}</span>
        {entry.type && <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] text-muted">{entry.type}</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-subtle">{entry.description}</span>
        {typeof entry.bytes === "number" && <span className="shrink-0 font-mono text-[11px] text-subtle">{Math.max(1, Math.round(entry.bytes / 1024))} KB</span>}
      </button>
      {open && <div className="mb-2 ml-5 rounded-lg bg-background px-3 py-2 text-sm">{content === null ? <span className="text-xs text-subtle">…</span> : <Markdown text={content} />}</div>}
    </div>
  );
}

/** `memory`: undefined while loading, null when this cutex doesn't provide project memory. `hostId`: the project's host (default: the focus host). */
export function ProjectMemoryList({ hostId, projectId, memory, indexOpenInitially = false }: { hostId?: string; projectId: string; memory: ProjectMemoryView | null | undefined; indexOpenInitially?: boolean }) {
  const { t } = useI18n();
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const host = hostId ?? focus;
  const [indexOpen, setIndexOpen] = useState(indexOpenInitially);
  return (
    <>
      {memory === undefined && <p className="py-2 text-xs text-subtle">…</p>}
      {memory === null && <p className="py-2 text-xs text-subtle">{t("projects.unavailable")}</p>}
      {memory?.index && (
        <div className="border-b border-border">
          <button onClick={() => setIndexOpen(!indexOpen)} className="flex w-full items-center gap-2 py-2 text-left">
            {indexOpen ? <ChevronDown size={13} className="text-subtle" /> : <ChevronRight size={13} className="text-subtle" />}
            <span className="font-mono text-sm">MEMORY.md</span>
            <span className="text-xs text-subtle">{t("projects.memoryIndex")}</span>
          </button>
          {indexOpen && (
            <div className="mb-2 ml-5 rounded-lg bg-background px-3 py-2 text-sm">
              <Markdown text={memory.index} />
            </div>
          )}
        </div>
      )}
      {memory && memory.entries.length === 0 && !memory.index && <p className="py-2 text-xs text-subtle">{t("projects.memoryNone")}</p>}
      {memory?.entries.map((e) => (
        <MemoryEntry key={e.file} hostId={host} projectId={projectId} entry={e} />
      ))}
    </>
  );
}
