// v1.16 (docs/desktop-modules.md §23): signed first-party module packs. A pack's entry is a single ES
// module the app imports after main verified it; it shares the app's React / zustand / app files through
// the host object below instead of bundling its own copies.
import type { ModuleDefinition, SlotItemBase } from './modules';

/** Name of the global the app installs before importing a pack entry. */
export const MODULE_PACK_HOST_GLOBAL = "__CUTEX_MODULE_HOST__";

/** The host object packs read shared modules from (an import-map style shim). */
export interface ModulePackHost {
  /** The app's MODULE_API_VERSION. */
  readonly apiVersion: string;
  /** The app's namespace object for a shared specifier (`react`, `@cutex-desktop/app/store`, …); throws for unknown ones. */
  get(specifier: string): Readonly<Record<string, unknown>>;
}

/** Messages a pack brings: locale → { "<moduleId>.<key>": text }; only keys of its own module. */
export type ModulePackMessages = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** What a pack entry module exports. */
export interface ModulePackEntry<M extends { [S in keyof M]: SlotItemBase } = Record<string, SlotItemBase>, Svc = unknown, K extends string = string> {
  /** semver range over MODULE_API_VERSION, e.g. "^1.16"; the same as in the signed index. */
  readonly moduleApi: string;
  readonly module: ModuleDefinition<M, Svc, K>;
  readonly messages?: ModulePackMessages;
}

/** One comparator of a parsed range; versions are [major, minor, patch]. */
export interface ModuleApiComparator { readonly op: '>=' | '>' | '<=' | '<' | '='; readonly version: readonly [number, number, number] }
type Version = ModuleApiComparator['version'];
type Comparator = ModuleApiComparator;

/** `M.m[.p]`; inside a range also a bare `M` (= M.0.0). */
function parseVersion(text: string, bareMajor = false): Version | null {
  const m = /^(0|[1-9]\d{0,5})(?:\.(0|[1-9]\d{0,5})(?:\.(0|[1-9]\d{0,5}))?)?$/.exec(text);
  if (!m || (m[2] === undefined && !bareMajor)) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * A range as comparators (all must hold): `^1.16` (>=1.16.0 <2.0.0; `^0.3` = >=0.3.0 <0.4.0), `~1.16`
 * (>=1.16.0 <1.17.0), `>=1.16 <2` (a bare major = M.0.0), `1.16` / `=1.16` (exactly 1.16.0). Null when malformed.
 */
export function parseModuleApiRange(range: string): ModuleApiComparator[] | null {
  if (typeof range !== 'string' || range.length > 64) return null;
  const parts = range.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const out: Comparator[] = [];
  for (const part of parts) {
    const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(part);
    const version = m ? parseVersion(m[2]!, true) : null;
    if (!m || !version) return null;
    const op = m[1] ?? '=';
    if (op === '^') {
      out.push({ op: '>=', version }, { op: '<', version: version[0] > 0 ? [version[0] + 1, 0, 0] : [0, version[1] + 1, 0] });
    } else if (op === '~') {
      out.push({ op: '>=', version }, { op: '<', version: [version[0], version[1] + 1, 0] });
    } else {
      out.push({ op: op as Comparator['op'], version });
    }
  }
  return out;
}

/** Whether `version` (MODULE_API_VERSION, `M.m[.p]`) satisfies `range`; false for a malformed range or version. */
export function moduleApiSatisfies(range: string, version: string): boolean {
  const comparators = parseModuleApiRange(range);
  const v = parseVersion(version);
  if (!comparators || !v) return false;
  return comparators.every(({ op, version: c }) => {
    const d = compare(v, c);
    return op === '>=' ? d >= 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : op === '<' ? d < 0 : d === 0;
  });
}

/**
 * Compatibility of a pack's range with the app: `ok`; `needsNewerApp` when the app is below what the
 * range asks (a lower bound above it, or a malformed range — an app that cannot read it is too old);
 * `needsNewerModule` when the app is past the range.
 */
export function moduleApiVerdict(range: string, version: string): 'ok' | 'needsNewerApp' | 'needsNewerModule' {
  if (moduleApiSatisfies(range, version)) return 'ok';
  const comparators = parseModuleApiRange(range);
  const v = parseVersion(version);
  if (!comparators || !v) return 'needsNewerApp';
  const below = comparators.some(({ op, version: c }) => (op === '>=' || op === '=' ? compare(v, c) < 0 : op === '>' ? compare(v, c) <= 0 : false));
  return below ? 'needsNewerApp' : 'needsNewerModule';
}
