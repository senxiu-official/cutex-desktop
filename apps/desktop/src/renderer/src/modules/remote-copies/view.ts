// 远程文件副本 page: the text / place filter, the sort and the cards / list view (owner 2026-10-29). Pure parts
// plus what this machine remembers (sort, direction, view) in localStorage — the filter is per visit.
import { create } from "zustand";
import type { RemoteCopy } from "../../../../shared/remoteCopies";
import type { DownloadFolder } from "../../../../shared/remoteCopyRequests";

export type CopySort = "name" | "size" | "date" | "host";
export type CopyView = "cards" | "list";
export const COPY_SORTS: readonly CopySort[] = ["name", "size", "date", "host"];
/** A header click on a new key starts in its natural direction: names A→Z, the largest / newest first. */
export const SORT_DESC_FIRST: Record<CopySort, boolean> = { name: false, host: false, size: true, date: true };

export interface CopyViewPrefs {
  sort: CopySort;
  desc: boolean;
  view: CopyView;
}
export const DEFAULT_COPY_VIEW: CopyViewPrefs = { sort: "date", desc: true, view: "cards" };
export const COPY_VIEW_STORAGE_KEY = "cutex-desktop.remote-copies.view";

export function parseCopyViewPrefs(raw: unknown): CopyViewPrefs {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    sort: COPY_SORTS.includes(v.sort as CopySort) ? (v.sort as CopySort) : DEFAULT_COPY_VIEW.sort,
    desc: typeof v.desc === "boolean" ? v.desc : DEFAULT_COPY_VIEW.desc,
    view: v.view === "list" ? "list" : "cards",
  };
}

function load(): CopyViewPrefs {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(COPY_VIEW_STORAGE_KEY);
    return parseCopyViewPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_COPY_VIEW };
  }
}

export const useCopyView = create<CopyViewPrefs>(() => load());

export function setCopyView(patch: Partial<CopyViewPrefs>): void {
  useCopyView.setState((s) => parseCopyViewPrefs({ ...s, ...patch }));
  try {
    localStorage.setItem(COPY_VIEW_STORAGE_KEY, JSON.stringify(useCopyView.getState()));
  } catch {
    /* storage full / unavailable: this session only */
  }
}

/** A column header / sort menu pick: the same key flips the direction, another key starts in its natural one. */
export function pickSort(prefs: Pick<CopyViewPrefs, "sort" | "desc">, sort: CopySort): Pick<CopyViewPrefs, "sort" | "desc"> {
  return sort === prefs.sort ? { sort, desc: !prefs.desc } : { sort, desc: SORT_DESC_FIRST[sort] };
}

/** Tests: read the stored prefs again. */
export function reloadCopyView(): void {
  useCopyView.setState(load(), true);
}

/** Where a copy came from, for the place filter and the list's host / project column. */
export interface CopyPlace {
  /** "host:<hostId>" or "project:<hostId>|<projectId>". */
  key: string;
  hostKey: string;
  host: string;
  project: string | null;
}
/** Host labels / project names as the app knows them now (absent: the label saved with the copy, the id). */
export interface PlaceNames {
  host(hostId: string): string | undefined;
  project(hostId: string, projectId: string): string | undefined;
}

export function placeOf(copy: RemoteCopy, names: PlaceNames): CopyPlace {
  const { hostId } = copy.source;
  const host = names.host(hostId) ?? copy.source.hostLabel ?? hostId;
  const hostKey = `host:${hostId}`;
  const scope = copy.source.scope;
  if (scope?.kind !== "project") return { key: hostKey, hostKey, host, project: null };
  return { key: `project:${hostId}|${scope.id}`, hostKey, host, project: names.project(hostId, scope.id) ?? scope.id };
}

/** The place filter's choices: each host, then its projects (only places some copy has), by name. */
export function placeOptions(copies: readonly RemoteCopy[], names: PlaceNames): { value: string; label: string }[] {
  const hosts = new Map<string, string>();
  const projects = new Map<string, { hostKey: string; label: string }>();
  for (const c of copies) {
    const p = placeOf(c, names);
    hosts.set(p.hostKey, p.host);
    if (p.project !== null) projects.set(p.key, { hostKey: p.hostKey, label: `${p.host} · ${p.project}` });
  }
  const out: { value: string; label: string }[] = [];
  for (const [hostKey, label] of [...hosts].sort((a, b) => collator.compare(a[1], b[1]))) {
    out.push({ value: hostKey, label });
    for (const [key, p] of [...projects].filter(([, p]) => p.hostKey === hostKey).sort((a, b) => collator.compare(a[1].label, b[1].label))) out.push({ value: key, label: p.label });
  }
  return out;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const time = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
/** The list's date: when the copy finished downloading, else when it was asked for. */
export const copyDate = (c: RemoteCopy): string => c.downloadedAt ?? c.createdAt;

export interface CopyFilter {
  /** Matches the name or the remote path, case-insensitive; every space-separated word must match. */
  text: string;
  /** A placeOptions value; "" = everywhere. A host value includes that host's projects. */
  place: string;
}

export function filterCopies(copies: readonly RemoteCopy[], filter: CopyFilter, names: PlaceNames): RemoteCopy[] {
  const words = filter.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return copies.filter((c) => {
    if (filter.place) {
      const p = placeOf(c, names);
      if (p.key !== filter.place && p.hostKey !== filter.place) return false;
    }
    if (!words.length) return true;
    const hay = `${c.name}\n${c.source.path}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Copies in the chosen order. The direction applies to the key only: ties always fall back to the name (A→Z),
 * then to the order the copies came in, so equal rows never swap places between refreshes.
 */
export function sortCopies(copies: readonly RemoteCopy[], prefs: Pick<CopyViewPrefs, "sort" | "desc">, names: PlaceNames): RemoteCopy[] {
  const key: (a: RemoteCopy, b: RemoteCopy) => number =
    prefs.sort === "size"
      ? (a, b) => a.size - b.size
      : prefs.sort === "date"
        ? (a, b) => time(copyDate(a)) - time(copyDate(b))
        : prefs.sort === "host"
          ? (a, b) => {
              const pa = placeOf(a, names);
              const pb = placeOf(b, names);
              return collator.compare(pa.host, pb.host) || collator.compare(pa.project ?? "", pb.project ?? "");
            }
          : (a, b) => collator.compare(a.name, b.name);
  return copies
    .map((c, i) => [c, i] as const)
    .sort(([a, ia], [b, ib]) => (prefs.desc ? -key(a, b) : key(a, b)) || collator.compare(a.name, b.name) || ia - ib)
    .map(([c]) => c);
}

/** Where a copy's file is on this computer: the download folder, its own folder (the copy id), its name. */
export function copyLocation(folder: DownloadFolder | null, copy: RemoteCopy): string | null {
  if (!folder) return null;
  const sep = folder.path.includes("\\") ? "\\" : "/";
  return [folder.path.replace(/[\\/]+$/, ""), copy.id, copy.name].join(sep);
}
