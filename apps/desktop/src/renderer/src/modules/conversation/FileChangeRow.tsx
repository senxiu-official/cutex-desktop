// A file change's row (TODO 工具行专用视图, 2026-11-12): the core row as before — the files as links, the +/− counts —
// and, expanded, its diff in the unified diff viewer (per-file header, line numbers, added / removed rows tinted,
// unchanged runs folded; components/UnifiedDiff) instead of one grey block of text. A change with no diff text keeps
// the plain row. Each file gets full --- / +++ headers (lib/turnSummary changeAsDiff, as 查看变更), so the viewer names it.
// A large change (cross-review 2026-11-13: 100 files × 100 lines mounted 60k elements on one click) first shows its
// leading files up to DIFF_FIRST_LINES lines / DIFF_FIRST_FILES files, then 「显示其余 N 个文件」 mounts the rest.
import { useMemo, useState } from "react";
import { FilePen } from "lucide-react";
import type { RawItem } from "../../lib/timeline";
import { toolDetail } from "../../lib/workGroups";
import { changeAsDiff, changeRecords } from "../../lib/turnSummary";
import { PlainToolRow } from "../../components/PlainToolRow";
import { ItemMedia } from "../../components/ItemMedia";
import { UnifiedDiff } from "../../components/UnifiedDiff";
import { useConvHost } from "../../lib/conversationScope";
import { useI18n } from "../../i18n";
import { TimelineRowFallback } from "../TimelineRowFallback";

/** Lines of diff the first expand mounts at most (whole files; the first file always shows — UnifiedDiff folds a big one). */
export const DIFF_FIRST_LINES = 1500;
/** Files the first expand mounts at most. */
export const DIFF_FIRST_FILES = 20;

const lineCount = (text: string) => text.split("\n").length;

/** The per-file diffs, and how many of them the first expand shows. */
export function firstDiffFiles(diffs: readonly string[]): number {
  let lines = 0;
  for (let i = 0; i < diffs.length; i++) {
    lines += lineCount(diffs[i]!);
    if (i > 0 && (i >= DIFF_FIRST_FILES || lines > DIFF_FIRST_LINES)) return i;
  }
  return diffs.length;
}

function CappedDiff({ diffs }: { diffs: readonly string[] }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const first = useMemo(() => firstDiffFiles(diffs), [diffs]);
  const shown = all ? diffs.length : first;
  const text = useMemo(() => diffs.slice(0, shown).join("\n"), [diffs, shown]);
  const rest = diffs.length - shown;
  return (
    <div data-file-change-diff="" className="max-h-96 overflow-auto rounded-md border border-border/60">
      <UnifiedDiff text={text} />
      {rest > 0 && (
        <button type="button" data-file-change-more="" onClick={() => setAll(true)} className="mx-2 mb-2 text-caption/[inherit] text-accent hover:underline">
          {t("conversation.tools.fileChange.more", { n: rest })}
        </button>
      )}
    </div>
  );
}

export function FileChangeRow({ item }: { item: RawItem; sessionId: string }) {
  const hostId = useConvHost();
  const diffs = useMemo(() => (item.type === "fileChange" ? changeRecords(item).filter((c) => c.diff).map((c) => changeAsDiff(c)) : []), [item]);
  if (!diffs.length) return <TimelineRowFallback />;
  return (
    <>
      <PlainToolRow item={item} presentation={{ kind: "fileChange", key: "tool.fileChange", detail: toolDetail(item), icon: FilePen, details: <CappedDiff diffs={diffs} /> }} />
      <ItemMedia item={item} hostId={hostId} />
    </>
  );
}
