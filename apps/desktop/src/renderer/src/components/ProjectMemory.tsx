// A project's shared memory (cutex `GET /v2/projects/{id}/memory` + one file per entry via
// `GET /v2/projects/{id}/memory/{file}`). Used by the Projects page memory tab and by the composer's
// "+" → 记忆 → 项目记忆 panel, so both show exactly the same content.
// `editable` (the Projects page, host with cutex `project-memory`): 新建 / 编辑 / 删除 through the daemon's
// PUT / DELETE with the revision the edit started from (lib/projectMemoryEdit); 删除 is medium risk, so a
// click-twice button. Without it the list stays read-only.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProjectMemoryView } from "../../../shared/ipc";
import { hostApi, useApp } from "../store";
import { useI18n, type MessageKey } from "../i18n";
import { Markdown } from "./Markdown";
import { Tag } from "./Tag";
import { Button, btnFace, btnShape } from "./Button";
import { ArmedButton } from "./ArmedButton";
import {
  MEMORY_TYPES,
  memoryDraftProblems,
  memoryFileProblem,
  parseMemory,
  saveMemoryEntry,
  slugify,
  type MemoryDraft,
  type MemoryProblem,
} from "../../../shared/projectMemory";

type Entry = ProjectMemoryView["entries"][number];
type Loaded = { content: string; revision: string | null };

const PROBLEM_KEY: Record<MemoryProblem, MessageKey> = {
  fileName: "projects.memoryProblemFileName",
  fileIndex: "projects.memoryProblemFileIndex",
  fileTaken: "projects.memoryProblemFileTaken",
  name: "projects.memoryProblemName",
  description: "projects.memoryProblemDescription",
  descriptionLines: "projects.memoryProblemDescriptionLines",
  type: "projects.memoryProblemType",
  tooLarge: "projects.memoryProblemTooLarge",
};
const TYPE_KEY: Record<string, MessageKey> = {
  user: "projects.memoryTypeUser",
  feedback: "projects.memoryTypeFeedback",
  project: "projects.memoryTypeProject",
  reference: "projects.memoryTypeReference",
};
const FIELD = "w-full rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent";

/** What the editor needs besides the draft: where it saves and what it started from. */
type EditTarget = { file: string | null; loaded: Loaded | null };

function MemoryEditor({
  hostId,
  projectId,
  memory,
  target,
  onDone,
  onCancel,
}: {
  hostId: string;
  projectId: string;
  memory: ProjectMemoryView;
  target: EditTarget;
  /** Saved (or the owner gave up their changes); `note`: what to tell them afterwards (the index was not updated). */
  onDone(note?: string): void;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const isNew = target.file === null;
  const start = useMemo<MemoryDraft>(() => (target.loaded ? parseMemory(target.loaded.content) : { name: "", description: "", type: "project", body: "", frontmatter: null }), [target.loaded]);
  const [draft, setDraft] = useState<MemoryDraft>(start);
  const [file, setFile] = useState(target.file ?? "");
  const [fileTouched, setFileTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ current: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const shownFile = isNew && !fileTouched ? (draft.name ? `${draft.name}.md` : "") : file;
  const taken = useMemo(() => memory.entries.map((e) => e.file), [memory.entries]);
  const problems = [...(isNew ? [memoryFileProblem(shownFile, taken)].filter((p): p is MemoryProblem => !!p) : []), ...memoryDraftProblems(draft)];
  const changed = isNew || draft.name !== start.name || draft.description !== start.description || draft.type !== start.type || draft.body !== start.body;
  const set = (patch: Partial<MemoryDraft>) => {
    setTouched(true);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const save = async (expected: string | null) => {
    setBusy(true);
    setError(null);
    setConflict(null);
    try {
      const prev = isNew ? null : { name: start.name, description: start.description };
      const r = await saveMemoryEntry(hostApi(hostId), projectId, { file: shownFile, draft, baseRevision: expected, prev });
      if (r.ok) return onDone(r.indexError ? t("projects.memoryIndexFailed", { message: r.indexError }) : undefined);
      if (r.code === "revision_conflict") setConflict({ current: r.currentRevision });
      else setError(r.code === "memory_not_found" ? t("projects.memoryGone") : r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = (key: MessageKey, children: React.ReactNode, problem?: MemoryProblem[], frame = "block") => (
    <label className={frame}>
      <span className="mb-0.5 block text-xs text-subtle">{t(key)}</span>
      {children}
      {touched && problem?.map((p) => (problems.includes(p) ? <span key={p} className="mt-0.5 block text-xs text-danger">{t(PROBLEM_KEY[p])}</span> : null))}
    </label>
  );

  return (
    <div data-testid="memory-editor" className="mb-2 space-y-2 rounded-lg bg-background px-3 py-2" onKeyDown={(e) => e.key === "Escape" && !busy && (e.stopPropagation(), onCancel())}>
      <div className="flex flex-wrap gap-2">
        {label(
          "projects.memoryName",
          <input aria-label={t("projects.memoryName")} autoFocus={isNew} value={draft.name} spellCheck={false} placeholder="kebab-case-name" className={`${FIELD} font-mono`} onChange={(e) => set({ name: e.target.value })} onBlur={(e) => !isKebabish(e.target.value) && set({ name: slugify(e.target.value) || e.target.value })} />,
          ["name"],
          "block min-w-[11rem] flex-[2]",
        )}
        {label(
          "projects.memoryFile",
          <input aria-label={t("projects.memoryFile")} value={shownFile} disabled={!isNew} spellCheck={false} placeholder="name.md" className={`${FIELD} font-mono disabled:opacity-60`} onChange={(e) => (setTouched(true), setFileTouched(true), setFile(e.target.value))} />,
          ["fileName", "fileIndex", "fileTaken"],
          "block min-w-[11rem] flex-[2]",
        )}
        {label(
          "projects.memoryType",
          <select aria-label={t("projects.memoryType")} value={draft.type} className={FIELD} onChange={(e) => set({ type: e.target.value })}>
            {!(MEMORY_TYPES as readonly string[]).includes(draft.type) && <option value={draft.type}>{draft.type || "—"}</option>}
            {MEMORY_TYPES.map((ty) => (
              <option key={ty} value={ty}>{t(TYPE_KEY[ty]!)} · {ty}</option>
            ))}
          </select>,
          ["type"],
          "block w-40 flex-none",
        )}
      </div>
      {label(
        "projects.memoryDescription",
        <input aria-label={t("projects.memoryDescription")} value={draft.description} placeholder={t("projects.memoryDescriptionPlaceholder")} className={FIELD} onChange={(e) => set({ description: e.target.value })} />,
        ["description", "descriptionLines"],
      )}
      {label(
        "projects.memoryBody",
        <textarea aria-label={t("projects.memoryBody")} value={draft.body} rows={10} spellCheck={false} placeholder={t("projects.memoryBodyPlaceholder")} className={`${FIELD} min-h-32 resize-y font-mono text-xs leading-relaxed`} onChange={(e) => set({ body: e.target.value })} />,
      )}
      {touched && problems.includes("tooLarge") && <p className="text-xs text-danger">{t(PROBLEM_KEY.tooLarge)}</p>}
      {conflict && (
        <div role="alert" data-testid="memory-conflict" className="flex flex-wrap items-center gap-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs">
          <span className="min-w-[12rem] flex-1">{t(conflict.current ? "projects.memoryConflict" : "projects.memoryConflictGone")}</span>
          <Button size="sm" danger disabled={busy} onClick={() => void save(conflict.current)}>{t("projects.memoryOverwrite")}</Button>
          <Button size="sm" disabled={busy} onClick={() => onDone()}>{t("projects.memoryDiscard")}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" data-testid="memory-save" disabled={busy || !changed || problems.length > 0 || !!conflict} onClick={() => (setTouched(true), void save(target.loaded?.revision ?? null))}>{t("projects.memorySave")}</Button>
        <Button disabled={busy} onClick={onCancel}>{t("projects.memoryCancel")}</Button>
        <span className="min-w-0 flex-1 text-right text-xs text-subtle">{t("projects.memoryLaunchNote")}</span>
      </div>
    </div>
  );
}

/** A memory file as read: its body when it has a frontmatter block (the row already shows name, type and description). */
const shownBody = (content: string) => {
  const d = parseMemory(content);
  return d.frontmatter ? d.body : content;
};

const isKebabish = (v: string) => /^[a-z0-9-]*$/.test(v);

function MemoryEntry({
  hostId,
  projectId,
  entry,
  memory,
  editable,
  onChanged,
}: {
  hostId: string;
  projectId: string;
  entry: Entry;
  memory: ProjectMemoryView;
  editable: boolean;
  onChanged?(): void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    hostApi(hostId).projectMemoryFile(projectId, entry.file).then(
      (d) => (setLoaded({ content: d.content, revision: d.revision ?? entry.revision ?? null }), setReadError(null)),
      (e: unknown) => setReadError(e instanceof Error ? e.message : String(e)),
    );
  const toggle = () => {
    if (!open && loaded === null) void load();
    setOpen(!open);
    setNote(null);
  };
  const remove = async () => {
    const revision = loaded?.revision ?? entry.revision;
    if (!revision) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await hostApi(hostId).projectMemoryDelete(projectId, entry.file, revision);
      if (r.ok || r.code === "memory_not_found") return onChanged?.();
      if (r.code === "revision_conflict") {
        setNote(t("projects.memoryDeleteConflict"));
        await load();
        onChanged?.();
      } else setNote(r.message);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const content = readError !== null ? `> ${readError}` : loaded ? shownBody(loaded.content) : null;
  return (
    <div data-memory-file={entry.file} className="border-b border-border last:border-b-0">
      <button onClick={toggle} className="flex w-full items-center gap-2 py-2 text-left">
        {open ? <ChevronDown size={13} className="shrink-0 text-subtle" /> : <ChevronRight size={13} className="shrink-0 text-subtle" />}
        <span className="shrink-0 text-sm">{entry.name}</span>
        {entry.type && <Tag>{entry.type}</Tag>}
        <span className="min-w-0 flex-1 truncate text-xs text-subtle">{entry.description}</span>
        {typeof entry.bytes === "number" && <span className="shrink-0 font-mono text-caption/[inherit] text-subtle">{Math.max(1, Math.round(entry.bytes / 1024))} KB</span>}
      </button>
      {open && editing && loaded && (
        <div className="ml-5">
          <MemoryEditor
            hostId={hostId}
            projectId={projectId}
            memory={memory}
            target={{ file: entry.file, loaded }}
            onCancel={() => setEditing(false)}
            onDone={(after) => {
              setEditing(false);
              setNote(after ?? null);
              void load();
              onChanged?.();
            }}
          />
        </div>
      )}
      {open && !editing && (
        <div className="mb-2 ml-5 rounded-lg bg-background px-3 py-2 text-sm">
          {content === null ? <span className="text-xs text-subtle">…</span> : <Markdown text={content} />}
          {editable && loaded && (
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
              <Button size="sm" data-testid="memory-edit" disabled={busy} onClick={() => (setNote(null), setEditing(true))}>{t("projects.memoryEdit")}</Button>
              <ArmedButton shape={btnShape({ size: "sm" })} idle={btnFace({ danger: true })} testId="memory-delete" disabled={busy} resetKey={loaded.revision} hint={t("projects.memoryDeleteArmed")} onConfirm={() => void remove()}>
                {t("projects.memoryDelete")}
              </ArmedButton>
              {note && <span role="status" className="min-w-0 flex-1 truncate text-xs text-subtle">{note}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** `memory`: undefined while loading, null when this cutex doesn't provide project memory. `hostId`: the project's host (default: the focus host).
 *  `editable`: offer 新建 / 编辑 / 删除 (the caller checks cutex `project-memory`); `onChanged` reloads `memory` after a change. */
export function ProjectMemoryList({
  hostId,
  projectId,
  memory,
  indexOpenInitially = false,
  editable = false,
  onChanged,
}: {
  hostId?: string;
  projectId: string;
  memory: ProjectMemoryView | null | undefined;
  indexOpenInitially?: boolean;
  editable?: boolean;
  onChanged?(): void;
}) {
  const { t } = useI18n();
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const host = hostId ?? focus;
  const [indexOpen, setIndexOpen] = useState(indexOpenInitially);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const canEdit = editable && !!memory;
  return (
    <>
      {memory === undefined && <p className="py-2 text-xs text-subtle">…</p>}
      {memory === null && <p className="py-2 text-xs text-subtle">{t("projects.unavailable")}</p>}
      {canEdit && (
        <div className="flex justify-end py-2">
          {note && <span role="status" className="mr-2 min-w-0 flex-1 self-center truncate text-xs text-subtle">{note}</span>}
          {!creating && <Button size="sm" data-testid="memory-new" onClick={() => (setNote(null), setCreating(true))}>+ {t("projects.memoryNew")}</Button>}
        </div>
      )}
      {canEdit && creating && (
        <MemoryEditor
          hostId={host}
          projectId={projectId}
          memory={memory}
          target={{ file: null, loaded: null }}
          onCancel={() => setCreating(false)}
          onDone={(after) => {
            setCreating(false);
            setNote(after ?? null);
            onChanged?.();
          }}
        />
      )}
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
      {memory && memory.entries.length === 0 && !memory.index && !creating && <p className="py-2 text-xs text-subtle">{t("projects.memoryNone")}</p>}
      {memory?.entries.map((e) => (
        <MemoryEntry key={e.file} hostId={host} projectId={projectId} entry={e} memory={memory} editable={canEdit} onChanged={onChanged} />
      ))}
    </>
  );
}
