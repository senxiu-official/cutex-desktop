// 从 ~/.claude/skills 导入… (cutex `claude-skills-import`, owner): lists the skills of a directory on
// `hostId` (default: that host user's ~/.claude/skills), lets the owner pick some and copies them into
// the host's shared ~/.cutex/claude-skills (lib/claudeSkillsImport). Opened from a Claude agent's
// skills flyout and from a Claude Profile's 行为 section. Nothing here touches the local filesystem.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, LoaderCircle, RefreshCw } from "lucide-react";
import type { ClaudeSkillsImportList, ClaudeSkillsImportResult } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { formatBytes, initialSelection, namesToImport, reasonKey, resultCounts, selectable } from "../lib/claudeSkillsImport";
import { hostApi } from "../store";
import { Checkbox } from "./settings/Form";

export function ClaudeSkillsImportDialog({ hostId, onClose, onImported }: { hostId: string; onClose(): void; onImported?(): void }) {
  const { t } = useI18n();
  const [list, setList] = useState<ClaudeSkillsImportList | null>(null);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClaudeSkillsImportResult | null>(null);

  const load = (from?: string) => {
    setLoading(true);
    setError(null);
    hostApi(hostId)
      .claudeSkillsImportList(from || undefined)
      .then(
        (r) => {
          setList(r);
          setSource(r.source);
          setSelected(initialSelection(r.skills));
        },
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per host
  useEffect(() => load(), [hostId]);

  const names = list ? namesToImport(list.skills, selected, overwrite) : [];
  const run = async () => {
    if (!list || !names.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await hostApi(hostId).importClaudeSkills(names, { source: list.source, overwrite });
      setResult(r);
      if (r.imported.length) onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (name: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  const button = "rounded-md px-3 py-1 text-sm disabled:opacity-50";
  const counts = result ? resultCounts(result) : null;

  // Portalled: the composer column may contain fixed elements (transforms / containment).
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="claude-skills-import-title"
        data-testid="claude-skills-import-dialog"
        className="flex max-h-[76vh] w-[34rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-surface p-4 shadow-2xl"
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <div id="claude-skills-import-title" className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Download size={16} className="shrink-0 text-muted" />
          {t("claudeSkillsImport.title")}
        </div>
        <p className="mb-3 text-xs text-subtle">{t("claudeSkillsImport.intro", { target: list?.target ?? "~/.cutex/claude-skills" })}</p>

        {result && counts ? (
          <div role="status" className="flex flex-col gap-2 text-sm">
            <p>{t("claudeSkillsImport.done", { imported: counts.imported, skipped: counts.skipped, failed: counts.failed })}</p>
            {result.imported.length > 0 && <p className="text-xs text-subtle">{t("claudeSkillsImport.nextStart")}</p>}
            {[...result.skipped.map((s) => ({ ...s, message: "" })), ...result.failed].length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-warn-text">
                {[...result.skipped.map((s) => ({ ...s, message: "" })), ...result.failed].map((f) => (
                  <li key={f.name}>
                    <span className="font-mono">{f.name}</span>: {t(reasonKey(f.reason))}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex justify-end">
              <button autoFocus onClick={onClose} className={`${button} bg-accent text-white`}>
                {t("claudeSkillsImport.close")}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("claudeSkillsImport.source")}
              <span className="flex gap-1.5">
                <input
                  value={source}
                  disabled={busy}
                  spellCheck={false}
                  onChange={(e) => setSource(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      load(source.trim());
                    }
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
                />
                <button type="button" disabled={busy || loading} title={t("claudeSkillsImport.reload")} onClick={() => load(source.trim())} className="rounded-md border border-border px-2 text-muted hover:bg-surface-2 disabled:opacity-50">
                  <RefreshCw size={13} />
                </button>
              </span>
            </label>
            <div className="min-h-[6rem] flex-1 overflow-y-auto rounded-md border border-border">
              {loading ? (
                <p className="flex items-center gap-2 px-3 py-3 text-xs text-subtle"><LoaderCircle size={13} className="animate-spin" />{t("common.loading")}</p>
              ) : !list ? null : !list.sourceExists ? (
                <p className="px-3 py-3 text-xs text-subtle">{t("claudeSkillsImport.noSource")}</p>
              ) : list.skills.length === 0 ? (
                <p className="px-3 py-3 text-xs text-subtle">{t("claudeSkillsImport.empty")}</p>
              ) : (
                <ul data-testid="claude-skills-import-list">
                  {list.skills.map((s) => {
                    const can = selectable(s, overwrite);
                    return (
                      <li key={s.name} className="flex items-start gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0">
                        <span className="pt-0.5">
                          <Checkbox label={s.name} checked={can && selected.has(s.name)} disabled={!can || busy} onChange={(on) => toggle(s.name, on)} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm">
                            <span className={`truncate ${s.importable ? "" : "text-muted"}`}>{s.title ?? s.name}</span>
                            {s.title && s.title !== s.name && <span className="truncate font-mono text-[11px] text-subtle">{s.name}</span>}
                            {s.exists && <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] text-muted">{t("claudeSkillsImport.exists")}</span>}
                            <span className="ml-auto shrink-0 text-[11px] text-subtle tabular-nums">{formatBytes(s.bytes)}</span>
                          </span>
                          {s.description && <span className="block truncate text-xs text-subtle" title={s.description}>{s.description}</span>}
                          {!s.importable && <span className="block text-xs text-warn-text">{t(reasonKey(s.reason))}</span>}
                          {s.importable && s.skippedLinks > 0 && <span className="block text-xs text-subtle">{t("claudeSkillsImport.skippedLinks", { n: s.skippedLinks })}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {list?.truncated && <p className="text-xs text-subtle">{t("claudeSkillsImport.truncated")}</p>}
            {list && list.skills.some((s) => s.exists && s.importable) && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <Checkbox label={t("claudeSkillsImport.overwrite")} checked={overwrite} disabled={busy} onChange={setOverwrite} />
                {t("claudeSkillsImport.overwrite")}
              </label>
            )}
            {error && <p role="alert" className="text-xs text-danger break-words">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={`${button} text-muted hover:bg-surface-2`}>
                {t("claudeSkillsImport.cancel")}
              </button>
              <button type="submit" disabled={!names.length || busy} className={`${button} bg-accent text-white`} data-testid="claude-skills-import-run">
                {busy ? t("claudeSkillsImport.importing") : t("claudeSkillsImport.submit", { n: names.length })}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
