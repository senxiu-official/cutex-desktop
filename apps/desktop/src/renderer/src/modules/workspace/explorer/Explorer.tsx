// 文件 card (workspace.files) = the file explorer (docs/design/019-file-explorer.md): an address bar (← → ↑,
// breadcrumb with a dropdown per segment, root switch, ◎ locate, view switch, ▥ preview, ⋯ options), a filter
// row (filter the read folders / search the whole workspace), the tree or the gallery of the current folder,
// and the built-in preview beside (wide) or below (narrow). All data from cutex workspace routes (fs/dir,
// fs/file, fs/search, git/status, the watch), so remote hosts work the same; the only local action is
// 在系统文件管理器中显示 (local host). Pure rules: ./model.ts; remembered state: ./store.ts.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, LayoutGrid, List, LocateFixed, MoreHorizontal, PanelBottom, PanelRight } from "lucide-react";
import type { FsEntry, WorkspaceScope } from "../../../../../shared/ipc";
import { useI18n } from "../../../i18n";
import { contextMenu, openMenuAt, openMenuFrom, type MenuEntry } from "../../../lib/contextMenu";
import { fileMenu } from "../../../lib/menus";
import { fileActions } from "../../../lib/fileActions";
import { enterModifiers, openModifiers, PLAIN_OPEN } from "../../../lib/openModifiers";
import { isWorkspaceDir } from "../../../lib/pathKind";
import { openFile, openFileKept, openHostFile } from "../../../lib/sideOpen";
import { rootFor, scopeKey } from "../../../lib/workspace";
import { mentionText, WORKSPACE_PATHS_MIME } from "../../../lib/workspaceDrag";
import { useSelectedWorkspace, useWorkspace } from "../../../lib/workspaceView";
import { selectedSidebar, useApp } from "../../../store";
import type { SideBodyProps } from "../../slots";
import { PREVIEW, useCurrentField } from "../shared";
import {
  absoluteOf,
  baseOf,
  buildRows,
  clampSplit,
  emptyHistory,
  folderView,
  gitMarks,
  isDirEntry,
  parentOf,
  parentRowIndex,
  planFollow,
  planReveal,
  pushHistory,
  relativeTo,
  rowIndexOf,
  segmentsOf,
  stepHistory,
  typeAhead,
  visibleChildren,
  withExpanded,
  within,
  type EntryRow,
  type ExplorerOptions,
  type History,
  type HistoryEntry,
  type Row,
} from "./model";
import { Gallery, InlinePreview, ROW_H, SearchList, TreeList, type PreviewTarget } from "./parts";
import { patchRootView, setExplorerOptions, useExplorerStore } from "./store";
import { EMPTY_VIEW } from "./model";
import { useListings } from "./useListings";
import { bindingLabel } from "../../../lib/keybindings";
import { withKey } from "../../../lib/useKeybindings";
import { useOwnerWindow } from "../../../lib/ownerContext";
import { ownerWindowOf } from "../../../lib/ownerWindow";

/**
 * The instance state (small; the rest is in ./store): `q` = the 全部搜索 text (v1's search box, restored as
 * a search), `reveal` / `revealSeq` = 在文件树中显示 (lib/sideOpen revealInTree; each open bumps the seq),
 * `root` = which root is shown ("cwd" = the agent's own working folder inside a project).
 */
export type FilesState = { q: string; reveal?: string; revealSeq?: number; root?: "default" | "cwd" };

/** Preview beside the tree from this pane width, below it from this height (019 §1). */
const WIDE = 560;
const TALL = 420;

interface Root {
  id: "default" | "cwd";
  scope: WorkspaceScope;
  abs: string | null;
  label: string;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

export function FilesBody({ instance, setState, sessionId, visible }: SideBodyProps<FilesState>) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const ws = useSelectedWorkspace();
  const sidebar = useApp(selectedSidebar);
  const hostId = ws.hostId;
  // ---------- roots (019 §7): the workspace the rest of the app uses; the agent's own folder when it differs ----------
  const defaultAbs = ws.scope ? rootFor(sidebar, ws.scope) : null;
  const cwd = useMemo(() => {
    if (!ws.scope || ws.scope.kind !== "project" || !sessionId || !sidebar) return null;
    const s = [...sidebar.active, ...sidebar.retired].find((x) => x.cutexSessionId === sessionId);
    return s?.cwd && (!defaultAbs || norm(s.cwd) !== norm(defaultAbs)) ? s.cwd : null;
  }, [ws.scope, sessionId, sidebar, defaultAbs]);
  const cwdScope = useMemo<WorkspaceScope | null>(() => (cwd && sessionId ? { kind: "session", id: sessionId } : null), [cwd, sessionId]);
  const rootId: Root["id"] = instance.state.root === "cwd" && cwdScope ? "cwd" : "default";
  const alt = useWorkspace(rootId === "cwd" ? cwdScope : null, hostId);
  const scope = rootId === "cwd" ? cwdScope : ws.scope;
  const rootAbs = rootId === "cwd" ? cwd : defaultAbs;
  const dirs = rootId === "cwd" ? alt.dirs : ws.dirs;
  const git = rootId === "cwd" ? alt.git : ws.git;
  const api = ws.api;
  const roots: Root[] = [];
  if (ws.scope) roots.push({ id: "default", scope: ws.scope, abs: defaultAbs, label: defaultAbs ? baseOf(norm(defaultAbs)) : t("workspace.files") });
  if (cwdScope && cwd) roots.push({ id: "cwd", scope: cwdScope, abs: cwd, label: baseOf(norm(cwd)) });
  const root = roots.find((r) => r.id === rootId) ?? null;
  const rootKey = scope ? `${hostId}|${scopeKey(scope)}` : "";
  const view = useExplorerStore((s) => (rootKey ? s.roots[rootKey] : undefined)) ?? EMPTY_VIEW;
  const options = useExplorerStore((s) => s.options);
  const patchView = useCallback((patch: Parameters<typeof patchRootView>[1]): void => {
    if (rootKey) patchRootView(rootKey, patch);
  }, [rootKey]);
  const setRoot = useCallback((id: Root["id"]) => setState({ ...instance.state, root: id }), [instance.state, setState]);

  // Paths: the explorer's are relative to the shown root; the rest of the app's to the default root.
  const toDefault = useCallback(
    (rel: string): { rel: string } | { abs: string } | null => {
      if (rootId === "default") return { rel };
      if (!cwd) return null;
      const abs = absoluteOf(cwd, rel);
      const r = defaultAbs ? relativeTo(abs, defaultAbs) : null;
      return r !== null ? { rel: r } : { abs };
    },
    [rootId, cwd, defaultAbs],
  );
  const fromDefault = useCallback(
    (rel: string): string | null => {
      if (rootId === "default") return rel;
      if (!cwd || !defaultAbs) return null;
      return relativeTo(absoluteOf(defaultAbs, rel), cwd);
    },
    [rootId, cwd, defaultAbs],
  );

  // ---------- filter / search ----------
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState<string | null>(instance.state.q ? instance.state.q : null);
  const [searchSel, setSearchSel] = useState(0);
  const [results, setResults] = useState<string[] | null>(null);
  const saved = useRef(instance.state.q ?? "");
  useEffect(() => {
    const q = search ?? "";
    if (q === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = q;
      setState({ ...instance.state, q });
    }, 400);
    return () => clearTimeout(timer);
  }, [search, instance.state, setState]);
  useEffect(() => {
    if (!scope || search === null || !search.trim()) {
      setResults(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api.fsSearch(scope, search, 200).then(
        (r) => {
          if (!live) return;
          setResults(r.results.map((x) => x.path));
          setSearchSel(0);
        },
        () => live && setResults([]),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, scope, search, ws.revision]);

  // ---------- rows ----------
  const marks = useMemo(() => gitMarks(git), [git]);
  const [force, setForce] = useState<string | null>(null);
  const [wanted, setWanted] = useState<string[]>([view.loc]);
  const listings = useListings(api, scope, dirs, wanted);
  const expanded = useMemo(() => new Set(view.expanded), [view.expanded]);
  const { rows, wanted: nextWanted } = useMemo(
    () => buildRows({ listings: listings.listings, loc: view.loc, expanded, options, hidden: view.hidden, marks, filter, force }),
    [listings.listings, view.loc, expanded, options, view.hidden, marks, filter, force],
  );
  const wantedKey = nextWanted.join("\n");
  useEffect(() => {
    setWanted((prev) => (prev.join("\n") === wantedKey ? prev : wantedKey.split("\n")));
  }, [wantedKey]);
  const locEntries = listings.listings.get(view.loc)?.entries ?? null;
  const mode = folderView(view, view.loc, locEntries);
  const galleryEntries = useMemo(
    () => (locEntries ? visibleChildren(locEntries, { options, hidden: view.hidden, marks, force }).slice(0, 2000) : []),
    [locEntries, options, view.hidden, marks, force],
  );
  const showGallery = mode === "gallery" && !filter.trim() && search === null;

  // ---------- selection ----------
  const sel = view.sel;
  const [multi, setMulti] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<{ index: number; center: boolean; seq: number } | null>(null);
  const pendingScroll = useRef<{ path: string; center: boolean } | null>(null);
  const select = useCallback(
    (path: string | null, opts: { center?: boolean; keepMulti?: boolean } = {}) => {
      patchView({ sel: path });
      if (!opts.keepMulti) setMulti(new Set(path !== null ? [path] : []));
      anchor.current = path;
      if (path !== null) pendingScroll.current = { path, center: !!opts.center };
    },
    [patchView],
  );
  // Scroll a selected row in once it is there (its folder may still be loading).
  useEffect(() => {
    const want = pendingScroll.current;
    if (!want) return;
    const i = rowIndexOf(rows, want.path);
    if (i < 0) return;
    pendingScroll.current = null;
    setScrollTo((s) => ({ index: i, center: want.center, seq: (s?.seq ?? 0) + 1 }));
  }, [rows, sel]);

  // ---------- history (019 §2; in memory, one root's agent) ----------
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const here = useCallback((): HistoryEntry => ({ root: rootId, loc: view.loc, sel: view.sel, scroll: scrollTop.current }), [rootId, view.loc, view.sel]);
  const [history, setHistory] = useState<History>(() => emptyHistory({ root: rootId, loc: view.loc, sel: view.sel, scroll: 0 }));
  const [initialScroll, setInitialScroll] = useState(0);
  const [listEpoch, setListEpoch] = useState(0);
  const agentKey = ws.scope ? `${hostId}|${scopeKey(ws.scope)}` : "";
  const lastAgent = useRef(agentKey);
  useEffect(() => {
    if (lastAgent.current === agentKey) return;
    lastAgent.current = agentKey;
    // Another agent (the card follows the selected one): its root, its remembered place, no history (rule 3).
    setHistory(emptyHistory({ root: rootId, loc: view.loc, sel: view.sel, scroll: 0 }));
    setFilter("");
    setForce(null);
    setMulti(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);
  const remount = (scroll: number) => {
    setInitialScroll(scroll);
    setListEpoch((n) => n + 1);
  };
  const navigate = useCallback(
    (loc: string, opts: { sel?: string | null; root?: Root["id"] } = {}) => {
      const nextRoot = opts.root ?? rootId;
      if (loc === view.loc && nextRoot === rootId) {
        if (opts.sel !== undefined) select(opts.sel, { center: true });
        return;
      }
      // ↑ / entering: the folder we came from is selected (Windows / Finder).
      const cameFrom = within(view.loc, loc) && view.loc !== loc ? (loc ? `${loc}/${(loc ? view.loc.slice(loc.length + 1) : view.loc).split("/")[0]}` : view.loc.split("/")[0]!) : null;
      const nextSel = opts.sel !== undefined ? opts.sel : nextRoot === rootId ? cameFrom : null;
      setHistory((h) => pushHistory(h, here(), { root: nextRoot, loc, sel: nextSel, scroll: 0 }));
      if (nextRoot !== rootId) {
        setRoot(nextRoot);
        const key = `${hostId}|${scopeKey(nextRoot === "cwd" ? cwdScope! : ws.scope!)}`;
        patchRootView(key, { loc, sel: nextSel });
      } else patchView({ loc, sel: nextSel });
      setMulti(new Set(nextSel !== null ? [nextSel] : []));
      setFilter("");
      setSearch(null);
      setForce(null);
      if (nextSel !== null) pendingScroll.current = { path: nextSel, center: true };
      remount(0);
    },
    [rootId, view.loc, here, select, setRoot, hostId, cwdScope, ws.scope, patchView],
  );
  const step = useCallback(
    (delta: number) => {
      const next = stepHistory(history, here(), delta);
      if (!next) return;
      const e = next.entries[next.index]!;
      setHistory(next);
      if (e.root !== rootId && (e.root === "default" || cwdScope)) {
        setRoot(e.root === "cwd" ? "cwd" : "default");
        patchRootView(`${hostId}|${scopeKey(e.root === "cwd" ? cwdScope! : ws.scope!)}`, { loc: e.loc, sel: e.sel });
      } else patchView({ loc: e.loc, sel: e.sel });
      setMulti(new Set(e.sel !== null ? [e.sel] : []));
      setFilter("");
      setSearch(null);
      setForce(null);
      remount(e.scroll);
    },
    [history, here, rootId, cwdScope, setRoot, hostId, ws.scope, patchView],
  );
  const up = useCallback(() => {
    if (view.loc) navigate(parentOf(view.loc), { sel: view.loc });
  }, [view.loc, navigate]);

  // A current folder that went away: up to the nearest one still there (019 §9).
  useEffect(() => {
    if (!view.loc || !listings.missing.has(view.loc)) return;
    useApp.getState().notify(t("workspace.fx.gone", { name: view.loc }), "info");
    patchView({ loc: parentOf(view.loc), sel: null });
  }, [listings.missing, view.loc, patchView, t]);

  const toggleRow = (row: EntryRow, open?: boolean) => {
    const want = open ?? !row.open;
    patchView((v) => {
      let list = v.expanded;
      // A merged chain opens / closes as one row.
      for (const c of row.chain) list = withExpanded(list, c.path, false);
      return { expanded: want ? withExpanded(list, row.path, true) : list };
    });
  };

  // ---------- reveal (019 §3) and follow ----------
  const revealSeq = instance.state.revealSeq ?? 0;
  const applyPlan = useCallback(
    (path: string, isDir: boolean) => {
      const plan = planReveal(path, view.loc, isDir);
      setFilter("");
      setSearch(null);
      if (plan.loc !== null) navigate(plan.loc, { sel: plan.sel });
      patchView((x) => ({ expanded: plan.expand.reduce((l, p) => withExpanded(l, p, true), x.expanded), sel: plan.sel }));
      setMulti(new Set([plan.sel]));
      // Shown even when hidden / ignored / not a change (rule 4: the row says 已隐藏).
      setForce(path);
      pendingScroll.current = { path: plan.sel, center: true };
      setFlash(path);
      setTimeout(() => setFlash((f) => (f === path ? null : f)), 1200);
    },
    [view.loc, navigate, patchView],
  );
  // 0: a reveal that opened this card (mounted with revealSeq 1) applies too; a restored card has none.
  const lastReveal = useRef(0);
  useEffect(() => {
    if (!revealSeq || revealSeq === lastReveal.current || instance.state.reveal === undefined || !ws.scope) return;
    lastReveal.current = revealSeq;
    const target = instance.state.reveal;
    // Shown in the agent's own folder when it is in there, else in the default root.
    let rel = fromDefault(target);
    if (rel === null) {
      setRoot("default");
      rel = target;
    }
    const finalRel = rel;
    void isWorkspaceDir(api, hostId, ws.scope, target).then((dir) => applyPlan(finalRel, dir));
    listRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealSeq]);
  const current = useCurrentField(PREVIEW, "path");
  const currentRel = useMemo(() => {
    if (current === null) return null;
    // A host preview inside the root counts too.
    const rel = /^([a-zA-Z]:)?[\\/]/.test(current) ? (defaultAbs ? relativeTo(current, defaultAbs) : null) : current;
    return rel === null ? null : fromDefault(rel);
  }, [current, defaultAbs, fromDefault]);
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!options.follow || currentRel === null || currentRel === followed.current) return;
    followed.current = currentRel;
    const plan = planFollow(currentRel, view.loc);
    if (!plan) return;
    patchView((x) => ({ expanded: plan.expand.reduce((l, p) => withExpanded(l, p, true), x.expanded), sel: plan.sel }));
    setMulti(new Set([plan.sel]));
    pendingScroll.current = { path: plan.sel, center: false };
  }, [currentRel, options.follow, view.loc, patchView]);
  const currentOutside = currentRel !== null && !(within(currentRel, view.loc) && currentRel !== view.loc);

  // ---------- opening ----------
  const openKept = useCallback(
    (rel: string, mods = PLAIN_OPEN) => {
      const target = toDefault(rel);
      if (!target) return;
      if ("rel" in target) openFileKept(target.rel, mods);
      else openHostFile(target.abs, null, mods);
    },
    [toDefault],
  );
  const openBrowse = useCallback(
    (rel: string, mods = PLAIN_OPEN) => {
      const target = toDefault(rel);
      if (!target) return;
      if ("rel" in target) openFile(target.rel, null, "browse", mods);
      else openHostFile(target.abs, null, mods);
    },
    [toDefault],
  );

  // ---------- layout: preview beside / below / off ----------
  const box = useRef<HTMLDivElement>(null);
  // Only the two flags the layout reads: a Shelf edge being dragged resizes this box on every step, and a new
  // size each time re-rendered the whole tree per step (perf/shelf-divider-drag).
  // (Compared before setting: an updater returning the same state could still render and commit once per step.)
  const [size, setSize] = useState({ wide: true, tall: true });
  const sizeNow = useRef(size);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = (w: number, h: number) => {
      const old = sizeNow.current;
      if (old.wide === w >= WIDE && old.tall === h >= TALL) return;
      setSize((sizeNow.current = { wide: w >= WIDE, tall: h >= TALL }));
    };
    const ro = new win.ResizeObserver(() => fit(el.clientWidth, el.clientHeight));
    ro.observe(el);
    fit(el.clientWidth || 600, el.clientHeight || 600);
    return () => ro.disconnect();
  }, []);
  const [forced, setForced] = useState(false);
  const beside = size.wide;
  const roomy = beside || size.tall;
  const previewShown = options.preview && (roomy || forced);
  const togglePreview = () => {
    if (!roomy) setForced((f) => !f || !options.preview);
    setExplorerOptions({ preview: roomy ? !options.preview : !(options.preview && forced) });
  };

  // ---------- keys ----------
  const typed = useRef({ text: "", at: 0 });
  const selIndex = rowIndexOf(rows, sel);
  const moveTo = (i: number, extend: boolean) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r || r.type !== "entry") {
      // Skip note rows in the direction of travel.
      const dir = i > selIndex ? 1 : -1;
      for (let k = i + dir; k >= 0 && k < rows.length; k += dir) if (rows[k]!.type === "entry") return moveTo(k, extend);
      return;
    }
    if (extend && anchor.current !== null) {
      const a = rowIndexOf(rows, anchor.current);
      const [lo, hi] = a < 0 ? [i, i] : [Math.min(a, i), Math.max(a, i)];
      setMulti(new Set(rows.slice(lo, hi + 1).flatMap((x) => (x.type === "entry" ? [x.path] : []))));
      patchView({ sel: r.path });
      pendingScroll.current = { path: r.path, center: false };
    } else select(r.path);
  };
  const navKeys = (e: KeyboardEvent) => {
    const mac = /Mac/i.test(navigator.platform);
    if ((e.altKey && e.key === "ArrowLeft") || (mac && e.metaKey && e.key === "[")) step(-1);
    else if ((e.altKey && e.key === "ArrowRight") || (mac && e.metaKey && e.key === "]")) step(1);
    else if ((e.altKey && e.key === "ArrowUp") || (mac && e.metaKey && e.key === "ArrowUp") || e.key === "Backspace") up();
    else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };
  const commonKeys = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === " " && !mod) {
      e.preventDefault();
      togglePreview();
    } else if (e.key === "/" || (mod && e.key.toLowerCase() === "f")) {
      e.preventDefault();
      e.stopPropagation();
      filterInput.current?.focus();
    } else if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      const paths = multi.size ? [...multi] : sel !== null ? [sel] : [];
      if (!paths.length) return true;
      const text = paths.map((p) => (e.altKey && rootAbs ? absoluteOf(rootAbs, p) : p)).join("\n");
      void navigator.clipboard?.writeText(text);
      useApp.getState().notify(t("workspace.copied"), "info");
    } else if (e.key === "Escape" && (multi.size > 1 || filter)) {
      e.preventDefault();
      e.stopPropagation();
      if (filter) setFilter("");
      else setMulti(new Set(sel !== null ? [sel] : []));
    } else return false;
    return true;
  };
  const onTreeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (navKeys(e) || commonKeys(e)) return;
    const row = rows[selIndex];
    const entry = row?.type === "entry" ? row : null;
    const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? 400) / ROW_H) - 1);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return moveTo(selIndex < 0 ? 0 : selIndex + 1, e.shiftKey);
      case "ArrowUp":
        e.preventDefault();
        return moveTo(selIndex < 0 ? 0 : selIndex - 1, e.shiftKey);
      case "Home":
        e.preventDefault();
        return moveTo(0, e.shiftKey);
      case "End":
        e.preventDefault();
        return moveTo(rows.length - 1, e.shiftKey);
      case "PageDown":
        e.preventDefault();
        return moveTo(selIndex + page, e.shiftKey);
      case "PageUp":
        e.preventDefault();
        return moveTo(Math.max(0, selIndex - page), e.shiftKey);
      case "ArrowRight":
        e.preventDefault();
        if (entry?.dir) {
          if (!entry.open) toggleRow(entry, true);
          else moveTo(selIndex + 1, false);
        }
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (!entry) return;
        if (entry.dir && entry.open) return toggleRow(entry, false);
        const p = parentRowIndex(rows, selIndex);
        if (p >= 0) moveTo(p, false);
        return;
      }
      case "Enter": {
        e.preventDefault();
        if (!entry) return;
        if (entry.dir) return navigate(entry.path);
        const mods = enterModifiers(e);
        return openKept(entry.path, mods ?? PLAIN_OPEN);
      }
    }
    // Type-ahead (letters typed within 0.7 s make one word).
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
      const now = Date.now();
      const text = now - typed.current.at < 700 ? typed.current.text + e.key : e.key;
      typed.current = { text, at: now };
      const i = typeAhead(rows, selIndex, text);
      if (i >= 0) {
        e.preventDefault();
        moveTo(i, false);
      }
    }
  };
  const onGalleryKey = (e: KeyboardEvent<HTMLDivElement>, columns: number) => {
    if (navKeys(e) || commonKeys(e)) return;
    const i = galleryEntries.findIndex((x) => x.path === sel);
    const go = (j: number) => {
      const x = galleryEntries[Math.max(0, Math.min(galleryEntries.length - 1, j))];
      if (x) select(x.path);
    };
    const delta: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (e.key in delta) {
      e.preventDefault();
      return go(i < 0 ? 0 : i + delta[e.key]!);
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      return go(e.key === "Home" ? 0 : galleryEntries.length - 1);
    }
    if (e.key === "Enter" && i >= 0) {
      e.preventDefault();
      const x = galleryEntries[i]!;
      if (isDirEntry(x)) navigate(x.path);
      else openKept(x.path, enterModifiers(e) ?? PLAIN_OPEN);
    }
  };

  // ---------- mouse / menus ----------
  const clickPath = (e: MouseEvent, path: string, dir: boolean, row: EntryRow | null) => {
    listRef.current?.focus({ preventScroll: true });
    if (e.ctrlKey || e.metaKey) {
      // Explorer convention (019 §4): Ctrl/⌘ + click adds / removes one; a new tab is the middle click or Ctrl/⌘ + Enter.
      setMulti((m) => {
        const next = new Set(m);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      patchView({ sel: path });
      anchor.current = path;
      return;
    }
    if (e.shiftKey && anchor.current !== null) {
      const list: string[] = row ? rows.flatMap((x) => (x.type === "entry" ? [x.path] : [])) : galleryEntries.map((x) => x.path);
      const a = list.indexOf(anchor.current);
      const b = list.indexOf(path);
      if (a >= 0 && b >= 0) {
        setMulti(new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1)));
        patchView({ sel: path });
        return;
      }
    }
    select(path);
    if (dir && row) toggleRow(row);
    // Decision 1: a click selects and shows the built-in preview; without it (too small / off) it opens the 预览 card.
    else if (!dir && !previewShown) openBrowse(path);
  };
  const dragPaths = (e: DragEvent, path: string) => {
    const paths = (multi.has(path) ? [...multi] : [path]).map((p) => {
      const d = toDefault(p);
      return d ? ("rel" in d ? d.rel : d.abs) : p;
    });
    e.dataTransfer.setData(WORKSPACE_PATHS_MIME, JSON.stringify(paths));
    e.dataTransfer.setData("text/plain", paths.join("\n"));
    e.dataTransfer.effectAllowed = "copy";
  };
  const menuFor = (path: string, dir: boolean, changed: boolean): MenuEntry[] => {
    const many = multi.size > 1 && multi.has(path);
    const paths = many ? [...multi] : [path];
    const defaults = paths.map((p) => toDefault(p));
    const sessionOf = useApp.getState().selectedId;
    const own: MenuEntry[] = [
      many && { label: t("workspace.fx.selected", { n: paths.length }), note: true, disabled: true, onSelect: () => {} },
      !many && dir && { label: t("workspace.fx.enter"), hint: t("workspace.fx.enterHint"), icon: <ChevronRight size={14} />, onSelect: () => navigate(path) },
      !many && !dir && { label: t("workspace.fx.openOwn"), hint: "Enter", onSelect: () => openKept(path) },
      !many && !dir && { label: t("workspace.fx.openBeside"), hint: "Ctrl+Enter", onSelect: () => openKept(path, { newInstance: true, focus: true }) },
    ];
    if (many) {
      const text = (abs: boolean) => paths.map((p) => (abs && rootAbs ? absoluteOf(rootAbs, p) : p)).join("\n");
      return [
        ...own,
        "separator",
        { label: t("workspace.fx.copyRel"), hint: "Ctrl+C", onSelect: () => void navigator.clipboard?.writeText(text(false)) },
        rootAbs && { label: t("workspace.fx.copyAbs"), onSelect: () => void navigator.clipboard?.writeText(text(true)) },
        sessionOf && {
          label: t("workspace.fx.mentionN", { n: paths.length }),
          onSelect: () => useApp.getState().insertIntoComposer(sessionOf, mentionText(defaults.map((d, i) => (d ? ("rel" in d ? d.rel : d.abs) : paths[i]!))), "append"),
        },
      ];
    }
    const d = defaults[0];
    const base = d && "rel" in d ? fileMenu(d.rel, defaultAbs, t, { isDir: dir, changed, inTree: true, hostId }) : [];
    // The shared menu's 预览 is the click here; keep the rest (diff, copy, mention, show in folder).
    const rest = base.filter((x) => !(x && typeof x === "object" && x.label === t("menu.preview")));
    if (!(d && "rel" in d) && rootAbs) {
      const abs = absoluteOf(rootAbs, path);
      rest.push("separator", ...fileActions({ hostId, path: abs, isDir: dir }, t));
    }
    return [...own, ...rest];
  };
  const rowMenu = (e: MouseEvent, path: string, dir: boolean, changed: boolean) => {
    if (!multi.has(path)) select(path);
    contextMenu(() => menuFor(path, dir, changed))(e);
  };
  const filterInput = useRef<HTMLInputElement>(null);

  const optionsMenu = (el: HTMLElement) => {
    const check = (on: boolean) => (on ? <Check size={14} /> : <span className="inline-block w-3.5" />);
    const set = (patch: Partial<ExplorerOptions>) => () => setExplorerOptions(patch);
    openMenuFrom(el, [
      { label: t("workspace.fx.follow"), icon: check(options.follow), onSelect: set({ follow: !options.follow }) },
      { label: t("workspace.fx.collapseAll"), onSelect: () => patchView({ expanded: [] }) },
      "separator",
      {
        label: t("workspace.fx.sort"),
        onSelect: () => {},
        submenu: [
          ...(["name", "mtime", "size", "kind"] as const).map((k) => ({ label: t(`workspace.fx.sort.${k}`), icon: check(options.sort === k), onSelect: set({ sort: k }) })),
          "separator" as const,
          { label: t("workspace.fx.sortDesc"), icon: check(options.desc), onSelect: set({ desc: !options.desc }) },
          { label: t("workspace.fx.foldersFirst"), icon: check(options.foldersFirst), onSelect: set({ foldersFirst: !options.foldersFirst }) },
        ],
      },
      { label: t("workspace.fx.compact"), icon: check(options.compact), onSelect: set({ compact: !options.compact }) },
      { label: t("workspace.fx.hidden"), icon: check(view.hidden), onSelect: () => patchView({ hidden: !view.hidden }) },
      { label: t("workspace.fx.ignoredDim"), icon: check(options.ignored === "dim"), onSelect: set({ ignored: "dim" }) },
      { label: t("workspace.fx.ignoredHide"), icon: check(options.ignored === "hide"), onSelect: set({ ignored: "hide" }) },
      { label: t("workspace.fx.changesOnly"), icon: check(options.changesOnly), onSelect: set({ changesOnly: !options.changesOnly }) },
      "separator",
      {
        label: t("workspace.fx.thumbSize"),
        onSelect: () => {},
        submenu: ([0, 1, 2] as const).map((n) => ({ label: t(`workspace.fx.thumb.${n}`), icon: check(options.thumb === n), onSelect: set({ thumb: n }) })),
      },
      { label: t("workspace.fx.refresh"), onSelect: () => dirs.invalidate({ all: true }) },
    ]);
  };
  const historyMenu = (e: MouseEvent) => {
    e.preventDefault();
    const items: MenuEntry[] = history.entries
      .map((h, i) => ({ h, i }))
      .reverse()
      .map(({ h, i }) => ({
        label: `${roots.find((r) => r.id === h.root)?.label ?? ""}${h.loc ? `/${h.loc}` : ""}`,
        icon: i === history.index ? <Check size={14} /> : <span className="inline-block w-3.5" />,
        onSelect: () => step(i - history.index),
      }));
    openMenuAt(e.clientX, e.clientY, items);
  };
  const folderMenu = async (el: HTMLElement, parent: string, current: string | null) => {
    let entries: FsEntry[] = [];
    try {
      entries = await listings.read(parent);
    } catch {
      /* the menu says there is nothing */
    }
    const kids = visibleChildren(entries, { options, hidden: view.hidden, marks, force: null }).filter(isDirEntry);
    openMenuFrom(
      el,
      kids.length
        ? kids.slice(0, 300).map((k) => ({ label: k.name, icon: current === k.path ? <Check size={14} /> : <span className="inline-block w-3.5" />, onSelect: () => navigate(k.path) }))
        : [{ label: t("workspace.fx.noFolders"), disabled: true, onSelect: () => {} }],
    );
  };
  const rootMenu = (el: HTMLElement) => {
    const entries: MenuEntry[] = roots.map((r) => ({
      label: r.label,
      hint: t(r.id === "default" ? (r.scope.kind === "project" ? "workspace.fx.rootProject" : "workspace.fx.rootCwd") : "workspace.fx.rootCwd"),
      icon: r.id === rootId ? <Check size={14} /> : <span className="inline-block w-3.5" />,
      onSelect: () => (r.id === rootId ? navigate("") : navigate(rootView(r) ?? "", { root: r.id })),
    }));
    openMenuFrom(el, entries);
  };
  const rootView = (r: Root) => useExplorerStore.getState().roots[`${hostId}|${scopeKey(r.scope)}`]?.loc;

  // ---------- address bar input ----------
  const [editing, setEditing] = useState(false);
  const goToTyped = async (raw: string) => {
    setEditing(false);
    const v = raw.trim().replace(/[\\/]+$/, "");
    if (!scope) return;
    const absLike = /^([a-zA-Z]:)?[\\/]/.test(v);
    const rel = absLike ? (rootAbs ? relativeTo(v, rootAbs) : null) : v.replace(/^\.\//, "");
    if (rel === null) return useApp.getState().notify(t("workspace.revealOutside"), "info");
    try {
      if (await isWorkspaceDir(api, hostId, scope, rel)) navigate(rel);
      else applyPlan(rel, false);
    } catch {
      useApp.getState().notify(t("workspace.fx.notFound", { path: v }), "info");
    }
  };

  // ---------- render ----------
  if (!ws.scope || !scope || !root) return <p className="p-3 text-xs text-subtle">{t("workspace.noScope")}</p>;
  if (ws.error && rootId === "default") return <p className="p-3 text-xs text-danger">{ws.error}</p>;
  const button = "grid size-[26px] shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-35";
  const thumbKey = `${hostId}|${scopeKey(scope)}`;
  const target: PreviewTarget | null = (() => {
    if (search !== null) {
      const p = results?.[searchSel];
      return p ? { path: p, name: baseOf(p), dir: false, entry: null, git: marks.files.get(p) ?? null } : null;
    }
    if (sel === null) return null;
    const r = rows.find((x): x is EntryRow => x.type === "entry" && x.path === sel);
    const g = galleryEntries.find((x) => x.path === sel);
    const entry = r?.entry ?? g ?? null;
    if (!entry) return null;
    const dir = isDirEntry(entry);
    return { path: sel, name: entry.name, dir, entry, git: dir ? null : (marks.files.get(sel) ?? null) };
  })();
  const segments = segmentsOf(view.loc);
  const note = (row: Exclude<Row, EntryRow>) => {
    if (row.type === "loading") return "…";
    if (row.type === "error") return row.text;
    if (row.type === "more") return t("workspace.fx.moreItems", { n: row.count ?? 0 });
    if (filter.trim())
      return (
        <button className="text-accent hover:underline" onClick={() => startSearch(filter)}>
          {t("workspace.fx.noMatch", { q: filter.trim() })}
        </button>
      );
    return options.changesOnly ? t("workspace.fx.noChanges") : t("workspace.fx.emptyFolder");
  };
  const startSearch = (q: string) => {
    setSearch(q);
    setFilter("");
    setSearchSel(0);
    setTimeout(() => filterInput.current?.focus());
  };
  const previewEl = previewShown && (
    <div className={`flex min-h-0 min-w-0 flex-col ${beside ? "border-l" : "border-t"} border-border/60`} style={{ flex: `calc(1 - var(--fx-split, ${options.split})) 1 0` }}>
      <InlinePreview
        visible={visible}
        api={api}
        hostId={hostId}
        scope={scope}
        thumbKey={thumbKey}
        target={target}
        multi={search === null ? multi.size : 0}
        children={target?.dir ? (listings.listings.get(target.path)?.entries ?? null) : null}
        onOpenKept={() => target && openKept(target.path)}
        onEnter={() => target && navigate(target.path)}
        onMenu={(el) => target && openMenuFrom(el, menuFor(target.path, target.dir, !!target.git))}
        onFolder={() => target && navigate(target.path)}
      />
    </div>
  );
  return (
    <div ref={box} className="flex h-full min-h-0 flex-col" data-explorer="">
      {/* Address bar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border/60 px-1.5 py-1">
        <button className={button} disabled={history.index <= 0} onClick={() => step(-1)} onContextMenu={historyMenu} title={t("workspace.fx.back")} aria-label={t("workspace.fx.back")}>
          <ArrowLeft size={15} />
        </button>
        <button className={button} disabled={history.index >= history.entries.length - 1} onClick={() => step(1)} title={t("workspace.fx.forward")} aria-label={t("workspace.fx.forward")}>
          <ArrowRight size={15} />
        </button>
        <button className={button} disabled={!view.loc} onClick={up} title={t("workspace.fx.up")} aria-label={t("workspace.fx.up")}>
          <ArrowUp size={15} />
        </button>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        {editing ? (
          <input
            autoFocus
            defaultValue={rootAbs ? absoluteOf(rootAbs, view.loc) : view.loc}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setEditing(false);
              } else if (e.key === "Enter") void goToTyped(e.currentTarget.value);
            }}
            aria-label={t("workspace.fx.address")}
            className="h-[26px] min-w-0 flex-1 rounded-md border border-accent bg-background px-2 font-mono text-xs outline-none"
          />
        ) : (
          <div className="flex h-[26px] min-w-0 flex-1 items-center rounded-md hover:bg-surface-2" onClick={(e) => e.target === e.currentTarget && setEditing(true)} title={t("workspace.fx.addressHint")}>
            <button onClick={() => navigate("")} className={`shrink-0 truncate rounded px-1.5 py-0.5 text-ui/[inherit] hover:bg-hover ${view.loc ? "text-muted" : "font-semibold"}`} title={root.abs ?? undefined} style={{ maxWidth: 140 }}>
              {root.label}
            </button>
            <button onClick={(e) => (roots.length > 1 ? rootMenu(e.currentTarget) : void folderMenu(e.currentTarget, "", segments[0]?.path ?? null))} className="shrink-0 rounded px-0.5 text-subtle hover:bg-hover hover:text-foreground" title={t("workspace.fx.rootMenu")} aria-label={t("workspace.fx.rootMenu")}>
              <ChevronDown size={12} />
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-end overflow-hidden" onClick={(e) => e.target === e.currentTarget && setEditing(true)}>
              <div className="mr-auto flex min-w-0 items-center">
                {segments.map((s, i) => (
                  <span key={s.path} className="flex shrink-0 items-center">
                    <button onClick={(e) => void folderMenu(e.currentTarget, parentOf(s.path), s.path)} className="rounded px-px text-subtle hover:bg-hover hover:text-foreground" title={t("workspace.fx.siblings")} aria-label={t("workspace.fx.siblings")}>
                      <ChevronRight size={12} />
                    </button>
                    <button onClick={() => navigate(s.path)} className={`max-w-[160px] truncate rounded px-1 py-0.5 text-ui/[inherit] hover:bg-hover ${i === segments.length - 1 ? "font-semibold" : "text-muted"}`}>
                      {s.name}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        <button
          className={`${button} relative`}
          disabled={currentRel === null}
          onClick={() => currentRel !== null && current !== null && applyPlan(currentRel, false)}
          title={currentOutside ? t("workspace.fx.locateOutside") : withKey(t("workspace.revealInTreeKey"), bindingLabel("revealInTree"))}
          aria-label={t("workspace.revealInTree")}
        >
          <LocateFixed size={15} />
          {currentOutside && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-warn" />}
        </button>
        <button className={button} onClick={() => patchView((v) => ({ views: { ...v.views, [view.loc]: mode === "gallery" ? "list" : "gallery" } }))} title={t(mode === "gallery" ? "workspace.fx.viewList" : "workspace.fx.viewGallery")} aria-label={t(mode === "gallery" ? "workspace.fx.viewList" : "workspace.fx.viewGallery")}>
          {mode === "gallery" ? <List size={15} /> : <LayoutGrid size={15} />}
        </button>
        <button className={`${button} ${previewShown ? "bg-accent/15 text-accent" : ""}`} onClick={togglePreview} title={t("workspace.fx.previewToggle")} aria-label={t("workspace.fx.previewToggle")} aria-pressed={previewShown}>
          {beside ? <PanelRight size={15} /> : <PanelBottom size={15} />}
        </button>
        <button className={button} onClick={(e) => optionsMenu(e.currentTarget)} title={t("workspace.fx.options")} aria-label={t("workspace.fx.options")}>
          <MoreHorizontal size={15} />
        </button>
      </div>
      {listings.stale && <div className="shrink-0 border-b border-border/60 bg-warn/10 px-2.5 py-1 text-meta/[inherit] text-warn">{t("workspace.fx.stale")}</div>}
      {/* Filter / search */}
      <div className="flex shrink-0 gap-1.5 border-b border-border/60 p-1.5">
        <input
          ref={filterInput}
          value={search ?? filter}
          onChange={(e) => (search !== null ? setSearch(e.target.value) : setFilter(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Escape" && (search !== null || filter)) {
              e.preventDefault();
              e.stopPropagation();
              if (search !== null) setSearch(null);
              else setFilter("");
              listRef.current?.focus();
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (search === null) return startSearch(filter);
              const p = results?.[searchSel];
              if (!p) return;
              if (e.altKey) applyPlan(p, false);
              else openKept(p, enterModifiers(e) ?? PLAIN_OPEN);
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (search === null) return listRef.current?.focus();
              const n = results?.length ?? 0;
              setSearchSel((i) => Math.max(0, Math.min(n - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
            }
          }}
          placeholder={search !== null ? t("workspace.fx.searchPlaceholder") : t("workspace.fx.filterPlaceholder")}
          aria-label={search !== null ? t("workspace.fx.searchAll") : t("workspace.fx.filter")}
          className="h-[26px] min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-accent"
        />
        <button onClick={() => (search !== null ? (setSearch(null), listRef.current?.focus()) : startSearch(filter))} className={`h-[26px] shrink-0 rounded-md border px-2 text-xs hover:bg-hover ${search !== null ? "border-accent text-accent" : "border-border"}`} title={t("workspace.fx.searchAllHint")}>
          {search !== null ? t("workspace.fx.backToTree") : t("workspace.fx.searchAll")}
        </button>
      </div>
      {/* Tree / gallery / results + the built-in preview */}
      <div className={`flex min-h-0 flex-1 ${beside ? "flex-row" : "flex-col"}`}>
        <div className="flex min-h-0 min-w-0 flex-col" style={{ flex: previewShown ? `var(--fx-split, ${options.split}) 1 0` : "1 1 0" }}>
          {search !== null ? (
            <SearchList
              results={results}
              sel={searchSel}
              marks={marks.files}
              onSelect={setSearchSel}
              onOpen={(p) => openKept(p)}
              onMenu={(e, p) => contextMenu(() => [{ label: t("workspace.revealInTree"), hint: "Alt+Enter", icon: <LocateFixed size={14} />, onSelect: () => applyPlan(p, false) }, "separator", ...menuFor(p, false, marks.files.has(p))])(e)}
              onEnterDir={(d) => navigate(d)}
              onDragStart={(e, p) => dragPaths(e, p)}
            />
          ) : showGallery ? (
            <Gallery
              key={`g${listEpoch}|${view.loc}`}
              api={api}
              scope={scope}
              thumbKey={thumbKey}
              entries={galleryEntries}
              sel={sel}
              multi={multi}
              thumb={options.thumb}
              onClick={(e, x) => clickPath(e, x.path, isDirEntry(x), null)}
              onDoubleClick={(x) => (isDirEntry(x) ? navigate(x.path) : openKept(x.path))}
              onMenu={(e, x) => rowMenu(e, x.path, isDirEntry(x), marks.files.has(x.path))}
              onDragStart={(e, x) => dragPaths(e, x.path)}
              onKeyDown={onGalleryKey}
              label={t("workspace.files")}
              listRef={listRef}
              empty={<p className="p-2 text-xs text-subtle">{t("workspace.fx.emptyFolder")}</p>}
            />
          ) : (
            <TreeList
              key={`t${listEpoch}|${rootId}`}
              rows={rows}
              sel={sel}
              multi={multi}
              filter={filter}
              flash={flash}
              scrollTo={scrollTo}
              initialScroll={initialScroll}
              onScrollTop={(top) => (scrollTop.current = top)}
              onKeyDown={onTreeKey}
              note={note}
              label={t("workspace.files")}
              listRef={listRef}
              onClick={(e, row) => clickPath(e, row.path, row.dir, row)}
              onDoubleClick={(row) => (row.dir ? navigate(row.path) : openKept(row.path))}
              onChevron={(row) => toggleRow(row)}
              onAux={(e, row) => {
                if (row.dir || e.button !== 1) return;
                e.preventDefault();
                openKept(row.path, openModifiers(e));
              }}
              onMenu={(e, row) => rowMenu(e, row.path, row.dir, !!row.git || row.dirty)}
              onDragStart={(e, row) => dragPaths(e, row.path)}
              onEnterPart={(p) => navigate(p)}
            />
          )}
        </div>
        {previewEl && <Splitter beside={beside} split={options.split} />}
        {previewEl}
      </div>
    </div>
  );
}

/** The line between the tree and the built-in preview: drag to resize (remembered), double-click = half.
 *  During the drag only the panes' --fx-split moves (no render per step); the split is stored once, on release. */
function Splitter({ beside, split }: { beside: boolean; split: number }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={beside ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(split * 100)}
      onDoubleClick={() => setExplorerOptions({ split: 0.5 })}
      onPointerDown={(e) => {
        const parent = ref.current?.parentElement;
        if (!parent) return;
        e.preventDefault();
        const rect = parent.getBoundingClientRect();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        let next: number | null = null;
        const move = (ev: PointerEvent) => {
          next = clampSplit(beside ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height);
          parent.style.setProperty("--fx-split", String(next));
        };
        const upFn = () => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", upFn);
          target.removeEventListener("pointercancel", upFn);
          if (next !== null) setExplorerOptions({ split: next });
          // The store's split is rendered by then (a sync external-store update): drop the drag's value.
          ownerWindowOf(parent).requestAnimationFrame(() => parent.style.removeProperty("--fx-split"));
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", upFn);
        target.addEventListener("pointercancel", upFn);
      }}
      className={`relative z-10 shrink-0 ${beside ? "-mx-[3px] w-[7px] cursor-col-resize" : "-my-[3px] h-[7px] cursor-row-resize"} hover:bg-accent/30`}
    />
  );
}
