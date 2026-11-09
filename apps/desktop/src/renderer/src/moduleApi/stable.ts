// The app's side of `@cutex-desktop/module-api` (docs/desktop-modules.md §30): what a module's reads from that entry get.
// The public types are the package's own; the casts here are checked by ./compat.ts.
import { useSyncExternalStore } from "react";
import type { Json, Jsonable, MessageKey, ModuleDefinition, ModuleId, ModuleServices, PageCrumb } from "@cutex-desktop/module-api";
import { MODULE_API_VERSION as APP_MODULE_API_VERSION } from "@cutex-desktop/plugin-sdk";
import { useI18n as useAppI18n, type MessageKey as AppMessageKey } from "../i18n";
import { canTargetHost } from "../lib/hostPick";
import { useHostScope } from "../lib/useHostScope";
import { services as appServices } from "../modules/app";
import { pageTitle as appPageTitle, useModulePref as appUseModulePref } from "../modules/react";

export const MODULE_API_VERSION: string = APP_MODULE_API_VERSION;

export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}

// Only the public services, read when used: this file loads with the module host, before the app's services are needed.
export const services: ModuleServices = {
  get ui() {
    return appServices.ui as unknown as ModuleServices["ui"];
  },
  get panes() {
    return appServices.panes;
  },
  get agents() {
    return appServices.agents;
  },
  get activity() {
    return appServices.activity;
  },
};

export function useI18n(): { locale: string; t(key: MessageKey, vars?: Record<string, string | number>): string } {
  const { locale, t } = useAppI18n();
  return { locale, t: t as (key: MessageKey, vars?: Record<string, string | number>) => string };
}

export function useModulePref<T>(moduleId: ModuleId, key: string, fallback: T & Jsonable<T>): [T, (value: (T & Jsonable<T>) | ((previous: T) => T & Jsonable<T>)) => void] {
  return appUseModulePref(moduleId, key, fallback as Json) as unknown as [T, (value: (T & Jsonable<T>) | ((previous: T) => T & Jsonable<T>)) => void];
}

export function pageTitle(key: MessageKey): () => readonly PageCrumb[] {
  return appPageTitle(key as AppMessageKey);
}

export function useAgents() {
  return useSyncExternalStore(appServices.agents.subscribe, appServices.agents.list);
}

export function useHosts(): readonly { id: string; label: string; online: boolean; focus: boolean }[] {
  const scope = useHostScope();
  return scope.hosts.map((h) => ({ id: h.id, label: h.label, online: canTargetHost(h), focus: h.id === scope.focus }));
}
