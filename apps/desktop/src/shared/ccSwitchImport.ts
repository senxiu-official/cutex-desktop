// Profile import from CC Switch (cutex capability `profile-import-cc-switch`, owner only): the wire
// shapes of `GET / POST /v2/profile-imports/cc-switch` and the request body the main process sends.
//
// cutex reads CC Switch's own store on the host (its SQLite database or the older JSON config) and
// only reads it. The list never carries a key (`hasKey` says whether the provider has one); the
// import copies the key into the new cutex profile on the host, so no credential crosses this bridge.
import type { ProfileDetail } from "./ipc";

/** cutex capability of `/v2/profile-imports/cc-switch`. */
export const CC_SWITCH_IMPORT_FEATURE = "profile-import-cc-switch";
/** cutex refuses a POST with more items than this. */
export const CC_SWITCH_IMPORT_MAX = 50;

export type CcSwitchApp = "claude" | "codex";
export const CC_SWITCH_APPS: readonly CcSwitchApp[] = ["claude", "codex"];

// ---------- wire ----------

/** One CC Switch provider as cutex read it (never with its key). */
export interface CcSwitchProvider {
  /** CC Switch's provider id (unique per app). */
  id: string;
  app: CcSwitchApp;
  name: string;
  baseUrl: string | null;
  model: string | null;
  /** The provider CC Switch has switched to right now. */
  current: boolean;
  /** The provider has an API key / token cutex can copy. */
  hasKey: boolean;
  /** cutex can turn it into a profile (false: e.g. an OAuth login it cannot copy; see `reason`). */
  supported: boolean;
  reason: string | null;
  /** The cutex profile already made from this provider (by an earlier import), or null. */
  existingProfile: string | null;
}

export interface CcSwitchSource {
  path: string;
  format: "sqlite" | "json";
  schemaVersion: number | null;
}

/** `GET /v2/profile-imports/cc-switch`. */
export interface CcSwitchImportList {
  found: boolean;
  source: CcSwitchSource | null;
  error: { code: string; message: string } | null;
  providers: CcSwitchProvider[];
}

/** One `POST` item: a provider, optionally with the new profile's name (cutex picks one otherwise). */
export interface CcSwitchImportItem {
  id: string;
  app: CcSwitchApp;
  name?: string;
}

/** `POST /v2/profile-imports/cc-switch` reply. */
export interface CcSwitchImportResult {
  created: { id: string; app: CcSwitchApp; profile: ProfileDetail }[];
  failed: { id: string; app: CcSwitchApp; code: string; message: string }[];
}

// ---------- helpers ----------

/** A provider the UI lets the owner pick: cutex supports it and it has a key. */
export function ccSwitchImportable(p: Pick<CcSwitchProvider, "supported" | "hasKey">): boolean {
  return p.supported && p.hasKey;
}

/** The POST body from known fields only (bad items dropped, at most CC_SWITCH_IMPORT_MAX); throws when nothing is left. */
export function ccSwitchImportBody(items: readonly CcSwitchImportItem[]): { items: CcSwitchImportItem[] } {
  if (!Array.isArray(items)) throw new Error("bad CC Switch import items");
  const out: CcSwitchImportItem[] = [];
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id || !CC_SWITCH_APPS.includes(item.app)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    out.push(name ? { id: item.id, app: item.app, name } : { id: item.id, app: item.app });
  }
  if (!out.length) throw new Error("no CC Switch provider to import");
  if (out.length > CC_SWITCH_IMPORT_MAX) throw new Error(`at most ${CC_SWITCH_IMPORT_MAX} CC Switch providers per import`);
  return { items: out };
}
