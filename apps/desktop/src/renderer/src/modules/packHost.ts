// The host object signed module packs read shared code from (docs/desktop-modules.md §23.6): the app's
// own React / zustand instances and the app files a pack may use, as namespace objects keyed by the
// specifier the pack builder records (`@cutex-desktop/app/<path under src/renderer/src>`). A pack never
// brings its own React; its build turns these imports into reads from this table.
//
// Listing a file here makes it part of what packs can import. Adding one is safe; renaming or removing
// one (or an export a pack uses) is caught per pack by its host import list (checkHostImports) and the
// pack falls back to the bundled copy. Never list dev/, registry.ts or another module's directory.
import { MODULE_API_VERSION, MODULE_PACK_HOST_GLOBAL, type ModulePackHost } from "@cutex-desktop/plugin-sdk";
import * as react from "react";
import * as reactJsxRuntime from "react/jsx-runtime";
import * as reactDom from "react-dom";
import * as zustand from "zustand";
import * as appBridge from "../bridge";
import * as appI18n from "../i18n";
import * as appStore from "../store";
import * as appModulesReact from "./react";
import * as appModulesSlots from "./slots";
import * as libContextMenu from "../lib/contextMenu";
import * as libHostGatingView from "../lib/hostGatingView";
import * as libHostPick from "../lib/hostPick";
import * as libSideServices from "../lib/sideServices";
import * as libStatus from "../lib/status";
import * as libTargetHost from "../lib/targetHost";
import * as libUseHostScope from "../lib/useHostScope";
import * as componentsHostPicker from "../components/HostPicker";
import * as componentsPage from "../components/Page";
import * as componentsServiceLogs from "../components/ServiceLogs";
import * as componentsSettingsForm from "../components/settings/Form";
import * as componentsStatusIcon from "../components/StatusIcon";

type Namespace = Readonly<Record<string, unknown>>;

export const PACK_HOST_MODULES: Readonly<Record<string, Namespace>> = Object.freeze({
  react,
  "react/jsx-runtime": reactJsxRuntime,
  "react-dom": reactDom,
  zustand,
  "@cutex-desktop/app/bridge": appBridge,
  "@cutex-desktop/app/i18n": appI18n,
  "@cutex-desktop/app/store": appStore,
  "@cutex-desktop/app/modules/react": appModulesReact,
  "@cutex-desktop/app/modules/slots": appModulesSlots,
  "@cutex-desktop/app/lib/contextMenu": libContextMenu,
  "@cutex-desktop/app/lib/hostGatingView": libHostGatingView,
  "@cutex-desktop/app/lib/hostPick": libHostPick,
  "@cutex-desktop/app/lib/sideServices": libSideServices,
  "@cutex-desktop/app/lib/status": libStatus,
  "@cutex-desktop/app/lib/targetHost": libTargetHost,
  "@cutex-desktop/app/lib/useHostScope": libUseHostScope,
  "@cutex-desktop/app/components/HostPicker": componentsHostPicker,
  "@cutex-desktop/app/components/Page": componentsPage,
  "@cutex-desktop/app/components/ServiceLogs": componentsServiceLogs,
  "@cutex-desktop/app/components/settings/Form": componentsSettingsForm,
  "@cutex-desktop/app/components/StatusIcon": componentsStatusIcon,
}) as Readonly<Record<string, Namespace>>;

/** What of a pack's host import list this app lacks (`spec` or `spec#name`); empty = it can load. */
export function checkHostImports(imports: Readonly<Record<string, readonly string[]>>, table: Readonly<Record<string, Namespace>> = PACK_HOST_MODULES): string[] {
  const missing: string[] = [];
  for (const [spec, names] of Object.entries(imports)) {
    const ns = Object.prototype.hasOwnProperty.call(table, spec) ? table[spec] : undefined;
    if (!ns) {
      missing.push(spec);
      continue;
    }
    for (const name of names) if (name !== "*" && !(name in ns)) missing.push(`${spec}#${name}`);
  }
  return missing;
}

/** Installs the host object once (globalThis.__CUTEX_MODULE_HOST__); returns it. */
export function installPackHost(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): ModulePackHost {
  const existing = target[MODULE_PACK_HOST_GLOBAL] as ModulePackHost | undefined;
  if (existing) return existing;
  const host: ModulePackHost = Object.freeze({
    apiVersion: MODULE_API_VERSION,
    get(specifier: string): Namespace {
      const ns = Object.prototype.hasOwnProperty.call(PACK_HOST_MODULES, specifier) ? PACK_HOST_MODULES[specifier] : undefined;
      if (!ns) throw new Error(`module pack host: ${specifier} is not provided by this app`);
      return ns;
    },
  });
  Object.defineProperty(target, MODULE_PACK_HOST_GLOBAL, { value: host, writable: false, configurable: false, enumerable: false });
  return host;
}
