// Only this built-in adapter runs in the trusted renderer. External packages never import here.
import { defineModule } from "../slots";
import { pageTitle } from "../react";
import { pluginManager } from "./controller";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const PluginsPage = lazyPage(() => import("./PluginsPage").then((m) => m.PluginsPage));
export default defineModule({
  id: "plugins",
  titleKey: "plugins.title",
  descriptionKey: "plugins.description",
  defaultEnabled: false,
  contributes: { "main.page": [{ id: "plugins.manage", Page: PluginsPage, useTitle: pageTitle("plugins.pageTitle") }] },
  activate: (context) => pluginManager.activate(context),
});
