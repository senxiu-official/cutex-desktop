// 项目图标 on the host (cutex `project-icon`): the project presentation carries the icon, so every
// device (and Waveline's 项目 / 工作 tabs) shows the same one. On such a host the picker writes the
// presentation (optimistic: shown at once, dropped back to the host's value when refused) and every
// surface reads the host value; the device-local pref (lib/projectIcons, prefs `projectIcons`) is
// no longer read for it. A host without the capability keeps the local pref as before.
//
// One-time upload: once a capable host's project list is in, each local choice for that host goes
// to its project when the host has no icon there yet (the host wins otherwise), and the local entry
// is removed once the host holds an icon. A failed write keeps the entry for a later try.
import { useSyncExternalStore } from "react";
import { PROJECT_ICON_FEATURE, type ProjectSummary } from "@cutex-desktop/protocol";
import { hostApi, useApp } from "../store";
import { hostKey, parseHostKey } from "./hostKeys";
import { getUiPrefs, setProjectIcon, useUiPrefs } from "./prefs";
import { cleanProjectIcon, type ProjectIconChoice } from "./projectIcons";

type AppState = ReturnType<typeof useApp.getState>;

/** What the hosts say: capable host ids, and their projects' icons by hostKey (null = none). */
export interface HostIcons {
  capable: ReadonlySet<string>;
  icons: Readonly<Record<string, ProjectIconChoice | null>>;
  /**
   * hostKeys whose presentation holds any icon, also one this desktop cannot draw (an id outside our
   * catalog: shown as the letter badge, never overwritten by the upload).
   */
  stored: ReadonlySet<string>;
  /** Projects listed per capable host (summaries with revisions, for writes). */
  projects: Readonly<Record<string, readonly ProjectSummary[]>>;
}

const EMPTY: HostIcons = { capable: new Set(), icons: {}, stored: new Set(), projects: {} };

/** Whether a presentation holds an icon at all (raw: an unknown kind or id counts too). */
const hasIcon = (p: ProjectSummary): boolean => p.presentation.icon != null;
const NO_ICONS: Readonly<Record<string, ProjectIconChoice>> = {};

type HostSource = Partial<Pick<AppState, "hosts" | "sidebar" | "features" | "byHost">>;

/** The followed hosts with their features and sidebar: the focus host (top level) and every slice (store sidebarOf / featuresOf). */
function followed(s: HostSource): { hostId: string; features: ReadonlySet<string> | undefined; sidebar: AppState["sidebar"] | undefined }[] {
  const focus = s.hosts?.active ?? "local";
  const out = [{ hostId: focus, features: s.features, sidebar: s.sidebar }];
  for (const [hostId, slice] of Object.entries(s.byHost ?? {})) if (hostId !== focus) out.push({ hostId, features: slice?.features, sidebar: slice?.sidebar });
  return out;
}

/** Read the host icons out of the app state (pure; capable = `project-icon` in the host's featureList). */
export function readHostIcons(s: HostSource): HostIcons {
  const capable = new Set<string>();
  const icons: Record<string, ProjectIconChoice | null> = {};
  const stored = new Set<string>();
  const projects: Record<string, readonly ProjectSummary[]> = {};
  for (const { hostId, features, sidebar } of followed(s)) {
    if (!features?.has(PROJECT_ICON_FEATURE)) continue;
    capable.add(hostId);
    const list = sidebar?.projects;
    if (!list) continue;
    const all = [...list.projects, ...(list.archived_projects ?? [])];
    projects[hostId] = all;
    for (const p of all) {
      const key = hostKey(hostId, p.project_id);
      icons[key] = cleanProjectIcon(p.presentation.icon ?? null);
      if (hasIcon(p)) stored.add(key);
    }
  }
  return { capable, icons, stored, projects };
}

/**
 * The icons every surface shows, by hostKey: a capable host's own value (a pending write first),
 * else this device's pref. A capable host whose list is not in yet shows nothing (not the local pref).
 */
export function effectiveIcons(local: Readonly<Record<string, ProjectIconChoice>>, host: HostIcons, pending: Readonly<Record<string, ProjectIconChoice | null>>): Record<string, ProjectIconChoice> {
  const out: Record<string, ProjectIconChoice> = {};
  for (const [key, icon] of Object.entries(local)) {
    const parsed = parseHostKey(key);
    if (parsed && !host.capable.has(parsed[0])) out[key] = icon;
  }
  for (const [key, icon] of Object.entries(host.icons)) if (icon) out[key] = icon;
  for (const [key, icon] of Object.entries(pending)) {
    if (icon) out[key] = icon;
    else delete out[key];
  }
  return out;
}

/**
 * Whether cutex stores `icon` (its rules, docs/research/project-icon-progress.md in cutex): an emoji is
 * one grapheme of at most 32 UTF-8 bytes, an icon id `[a-z0-9-]{1,32}`, text 1–2 characters. The
 * picker also offers several emoji in one choice; those stay on this device.
 */
export function hostAcceptsIcon(icon: ProjectIconChoice): boolean {
  if (icon.kind === "icon") return /^[a-z0-9-]{1,32}$/.test(icon.value);
  if (icon.kind === "text") return [...icon.value].length >= 1 && [...icon.value].length <= 2;
  const graphemes = typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(icon.value)].length : 1;
  return graphemes === 1 && new TextEncoder().encode(icon.value).length <= 32;
}

// ── state: host icons (derived from the app store) + pending writes ─────────────────────────────

let hostIcons: HostIcons = EMPTY;
let signature = "";
let pending: Record<string, ProjectIconChoice | null> = {};
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

function sync(s: HostSource): void {
  const next = readHostIcons(s);
  const sig = JSON.stringify([[...next.capable].sort(), next.icons, [...next.stored].sort(), Object.entries(next.projects).map(([h, l]) => [h, l.map((p) => [p.project_id, p.authority_epoch, p.presentation.revision ?? 0])])]);
  if (sig === signature) return;
  signature = sig;
  hostIcons = next;
  emit();
  maybeUpload(next);
}

let started = false;
function start(): void {
  if (started) return;
  started = true;
  sync(useApp.getState?.() ?? {});
  useApp.subscribe?.(sync);
}

/** Snapshot (starts following the app store on first read; no listener exists yet then). */
function currentHostIcons(): HostIcons {
  start();
  return hostIcons;
}

function subscribe(l: () => void): () => void {
  start();
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Whether `hostId` stores project icons (cutex `project-icon`). */
export function hostStoresProjectIcons(hostId: string): boolean {
  start();
  return hostIcons.capable.has(hostId);
}

/** The project icons to show, by hostKey (use with lib/projectIcons projectIcon / groupIcon). */
export function useProjectIcons(): Readonly<Record<string, ProjectIconChoice>> {
  const local = useUiPrefs().projectIcons ?? NO_ICONS;
  const host = useSyncExternalStore(subscribe, currentHostIcons, currentHostIcons);
  const shown = useSyncExternalStore(subscribe, () => pending, () => pending);
  return shared(local, host, shown);
}

/** One result shared by every surface (avatars are many) until one of the inputs changes. */
let memo: { local: unknown; host: unknown; pending: unknown; out: Record<string, ProjectIconChoice> } | null = null;
function shared(local: Readonly<Record<string, ProjectIconChoice>>, host: HostIcons, shown: Readonly<Record<string, ProjectIconChoice | null>>): Record<string, ProjectIconChoice> {
  if (!memo || memo.local !== local || memo.host !== host || memo.pending !== shown) memo = { local, host, pending: shown, out: effectiveIcons(local, host, shown) };
  return memo.out;
}

/** The icons now (non-reactive). */
export function projectIconsNow(): Record<string, ProjectIconChoice> {
  start();
  return shared(getUiPrefs().projectIcons, hostIcons, pending);
}

function setPending(key: string, icon: ProjectIconChoice | null | undefined): void {
  const next = { ...pending };
  if (icon === undefined) delete next[key];
  else next[key] = icon;
  pending = next;
  emit();
}

function summaryOf(hostId: string, projectId: string): ProjectSummary | null {
  return hostIcons.projects[hostId]?.find((p) => p.project_id === projectId) ?? null;
}

/** Write a project's icon into its presentation on `hostId` (name, badge and colour kept). Resolves to whether the host stored it. */
async function writeHostIcon(hostId: string, project: ProjectSummary, icon: ProjectIconChoice | null): Promise<boolean> {
  const { display_name, badge_label, color } = project.presentation;
  try {
    await hostApi(hostId).projectPresentation(project.project_id, { authorityEpoch: project.authority_epoch, presentationRevision: project.presentation.revision ?? 0 }, { display_name, badge_label, color, icon });
    await useApp.getState().refreshHostSidebar(hostId).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Set (null: clear) the 项目图标 of `projectId` on `hostId`: on a `project-icon` host its presentation
 * (shown at once; a refusal shows the host's value again and says so), else this device's pref.
 * A capable host whose list does not hold the project yet (just created) gets it after one refresh;
 * failing that the choice waits in the local pref for the upload.
 */
export async function setProjectIconOn(hostId: string, projectId: string, icon: ProjectIconChoice | null, failed?: (error: string) => void): Promise<void> {
  start();
  const clean = cleanProjectIcon(icon);
  if (!hostIcons.capable.has(hostId)) return setProjectIcon(hostId, projectId, clean);
  if (clean && !hostAcceptsIcon(clean)) {
    failed?.("project-icon");
    return;
  }
  const key = hostKey(hostId, projectId);
  setPending(key, clean);
  try {
    let project = summaryOf(hostId, projectId);
    if (!project) {
      await useApp.getState().refreshHostSidebar(hostId).catch(() => {});
      sync(useApp.getState());
      project = summaryOf(hostId, projectId);
    }
    if (!project) {
      if (clean) setProjectIcon(hostId, projectId, clean); // uploaded once the list has it
      return;
    }
    const ok = await writeHostIcon(hostId, project, clean);
    if (ok) setProjectIcon(hostId, projectId, null); // the host holds it now
    else failed?.("project-icon");
  } finally {
    if (pending[key] === clean) setPending(key, undefined);
  }
}

// ── one-time upload of this device's choices (per host, once per entry and run) ─────────────────

const tried = new Set<string>();
let uploading: Promise<void> | null = null;
/** Set synchronously (before any write can re-enter through the store subscription). */
let running = false;

/** The local choices to upload to `hostId` now: listed projects without a host icon. And the local entries to drop (host already has one). */
export function uploadPlan(hostId: string, local: Readonly<Record<string, ProjectIconChoice>>, host: HostIcons, done: ReadonlySet<string> = new Set()): { upload: { project: ProjectSummary; icon: ProjectIconChoice }[]; drop: string[] } {
  const upload: { project: ProjectSummary; icon: ProjectIconChoice }[] = [];
  const drop: string[] = [];
  const projects = host.projects[hostId];
  if (!host.capable.has(hostId) || !projects) return { upload, drop };
  for (const [key, icon] of Object.entries(local)) {
    const parsed = parseHostKey(key);
    if (!parsed || parsed[0] !== hostId || done.has(key)) continue;
    const project = projects.find((p) => p.project_id === parsed[1]);
    if (!project) continue; // not listed (yet): kept for a later list
    if (host.stored.has(key)) drop.push(key); // the host wins, also with an icon this desktop cannot draw
    else if (hostAcceptsIcon(icon)) upload.push({ project, icon }); // else kept here, not shown on this host
  }
  return { upload, drop };
}

function maybeUpload(host: HostIcons): void {
  if (running || !Object.keys(host.projects).length) return;
  const local = getUiPrefs().projectIcons;
  const work = [...host.capable].map((hostId) => ({ hostId, ...uploadPlan(hostId, local, host, tried) })).filter((w) => w.upload.length || w.drop.length);
  if (!work.length) return;
  running = true;
  uploading = (async () => {
    await Promise.resolve(); // `uploading` is set before the first write
    for (const { hostId, upload, drop } of work) {
      for (const key of drop) {
        tried.add(key);
        const [h, projectId] = parseHostKey(key)!;
        setProjectIcon(h, projectId, null);
      }
      for (const { project, icon } of upload) {
        const key = hostKey(hostId, project.project_id);
        tried.add(key);
        // Re-read: an earlier write of this run moved the revision on.
        const current = summaryOf(hostId, project.project_id) ?? project;
        if (hasIcon(current)) {
          setProjectIcon(hostId, project.project_id, null);
          continue;
        }
        if (await writeHostIcon(hostId, current, icon)) {
          sync(useApp.getState());
          setProjectIcon(hostId, project.project_id, null);
        }
      }
    }
  })().finally(() => {
    running = false;
    uploading = null;
    // Lists that arrived meanwhile (another host) were skipped while this ran: look again.
    maybeUpload(hostIcons);
  });
}

/** Run the one-time upload for the current state now (tests; the store subscription runs it otherwise). */
export async function uploadLocalProjectIcons(): Promise<void> {
  start();
  sync(useApp.getState());
  maybeUpload(hostIcons);
  while (uploading) await uploading;
}

/** Tests. */
export function resetProjectIconSyncForTests(): void {
  hostIcons = EMPTY;
  signature = "";
  pending = {};
  memo = null;
  tried.clear();
  uploading = null;
  running = false;
  if (started) sync(useApp.getState());
}
