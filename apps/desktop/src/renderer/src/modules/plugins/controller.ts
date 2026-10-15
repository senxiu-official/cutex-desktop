import { Puzzle } from "lucide-react";
import { bridge } from "../../bridge";
import { appModules } from "../app";
import { PluginManager } from "./manager";
import { pluginDefinition } from "./definition";

export const pluginManager = new PluginManager({
  catalog: () => bridge.plugins?.list() ?? Promise.resolve({ plugins: [], errors: [] }),
  host: appModules,
  definition: pluginDefinition,
  contributeManagement(context) {
    context.contribute("nav.primary", { id: "plugins.manage", order: 1000, area: "footer", titleKey: "plugins.title", icon: Puzzle, target: { page: "plugins.manage" } });
  },
});
