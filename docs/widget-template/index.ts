// Template (docs/widget-authoring-guide.md §2 Step 3): copy to modules/<id>/index.ts, rename, then add the module to
// modules/registry.ts. Sizes are grid steps (8 px): [36, 18] = 288 × 144 px.
import { Sparkles } from "lucide-react";
import { defineModule } from "../slots";
import { MyWidget } from "./Widget";

export const MY_WIDGET = "my-widget.widget";

export default defineModule({
  id: "my-widget",
  titleKey: "my-widget.title",
  descriptionKey: "my-widget.description",
  contributes: {
    "desktop.widget": [
      {
        id: MY_WIDGET,
        titleKey: "my-widget.widget",
        descriptionKey: "my-widget.widgetHint",
        icon: Sparkles,
        // Units (contract 1.24: 40 px, 16 px apart); the step sizes are for 1.22 desktops.
        size: { min: [24, 10], max: [60, 40], default: [36, 18], units: { min: [4, 2], max: [10, 8], default: [6, 4] } },
        // card = the shell draws the glass card (use px-3.5 py-3, home-sub). bare = text on the wallpaper: put `home-clock`
        // on your root, no background, opacity for secondary text (guide rule 5).
        shape: "card",
        multiple: false,
        // defaultPlace: { area: "side", order: 30 },   // only if the owner wants it on every new desktop
        // refresh: "minute",                           // only if it shows the time (then read `now`)
        // The shell draws the form from this list (编辑主页 → the widget's 设置…). Field types: text, number, toggle,
        // select, timezone, list (widgetTypes.ts WidgetSettingField). A stored value that fails its field (wrong
        // type, out of range, not an option) is dropped and the default is used instead.
        settings: [
          { key: "label", type: "text", labelKey: "my-widget.label", maxLength: 40 },
          { key: "rows", type: "number", labelKey: "my-widget.rows", min: 1, max: 10, step: 1 },
          {
            key: "order",
            type: "select",
            labelKey: "my-widget.order",
            options: [
              { value: "newest", labelKey: "my-widget.orderNewest" },
              { value: "name", labelKey: "my-widget.orderName" },
            ],
          },
          { key: "compact", type: "toggle", labelKey: "my-widget.compact" },
        ],
        // Defaults need not name every field: a field with no default and nothing stored is simply absent from
        // `settings`, so the component must cope (`typeof settings.rows === "number" ? … : 5`). Giving every field a
        // default is still the clearest. A default that depends on the language: `defaults: (locale) => ({ … })`.
        defaults: { label: "", rows: 5, order: "newest", compact: false },
        Widget: MyWidget,
      },
    ],
  },
});
