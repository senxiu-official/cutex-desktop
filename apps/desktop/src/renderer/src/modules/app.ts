import { createModuleServiceScope } from "@cutex-desktop/plugin-host";
// The app's module host instance, bound to the store: the active host (id, kind) and its
// capabilities drive gating (docs/desktop-modules.md §4). main.tsx starts it with the registry, so
// shell code reaches modules only through slots (react.ts) and never imports registry.ts.
import { translate, type MessageKey } from "../i18n";
import { activeHost } from "../lib/hosts";
import { scopeHosts, type HostView } from "../../../shared/hosts";
import { apiFor } from "../bridge";
import { closePeek } from "../lib/peekStore";
import { checkRefContributions, parseRef } from "../lib/refs";
import { refsHere, refsOpen, timelineFocusTurn } from "../lib/refServices";
import { closeSideInstances, sideList, sideOpenHeld, sideReleaseHold, sideReveal } from "../lib/sideServices";
import { panesOpen, sideOpenAlias } from "../lib/paneServices";
import { checkStatusContributions } from "../lib/statusSurfaces";
import { useApp } from "../store";
import { pinFlippedDefaults } from "./defaultFlips";
import { createModuleHost } from "./host";
import { SLOT_SPECS, type AppModule, type AppModuleHost, type ModuleServices, type SlotMap } from "./slots";
import type { HostInput, HostsInput, KeyValueStorage } from "./types";

const storage: KeyValueStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage unavailable: the change lasts for this session only
    }
  },
};

/**
 * The services handed to modules (ctx.services). Shell and shared components that are not module
 * code navigate through the same object (services.ui.openPage, services.side.open), never through
 * store actions. The side part lives in lib/sideServices.ts, timeline / refs in lib/refServices.ts
 * (called lazily: those files reach back here for the module host).
 */
export const services: ModuleServices = {
  daemonFor: (hostId) => apiFor(hostId),
  ui: {
    notice: (text, tone) => useApp.getState().notify(text, tone),
    openSettings: (page, focus) => useApp.getState().openSettings(page, focus),
    openPage: (page, params) => useApp.getState().openPage(page, params),
    closePage: () => useApp.getState().closePage(),
    customize: (region) => useApp.getState().openCustomize(region),
  },
  // v1.17 (§24.5): any pane kind; services.side.open stays as its alias for tool kinds.
  panes: {
    open: (kind, params, opts) => panesOpen(kind, params, opts),
  },
  side: {
    open: (kind, params, opts) => sideOpenAlias(kind, params, opts),
    reveal: (target) => sideReveal(target),
    close: (instanceId) => void closeSideInstances([instanceId]),
    closePeek: () => closePeek(),
    list: (kind) => sideList(kind),
    openHeld: (kind, params, opts) => sideOpenHeld(kind, params, opts),
    releaseHold: (hold, opts) => sideReleaseHold(hold, opts),
  },
  timeline: {
    focusTurn: (hostId, sessionId, turnId, opts) => timelineFocusTurn(hostId, sessionId, turnId, opts),
  },
  refs: {
    open: (ref, opts) => refsOpen(ref, opts),
    here: () => refsHere(),
    parse: (raw) => parseRef(raw),
  },
};

type HostSource = Pick<ReturnType<typeof useApp.getState>, "hosts" | "features" | "featuresKnown">;

/** Modules see two kinds: a DEV ONLY dev-direct host (main/devHosts.ts) is a remote host to them. */
const moduleKind = (kind: HostView["kind"]): "local" | "ssh" => (kind === "local" ? "local" : "ssh");

/** The gating input from the store; before the host list loads, assume local. */
export function hostInput(s: HostSource): HostInput {
  const host = activeHost(s.hosts);
  return { id: s.hosts?.active ?? "local", kind: moduleKind(host?.kind ?? "local"), features: s.featuresKnown ? s.features : null };
}

/** v1.5: the focus host plus every other connected host (store byHost) and the scope. */
export function hostsInput(s: HostSource & Pick<ReturnType<typeof useApp.getState>, "byHost">): HostsInput {
  const focus = hostInput(s);
  const others = Object.entries(s.byHost ?? {}).map(([id, slice]) => ({ id, kind: moduleKind(s.hosts?.hosts.find((h) => h.id === id)?.kind ?? "ssh"), features: slice.featuresKnown ? slice.features : null }));
  const scope = s.hosts ? scopeHosts(s.hosts) : [];
  return { focus, others, scope: scope.includes(focus.id) ? scope : [focus.id, ...scope] };
}

let instance: AppModuleHost | null = null;

export function startAppModules(modules: readonly AppModule[]): AppModuleHost {
  if (instance) return instance;
  // Modules whose default flipped to on stay off on installs that already saved module choices.
  pinFlippedDefaults(storage);
  const host = createModuleHost<SlotMap, ModuleServices, MessageKey>({
    modules,
    slots: SLOT_SPECS,
    host: hostInput(useApp.getState()),
    hosts: hostsInput(useApp.getState()),
    storage,
    services: () => services,
    scopedServices: scope => {
      const guard = createModuleServiceScope(scope);
      return {
        daemonFor: guard.read(services.daemonFor),
        ui: {
          notice: guard.write(services.ui.notice),
          openSettings: guard.write(services.ui.openSettings),
          openPage: guard.write(services.ui.openPage),
          closePage: guard.write(services.ui.closePage),
          customize: guard.write(services.ui.customize),
        },
        // Calls after the module stopped are refused (read: throws AbortError; write: no-op).
        panes: { open: guard.read(services.panes.open) },
        side: {
          open: guard.read(services.side.open),
          reveal: guard.read(services.side.reveal),
          close: guard.write(services.side.close),
          closePeek: guard.write(services.side.closePeek),
          list: guard.read(services.side.list),
          openHeld: guard.read(services.side.openHeld),
          // v1.10: only drops a pre-hold the module itself took (and its card), so it works after the module stopped too.
          releaseHold: services.side.releaseHold,
        },
        timeline: { focusTurn: guard.request(services.timeline.focusTurn) },
        refs: { open: guard.request(services.refs.open), here: guard.read(services.refs.here), parse: services.refs.parse },
      };
    },
    t: translate,
    validate: (candidates, existing) => new Map([...checkStatusContributions(candidates, existing), ...checkRefContributions(candidates, existing)]),
  });
  const unsubscribe = useApp.subscribe((s, prev) => {
    if (s.hosts !== prev.hosts || s.features !== prev.features || s.featuresKnown !== prev.featuresKnown || s.byHost !== prev.byHost) void host.setHosts(hostsInput(s));
  });
  const dispose = host.dispose.bind(host);
  host.dispose = () => {
    unsubscribe();
    if (instance === host) instance = null;
    return dispose();
  };
  instance = host;
  return host;
}

export function appModules(): AppModuleHost {
  if (!instance) throw new Error("module host not started (main.tsx startAppModules)");
  return instance;
}
