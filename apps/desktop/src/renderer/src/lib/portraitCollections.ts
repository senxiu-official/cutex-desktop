// 完整头像主题 (docs/desktop-optional-collections.md, owner 2026-11-27): the app ships a starter set of the bundled pack;
// main downloads, verifies and installs a theme's full collection on request (window.cutex.portraitCollections). This
// keeps the one view main reports (state(), then its `portraitCollections` events) for the renderer; main owns every
// decision. Absent in a plain browser without the mock, and then every surface hides its download parts.
// Not in the contract (so not offered here): cancelling an operation and removing an installed collection.
import { useSyncExternalStore } from "react";
import type { PreloadBridge } from "../../../shared/ipc";
import type { PortraitCollectionsBridge, PortraitCollectionsView } from "../../../shared/portraitCollections";

export type CollectionErrorCode = NonNullable<PortraitCollectionsView["error"]>["code"];
export type CollectionStep = NonNullable<PortraitCollectionsView["operation"]>["step"];

/**
 * One theme as the library shows it. starter: nothing in the catalogue (yet), the app's starter pictures are all there is;
 * downloadable: the catalogue offers it, none installed; installed: a verified collection here (version 0 = the full set
 * an older app version left behind); update: installed, a newer one is offered; working: the operation is on this theme.
 */
export type CollectionStatus =
  | { kind: "starter" }
  | { kind: "downloadable"; available: number; bytes: number | null }
  | { kind: "installed"; installed: number }
  | { kind: "update"; installed: number; available: number; bytes: number | null }
  | { kind: "working"; step: CollectionStep; received: number | null; total: number | null };

const api = (): { bridge: PreloadBridge; collections: PortraitCollectionsBridge } | null => {
  const bridge = (globalThis as { cutex?: PreloadBridge }).cutex;
  return bridge?.portraitCollections ? { bridge, collections: bridge.portraitCollections } : null;
};

let view: PortraitCollectionsView | null = null;
let started = false;
const listeners = new Set<() => void>();
const set = (next: PortraitCollectionsView) => {
  view = next;
  for (const l of listeners) l();
};

function start(): void {
  if (started) return;
  const a = api();
  if (!a) return;
  started = true;
  a.bridge.on("portraitCollections", ({ view: next }) => set(next));
  void a.collections.state().then(set, (error: unknown) => console.warn("[portrait-collections]", error));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => view;

/** This app has the service (Electron, or the preview's mock). */
export const hasPortraitCollections = (): boolean => !!api();

/** The view main reports; null = no bridge here, or not read yet (a cold start verifies every installed file first). */
export function usePortraitCollections(): PortraitCollectionsView | null {
  start();
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

async function call(op: (c: PortraitCollectionsBridge) => Promise<PortraitCollectionsView>): Promise<void> {
  const a = api();
  if (!a) return;
  start();
  try {
    set(await op(a.collections));
  } catch (error) {
    console.warn("[portrait-collections]", error);
  }
}

export const checkPortraitCollections = () => call((c) => c.check());
export const installPortraitCollection = (theme: string) => call((c) => c.install(theme));
export const retryPortraitCollections = () => call((c) => c.retry());

export function collectionStatus(v: PortraitCollectionsView, theme: string): CollectionStatus {
  if (v.operation?.theme === theme) return { kind: "working", step: v.operation.step, received: v.operation.received ?? null, total: v.operation.total ?? null };
  const row = v.themes.find((r) => r.theme === theme);
  if (!row) return { kind: "starter" };
  if (row.installed !== null) {
    return row.available !== null && row.available > row.installed ? { kind: "update", installed: row.installed, available: row.available, bytes: row.bytes } : { kind: "installed", installed: row.installed };
  }
  return row.available !== null ? { kind: "downloadable", available: row.available, bytes: row.bytes } : { kind: "starter" };
}

/** The last error about this theme (a catalogue error, theme null, belongs to the library header). */
export const collectionError = (v: PortraitCollectionsView, theme: string | null): CollectionErrorCode | null =>
  v.error && v.error.theme === theme ? v.error.code : null;

/** Its words (lib/portraitCollectionsMessages). */
export const collectionErrorKey = (code: CollectionErrorCode) => `portraitLib.error.${code}`;

/** A theme where a full collection could be fetched now (download or update), or is being fetched. */
export const fetchable = (status: CollectionStatus) => status.kind === "downloadable" || status.kind === "update" || status.kind === "working";

/** 0–100, or null while the size is unknown or the step is not the download. */
export function collectionPercent(status: CollectionStatus): number | null {
  if (status.kind !== "working") return null;
  if (status.step === "verify" || status.step === "install") return 100;
  if (status.step !== "download" || !status.total || status.received === null) return null;
  return Math.max(0, Math.min(100, Math.round((status.received / status.total) * 100)));
}

/** Tests: forget the view and the subscription. */
export function resetPortraitCollectionsForTest(): void {
  view = null;
  started = false;
  listeners.clear();
}
