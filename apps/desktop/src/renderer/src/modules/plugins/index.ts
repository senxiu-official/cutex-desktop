// Only this built-in adapter runs in the trusted renderer. External packages never import here.
import { defineModule } from "../slots";
import { pageTitle } from "../react";
import { PluginsPage } from "./PluginsPage";
import { pluginManager } from "./controller";
export default defineModule({
  id: "plugins",
  titleKey: "plugins.title",
  descriptionKey: "plugins.description",
  defaultEnabled: false,
  contributes: { "main.page": [{ id: "plugins.manage", Page: PluginsPage, useTitle: pageTitle("plugins.pageTitle") }] },
  activate: (context) => pluginManager.activate(context),
});
