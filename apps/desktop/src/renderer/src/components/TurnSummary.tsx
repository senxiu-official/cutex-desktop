// Turn-end summary (轮尾摘要): a thin muted line under a finished turn's last reply, before its
// action row — "✎ 改了 3 个文件 +12 −4 · [chip] · [chip] · +N ▸". Expanded: one row per changed file
// (查看变更 / 打开 on hover) and per picked link (打开方式 ▾). Data: lib/turnSummary (the turn's
// fileChange items + links of its final reply); clicks: lib/turnSummaryView. No undo yet (needs a
// cutex revert API; DESIGN §4.6).
import { openModifiers } from "../lib/openModifiers";
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown, ChevronRight, ExternalLink, File, FileDiff, FileImage, FilePen, FileText, Globe } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu, openMenuFrom } from "../lib/contextMenu";
import { useUiPrefs } from "../lib/prefs";
import { linkName, linkTypeOf, pickTurnLinks, startsExpanded, turnFileDiff, type TurnChanges, type TurnFileChange, type TurnLink } from "../lib/turnSummary";
import { linkActions, useExistingLinks, useFileActions } from "../lib/turnSummaryView";
import { HOST_FILE_READ_FEATURE, rootFor, scopeFor } from "../lib/workspace";
import { useApp } from "../store";
import { convFeaturesOf, useConvScope, useConvSidebar } from "../lib/conversationScope";
import { openTurnDiff } from "../lib/sideOpen";

const NO_FILES: TurnFileChange[] = [];
/** Link chips on the collapsed line; the rest count as +N. */
const CHIPS = 2;

function Counts({ added, deleted }: { added: number; deleted: number }) {
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-ok-text">+{added}</span> <span className="text-danger">−{deleted}</span>
    </span>
  );
}

function LinkIcon({ link, size }: { link: TurnLink; size: number }) {
  const group = linkTypeOf(link).group;
  const Icon = group === "web" ? Globe : group === "image" ? FileImage : group === "doc" ? FileText : File;
  return <Icon size={size} className="shrink-0 text-subtle" />;
}

function HoverButton({ title, onClick, children }: { title: string; onClick(e: ReactMouseEvent<HTMLButtonElement>): void; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface hover:text-foreground">
      {children}
    </button>
  );
}

export function TurnSummary({ sessionId, turnId, text, changes, latest }: { sessionId: string; turnId: string; /** The turn's final reply (links are picked from it). */ text: string; changes: TurnChanges | undefined; latest: boolean }) {
  const { t } = useI18n();
  const { turnSummary: mode } = useUiPrefs();
  const files = changes?.files ?? NO_FILES;
  const sidebar = useConvSidebar();
  const conv = useConvScope();
  const hostRead = useApp((s) => convFeaturesOf(conv, s).has(HOST_FILE_READ_FEATURE));
  const root = useMemo(() => {
    const scope = scopeFor(sidebar, sessionId);
    return scope ? rootFor(sidebar, scope) : null;
  }, [sidebar, sessionId]);
  const picked = useMemo(() => (mode === "off" ? [] : pickTurnLinks(text, files, { root, hostRead })), [mode, text, files, root, hostRead]);
  const links = useExistingLinks(picked);
  const fileActions = useFileActions(sessionId);
  const [expanded, setExpanded] = useState(() => startsExpanded(mode, latest, files.length));
  if (mode === "off" || (!files.length && !links.length)) return null;
  const chips = links.slice(0, CHIPS);
  const more = links.length - chips.length;
  const toggle = () => setExpanded(!expanded);
  const typeLabel = (link: TurnLink) => {
    const { group, ext } = linkTypeOf(link);
    const word = t(`conversation.turnSummary.type.${group}` as MessageKey);
    return ext ? `${word} · ${ext}` : word;
  };
  return (
    <div className="mt-1.5 text-xs text-muted">
      <div className="flex h-5 min-w-0 items-center gap-1.5">
        {files.length > 0 && (
          <button onClick={toggle} className="flex shrink-0 items-center gap-1.5 hover:text-foreground" aria-expanded={expanded}>
            <FilePen size={13} className="text-subtle" />
            <span>{t("conversation.turnSummary.files", { n: files.length })}</span>
            <Counts added={changes!.added} deleted={changes!.deleted} />
          </button>
        )}
        {chips.map((link, i) => {
          const actions = linkActions(link, fileActions, t);
          return (
            <span key={link.target} className="flex min-w-12 items-center gap-1.5">
              {(i > 0 || files.length > 0) && <span className="shrink-0 text-subtle">·</span>}
              <button
                onClick={(e) => actions.open(e.currentTarget, openModifiers(e))}
                onAuxClick={(e) => e.button === 1 && actions.open(e.currentTarget, openModifiers(e))}
                onContextMenu={contextMenu(actions.menu)}
                title={link.target}
                className="flex h-[18px] max-w-56 min-w-0 items-center gap-1 rounded-md border border-border bg-surface px-1.5 text-[11px] text-muted hover:bg-surface-2 hover:text-foreground"
              >
                <LinkIcon link={link} size={11} />
                <span className="truncate">{linkName(link)}</span>
              </button>
            </span>
          );
        })}
        {more > 0 && (
          <button onClick={toggle} className="shrink-0 text-subtle hover:text-foreground">
            · +{more}
          </button>
        )}
        <button onClick={toggle} title={t(expanded ? "conversation.turnSummary.collapse" : "conversation.turnSummary.expand")} aria-label={t(expanded ? "conversation.turnSummary.collapse" : "conversation.turnSummary.expand")} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface-2 hover:text-foreground">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      </div>
      {expanded && (
        <div className="mt-1 mb-1 max-w-xl rounded-lg border border-border py-1">
          {files.map((file) => {
            const f = fileActions(file.path);
            const name = f.display.split(/[\\/]/).filter(Boolean).pop() ?? f.display;
            const dir = f.display.slice(0, Math.max(0, f.display.length - name.length)).replace(/[\\/]$/, "");
            const from = file.from ? fileActions(file.from).display : null;
            const gone = file.status === "deleted";
            return (
              <div key={file.path} onContextMenu={contextMenu(f.menu)} className="group flex h-6 min-w-0 items-center gap-2 px-2 hover:bg-surface-2">
                <FilePen size={13} className="shrink-0 text-subtle" />
                <span className={`min-w-0 shrink truncate text-foreground ${gone ? "line-through opacity-60" : ""}`} title={f.abs ?? f.display}>
                  {name}
                </span>
                {dir && <span className="min-w-0 flex-1 truncate text-subtle" title={f.display}>{dir}</span>}
                {!dir && <span className="flex-1" />}
                {file.status === "added" && <span className="shrink-0 text-[11px] text-subtle">{t("conversation.turnSummary.added")}</span>}
                {gone && <span className="shrink-0 text-[11px] text-subtle">{t("conversation.turnSummary.deleted")}</span>}
                {from && <span className="max-w-40 shrink-0 truncate text-[11px] text-subtle" title={from}>{t("conversation.turnSummary.movedFrom", { from: from.split(/[\\/]/).pop() ?? from })}</span>}
                <Counts added={file.added} deleted={file.deleted} />
                <span className="flex w-10 shrink-0 justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <HoverButton title={t("conversation.turnSummary.viewDiff")} onClick={() => void openTurnDiff({ sessionId, turnId, path: f.display, diff: turnFileDiff(file, (p) => fileActions(p).display) })}>
                    <FileDiff size={13} />
                  </HoverButton>
                  {!gone && (
                    <HoverButton title={t("conversation.turnSummary.open")} onClick={(e) => f.open(e.currentTarget, openModifiers(e))}>
                      <ExternalLink size={13} />
                    </HoverButton>
                  )}
                </span>
              </div>
            );
          })}
          {files.length > 0 && links.length > 0 && <div className="my-1 border-t border-border" />}
          {links.map((link) => {
            const actions = linkActions(link, fileActions, t);
            return (
              <div key={link.target} onContextMenu={contextMenu(actions.menu)} className="group flex h-6 min-w-0 items-center gap-2 px-2 hover:bg-surface-2">
                <LinkIcon link={link} size={13} />
                <button onClick={(e) => actions.open(e.currentTarget, openModifiers(e))}
                onAuxClick={(e) => e.button === 1 && actions.open(e.currentTarget, openModifiers(e))} title={link.target} className="min-w-0 truncate text-left text-foreground hover:text-accent hover:underline">
                  {linkName(link)}
                </button>
                <span className="min-w-0 flex-1 truncate text-subtle">{typeLabel(link)}</span>
                <button onClick={(e) => openMenuFrom(e.currentTarget, actions.menu())} className="flex shrink-0 items-center gap-0.5 rounded px-1 text-subtle hover:bg-surface hover:text-foreground">
                  {t("conversation.turnSummary.openWith")}
                  <ChevronDown size={12} />
                </button>
              </div>
            );
          })}
          {files.length > 0 && <p className="px-2 pt-1 text-[11px] text-subtle">{t("conversation.turnSummary.footnote")}</p>}
        </div>
      )}
    </div>
  );
}
