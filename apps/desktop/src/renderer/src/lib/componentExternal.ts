// r269 components (plan components-021 §2–§3; contract frozen in shared/componentIndex.ts): what the component card
// and the runtime settings show for an adapter component whose upstream CLI the owner installs, and for its effective
// offers (signed index). Pure. Every check result, version, readiness and compatibility verdict comes from cutex; this
// file only turns them into copyable per-platform commands and an update / yank / pin summary. The desktop never probes the host.
import { COMPONENT_INDEX_FEATURE, EXTERNAL_RUNTIME_ROOT_FEATURE, componentConfigureCli, externalReadiness, externalRuntimeOf, type ComponentExternal, type ComponentExternalIssue, type ComponentIndexRelease, type ComponentStatus, type ExternalPathKey, type ExternalPaths, type ExternalReadiness, EXTERNAL_PATH_KEYS } from "../../../shared/components";
import type { HostPlatform } from "../../../shared/hosts";

/** The host reports external-install readiness (gate; nothing new without it). */
export function externalGuidanceSupported(features: ReadonlySet<string>): boolean {
  return features.has(EXTERNAL_RUNTIME_ROOT_FEATURE);
}

/** The host reports the signed component index (gate; nothing new without it). */
export function componentIndexSupported(features: ReadonlySet<string>): boolean {
  return features.has(COMPONENT_INDEX_FEATURE);
}

/** Directory / variable name of the install prefix per adapter component (plan §2 README layout). */
const SHORT: Readonly<Record<string, string>> = { "dsh-runtime": "dsh", "kimi-runtime": "kimi" };

export type CommandPlatform = "linux" | "windows";

/** A copyable block for one platform of the target host. */
export interface CommandBlock {
  platform: CommandPlatform;
  /** Shell lines, newline-joined when copied. */
  lines: string[];
}

export interface IssueGuide {
  issue: ComponentExternalIssue;
  /** Known code: the i18n suffix (`modules.component.external.<code>`); false: show cutex's steps only. */
  known: boolean;
  /** One block per platform shown (the host's platform; both when it is unknown). Empty: no commands for this code. */
  commands: CommandBlock[];
}

/**
 * What cutex says the adapter needs: `external`'s own lists first, else the signed `externalRuntime` of the release
 * being checked (the index row of `external.version`). No versions of the desktop's own.
 */
export interface ExternalNeeds {
  packages: string[];
  nodeRecommended: string | null;
}

export function externalNeeds(external: ComponentExternal, release?: ComponentIndexRelease): ExternalNeeds {
  const rt = externalRuntimeOf(release?.version === external.version ? release.externalRuntime : null);
  return { packages: external.packages.length ? external.packages : (rt?.packages ?? []), nodeRecommended: external.nodeRecommended ?? rt?.nodeRecommended ?? null };
}

/** The version part of an npm spec (`@scope/name@1.2.3` → `1.2.3`). */
export function specVersion(spec: string): string | null {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(at + 1) || null : null;
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Platforms whose commands are shown: the host's own, both when unknown (an older host look). */
export function commandPlatforms(platform: HostPlatform | null): CommandPlatform[] {
  return platform === "linux" || platform === "windows" ? [platform] : ["linux", "windows"];
}

/** Node version for install commands: cutex's recommendation, else a plain version in the issue's `expected`; null: no commands. */
function nodeVersion(needs: ExternalNeeds, issue: ComponentExternalIssue): string | null {
  if (needs.nodeRecommended) return needs.nodeRecommended.replace(/^v/, "");
  const plain = issue.expected && /^v?\d+\.\d+\.\d+$/.test(issue.expected.trim()) ? issue.expected.trim().replace(/^v/, "") : null;
  return plain;
}

/** Prefix variable + its definition (the configured root when cutex has one, else a fresh versioned directory). */
function prefixLines(name: string, external: ComponentExternal, needs: ExternalNeeds, platform: CommandPlatform, fresh: boolean): { v: string; def: string } {
  const short = SHORT[name] ?? name.replace(/-runtime$/, "");
  const version = specVersion(needs.packages[0] ?? "") ?? external.version;
  if (!fresh && external.root) return platform === "linux" ? { v: `"$${short}"`, def: `${short}=${shQuote(external.root)}` } : { v: `$${short}`, def: `$${short} = ${psQuote(external.root)}` };
  return platform === "linux"
    ? { v: `"$${short}"`, def: `${short}="$HOME/.local/share/cutex-external/${short}/${version}"` }
    : { v: `$${short}`, def: `$${short} = Join-Path $env:LOCALAPPDATA ${psQuote(`cutex-external/${short}/${version}`)}` };
}

function commandsFor(name: string, external: ComponentExternal, needs: ExternalNeeds, issue: ComponentExternalIssue, platform: CommandPlatform): string[] | null {
  const linux = platform === "linux";
  switch (issue.code) {
    case "external_root_missing":
    case "external_root_invalid":
    case "upstream_version_mismatch": {
      // Without cutex's package list there is nothing exact to install: its steps only.
      if (!needs.packages.length) return null;
      // A new versioned prefix each time (an upgrade never rewrites the directory pinned agents use).
      const p = prefixLines(name, external, needs, platform, true);
      const pkgs = needs.packages.map((s) => (linux ? s : psQuote(s)));
      const node = linux ? `"$(command -v node)"` : "(Get-Command node.exe).Source";
      return [p.def, `npm install --prefix ${p.v} ${pkgs.join(" ")}`, componentConfigureCli(name, [["externalRoot", p.v], ["node", node]])];
    }
    case "node_missing":
    case "node_version_unsupported": {
      const v = nodeVersion(needs, issue);
      if (!v) return null;
      if (linux)
        return [
          `node_dir="$HOME/.local/share/cutex-external/node"; arch=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')`,
          `mkdir -p "$node_dir" && curl -fsSL "https://nodejs.org/dist/v${v}/node-v${v}-linux-$arch.tar.xz" | tar -xJ -C "$node_dir"`,
          componentConfigureCli(name, [["node", `"$node_dir/node-v${v}-linux-$arch/bin/node"`]]),
        ];
      return [`winget install -e --id OpenJS.NodeJS --version ${v}`, componentConfigureCli(name, [["node", "(Get-Command node.exe).Source"]])];
    }
    case "kimi_pty_unavailable": {
      const p = prefixLines(name, external, needs, platform, false);
      return linux
        ? ["sudo apt-get install build-essential python3", p.def, `npm rebuild --prefix ${p.v} node-pty`]
        : [`winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`, p.def, `npm rebuild --prefix ${p.v} node-pty`];
    }
    case "kimi_rg_missing":
      return linux
        ? ["sudo apt-get install ripgrep", componentConfigureCli(name, [["rg", `"$(command -v rg)"`]])]
        : ["winget install -e --id BurntSushi.ripgrep.MSVC", componentConfigureCli(name, [["rg", "(Get-Command rg.exe).Source"]])];
    default:
      return null;
  }
}

const KNOWN = new Set(["external_root_missing", "external_root_invalid", "upstream_version_mismatch", "node_missing", "node_version_unsupported", "kimi_pty_unavailable", "kimi_rg_missing"]);

/** The guide of every failed check, in cutex's order, with commands for the target host's platform. `release`: the index row of `external.version`. */
export function externalGuides(name: string, external: ComponentExternal, platform: HostPlatform | null, release?: ComponentIndexRelease): IssueGuide[] {
  const needs = externalNeeds(external, release);
  return external.issues.map((issue) => {
    const commands = commandPlatforms(platform).flatMap((p): CommandBlock[] => {
      const lines = commandsFor(name, external, needs, issue, p);
      return lines ? [{ platform: p, lines }] : [];
    });
    return { issue, known: KNOWN.has(issue.code), commands };
  });
}

/** The configure form asks for an rg path only for Kimi (plan §2: rg is a Kimi requirement), or when one is reported / stored. */
export function configureFields(name: string, external: ComponentExternal): ExternalPathKey[] {
  return name === "kimi-runtime" || external.rg !== null || (external.storedConfig?.rg ?? null) !== null || external.issues.some((i) => i.code === "kimi_rg_missing") ? ["externalRoot", "node", "rg"] : ["externalRoot", "node"];
}

export interface ConfigureFormState {
  /** What the inputs start with: the stored overrides (r270), else the effective paths cutex reports (r269). */
  initial: Record<ExternalPathKey, string>;
  /** Fields 恢复默认 clears (sent as null). */
  stored: ExternalPathKey[];
  /** 恢复默认 is offered. */
  resettable: boolean;
  /** cutex reported its stored overrides (r270 `storedConfig`): the inputs are exact and saving sends changed fields only. */
  exact: boolean;
  /** r270 stored overrides (null field: discovered by cutex). */
  storedValues?: ExternalPaths;
  /** r270 effective paths, shown under the inputs. */
  resolved?: ExternalPaths;
}

/**
 * The path form of an adapter's external runtime. r270: the inputs edit `storedConfig` exactly and 恢复默认 is offered only
 * for stored overrides (any field, rg included). r269 (`storedConfig` unknown): the effective paths fill the inputs and the
 * old heuristic applies — a non-empty root / node counts as stored; cutex 86753eea reports an rg it found on PATH, so rg
 * alone does not offer 恢复默认 (with it, a reported rg is cleared too, harmless when not stored).
 */
export function configureFormState(external: ComponentExternal, fields: readonly ExternalPathKey[]): ConfigureFormState {
  const resolved = external.resolved ? { resolved: external.resolved } : {};
  const sc = external.storedConfig;
  if (sc) {
    const stored = EXTERNAL_PATH_KEYS.filter((f) => sc[f] !== null);
    return { initial: { externalRoot: sc.externalRoot ?? "", node: sc.node ?? "", rg: sc.rg ?? "" }, stored, resettable: stored.length > 0, exact: true, storedValues: sc, ...resolved };
  }
  const initial = { externalRoot: external.root ?? "", node: external.node ?? "", rg: external.rg ?? "" };
  const stored = fields.filter((f) => initial[f] !== "");
  return { initial, stored, resettable: stored.some((f) => f !== "rg"), exact: false, ...resolved };
}

/** Paths the owner may type (cutex checks them again): absolute on either platform, or empty (= cutex's default). */
export function configurePathOk(value: string): boolean {
  const v = value.trim();
  return v === "" || /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(v);
}

// ---------- adapter candidate (contract: `external` may describe a staged version while the bundled one stays selected) ----------

export interface ExternalStatus {
  external: ComponentExternal;
  /** cutex's verdict; `checkedAt: null` is `unverified`, never ready. */
  readiness: ExternalReadiness;
  /** The checked version is not the new-agent default (e.g. dsh-r3 verified / staged while dsh-r2 stays selected). */
  candidate: boolean;
  /** The index row of `external.version` (its signed externalRuntime), when listed. */
  release?: ComponentIndexRelease;
}

/** `external` of a component on a host with the gate (undefined: nothing to show). */
export function externalStatus(c: ComponentStatus | undefined, features: ReadonlySet<string>): ExternalStatus | undefined {
  const external = c?.external;
  if (!c || !external || !externalGuidanceSupported(features)) return undefined;
  const release = c.index?.releases.find((r) => r.version === external.version);
  return { external, readiness: externalReadiness(external), candidate: external.version !== c.selected, ...(release ? { release } : {}) };
}

// ---------- effective offers / signed component index (plan §3) ----------

export type IndexOffer =
  /** The selected version is the recommendation. */
  | { kind: "current"; version: string }
  /** A compatible recommended version this host can install: an adapter update for new agents. */
  | { kind: "adapterUpdate"; version: string; requirements: Record<string, string> }
  /** The recommended version needs a newer cutex (`capability:` / `payload:` reason). */
  | { kind: "needsCutex"; version: string; reason: string | null }
  /** The recommended version cannot run on this host for another reason (`platform` / cutex's text). */
  | { kind: "incompatible"; version: string; reason: string | null }
  /**
   * A recommendation cutex does not list among the releases: malformed / unknown data (contract clarification 5), not a
   * platform mismatch. Nothing is offered; refreshing the index is the only action and the current selection stays.
   */
  | { kind: "unknown"; version: string }
  /** No recommendation (a withdrawal with no safe version yet): wait for a fix. */
  | { kind: "none" };

export interface IndexView {
  offer: IndexOffer;
  /** The new-agent default was withdrawn (cutex's `selectedYanked`): its reason when still listed, and the version to go back to (null: none yet). */
  yanked: { version: string; reason: string | null; safe: string | null } | null;
  /** Versions existing agents stay on (other than the new-agent default), most agents first. */
  pins: { version: string; agents: number }[];
  source: string;
  channel: string | null;
  sequence: number | null;
  publishedAt: string | null;
  fetchedAt: string | null;
  stale: boolean;
  staleReason: string | null;
}

const release = (releases: readonly ComponentIndexRelease[], version: string | null) => (version ? releases.find((r) => r.version === version) : undefined);

/** A newer cutex brings it: a missing capability or payload mode. */
function upgradeNeeded(reason: string | null): boolean {
  return !!reason && /^(?:capability|payload):/.test(reason);
}

/** The update / yank / pin summary of a component that carries `index` (undefined: nothing to show). */
export function componentIndexView(c: ComponentStatus | undefined): IndexView | undefined {
  const index = c?.index;
  if (!c || !index) return undefined;
  const rec = release(index.releases, index.recommended);
  const recUsable = !!index.recommended && !rec?.yanked;
  let offer: IndexOffer;
  if (!index.recommended || rec?.yanked) offer = { kind: "none" };
  else if (index.recommended === c.selected) offer = { kind: "current", version: c.selected };
  // A recommendation missing from the rows is unknown data: never a platform verdict, never another version inferred.
  else if (!rec) offer = { kind: "unknown", version: index.recommended };
  // cutex decides compatibility.
  else if (!rec.compatible)
    offer = upgradeNeeded(rec.incompatibleReason) ? { kind: "needsCutex", version: index.recommended, reason: rec.incompatibleReason } : { kind: "incompatible", version: index.recommended, reason: rec.incompatibleReason };
  else offer = { kind: "adapterUpdate", version: index.recommended, requirements: rec.requirements };
  const sel = release(index.releases, c.selected);
  const selYanked = !!c.selected && (index.selectedYanked || !!sel?.yanked);
  const safe = recUsable && rec?.compatible === true && index.recommended !== c.selected ? index.recommended : null;
  const yanked = selYanked ? { version: c.selected!, reason: sel?.yankReason ?? null, safe } : null;
  // While a yank is shown, its own line carries the safe version: no separate update offer for it.
  if (yanked && offer.kind === "adapterUpdate" && offer.version === yanked.safe) offer = { kind: "none" };
  const pins = c.versions.filter((v) => v.pinnedBy > 0 && v.version !== c.selected).map((v) => ({ version: v.version, agents: v.pinnedBy })).sort((a, b) => b.agents - a.agents);
  return { offer, yanked, pins, source: index.source, channel: index.channel, sequence: index.sequence, publishedAt: index.publishedAt, fetchedAt: index.fetchedAt, stale: index.stale, staleReason: index.staleReason };
}

/** `capability:<name>` → the capability; otherwise null (show cutex's text). */
export function missingCapability(reason: string | null): string | null {
  const m = reason ? /^capability:(.+)$/.exec(reason) : null;
  return m ? m[1]! : null;
}

// ---------- host Node prerequisite (Settings → 运行时 groups of DSH / Kimi Code) ----------

export interface NodeRequirement {
  /** The full supported range (`>=24.9.0 <25`), null: cutex reports only a minimum. */
  range: string | null;
  /** A plain minimum version (`24.9.0`), used only without a range. */
  minimum: string | null;
  /** The Node version cutex actually observed on the host; null: unknown (never the recommended one). */
  version: string | null;
}

const PLAIN_VERSION = /^v?\d+(?:\.\d+)*$/;

/**
 * What the runtime group says about Node. r270 (ae9cced9): the legacy `node.minimum` is a plain version again, the full
 * range comes from `node.range` (ComponentStatus.nodeRange) or `external.nodeRange`; aa1d3463 reported the range as the
 * minimum, so a non-plain minimum is read as a range. The version is only what cutex observed (`node.version`, else
 * `external.nodeVersion`): `nodeRecommended` never fills it. null: nothing reported.
 */
export function nodeRequirement(component: ComponentStatus | undefined, legacy: { minimum: string; version: string | null } | undefined): NodeRequirement | null {
  const minimum = legacy?.minimum.trim() || null;
  const range = component?.nodeRange ?? component?.external?.nodeRange ?? (minimum && !PLAIN_VERSION.test(minimum) ? minimum : null);
  const plain = minimum && PLAIN_VERSION.test(minimum) ? minimum : null;
  if (!range && !plain) return null;
  return { range, minimum: range ? null : plain, version: legacy?.version ?? component?.external?.nodeVersion ?? null };
}

const RANGE_OP: Readonly<Record<string, string>> = { ">=": "≥ ", "<=": "≤ ", ">": "> ", "<": "< ", "=": "" };

/** `>=24.9.0 <25` → `≥ 24.9.0, < 25` (comparators only); anything else (`||`, `^`, `x`) as cutex wrote it. */
export function formatNodeRange(range: string): string {
  const parts = range.trim().replace(/(>=|<=|>|<|=)\s+/g, "$1").split(/\s+/);
  const out: string[] = [];
  for (const part of parts) {
    const m = /^(>=|<=|>|<|=)?(v?\d+(?:\.\d+)*)$/.exec(part);
    if (!m) return range.trim();
    out.push(`${RANGE_OP[m[1] ?? "="]}${m[2]}`);
  }
  return out.join(", ");
}
