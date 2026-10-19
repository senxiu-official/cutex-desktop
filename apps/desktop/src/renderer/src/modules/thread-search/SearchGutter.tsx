// The conversation search (top-left gutter popover; Ctrl+F): native `thread/searchOccurrences` on the
// open agent's own thread through cutex, results as snippets; a click jumps to the turn (lib/jump).
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { ThreadSearchHit } from "../../../../shared/ipc";
import { IconButton } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { jumpToTurn } from "../../lib/jump";
import { hostApi, useApp, viewOf } from "../../store";
import type { GutterBodyProps, GutterTriggerProps } from "../slots";
import { searchErrorKind, searchTerm, splitSnippet } from "./model";

export function SearchTrigger({ open, toggle }: GutterTriggerProps) {
  const { t } = useI18n();
  return (
    <button onClick={toggle} aria-expanded={open} aria-label={t("thread-search.title")} title={t("thread-search.title")} className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${open ? "bg-accent/10 text-accent" : "text-subtle hover:bg-hover"}`}>
      <Search size={15} />
      <span>{t("thread-search.title")}</span>
    </button>
  );
}

interface Results {
  term: string;
  hits: ThreadSearchHit[];
  cursor: string | null;
  loading: boolean;
  error: string | null;
}

function Snippet({ hit }: { hit: ThreadSearchHit }) {
  const { before, match, after } = splitSnippet(hit);
  return (
    <span className="line-clamp-3 text-[11.5px] [overflow-wrap:anywhere] text-muted">
      {before}
      <mark className="rounded-sm bg-accent/20 px-0.5 text-foreground">{match}</mark>
      {after}
    </span>
  );
}

function SearchBody({ hostId, sessionId, close, docked }: GutterBodyProps) {
  const { t } = useI18n();
  const threadId = useApp((s) => viewOf(s, hostId, sessionId)?.timeline.threadId ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const run = useRef(0);

  const search = (term: string, cursor: string | null) => {
    if (!threadId) return;
    const id = ++run.current;
    setResults((old) => ({ term, hits: cursor && old?.term === term ? old.hits : [], cursor: cursor && old?.term === term ? old.cursor : null, loading: true, error: null }));
    hostApi(hostId).searchThread(sessionId, threadId, term, cursor).then(
      (page) => {
        if (id !== run.current) return;
        setResults((old) => ({ term, hits: [...(cursor && old?.term === term ? old.hits : []), ...page.data], cursor: page.nextCursor, loading: false, error: null }));
      },
      (e: unknown) => {
        if (id !== run.current) return;
        const kind = searchErrorKind(e);
        const text = kind === "offline" ? t("thread-search.offline") : kind === "unsupported" ? t("thread-search.unsupported") : t("thread-search.failed", { error: e instanceof Error ? e.message : String(e) });
        setResults((old) => ({ term, hits: old?.term === term ? old.hits : [], cursor: null, loading: false, error: text }));
      },
    );
  };

  useEffect(() => {
    const term = searchTerm(query);
    if (!term) {
      run.current++;
      setResults(null);
      return;
    }
    const timer = setTimeout(() => search(term, null), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, threadId, sessionId]);

  const pick = (hit: ThreadSearchHit) => {
    void jumpToTurn(hostId, sessionId, hit.turnId);
    if (!docked) close();
  };

  const count = results && !results.loading && results.hits.length > 0 ? t(results.cursor ? "thread-search.countMore" : "thread-search.count", { n: results.hits.length }) : null;
  return (
    <div className="space-y-1 p-1" data-thread-search="">
      <div className="flex items-center gap-1 border-b border-border px-1 py-1.5">
        <Search size={13} className="shrink-0 text-subtle" />
        <input
          autoFocus
          aria-label={t("thread-search.placeholder")}
          placeholder={t("thread-search.placeholder")}
          value={query}
          maxLength={2048}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && results?.hits[0]) {
              e.preventDefault();
              pick(results.hits[0]);
            } else if (e.key === "Escape" && query && !e.repeat && !e.nativeEvent.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
            }
          }}
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
        />
        {count && <span className="shrink-0 text-[11px] text-subtle">{count}</span>}
        <IconButton label={t("thread-search.close")} onClick={close}>
          <X size={13} />
        </IconButton>
      </div>
      {!threadId ? (
        <p className="px-2 py-2 text-xs text-subtle">{t("thread-search.noThread")}</p>
      ) : !results ? (
        <p className="px-2 py-2 text-[11px] text-subtle">{t("thread-search.hint")}</p>
      ) : (
        <div className="max-h-[min(60vh,28rem)] overflow-y-auto">
          {results.hits.map((hit, index) => (
            <button key={`${hit.itemId}:${index}`} data-search-hit={hit.turnId} onClick={() => pick(hit)} className="block w-full min-w-0 rounded-lg px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
              <Snippet hit={hit} />
            </button>
          ))}
          {results.loading && <p className="px-2 py-2 text-xs text-subtle">{t("thread-search.searching")}</p>}
          {results.error && <p className="px-2 py-2 text-xs text-danger">{results.error}</p>}
          {!results.loading && !results.error && results.hits.length === 0 && <p className="px-2 py-2 text-xs text-subtle">{t("thread-search.none")}</p>}
          {!results.loading && results.cursor && (
            <button onClick={() => search(results.term, results.cursor)} className="w-full rounded-lg px-2 py-1.5 text-center text-xs text-accent hover:bg-hover">
              {t("thread-search.more")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Keyed by agent: another agent starts a fresh search. */
export function SearchGutter(props: GutterBodyProps) {
  return <SearchBody key={`${props.hostId}:${props.sessionId}`} {...props} />;
}
