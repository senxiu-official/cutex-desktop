// Backend upgrade (cutex capability `backend-upgrade`, owner only; cutex docs/backend-upgrade.md, schema
// export `upgrade`): wire types of `/v2/upgrade*`, the host event `cutex/upgrade/updated`, the
// `/v2/host` `serviceManager` / `runtimes` blocks, and the body builders the client uses so only known
// fields reach cutex (cutex rejects unknown fields with 400 invalid_request). Hand-written like
// users.ts until cutex exports its schemas. Refusals come back as values (`UpgradeResult`), since the
// page explains every one of them (unmanaged install, one-way confirmation, run in progress, …).

export const BACKEND_UPGRADE_FEATURE = "backend-upgrade";
/** Host event; its params are small (`UpgradeEvent`): re-read `GET /v2/upgrade` for details. */
export const UPGRADE_UPDATED_EVENT = "cutex/upgrade/updated";
/** cutex `upg-<12 hex>`. */
export const UPGRADE_RUN_ID = /^upg-[0-9a-f]{12}$/;
/** cutex caps `maxWaitSecs` at 24 h (default 3600). */
export const UPGRADE_MAX_WAIT_SECS = 24 * 3600;
/** `checkIntervalHours` 0 (off) .. one week. */
export const UPGRADE_CHECK_INTERVAL_MAX = 24 * 7;
export const UPGRADE_PACKAGE_RUN_BATCH_MAX = 50;
const RELEASE_MAX = 64;

export type UpgradeMigrationClass = "reload-safe" | "rollback-safe" | "one-way";
export type UpgradeMode = "reload" | "full";
export type UpgradePackageRun = "after" | "during" | "none";
export const UPGRADE_PACKAGE_RUNS: readonly UpgradePackageRun[] = ["after", "during", "none"];
export type UpgradeChannel = "release" | "main";
export const UPGRADE_CHANNELS: readonly UpgradeChannel[] = ["release", "main"];
export type UpgradeServiceManagerKind = "systemd" | "cutex-supervisor" | "runtime-host" | "none";

export type UpgradePhase =
  | "queued"
  | "waiting-idle"
  | "quiescing"
  | "backing-up"
  | "stopping"
  | "swapping"
  | "starting"
  | "waiting-ready"
  | "package-run"
  | "restoring-online"
  | "verifying"
  | "rolling-back"
  | "committed"
  | "rolled-back"
  | "needs-owner"
  | "deferred"
  | "cancelled"
  | "failed";

/** Terminal phases: the run is over (committed, or nothing / a rollback happened). */
export const UPGRADE_TERMINAL_PHASES: readonly UpgradePhase[] = ["committed", "rolled-back", "needs-owner", "deferred", "cancelled", "failed"];
/** The Management API is unreachable in these phases (cutex `Phase::services_down`): expect a reconnect. */
export const UPGRADE_SERVICES_DOWN_PHASES: readonly UpgradePhase[] = ["stopping", "swapping", "starting", "waiting-ready", "rolling-back"];
/** Cancel still possible: nothing changed yet (cutex `Phase::cancellable`). */
export const UPGRADE_CANCELLABLE_PHASES: readonly UpgradePhase[] = ["queued", "waiting-idle", "quiescing"];

export function isUpgradeTerminal(phase: string | null | undefined): boolean {
  return !!phase && (UPGRADE_TERMINAL_PHASES as readonly string[]).includes(phase);
}

export function isUpgradeServicesDown(phase: string | null | undefined): boolean {
  return !!phase && (UPGRADE_SERVICES_DOWN_PHASES as readonly string[]).includes(phase);
}

export function isUpgradeCancellable(phase: string | null | undefined): boolean {
  return !!phase && (UPGRADE_CANCELLABLE_PHASES as readonly string[]).includes(phase);
}

export interface UpgradeMigration {
  id: string;
  class: UpgradeMigrationClass;
  /** First release that runs it. */
  since: string;
  /** Language tag (en, zh-CN) → text. */
  notes?: Record<string, string>;
  /** Paths relative to the cutex home a rollback moves aside. */
  newStores?: string[];
}

export interface UpgradeInstalled {
  /** Active release ("unknown" when undeterminable). */
  release: string;
  /** Channel sequence; 0 = not installed from a signed release. */
  sequence?: number;
  commit?: string | null;
  manifestSha256?: string | null;
  /** Capability upgrade-installed-notes: the installed manifest's notes (language tag -> text); null when unknown. */
  notes?: Record<string, string> | null;
  /** Capability upgrade-installed-notes: the installed manifest's publishedAt; null when unknown. */
  publishedAt?: string | null;
}

export interface UpgradeAvailable {
  release: string;
  sequence: number;
  tag: string;
  manifestSha256: string;
  publishedAt?: string | null;
  notes?: Record<string, string>;
  class: UpgradeMigrationClass;
  mode: UpgradeMode;
  /** Migrations in (installed, release]. */
  migrations?: UpgradeMigration[];
  /** Set: the installed release is below the upgrade floor; install this release first. */
  belowFloor?: string | null;
  nativeVersion?: string | null;
  claudeRuntime?: string | null;
  capabilitiesRemoved?: string[];
  desktopMinCommit?: string | null;
}

/** One preflight check of a staged release (version, selftest, nativeFiles, disk, rollbackTarget, …). */
export interface UpgradeCheck {
  name: string;
  ok: boolean;
  detail?: string | null;
}

export interface UpgradeStaged {
  release: string;
  sequence: number;
  stagedAt: string;
  manifestSha256: string;
  preflightOk: boolean;
  preflight?: UpgradeCheck[];
  nativeVersion?: string | null;
}

export interface UpgradeError {
  code: string;
  message: string;
}

/** Background staging (`POST /v2/upgrade/stage` → 202): running, or failed with an error. */
export interface UpgradeStaging {
  release: string;
  state: "running" | "failed";
  startedAt?: string;
  finishedAt?: string;
  error?: UpgradeError;
}

/** What keeps the host busy while a run waits for idle (never interrupted). */
export interface UpgradeBusy {
  /** activeTurn | threadActive | packageRun (later: askSubmitting, workflowRunning). */
  reason: string;
  cutexSessionId?: string | null;
  name?: string | null;
  detail?: string | null;
}

export interface UpgradeTimelineEntry {
  phase: UpgradePhase;
  at: string;
  detail?: string;
}

export interface UpgradeNeedsOwner {
  reason: string;
  /** Commands the owner runs on the host. */
  commands: string[];
}

export interface UpgradeRun {
  runId: string;
  kind: "apply" | "rollback";
  fromRelease: string;
  toRelease: string;
  mode: UpgradeMode;
  class: UpgradeMigrationClass;
  phase: UpgradePhase;
  createdAt: string;
  finishedAt?: string | null;
  maxWaitSecs: number;
  packageRun: UpgradePackageRun;
  confirmOneWay?: string | null;
  requestedBy?: string | null;
  waitingFor?: UpgradeBusy[];
  cancelRequested?: boolean;
  timeline: UpgradeTimelineEntry[];
  downtimeMs?: number | null;
  backupDir?: string | null;
  packageRunId?: string | null;
  error?: UpgradeError | null;
  needsOwner?: UpgradeNeedsOwner | null;
  runnerPid?: number | null;
  displaced?: string[];
  selectionBackup?: string;
  // Capability `upgrade-run-native` (recorded when the run is prepared; null on older records, absent
  // on older cutex):
  /** The cute-codex native the target release carries (apply: staged manifest; rollback: target's installed one). */
  nativeVersion?: string | null;
  /** Apply: the native selected for new agents then; rollback: the running release's. */
  previousNativeVersion?: string | null;
  /** native = full + another native; package = full, same native (runtime package only); none = reload. */
  runtimeChange?: UpgradeRuntimeChange | null;
}

/** What a run does to the runtime new agents get (`UpgradeRun.runtimeChange`). */
export type UpgradeRuntimeChange = "native" | "package" | "none";
export const UPGRADE_RUNTIME_CHANGES: readonly UpgradeRuntimeChange[] = ["native", "package", "none"];
/** Capability: run records carry `nativeVersion` / `previousNativeVersion` / `runtimeChange`. */
export const UPGRADE_RUN_NATIVE_FEATURE = "upgrade-run-native";
/** Capability: `GET /v2/upgrade` `installed` carries `notes` / `publishedAt` from the installed manifest. */
export const UPGRADE_INSTALLED_NOTES_FEATURE = "upgrade-installed-notes";

/** After a full-mode commit: idle outdated agents move in batches (`packageRun: after`). */
export interface UpgradeFollowUp {
  upgradeRunId: string;
  startedAt: string;
  lastBatchAt?: string | null;
  packageRunIds?: string[];
  done: boolean;
}

export interface UpgradeSettings {
  channel: UpgradeChannel;
  /** Release source (read-only here; `cutex upgrade config --source` on the host). */
  source: string;
  /** 0 = never check automatically. */
  checkIntervalHours: number;
  autoStage: boolean;
  /** Default false; never applies a one-way release. */
  autoApply: boolean;
  packageRun: UpgradePackageRun;
  packageRunBatch: number;
  maxWaitSecs: number;
}

/** `GET /v2/upgrade`, `POST /v2/upgrade/check`. */
export interface UpgradeStatus {
  /** false: hand-deployed (owner hosts); every mutation answers 409 upgrade_blocked {reason: unmanaged_install}. */
  managed: boolean;
  base?: string | null;
  serviceManager: UpgradeServiceManagerKind | (string & {});
  /** Same object as `/v2/capabilities` `cutexBuild` (read it with readCutexBuild). */
  build: Record<string, unknown>;
  installed?: UpgradeInstalled | null;
  /** Default rollback target. */
  previousRelease?: string | null;
  installedReleases: string[];
  lastCheckAt?: string | null;
  lastCheckError?: UpgradeError | null;
  available?: UpgradeAvailable | null;
  staged?: UpgradeStaged | null;
  staging?: UpgradeStaging | null;
  /** The current or last run. */
  run?: UpgradeRun | null;
  followUp?: UpgradeFollowUp | null;
  settings: UpgradeSettings;
  /** minisign key ids this build trusts; empty = cannot check. */
  trustedKeys: string[];
}

export interface UpgradeRollbackPreview {
  from: string;
  to: string;
  class: UpgradeMigrationClass;
  migrations: UpgradeMigration[];
  movedAside: string[];
  selectionBackup?: string | null;
  /** Always false: session data are never restored. */
  sessionDataRestored: false;
}

/** `POST /v2/upgrade/rollback`: a dry run answers the preview only. */
export interface UpgradeRollbackResult {
  preview: UpgradeRollbackPreview;
  run?: UpgradeRun;
}

/** `cutex/upgrade/updated` params (small; re-read `GET /v2/upgrade`). */
export interface UpgradeEvent {
  reason: "startup" | "state";
  hostId: string;
  run: { runId: string; kind: "apply" | "rollback"; phase: UpgradePhase; fromRelease: string; toRelease: string; servicesDown: boolean } | null;
  /** Release names. */
  available: string | null;
  staged: string | null;
  staging?: UpgradeStaging | null;
}

/** `POST /v2/upgrade/apply` body. */
export interface UpgradeApplyRequest {
  /** Default: the staged release. */
  release?: string;
  /** Can only raise the release's own mode (reload → full). */
  mode?: UpgradeMode;
  maxWaitSecs?: number;
  /** Required (= the release) for a one-way release. */
  confirmOneWay?: string;
  packageRun?: UpgradePackageRun;
}

/** `POST /v2/upgrade/rollback` body. */
export interface UpgradeRollbackRequest {
  /** Default: `previousRelease`. */
  to?: string;
  maxWaitSecs?: number;
  dryRun?: boolean;
}

export type UpgradeSettingsPatch = Partial<Omit<UpgradeSettings, "source">>;

/**
 * A cutex refusal of an upgrade route. `reason` is `details.reason` of `upgrade_blocked`
 * (unmanaged_install, run_in_progress, stage_in_progress, preflight_failed, below_floor, one_way);
 * `runId` of run_in_progress / run_not_found; `migrations` of one_way_unconfirmed.
 */
export interface UpgradeRefusal {
  code: string;
  message: string;
  status: number;
  reason?: string;
  runId?: string;
  migrations?: UpgradeMigration[];
}

export type UpgradeResult<T> = { ok: true; value: T } | { ok: false; error: UpgradeRefusal };

/** `/v2/host` `serviceManager`: what keeps this daemon running. */
export interface HostServiceManager {
  kind: UpgradeServiceManagerKind | (string & {});
  /** systemd unit name when known. */
  unit: string | null;
  /** The daemon runs from a `cutex service install` layout (only such installs can be upgraded). */
  managedInstall: boolean;
}

export interface HostRuntimeUse {
  /** r53 (native) or claude-r12. */
  release: string;
  /** Native version; null for Claude runtimes and unregistered native builds. */
  version: string | null;
  /** Non-retired agents pinned to it. */
  agents: number;
  /** Used for new agents. */
  selected: boolean;
  /** Its files no longer exist. */
  missing: boolean;
}

/** `/v2/host` `runtimes` (owner only). */
export interface HostRuntimes {
  native: { selected: string | null; latest: string | null; inUse: HostRuntimeUse[] };
  claude: { selected: string | null; inUse: HostRuntimeUse[] };
  unpinnedAgents: number;
}

/** The backend-upgrade blocks of `GET /v2/host` (null each on an older cutex / a non-owner). */
export interface HostServiceInfo {
  serviceManager: HostServiceManager | null;
  runtimes: HostRuntimes | null;
}

// ---------- readers / body builders ----------

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function releaseName(value: unknown, what: string): string {
  if (typeof value !== "string" || !value || value.length > RELEASE_MAX || /[\p{Cc}\s]/u.test(value)) throw new Error(`bad ${what}`);
  return value;
}

function waitSecs(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > UPGRADE_MAX_WAIT_SECS) throw new Error("bad maxWaitSecs");
  return value;
}

/** A `POST /v2/upgrade/stage` body (`{}` = the available release). */
export function upgradeStageBody(release?: string | null): { release?: string } {
  return release === undefined || release === null ? {} : { release: releaseName(release, "release") };
}

/** A `POST /v2/upgrade/apply` body with known fields only (throws on bad values). */
export function upgradeApplyBody(request: UpgradeApplyRequest = {}): UpgradeApplyRequest {
  if (!request || typeof request !== "object") throw new Error("bad apply request");
  const body: UpgradeApplyRequest = {};
  if (request.release !== undefined) body.release = releaseName(request.release, "release");
  if (request.mode !== undefined) {
    if (request.mode !== "reload" && request.mode !== "full") throw new Error("bad mode");
    body.mode = request.mode;
  }
  if (request.maxWaitSecs !== undefined) body.maxWaitSecs = waitSecs(request.maxWaitSecs);
  if (request.confirmOneWay !== undefined) body.confirmOneWay = releaseName(request.confirmOneWay, "confirmOneWay");
  if (request.packageRun !== undefined) {
    if (!UPGRADE_PACKAGE_RUNS.includes(request.packageRun)) throw new Error("bad packageRun");
    body.packageRun = request.packageRun;
  }
  return body;
}

/** A `POST /v2/upgrade/rollback` body with known fields only. */
export function upgradeRollbackBody(request: UpgradeRollbackRequest = {}): UpgradeRollbackRequest {
  if (!request || typeof request !== "object") throw new Error("bad rollback request");
  const body: UpgradeRollbackRequest = {};
  if (request.to !== undefined) body.to = releaseName(request.to, "rollback target");
  if (request.maxWaitSecs !== undefined) body.maxWaitSecs = waitSecs(request.maxWaitSecs);
  if (request.dryRun !== undefined) {
    if (typeof request.dryRun !== "boolean") throw new Error("bad dryRun");
    body.dryRun = request.dryRun;
  }
  return body;
}

/** A `PATCH /v2/upgrade/settings` body with known fields only (never `source`: host CLI only). */
export function upgradeSettingsBody(patch: UpgradeSettingsPatch): UpgradeSettingsPatch {
  if (!patch || typeof patch !== "object") throw new Error("bad upgrade settings");
  const body: UpgradeSettingsPatch = {};
  const int = (v: unknown, min: number, max: number, what: string): number => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new Error(`bad ${what}`);
    return v;
  };
  const bool = (v: unknown, what: string): boolean => {
    if (typeof v !== "boolean") throw new Error(`bad ${what}`);
    return v;
  };
  if (patch.channel !== undefined) {
    if (!UPGRADE_CHANNELS.includes(patch.channel)) throw new Error("bad channel");
    body.channel = patch.channel;
  }
  if (patch.checkIntervalHours !== undefined) body.checkIntervalHours = int(patch.checkIntervalHours, 0, UPGRADE_CHECK_INTERVAL_MAX, "checkIntervalHours");
  if (patch.autoStage !== undefined) body.autoStage = bool(patch.autoStage, "autoStage");
  if (patch.autoApply !== undefined) body.autoApply = bool(patch.autoApply, "autoApply");
  if (patch.packageRun !== undefined) {
    if (!UPGRADE_PACKAGE_RUNS.includes(patch.packageRun)) throw new Error("bad packageRun");
    body.packageRun = patch.packageRun;
  }
  if (patch.packageRunBatch !== undefined) body.packageRunBatch = int(patch.packageRunBatch, 1, UPGRADE_PACKAGE_RUN_BATCH_MAX, "packageRunBatch");
  if (patch.maxWaitSecs !== undefined) body.maxWaitSecs = waitSecs(patch.maxWaitSecs);
  if (Object.keys(body).length === 0) throw new Error("empty upgrade settings patch");
  return body;
}

/** A refusal value from an upgrade error's code / message / details. */
export function upgradeRefusalOf(status: number, code: string, message: string, details: unknown): UpgradeRefusal {
  const d = details && typeof details === "object" && !Array.isArray(details) ? (details as Record<string, unknown>) : {};
  const out: UpgradeRefusal = { code, message, status };
  const reason = str(d.reason);
  if (reason) out.reason = reason;
  const runId = str(d.runId);
  if (runId) out.runId = runId;
  if (Array.isArray(d.migrations)) out.migrations = d.migrations.filter((m): m is UpgradeMigration => !!m && typeof m === "object" && typeof (m as UpgradeMigration).id === "string");
  return out;
}

/** The `serviceManager` / `runtimes` blocks of a `GET /v2/host` reply (null each when absent or malformed). */
export function readHostServiceInfo(host: unknown): HostServiceInfo {
  const h = host && typeof host === "object" ? (host as Record<string, unknown>) : {};
  const sm = h.serviceManager && typeof h.serviceManager === "object" ? (h.serviceManager as Record<string, unknown>) : null;
  const serviceManager: HostServiceManager | null = sm && typeof sm.kind === "string" ? { kind: sm.kind, unit: str(sm.unit), managedInstall: sm.managedInstall === true } : null;
  return { serviceManager, runtimes: readRuntimes(h.runtimes) };
}

function readUses(value: unknown): HostRuntimeUse[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((u): u is Record<string, unknown> => !!u && typeof u === "object" && typeof (u as { release?: unknown }).release === "string")
    .map((u) => ({
      release: u.release as string,
      version: str(u.version),
      agents: typeof u.agents === "number" && Number.isFinite(u.agents) && u.agents >= 0 ? Math.floor(u.agents) : 0,
      selected: u.selected === true,
      missing: u.missing === true,
    }));
}

function readRuntimes(value: unknown): HostRuntimes | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const native = r.native && typeof r.native === "object" ? (r.native as Record<string, unknown>) : null;
  const claude = r.claude && typeof r.claude === "object" ? (r.claude as Record<string, unknown>) : null;
  if (!native || !claude) return null;
  return {
    native: { selected: str(native.selected), latest: str(native.latest), inUse: readUses(native.inUse) },
    claude: { selected: str(claude.selected), inUse: readUses(claude.inUse) },
    unpinnedAgents: typeof r.unpinnedAgents === "number" && r.unpinnedAgents >= 0 ? Math.floor(r.unpinnedAgents) : 0,
  };
}

/** A `cutex/upgrade/updated` envelope's params, or null for any other event / a malformed one. */
export function upgradeEventOf(envelope: { cutex?: { method?: string; params?: unknown } } | null | undefined): UpgradeEvent | null {
  if (envelope?.cutex?.method !== UPGRADE_UPDATED_EVENT) return null;
  const p = envelope.cutex.params;
  if (!p || typeof p !== "object") return null;
  const e = p as Record<string, unknown>;
  const r = e.run && typeof e.run === "object" ? (e.run as Record<string, unknown>) : null;
  const run =
    r && typeof r.runId === "string" && typeof r.phase === "string"
      ? { runId: r.runId, kind: r.kind === "rollback" ? ("rollback" as const) : ("apply" as const), phase: r.phase as UpgradePhase, fromRelease: str(r.fromRelease) ?? "", toRelease: str(r.toRelease) ?? "", servicesDown: r.servicesDown === true }
      : null;
  const staging = e.staging && typeof e.staging === "object" ? (e.staging as UpgradeStaging) : null;
  return { reason: e.reason === "startup" ? "startup" : "state", hostId: str(e.hostId) ?? "", run, available: str(e.available), staged: str(e.staged), staging };
}

/** The text of a manifest note map in the UI language (zh* → zh-CN, else en; then whatever is there). */
export function upgradeNoteText(notes: Record<string, string> | null | undefined, language: string): string | null {
  if (!notes || typeof notes !== "object") return null;
  const zh = language.toLowerCase().startsWith("zh");
  const order = zh ? ["zh-CN", "zh", "en"] : ["en", "en-AU", "zh-CN"];
  for (const tag of order) {
    const text = notes[tag];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  const any = Object.values(notes).find((v) => typeof v === "string" && v.trim());
  return any ? any.trim() : null;
}
