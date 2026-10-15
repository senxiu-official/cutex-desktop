// Unified diff viewer (diff card, artifact compare): per-file header (status, path, +N −M), old / new
// line-number gutters, added / removed rows tinted from the --ok / --danger tokens with the changed
// span of a paired line stronger, long unchanged runs folded (click to show), the unchanged lines
// between hunks counted, large files collapsed by default; horizontal scroll inside each file, wrap
// toggle, copy. Parsing and folding rules: lib/unifiedDiff.ts.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleSlash, Copy, UnfoldVertical, WrapText } from "lucide-react";
import { useI18n } from "../i18n";
import { copyQuietly } from "../lib/copyFeedback";
import { diffFilePath, diffLineCount, hiddenBefore, hunkRows, parseUnifiedDiff, type DiffFile, type DiffHunk, type DiffLine } from "../lib/unifiedDiff";

/** Files with more rows than this start collapsed. */
const LARGE_FILE = 400;

// Opaque tints (the line-number gutter stays sticky over scrolled text).
const ROW_BG = {
  add: "bg-[color-mix(in_oklab,var(--ok)_12%,var(--bg))]",
  del: "bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg))]",
  ctx: "bg-background",
} as const;
const GUTTER_BG = {
  add: "bg-[color-mix(in_oklab,var(--ok)_20%,var(--bg))]",
  del: "bg-[color-mix(in_oklab,var(--danger)_17%,var(--bg))]",
  ctx: "bg-background",
} as const;
const SPAN_BG = {
  add: "rounded-[2px] bg-[color-mix(in_oklab,var(--ok)_30%,transparent)]",
  del: "rounded-[2px] bg-[color-mix(in_oklab,var(--danger)_28%,transparent)]",
  ctx: "",
} as const;
const SIGN = { add: "+", del: "−", ctx: " " } as const;
const SIGN_COLOR = { add: "text-[var(--ok)]", del: "text-danger", ctx: "text-subtle" } as const;

function useCopied(): [boolean, (text: string) => void] {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return [done, (text) => void copyQuietly(text).then(() => setDone(true), () => {})];
}

function Counts({ add, del }: { add: number; del: number }) {
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      <span className="text-[var(--ok)]">+{add}</span> <span className="text-danger">−{del}</span>
    </span>
  );
}

function LineText({ line, wrap }: { line: DiffLine; wrap: boolean }) {
  const { t } = useI18n();
  const ws = wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre";
  const s = line.span;
  return (
    <span className={`min-w-0 flex-1 pr-3 ${ws}`}>
      {s ? (
        <>
          {line.text.slice(0, s[0])}
          <span className={SPAN_BG[line.kind]}>{line.text.slice(s[0], s[1])}</span>
          {line.text.slice(s[1])}
        </>
      ) : (
        line.text
      )}
      {line.noNewline && (
        <span title={t("diffView.noNewline")} aria-label={t("diffView.noNewline")} className="ml-1 inline-flex align-middle text-subtle">
          <CircleSlash size={10} />
        </span>
      )}
    </span>
  );
}

function Row({ line, width, wrap }: { line: DiffLine; width: number; wrap: boolean }) {
  const k = line.kind;
  return (
    <div className={`flex min-h-[18px] ${ROW_BG[k]}`}>
      <span className={`sticky left-0 z-[1] flex shrink-0 select-none text-subtle ${GUTTER_BG[k]}`} aria-hidden>
        <span className="px-1.5 text-right" style={{ width: `calc(${width}ch + 0.75rem)` }}>
          {line.oldNo ?? ""}
        </span>
        <span className="px-1.5 text-right" style={{ width: `calc(${width}ch + 0.75rem)` }}>
          {line.newNo ?? ""}
        </span>
        <span className={`w-4 text-center ${SIGN_COLOR[k]}`}>{SIGN[k]}</span>
      </span>
      <LineText line={line} wrap={wrap} />
    </div>
  );
}

function Separator({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  const cls = "sticky left-0 flex w-full items-center gap-1.5 bg-surface px-2 py-0.5 text-left font-sans text-[11px] text-subtle";
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={`${cls} hover:bg-surface-2 hover:text-foreground`}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function HunkHeader({ hunk }: { hunk: DiffHunk }) {
  const range = hunk.numbered ? `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` : "@@";
  return (
    <div className="flex min-h-[18px] bg-[color-mix(in_oklab,var(--accent)_7%,var(--bg))] text-subtle">
      <span className="whitespace-pre px-2">
        {range}
        {hunk.section && <span className="text-muted"> {hunk.section}</span>}
      </span>
    </div>
  );
}

function FileBody({ file, wrap }: { file: DiffFile; wrap: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const width = useMemo(() => {
    let max = 1;
    for (const h of file.hunks) for (const l of h.lines) max = Math.max(max, l.oldNo ?? 0, l.newNo ?? 0);
    return String(max).length;
  }, [file]);
  if (file.binary) return <p className="px-3 py-2 font-sans text-xs text-subtle">{t("diffView.binary")}</p>;
  if (file.hunks.length === 0) return <p className="px-3 py-2 font-sans text-xs text-subtle">{t("diffView.noContent")}</p>;
  return (
    <div className="overflow-x-auto">
      <div className={`${wrap ? "w-full" : "w-max min-w-full"} py-0.5`}>
        {file.hunks.map((h, hi) => {
          const hidden = hiddenBefore(file, hi);
          const opened = new Set<number>();
          for (const key of open) if (key.startsWith(`${hi}:`)) opened.add(Number(key.slice(hi.toString().length + 1)));
          return (
            <div key={hi}>
              {hidden > 0 && <Separator>⋯ {t("diffView.hiddenLines", { n: hidden })}</Separator>}
              <HunkHeader hunk={h} />
              {hunkRows(h.lines, opened).map((r) =>
                r.type === "line" ? (
                  <Row key={r.index} line={r.line} width={width} wrap={wrap} />
                ) : (
                  <Separator key={`f${r.from}`} onClick={() => setOpen((s) => new Set(s).add(`${hi}:${r.from}`))}>
                    <UnfoldVertical size={11} />
                    {t("diffView.expandLines", { n: r.to - r.from })}
                  </Separator>
                ),
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_STYLE = {
  added: "text-[var(--ok)] bg-[color-mix(in_oklab,var(--ok)_14%,transparent)]",
  deleted: "text-danger bg-[color-mix(in_oklab,var(--danger)_12%,transparent)]",
  renamed: "text-accent bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]",
  copied: "text-accent bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]",
} as const;

function FileBlock({ file, wrap }: { file: DiffFile; wrap: boolean }) {
  const { t } = useI18n();
  const lines = diffLineCount(file);
  const large = lines > LARGE_FILE;
  const [collapsed, setCollapsed] = useState(large);
  const path = diffFilePath(file);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section className="overflow-clip rounded-md border border-border/70 bg-background">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        title={t(collapsed ? "diffView.expandFile" : "diffView.collapseFile")}
        aria-expanded={!collapsed}
        className={`sticky top-0 z-[2] flex w-full items-center gap-1.5 bg-surface px-2 py-1 text-left font-sans text-xs hover:bg-surface-2 ${collapsed ? "" : "border-b border-border/70"}`}
      >
        <Chevron size={13} className="shrink-0 text-subtle" />
        {file.status !== "modified" && <span className={`shrink-0 rounded px-1 text-[10px] leading-4 ${STATUS_STYLE[file.status]}`}>{t(`diffView.status.${file.status}`)}</span>}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" dir="rtl" title={path}>
          <bdi>{path}</bdi>
        </span>
        {file.hunks.length > 0 && <Counts add={file.additions} del={file.deletions} />}
      </button>
      {collapsed ? (
        large && (
          <Separator onClick={() => setCollapsed(false)}>
            <UnfoldVertical size={11} />
            {t("diffView.largeFile", { n: lines })}
          </Separator>
        )
      ) : (
        <div className="font-mono text-[11.5px] leading-[18px] [tab-size:4]">
          <FileBody file={file} wrap={wrap} />
        </div>
      )}
    </section>
  );
}

export function UnifiedDiff({ text, className = "" }: { text: string; className?: string }) {
  const { t } = useI18n();
  const files = useMemo(() => parseUnifiedDiff(text), [text]);
  const [wrap, setWrap] = useState(false);
  const [copied, copy] = useCopied();
  const totals = useMemo(() => files.reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 }), [files]);
  const tool = "flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground";
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2 font-sans text-xs text-subtle">
        {files.length > 1 && <span>{t("diffView.files", { n: files.length })}</span>}
        {files.length > 1 && <Counts add={totals.add} del={totals.del} />}
        <span className="flex-1" />
        <button type="button" onClick={() => setWrap((w) => !w)} title={t("diffView.wrap")} aria-label={t("diffView.wrap")} aria-pressed={wrap} className={`${tool} ${wrap ? "bg-surface-2 text-foreground" : ""}`}>
          <WrapText size={13} />
        </button>
        <button type="button" onClick={() => copy(text)} title={copied ? t("reply.copied") : t("diffView.copy")} aria-label={t("diffView.copy")} className={tool}>
          {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
        </button>
      </div>
      {files.length === 0 ? (
        <pre className={`overflow-x-auto rounded-md border border-border/70 bg-background p-2 font-mono text-[11.5px] ${wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : ""}`}>{text}</pre>
      ) : (
        files.map((f, i) => <FileBlock key={`${i}:${diffFilePath(f)}`} file={f} wrap={wrap} />)
      )}
    </div>
  );
}
