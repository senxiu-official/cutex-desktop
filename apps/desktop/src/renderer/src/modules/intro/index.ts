// 开场 (timeline.intro, docs/desktop-modules.md §19.3): the session's opening above its first turn —
// the profile's portrait and greeting, like a game character's entrance. Custom portrait / greeting
// are device-local per profile (lib/introAppearance, edited in 设置 → Profile → 外观); without them
// the provider's launcher artwork (lib/launchArt) and greeting pool (lib/providerGreetings) show,
// and with neither portrait there is just the greeting — never an empty frame.
import { createElement } from "react";
import { defineModule, type TimelineIntroProps } from "../slots";
import { Opening } from "./Opening";

/** The `intro.opening` render factory. Lives here (not in Opening.tsx) so the component file only
 *  exports components — the Fast Refresh rule; this file stays JSX-free via createElement. */
function openingRender(props: TimelineIntroProps) {
  return createElement(Opening, props);
}

export default defineModule({
  id: "intro",
  titleKey: "intro.moduleTitle",
  descriptionKey: "intro.moduleDescription",
  contributes: {
    "timeline.intro": [
      {
        id: "intro.opening",
        order: 100,
        render: openingRender,
      },
    ],
  },
});
