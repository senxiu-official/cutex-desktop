// Optional components (components spec v2 §5; docs/desktop-modules.md §12.1): what a page whose module
// has `requires.component` shows for its target host — the page body, or a component card that says
// why the component is not usable there and what the owner can do. Pure: the store / hook gather the
// inputs (lib/componentStore.ts), components/ComponentCard.tsx draws the result.
//
// The desktop only *asks* cutex to install a component (POST /v2/components/{name}/install); it never
// downloads, starts or touches files itself.
import { COMPONENTS_FEATURE, isComponentRefusalCode, isOperationRunning, type ComponentsList, type ComponentStatus } from "../../../shared/components";
import type { HostPlatform } from "../../../shared/hosts";
import { isOwnerFeatures } from "../../../shared/users";
import type { MessageKey } from "../i18n";

/**
 * Platforms of the components the desktop knows, for hosts that cannot say (no `components`
 * capability). With the capability, cutex's own `supported` decides.
 */
export const KNOWN_COMPONENT_PLATFORMS: Readonly<Record<string, readonly HostPlatform[]>> = {
  "job-service": ["linux"],
  "claude-runtime": ["linux", "windows"],
};

/** The Claude runtime component (Claude agents need it on their host). */
export const CLAUDE_RUNTIME_COMPONENT = "claude-runtime";
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
  /** A source install: only the CLI can install it. */
  | { kind: "sourceOnly"; command: string }
  /** The running cutex release does not name this component: a backend update brings it. */
  | { kind: "notInManifest" }
  /** Not installed: the owner can ask cutex to install it. */
  | { kind: "missing"; version: string | null }
  /** cutex installs it now (progress from `cutex/components/updated`). */
  | { kind: "installing"; step: string | null }
  /** Installed but the owner must do something (log in, install a CLI…). */
  | { kind: "needsUser"; steps: string[] }
  /** A new version is selected; the service restarts when no job runs. The old one still works: banner over the body. */
  | { kind: "restartPending"; version: string | null }
  /** The last install / update failed. With `working` (a previous version stays selected) it is a banner over the body. */
  | { kind: "degraded"; error: string | null; working: boolean }
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

/** The friendly line of a refusal code (null: unknown code, show cutex's message). */
export function refusalKey(code: string): MessageKey | null {
  return isComponentRefusalCode(code) ? (`modules.component.refusal.${code}` as MessageKey) : null;
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
  if (component.state === "needsUser") return { kind: "needsUser", steps: component.steps };
  if (component.state === "restartPending") return { kind: "restartPending", version: component.selected };
  if (!list.managed || list.installFrom === "none") return { kind: "unmanaged" };
  if (list.installFrom === "source-only") return { kind: "sourceOnly", command: sourceInstallCommand(name) };
  if (input.pending) return { kind: "installing", step: null };
  if (component.state === "degraded") return { kind: "degraded", error: component.error, working: component.selected !== null };
  if (component.state === "notInManifest") return { kind: "notInManifest" };
  if (component.state === "missing") return { kind: "missing", version: component.available };
  return { kind: "unknown", state: component.state };
}

/** Card text of the components the desktop knows (i18n keyed by component name); others: the generic text. */
const COMPONENT_TEXT: Readonly<Record<string, { name: MessageKey; what: MessageKey }>> = {
  "job-service": { name: "modules.component.job-service.name", what: "modules.component.job-service.what" },
  "claude-runtime": { name: "modules.component.claude-runtime.name", what: "modules.component.claude-runtime.what" },
};

/** The display name and the one-line "what is it" of a component (unknown names: the name itself + a generic line). */
export function componentText(name: string, t: (key: MessageKey, vars?: Record<string, string | number>) => string): { title: string; what: string } {
  const known = Object.hasOwn(COMPONENT_TEXT, name) ? COMPONENT_TEXT[name] : undefined;
  const title = known ? t(known.name) : name;
  return { title, what: known ? t(known.what) : t("modules.component.generic.what", { component: name }) };
}
