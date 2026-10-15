import { createElement } from "react";
import { Puzzle } from "lucide-react";
import type { AppModule } from "../slots";
import { externalItemId, externalModuleId } from "./manager";
import { PluginFrame } from "./PluginFrame";
import type { PluginRuntime } from "./runtime";

/** Manifest declarations only: no import(), eval(), renderer scripts or plugin callbacks in the parent. */
export function pluginDefinition(runtime: PluginRuntime): AppModule {
  const { manifest, permissions } = runtime.plugin;
  const pages = manifest.contributes["main.page"];
  const canView = permissions.includes("views");
  return {
    id: externalModuleId(manifest.id),
    titleKey: "plugins.externalTitle",
    displayName: manifest.name,
    descriptionKey: "plugins.externalDescription",
    required: false,
    defaultEnabled: true,
    requires: {
      // A plugin frame's host lifetime is one host: the focus (multi-host RFC §9.1 ★).
      focusHost: true,
      modules: ["plugins", ...manifest.dependencies.map(externalModuleId)],
      capabilities: manifest.requires.cutexCapabilities,
      ...(manifest.requires.hosts === "local" ? { hostKinds: ["local"] } : {}),
    },
    contributes: {
      "main.page": canView ? pages.map((page) => ({ id: externalItemId(page.id), order: page.order, Page: () => createElement(PluginFrame, { runtime }), useTitle: () => [{ text: page.title }] })) : [],
      "nav.primary": canView && permissions.includes("entries") ? manifest.contributes["nav.primary"].map((entry) => ({
        id: externalItemId(entry.id), order: entry.order, area: entry.area,
        icon: Puzzle, titleKey: "plugins.openPlugin", title: entry.title,
        target: { page: externalItemId(entry.page) }, unavailable: "hide",
      })) : [],
    },
    activate: (context) => runtime.activate(context),
  };
}
