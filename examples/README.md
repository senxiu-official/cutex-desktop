# Examples

Desktop modules start from the template: `node packages/module-api/bin/cutex-module.mjs new my-thing`, then follow
[docs/module-authoring.md](../docs/module-authoring.md). The template is a working module (a tray button and a page).

The opaque frame plugins these folders used to hold are retired as a product feature (docs/desktop-modules.md §10).
Their sandbox package, `packages/plugin-sandbox`, stays in the repository, frozen; the app does not import it.
