// Optional components (cutex `components`, owner only; components spec v2 §4): backend pieces cutex
// installs, updates and removes on demand (job-service, claude-runtime). The desktop only reads the
// state and *asks* cutex to install / remove one — it never downloads, starts or touches files itself.
// Readers are lenient (unknown states / fields pass through) so a newer cutex never breaks the card.

/** Static capability: the routes below exist (component state is only in `GET /v2/components`). */
export const COMPONENTS_FEATURE = "components";
/** Host event published on every change; its params are small — re-read `GET /v2/components`. */
export const COMPONENTS_UPDATED_EVENT = "cutex/components/updated";
/** kebab-case, stable forever (manifest key, on-disk dir, desktop i18n key). */
export const COMPONENT_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export type ComponentState = "missing" | "installing" | "ready" | "degraded" | "needsUser" | "external" | "restartPending" | "notInManifest";
export const COMPONENT_STATES: readonly ComponentState[] = ["missing", "installing", "ready", "degraded", "needsUser", "external", "restartPending", "notInManifest"];
/** `release`: signed installs over HTTP; `source-only`: only `cutex component install <name> --from-source <dir>` (CLI); `none`: neither. */
export type ComponentInstallFrom = "release" | "source-only" | "none";

export interface ComponentVersion {
  version: string;
  /** Agents / sessions pinning this version. */
  pinnedBy: number;
  sizeBytes: number;
}

export interface ComponentStatus {
  name: string;
  /** This host's platform is one the component ships for. */
  supported: boolean;
  /** One of COMPONENT_STATES; an unknown newer state passes through as is. */
  state: ComponentState | (string & {});
  /** Version selected for new agents (null: none). */
  selected: string | null;
  /** Version this cutex release names (null: none / not in the manifest). */
  available: string | null;
  origin: "signed" | "source" | null;
  versions: ComponentVersion[];
  error: string | null;
  /** `needsUser`: what the owner must do (cutex `steps`); empty otherwise. */
  steps: string[];
}

export type ComponentOperationState = "running" | "done" | "failed";
/** Refusal codes of the install / remove routes (each has a friendly line on the card). */
export const COMPONENT_REFUSAL_CODES = ["unmanaged_install", "component_unsupported_platform", "component_external", "upgrade_blocked", "component_pinned", "jobs_running"] as const;
export type ComponentRefusalCode = (typeof COMPONENT_REFUSAL_CODES)[number];

/** A component install / remove cutex runs (202 `{operation}`, list `operation`, event `operation`). */
export interface ComponentOperation {
  id: string | null;
  /** Component name. */
  name: string | null;
  action: "install" | "remove" | (string & {}) | null;
  /** `running` | `done` | `failed`; a newer value passes through. */
  state: ComponentOperationState | (string & {}) | null;
  /** Current step while running (download, verify, prepare, select, …); null when cutex names none. */
  step: string | null;
  error: string | null;
}

export interface ComponentsList {
  /** The daemon runs from a managed install (`install.json`); false = set up by hand. */
  managed: boolean;
  installFrom: ComponentInstallFrom | (string & {});
  components: ComponentStatus[];
  /** The running operation, if any. */
  operation: ComponentOperation | null;
}

export interface ComponentEvent {
  name: string | null;
  /** `operation` | `state` | `startup`; a newer value passes through. */
  reason: "operation" | "state" | "startup" | (string & {}) | null;
  /** The component's state after the change. */
  state: string | null;
  operation: ComponentOperation | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : []);

/** A component name the routes accept (throws otherwise: never build a path from anything else). */
export function componentName(name: string): string {
  if (typeof name !== "string" || !COMPONENT_NAME.test(name)) throw new Error("bad component name");
  return name;
}

export function readComponentOperation(value: unknown): ComponentOperation | null {
  const o = obj(value);
  if (!o) return null;
  return {
    id: str(o.id),
    name: str(o.name),
    action: str(o.action),
    state: str(o.state),
    step: str(o.step),
    error: str(o.error),
  };
}

export function readComponentStatus(value: unknown): ComponentStatus | null {
  const c = obj(value);
  const name = str(c?.name);
  if (!c || !name) return null;
  const origin = c.origin === "signed" || c.origin === "source" ? c.origin : null;
  const versions = Array.isArray(c.versions)
    ? c.versions.flatMap((v) => {
        const o = obj(v);
        const version = str(o?.version);
        return o && version ? [{ version, pinnedBy: num(o.pinnedBy), sizeBytes: num(o.sizeBytes) }] : [];
      })
    : [];
  return {
    name,
    supported: c.supported !== false,
    state: str(c.state) ?? "missing",
    selected: str(c.selected),
    available: str(c.available),
    origin,
    versions,
    error: str(c.error),
    steps: strings(c.steps),
  };
}

/** A `GET /v2/components` reply (malformed parts dropped). */
export function readComponentsList(value: unknown): ComponentsList {
  const r = obj(value) ?? {};
  const components = Array.isArray(r.components) ? r.components.map(readComponentStatus).filter((c): c is ComponentStatus => c !== null) : [];
  const installFrom = str(r.installFrom) ?? "none";
  return { managed: r.managed === true, installFrom, components, operation: readComponentOperation(r.operation) };
}

/** The params of a `cutex/components/updated` host event (null: another event). */
export function componentEventOf(envelope: { cutex?: { method?: string; params?: unknown } } | null | undefined): ComponentEvent | null {
  if (envelope?.cutex?.method !== COMPONENTS_UPDATED_EVENT) return null;
  const p = obj(envelope.cutex.params) ?? {};
  return { name: str(p.name), reason: str(p.reason), state: str(p.state), operation: readComponentOperation(p.operation) };
}

/** The operation is still going (`state: "running"`). */
export function isOperationRunning(op: ComponentOperation | null | undefined): boolean {
  return op?.state === "running";
}

export function isComponentRefusalCode(code: string): code is ComponentRefusalCode {
  return (COMPONENT_REFUSAL_CODES as readonly string[]).includes(code);
}
