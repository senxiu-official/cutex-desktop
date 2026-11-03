// r269 component contract, FROZEN by Wren on 2026-10-29 (cutex feat/r269-component-index cefe571a,
// docs/contracts/component-index-v1.md "Desktop capability and GET contract" / "Owner actions and progress"): the
// daemon-verified external-install readiness of an adapter component (DSH / Kimi installed by the user) and the
// component's state in the signed component index. Every wire name of the contract is in this file. Readers are
// lenient: absent / malformed → undefined, so a cutex without the capability shows nothing new. Kept in the app (not
// cutex-client): shared/components.ts attaches `external` / `index` / `indexOperation` / operation `result` to the client
// reader's values and main/daemon.ts sends the new routes with the client's raw request.
//
// The desktop never probes, installs or reads the host itself, and never decides compatibility or readiness: cutex
// reports what it checked; the desktop shows it and asks cutex to re-check / configure (owner actions, Management v2).
// `configure` (and its CLI) belong to Moth's external-runtime module, not yet published: kept isolated here and mocked.
//
// r270 additive delta (cutex fix/r270-component-contract a40c7e81, docs/contracts/component-external-ui-v1.md): `external`
// carries `storedConfig` (the owner's exact stored overrides) and `resolved` (the effective paths), an issue may carry
// expandable `diagnostics` next to its compact `actual`, and a `component_source_only` refusal may name the verified
// version to request explicitly (`details.offeredVersion` / `details.suggestedRequest.version`). r269 daemons send none of
// these: the readers leave them undefined and the desktop behaves as for r269.

/** Capability: `GET /v2/components` carries `index` per component and top-level `indexOperation`; install takes `{version}`; `POST /v2/components/index/check`. */
export const COMPONENT_INDEX_FEATURE = "component-index-v1";
/** Capability: adapter components report `external` readiness; `check` / `configure` routes exist (Moth). */
export const EXTERNAL_RUNTIME_ROOT_FEATURE = "external-runtime-root-v1";
/** Index refresh event `{channel, sequence, stale, staleReason, operation}` (no component name): re-read the list. */
export const COMPONENTS_INDEX_UPDATED_EVENT = "cutex/components/indexUpdated";
/** Explicit refresh of the configured signed index → 202 `{operation}` (action `indexCheck`, name null); no selection change. */
export const COMPONENT_INDEX_CHECK_PATH = "/v2/components/index/check";

/** needsUser codes of the external-install readiness probe (contract "initial issue codes"). Unknown newer codes pass through. */
export const EXTERNAL_ISSUE_CODES = [
  "external_root_missing",
  "external_root_invalid",
  "upstream_version_mismatch",
  "node_missing",
  "node_version_unsupported",
  "kimi_pty_unavailable",
  "kimi_rg_missing",
] as const;
export type ExternalIssueCode = (typeof EXTERNAL_ISSUE_CODES)[number];

/** One failed readiness check (cutex `needsUser` with structure). */
export interface ComponentExternalIssue {
  code: ExternalIssueCode | (string & {});
  /** What the adapter requires (a version / range / package spec), as cutex words it. */
  expected: string | null;
  /** What cutex found (a version, `missing`, an error line). */
  actual: string | null;
  /** The path the check looked at (prefix, JS entry, node / rg executable). */
  path: string | null;
  /** cutex's own steps (shown as is, after the desktop's per-platform commands). */
  steps: string[];
  /**
   * r270: the original diagnostic text (stack, stderr) behind a compact single-line `actual`, for an expandable area
   * (≤ 64 KiB, cutex marks a truncation). Absent: nothing more than `actual` (and on r269 daemons, whose `actual` may itself be multi-line).
   */
  diagnostics?: string;
}

/** The three discovery inputs of an adapter's external runtime (r270 `storedConfig` / `resolved`). */
export interface ExternalPaths {
  externalRoot: string | null;
  node: string | null;
  rg: string | null;
}

export const EXTERNAL_PATH_KEYS = ["externalRoot", "node", "rg"] as const;
export type ExternalPathKey = (typeof EXTERNAL_PATH_KEYS)[number];

/**
 * `external` of a component status: the user-installed dependencies of the adapter `version` (`payload: adapter-v1`).
 * May belong to a candidate (e.g. dsh-r3 staged) while the bundled r2 stays selected. Absent: no adapter candidate
 * or selected adapter — never infer readiness from absence.
 */
export interface ComponentExternal {
  /** The adapter version these checks are for (the selected one, or a candidate). */
  version: string;
  /** Configured (owner) external npm prefix, or the deployment default cutex uses; null: none. */
  root: string | null;
  /** Configured absolute Node path (null: cutex looks on its own PATH). */
  node: string | null;
  /** Configured absolute rg path (Kimi; null: cutex's PATH). */
  rg: string | null;
  /** npm specs the adapter needs in the prefix (from its signed external-runtime.json), e.g. `ws@8.22.0`. */
  packages: string[];
  /** Node range the adapter supports, e.g. `>=24.9.0 <25`. */
  nodeRange: string | null;
  /** Node version the adapter recommends, e.g. `24.21.0`. For install commands only: never shown as the host's version. */
  nodeRecommended: string | null;
  /**
   * r270 (ae9cced9): the actual `node --version` cutex observed during an explicit check / configure / prepare, e.g.
   * `v24.21.0`. Absent: not observed (old cache, changed config or binary, older daemon): unknown, never the recommendation.
   */
  nodeVersion?: string;
  /** When cutex last completed the probe (ISO 8601). null: UNVERIFIED, even with no issues. */
  checkedAt: string | null;
  /** Failed checks of the last probe. */
  issues: ComponentExternalIssue[];
  /**
   * r270: the owner's stored overrides, exactly as saved (no canonicalisation / display rewrite). null field: no override,
   * cutex discovers it (environment / PATH / default) — not "not found". undefined (r269 daemon, invalid cache): unknown.
   */
  storedConfig?: ExternalPaths;
  /** r270: the effective host paths of the current check, in owner display form (null: none found / none used). */
  resolved?: ExternalPaths;
}

/** `ready`: a completed probe found nothing; `unverified`: never probed (or invalidated by a configuration change). */
export type ExternalReadiness = "ready" | "needsUser" | "unverified";

/** Readiness as cutex reports it: `checkedAt: null` is never ready (contract), whatever `issues` says. */
export function externalReadiness(e: ComponentExternal): ExternalReadiness {
  if (e.checkedAt === null) return "unverified";
  return e.issues.length ? "needsUser" : "ready";
}

/** Where the offers come from (effective offer policy). */
export type ComponentIndexSource = "componentIndex" | "releaseManifest" | "privateKit";

export interface ComponentIndexRelease {
  version: string;
  /** Withdrawn by a later signed sequence: never offered to new installs. */
  yanked: boolean;
  yankReason: string | null;
  /** cutex judged it installable here (capabilities, payload mode, handler protocol, platform). Independent of yank / readiness. */
  compatible: boolean;
  /** Why not: `capability:<name>` / `payload:<mode>` / `platform` / free text from cutex. */
  incompatibleReason: string | null;
  /** Daemon-produced display map, e.g. `{upstream: "@deepseek-ai/dsh@0.2.1-rc.3", node: ">=24.9.0 <25"}`. Display only. */
  requirements: Record<string, string>;
  /** The exact signed `cutex/external-runtime/v1` object of an adapter release (null: bundled). Read with externalRuntimeOf. */
  externalRuntime: Record<string, unknown> | null;
  /** SHA256 of the raw external-runtime.json in the archive (null: bundled). */
  externalRuntimeSha256: string | null;
}

/** `index` of a component status: what cutex verified (or fell back to) for this component's offers. */
export interface ComponentIndexState {
  source: ComponentIndexSource | (string & {});
  /** null with sequence / publishedAt: no signed index supplied these offers. */
  channel: string | null;
  sequence: number | null;
  /** The index's own `publishedAt`. */
  publishedAt: string | null;
  /** Last successful paired verification (not the last failed try). */
  fetchedAt: string | null;
  /** Channel refresh property (the same on every row of the channel): the last refresh failed, cached offers shown. */
  stale: boolean;
  staleReason: string | null;
  /** The effective safe recommendation for this host (null: none). */
  recommended: string | null;
  /** The selected version was withdrawn (may be true when it is no longer in the document). */
  selectedYanked: boolean;
  releases: ComponentIndexRelease[];
}

/** Terminal `result` of a component install / check / configure operation (absent on old daemons). */
export interface ComponentOperationResult {
  outcome: "selected" | "ready" | "needsUser" | (string & {});
  version: string | null;
  /** This operation committed a new-agent default. `done` alone never means selected. */
  selected: boolean;
}

/** Payload of `cutex/components/indexUpdated`. */
export interface ComponentIndexEvent {
  channel: string | null;
  sequence: number | null;
  stale: boolean;
  staleReason: string | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 && v.length <= 4096 ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : []);
const positive = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 1 ? v : null);
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * A Windows host path as the owner typed it: cutex 86753eea reports canonicalized `\\?\C:\…` (verbatim) paths, which
 * read badly and break npm / PowerShell commands built from them. Only the drive form is shortened (`\\?\UNC\…` stays).
 */
export function hostPath(value: string | null): string | null {
  return value && /^\\\\\?\\[A-Za-z]:\\/.test(value) ? value.slice(4) : value;
}

/** 64 KiB of UTF-8 is at most 65536 UTF-16 units; room for cutex's truncation marker. */
const DIAGNOSTICS_MAX = 66_000;

/**
 * r270 `storedConfig` / `resolved`: all three keys, each a string or null; anything else is unknown (undefined), never
 * "three absent overrides". Stored values stay byte-exact (`display` false); effective ones get the display form.
 */
function readPaths(value: unknown, display: boolean): ExternalPaths | undefined {
  const p = obj(value);
  if (!p) return undefined;
  const out: Partial<ExternalPaths> = {};
  for (const key of EXTERNAL_PATH_KEYS) {
    const v = p[key];
    if (v === null) out[key] = null;
    else if (typeof v === "string" && v.length > 0 && v.length <= 4096) out[key] = display ? hostPath(v) : v;
    else return undefined;
  }
  return out as ExternalPaths;
}

export function readComponentExternal(value: unknown): ComponentExternal | undefined {
  const e = obj(value);
  const version = str(e?.version);
  if (!e || !version || !Array.isArray(e.issues)) return undefined;
  const issues = e.issues.flatMap((v): ComponentExternalIssue[] => {
    const i = obj(v);
    const code = str(i?.code);
    if (!i || !code) return [];
    const diagnostics = typeof i.diagnostics === "string" && i.diagnostics.trim().length > 0 && i.diagnostics.length <= DIAGNOSTICS_MAX ? i.diagnostics : undefined;
    return [{ code, expected: str(i.expected), actual: str(i.actual), path: hostPath(str(i.path)), steps: strings(i.steps), ...(diagnostics ? { diagnostics } : {}) }];
  });
  const storedConfig = readPaths(e.storedConfig, false);
  const resolved = readPaths(e.resolved, true);
  const nodeVersion = str(e.nodeVersion);
  return { version, root: hostPath(str(e.root)), node: hostPath(str(e.node)), rg: hostPath(str(e.rg)), packages: strings(e.packages), nodeRange: str(e.nodeRange), nodeRecommended: str(e.nodeRecommended), ...(nodeVersion ? { nodeVersion } : {}), checkedAt: str(e.checkedAt), issues, ...(storedConfig ? { storedConfig } : {}), ...(resolved ? { resolved } : {}) };
}

export function readComponentIndex(value: unknown): ComponentIndexState | undefined {
  const x = obj(value);
  const source = str(x?.source);
  if (!x || !source) return undefined;
  const releases = Array.isArray(x.releases)
    ? x.releases.flatMap((v): ComponentIndexRelease[] => {
        const r = obj(v);
        const version = str(r?.version);
        if (!r || !version) return [];
        const req = obj(r.requirements) ?? {};
        const requirements = Object.fromEntries(Object.entries(req).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0));
        const sha = typeof r.externalRuntimeSha256 === "string" && SHA256.test(r.externalRuntimeSha256) ? r.externalRuntimeSha256 : null;
        // cutex decides compatibility: anything but an explicit true is not installable here.
        return [{ version, yanked: r.yanked === true, yankReason: str(r.yankReason), compatible: r.compatible === true, incompatibleReason: str(r.incompatibleReason), requirements, externalRuntime: obj(r.externalRuntime), externalRuntimeSha256: sha }];
      })
    : [];
  return { source, channel: str(x.channel), sequence: positive(x.sequence), publishedAt: str(x.publishedAt), fetchedAt: str(x.fetchedAt), stale: x.stale === true, staleReason: str(x.staleReason), recommended: str(x.recommended), selectedYanked: x.selectedYanked === true, releases };
}

export function readOperationResult(value: unknown): ComponentOperationResult | undefined {
  const r = obj(value);
  const outcome = str(r?.outcome);
  if (!r || !outcome) return undefined;
  return { outcome, version: str(r.version), selected: r.selected === true };
}

/** `cutex/components/indexUpdated` → its payload; null for any other event. */
export function componentIndexEventOf(envelope: { cutex?: { method?: string; params?: unknown } } | null | undefined): ComponentIndexEvent | null {
  if (envelope?.cutex?.method !== COMPONENTS_INDEX_UPDATED_EVENT) return null;
  const p = obj(envelope.cutex.params) ?? {};
  return { channel: str(p.channel), sequence: positive(p.sequence), stale: p.stale === true, staleReason: str(p.staleReason) };
}

/** npm specs and recommended Node of a signed `cutex/external-runtime/v1` object (Linnet's format; display / commands only). */
export function externalRuntimeOf(rt: Record<string, unknown> | null | undefined): { packages: string[]; nodeRecommended: string | null; nodeRange: string | null } | null {
  if (!rt || rt.schema !== "cutex/external-runtime/v1") return null;
  const pkgs = obj(obj(rt.externalRoot)?.packages) ?? {};
  const node = obj(rt.node);
  const packages = Object.entries(pkgs).flatMap(([name, v]) => (typeof v === "string" && v ? [`${name}@${v}`] : []));
  return { packages, nodeRecommended: str(node?.recommended), nodeRange: str(node?.range) };
}

/**
 * Body of `POST /v2/components/{name}/configure` (contract: `{externalRoot?, node?, rg?}`, absolute host paths, null clears,
 * absent unchanged; cutex re-runs the probe). The route is Moth's and not implemented yet: the desktop sends it only on hosts
 * with EXTERNAL_RUNTIME_ROOT_FEATURE and the preview mocks it.
 */
export interface ComponentConfigureRequest {
  externalRoot?: string | null;
  node?: string | null;
  rg?: string | null;
}

/** Absolute path on either platform (cutex checks it again; this only refuses obvious junk before sending). */
const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

export function componentConfigureBody(req: ComponentConfigureRequest): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  for (const key of ["externalRoot", "node", "rg"] as const) {
    const v = req[key];
    if (v === undefined) continue;
    if (v === null || v.trim() === "") body[key] = null;
    else if (!ABSOLUTE.test(v.trim()) || /[\u0000-\u001f]/.test(v)) throw new Error(`${key} must be an absolute path`);
    else body[key] = v.trim();
  }
  return body;
}

const CONFIGURE_FLAG = { externalRoot: "external-root", node: "node", rg: "rg" } as const;

/**
 * The owner CLI that stores the same paths on the host (shown in copyable commands). Confirmed for cutex 86753eea (contract
 * "Implemented desktop integration clarifications" 1): `cutex component configure <name> --external-root … --node … --rg …`.
 */
export function componentConfigureCli(name: string, flags: readonly [flag: "externalRoot" | "node" | "rg", value: string][]): string {
  return [`cutex component configure ${name}`, ...flags.map(([f, v]) => `--${CONFIGURE_FLAG[f]} ${v}`)].join(" ");
}

/** The same CLI clearing stored paths (`--clear-*` = API null: back to cutex's default / environment discovery). */
export function componentClearCli(name: string, flags: readonly ("externalRoot" | "node" | "rg")[]): string {
  return [`cutex component configure ${name}`, ...flags.map((f) => `--clear-${CONFIGURE_FLAG[f]}`)].join(" ");
}

/**
 * r270: refusal of an empty install on a build without a release manifest (a source / debug build). Not in the
 * cutex-client refusal list (Waveline pins that package): the desktop adds its friendly line itself.
 */
export const COMPONENT_SOURCE_ONLY = "component_source_only";
/** Refusal codes with friendly copy in the desktop beyond cutex-client's COMPONENT_REFUSAL_CODES. */
export const DESKTOP_REFUSAL_CODES = [COMPONENT_SOURCE_ONLY] as const;

/**
 * The verified version a `component_source_only` refusal suggests requesting explicitly (`details.suggestedRequest.version`,
 * else `details.offeredVersion`); null: none (legacy source-only guidance). Used only as the body of an explicit,
 * owner-clicked install `{version}` — never to retry an empty install on the owner's behalf.
 */
export function sourceOnlyOffer(code: string, details: unknown): string | null {
  if (code !== COMPONENT_SOURCE_ONLY) return null;
  const d = obj(details);
  return str(obj(d?.suggestedRequest)?.version) ?? str(d?.offeredVersion);
}

/** `external` / `index` of one raw status (only the keys present and well-formed). */
export function readR269Fields(value: unknown): { external?: ComponentExternal; index?: ComponentIndexState; nodeRange?: string } {
  const c = obj(value);
  const external = readComponentExternal(c?.external);
  const index = readComponentIndex(c?.index);
  // r270 (ae9cced9): the legacy dsh / kimi detail keeps `node.minimum` a plain version and adds the full `node.range`
  // (the cutex-client reader does not carry it).
  const nodeRange = str(obj(obj(c?.dsh)?.node)?.range) ?? str(obj(obj(c?.kimi)?.node)?.range);
  return { ...(external ? { external } : {}), ...(index ? { index } : {}), ...(nodeRange ? { nodeRange } : {}) };
}
