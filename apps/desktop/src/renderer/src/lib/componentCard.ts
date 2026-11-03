// Optional components (components spec v2 §5; docs/desktop-modules.md §12.1): what a page whose module
// has `requires.component` shows for its target host — the page body, or a component card that says
// why the component is not usable there and what the owner can do. Pure: the store / hook gather the
// inputs (lib/componentStore.ts), components/ComponentCard.tsx draws the result.
//
// The desktop only *asks* cutex to install a component (POST /v2/components/{name}/install); it never
// downloads, starts or touches files itself.
import { COMPONENT_INDEX_FEATURE, COMPONENTS_FEATURE, DESKTOP_REFUSAL_CODES, EXTERNAL_RUNTIME_ROOT_FEATURE, externalReadiness, isComponentRefusalCode, isOperationRunning, type ComponentExternal, type ComponentsList, type ComponentStatus } from "../../../shared/components";
import type { HostPlatform } from "../../../shared/hosts";
import { isOwnerFeatures } from "../../../shared/users";
import { componentIndexView } from "./componentExternal";
import type { MessageKey } from "../i18n";

/**
 * Platforms of the components the desktop knows, for hosts that cannot say (no `components`
 * capability). With the capability, cutex's own `supported` decides.
 */
export const KNOWN_COMPONENT_PLATFORMS: Readonly<Record<string, readonly HostPlatform[]>> = {
  "job-service": ["linux"],
  "claude-runtime": ["linux", "windows"],
  "dsh-runtime": ["linux", "windows"],
  "kimi-runtime": ["linux", "windows"],
};

/** The Claude runtime component (Claude agents need it on their host). */
export const CLAUDE_RUNTIME_COMPONENT = "claude-runtime";
export const DSH_RUNTIME_COMPONENT = "dsh-runtime";
/** The Kimi Code runtime component (r266, docs/design/049). */
export const KIMI_RUNTIME_COMPONENT = "kimi-runtime";
/** The Job Service component (modules/jobs). */
export const JOB_SERVICE_COMPONENT = "job-service";

/** `cutex component install <name> --from-source <dir>`: the only way in on a source install (CLI only). */
export function sourceInstallCommand(name: string): string {
  return `cutex component install ${name} --from-source <dir>`;
}

/** Where the "set up by hand" guide of a component lives (its public README in the cutex repo). */
export function componentGuideUrl(name: string): string {
  return `https://github.com/senxiu-official/cutex/blob/release/components/${encodeURIComponent(name)}/README.md`;
}

export type ComponentCardState =
  /** Render the page body: ready / external, or the host is not connected (the page shows that). */
  | { kind: "body" }
  /** Capabilities or the first `GET /v2/components` not loaded yet: render nothing. */
  | { kind: "waiting" }
  /** The connection is not the host owner's: components are the owner's. */
  | { kind: "askOwner" }
  /** The component does not ship for this host's platform. */
  | { kind: "unsupportedPlatform"; platform: HostPlatform | null }
  /** The host's cutex predates components (or does not know this one): update cutex. `bypass`: the page may still be opened (older hosts set the service up by hand). */
  | { kind: "updateCutex"; bypass: boolean }
  /** A daemon set up by hand (no managed install): set the component up by hand too. */
  | { kind: "unmanaged" }
  /**
   * No legacy release-manifest install (`installFrom: "source-only"`): an empty install is refused (409). r270: a kit base is
   * still managed, so `version` — the verified index offer — is installed explicitly (`{version}`); the CLI from-source
   * command stays as the other way. null: no verified offer, the CLI only.
   */
  | { kind: "sourceOnly"; command: string; version: string | null }
  /** The running cutex release does not name this component: a backend update brings it. */
  | { kind: "notInManifest" }
  /** Not installed: the owner can ask cutex to install it. */
  | { kind: "missing"; version: string | null }
  /** cutex installs it now (progress from `cutex/components/updated`). */
  | { kind: "installing"; step: string | null }
  /**
   * Installed but the owner must do something (log in, install a CLI…). `external` (r269, hosts with
   * EXTERNAL_RUNTIME_ROOT_FEATURE only): the failed checks of an adapter whose upstream CLI the owner installs.
   */
  | { kind: "needsUser"; steps: string[]; external?: ComponentExternal }
  /** A new version is selected; the service restarts when no job runs. The old one still works: banner over the body. */
  | { kind: "restartPending"; version: string | null }
  /**
   * The last install / update failed. With `working` (a previous version stays selected) it is a banner over the body.
   * `retryVersion` (source-only hosts): retry installs that explicit version; null: no retry (an empty install is refused).
   */
  | { kind: "degraded"; error: string | null; working: boolean; retryVersion?: string | null }
  /** `GET /v2/components` failed (nothing read yet). */
  | { kind: "readError"; error: string }
  /** A state this desktop does not know (newer cutex). */
  | { kind: "unknown"; state: string };

export interface ComponentCardInput {
  /** Component name (`requires.component`). */
  name: string;
  /** The host has a live connection. */
  connected: boolean;
  featuresKnown: boolean;
  features: ReadonlySet<string>;
  platform: HostPlatform | null;
  /** The page module's own `requires.capabilities` (an older host that has them may bypass "update cutex"). */
  moduleCapabilities: readonly string[];
  /** undefined: not read yet; null: the host has no components route. */
  list: ComponentsList | null | undefined;
  listError: string | null;
  /** This desktop asked for an install / remove of `name` that has not shown up in the list yet. */
  pending: boolean;
  /**
   * Set up by hand on an unmanaged (hand-deployed) host although cutex lists it as missing (claude-runtime:
   * `GET /v2/runtimes` names a selected Claude runtime). cutex before the components fix reported those as
   * missing, which blocked creating Claude agents.
   */
  handConfigured?: boolean;
}

/**
 * Starting / creating something that needs the component cannot work in this state (the new-agent
 * flow refuses a Claude agent then). Viewing never blocks. Unknown answers (old cutex, read error, a
 * non-owner connection, a state this desktop does not know) do not block: cutex refuses itself.
 */
export function componentBlocks(state: ComponentCardState): boolean {
  switch (state.kind) {
    case "missing":
    case "installing":
    case "needsUser":
    case "unmanaged":
    case "sourceOnly":
    case "notInManifest":
    case "unsupportedPlatform":
      return true;
    case "degraded":
      return !state.working;
    default:
      return false;
  }
}

/**
 * The component can be used now: ready / external, a selected version still running (restartPending,
 * degraded update), or a host that cannot say (no `components`: an older cutex, set up by hand).
 * False while the list is unread, so nothing calls a missing service.
 */
export function componentUsable(features: ReadonlySet<string>, list: ComponentsList | null | undefined, name: string): boolean {
  if (!features.has(COMPONENTS_FEATURE) || list === null) return true;
  const c = list?.components.find((x) => x.name === name);
  if (!c) return list !== undefined; // a cutex without this component's handler: as before components
  if (c.state === "ready" || c.state === "external" || c.state === "restartPending") return true;
  return c.state === "degraded" && c.selected !== null;
}

/** The friendly line of a refusal code (null: unknown code, show cutex's message). r270: also the desktop's own (component_source_only). */
export function refusalKey(code: string): MessageKey | null {
  return isComponentRefusalCode(code) || (DESKTOP_REFUSAL_CODES as readonly string[]).includes(code) ? (`modules.component.refusal.${code}` as MessageKey) : null;
}

/** Cards that leave the page body below them (the component still works). */
export function isBanner(state: ComponentCardState): boolean {
  return state.kind === "restartPending" || (state.kind === "degraded" && state.working);
}

function unsupportedHere(name: string, platform: HostPlatform | null): boolean {
  const known = KNOWN_COMPONENT_PLATFORMS[name];
  return !!known && platform !== null && !known.includes(platform);
}

function running(list: ComponentsList, component: ComponentStatus): string | null | false {
  const op = list.operation;
  if (op && op.name === component.name && isOperationRunning(op)) return op.step;
  return component.state === "installing" ? null : false;
}

/**
 * The version a source-only host can still install explicitly: the verified, compatible, non-withdrawn index recommendation
 * (what `component_source_only` would suggest). null without the index gate or such an offer: never a guessed version.
 */
export function sourceOnlyVersion(features: ReadonlySet<string>, component: ComponentStatus): string | null {
  if (!features.has(COMPONENT_INDEX_FEATURE)) return null;
  const offer = componentIndexView(component)?.offer;
  return offer?.kind === "adapterUpdate" ? offer.version : null;
}

export function componentCardState(input: ComponentCardInput): ComponentCardState {
  const { name, features, platform } = input;
  if (!input.connected) return { kind: "body" };
  if (!input.featuresKnown) return { kind: "waiting" };
  if (!isOwnerFeatures(features)) return { kind: "askOwner" };
  if (!features.has(COMPONENTS_FEATURE)) {
    if (unsupportedHere(name, platform)) return { kind: "unsupportedPlatform", platform };
    return { kind: "updateCutex", bypass: input.moduleCapabilities.every((c) => features.has(c)) };
  }
  const { list } = input;
  if (list === undefined) return input.listError ? { kind: "readError", error: input.listError } : { kind: "waiting" };
  if (list === null) return { kind: "updateCutex", bypass: input.moduleCapabilities.every((c) => features.has(c)) };
  const component = list.components.find((c) => c.name === name);
  // A cutex with components that has no handler for this one: a newer cutex brings it.
  if (!component) return { kind: "updateCutex", bypass: false };
  if (!component.supported) return { kind: "unsupportedPlatform", platform };
  if (component.state === "ready" || component.state === "external") return { kind: "body" };
  const step = running(list, component);
  if (step !== false) return { kind: "installing", step };
  if (component.state === "needsUser") {
    // Failed checks, or never checked (`checkedAt: null` is unverified even without issues): the guide with 重新检测.
    const external = features.has(EXTERNAL_RUNTIME_ROOT_FEATURE) && component.external && externalReadiness(component.external) !== "ready" ? component.external : undefined;
    return external ? { kind: "needsUser", steps: component.steps, external } : { kind: "needsUser", steps: component.steps };
  }
  if (component.state === "restartPending") return { kind: "restartPending", version: component.selected };
  if (!list.managed || list.installFrom === "none") return input.handConfigured ? { kind: "body" } : { kind: "unmanaged" };
  if (input.pending) return { kind: "installing", step: null };
  if (list.installFrom === "source-only") {
    // r270: source-only only says there is no legacy manifest install; the verified index offer is still installable explicitly.
    const version = sourceOnlyVersion(features, component);
    if (component.state === "degraded" && component.selected !== null) return { kind: "degraded", error: component.error, working: true, retryVersion: version };
    return { kind: "sourceOnly", command: sourceInstallCommand(name), version };
  }
  if (component.state === "degraded") return { kind: "degraded", error: component.error, working: component.selected !== null };
  if (component.state === "notInManifest") return { kind: "notInManifest" };
  if (component.state === "missing") return { kind: "missing", version: component.available };
  return { kind: "unknown", state: component.state };
}

/** Card text of the components the desktop knows (i18n keyed by component name); others: the generic text. */
const COMPONENT_TEXT: Readonly<Record<string, { name: MessageKey; what: MessageKey }>> = {
  "job-service": { name: "modules.component.job-service.name", what: "modules.component.job-service.what" },
  "dsh-runtime": { name: "modules.component.dsh-runtime.name", what: "modules.component.dsh-runtime.what" },
  "kimi-runtime": { name: "modules.component.kimi-runtime.name", what: "modules.component.kimi-runtime.what" },
  "claude-runtime": { name: "modules.component.claude-runtime.name", what: "modules.component.claude-runtime.what" },
};

/** The display name and the one-line "what is it" of a component (unknown names: the name itself + a generic line). */
export function componentText(name: string, t: (key: MessageKey, vars?: Record<string, string | number>) => string): { title: string; what: string } {
  const known = Object.hasOwn(COMPONENT_TEXT, name) ? COMPONENT_TEXT[name] : undefined;
  const title = known ? t(known.name) : name;
  return { title, what: known ? t(known.what) : t("modules.component.generic.what", { component: name }) };
}
