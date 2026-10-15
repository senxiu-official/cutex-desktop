// cutex usage-external-sources (`/v2/usage/sources`, cutex docs/usage-pricing.md §6): token usage of the
// owner's own Claude Code (`~/.claude`), plain Codex CLI (`~/.codex`) and Zhipu ZCode (`~/.zcode`, kind
// `zcode`, capability `usage-source-zcode`: its local usage database, table model_usage only) runs that
// never went through cutex, imported by the daemon into separate ledger rows. The desktop only edits the
// list and reads the scan status; cutex reads the directories (never credential / settings files).
import type { CutexRefusal } from "./ipc";

export const USAGE_SOURCES_FEATURE = "usage-external-sources";
/** The `zcode` kind; a host lists it in `GET /v2/usage/sources` `kinds` too. */
export const USAGE_SOURCE_ZCODE_FEATURE = "usage-source-zcode";
/** cutex `validate_id`: 1–40 of a-z, 0-9 and -, starting with a letter or digit. */
export const USAGE_SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Every kind this build knows; a host offers the ones in its `kinds`. */
export const USAGE_SOURCE_KINDS = ["claude-code", "codex", "zcode"] as const;
export type UsageSourceKind = (typeof USAGE_SOURCE_KINDS)[number];
/** Placeholder directory and default name (cutex's default label) of a kind. */
export const USAGE_SOURCE_KIND_DEFAULTS: Record<UsageSourceKind, { path: string; label: string }> = {
  "claude-code": { path: "~/.claude", label: "Claude Code" },
  codex: { path: "~/.codex", label: "Codex" },
  zcode: { path: "~/.zcode", label: "ZCode" },
};
/** `subscription`: a monthly plan, its cost shows as an API-equivalent value; `api`: billed per token. */
export type UsageSourceBilling = "subscription" | "api";

export interface UsageSourceStatus {
  lastScanAt: string | null;
  lastScanMs?: number | null;
  files: number;
  rows: number;
  lastRows?: number;
  errors: number;
  lastError?: string | null;
  scanning: boolean;
}

export interface UsageSource {
  id: string;
  kind: UsageSourceKind | string;
  path: string;
  label: string;
  billing: UsageSourceBilling;
  enabled: boolean;
  /** false: a kind this cutex does not read (kept in config, never scanned). */
  supported: boolean;
  status: UsageSourceStatus;
}

export interface UsageSourcesView {
  sources: UsageSource[];
  /** Directories offered for a new source (`~/.claude`, `~/.codex`, `~/.zcode` of the daemon host). */
  defaults: { kind: UsageSourceKind; path: string | null; exists: boolean }[];
  kinds: UsageSourceKind[];
  billing: UsageSourceBilling[];
  scanIntervalSecs: number;
}

export interface UsageSourceCreate {
  kind: UsageSourceKind;
  path: string;
  label?: string;
  billing?: UsageSourceBilling;
  enabled?: boolean;
}

export type UsageSourcePatch = Partial<Pick<UsageSource, "path" | "label" | "billing" | "enabled">>;

/** Refusals (400 invalid_request, 409 usage_source_overlaps_cutex / _overlaps_source / _exists / _disabled, 404) come back as `ok: false`. */
export type UsageSourceResult = { ok: true; source: UsageSource } | { ok: false; error: CutexRefusal };
export type UsageSourceDeleteResult = { ok: true; purged: boolean } | { ok: false; error: CutexRefusal };
