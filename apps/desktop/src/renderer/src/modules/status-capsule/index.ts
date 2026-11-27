// LEGACY(status-capsule): frozen optional surface; retain its settings, default and placements.
// Status capsule (contract 1.2, docs/desktop-modules.md §16): the floating capsule over the
// conversation, as a module the owner can turn off. Provides the "capsule" status surface, mounts
// through the `conversation.overlay` slot and owns its settings: its own page under 模块 (owner 2026-11-28),
// opened from its module row and from the capsule's ⋯ 「胶囊设置…」. Turning it off never stops the status modules (plan, jobs, …): items placed in the
// capsule show in the status row while it is off (owner 2026-11-28, lib/statusSurfaces capsuleOff);
// the saved choices stay and come back with it.
import { defineModule } from "../slots";
import { revealInCapsule } from "./capsuleState";
import { StatusCapsule } from "./StatusCapsule";
import { lazyPage } from "../../lib/lazyPage";
import { PanelTopDashed } from "lucide-react";
import { CAPSULE_SETTINGS_PAGE } from "./capsuleState";

// Loaded on first open (lib/lazyPage).
const CapsuleSettingsPage = lazyPage(() => import("./CapsuleSettings").then((m) => m.CapsuleSettingsPage));

export default defineModule({
  id: "status-capsule",
  titleKey: "status-capsule.moduleTitle",
  descriptionKey: "status-capsule.description",
  // Off for new installs (owner 2026-11-27); existing installs keep it on (modules/defaultFlips.ts).
  defaultEnabled: false,
  contributes: {
    "conversation.statusSurface": [{ id: "status-capsule.surface", surface: "capsule", intents: ["view"], reveal: revealInCapsule }],
    "conversation.overlay": [{ id: "status-capsule.overlay", order: 100, Overlay: StatusCapsule }],
    // A detail page under 模块 (no nav row; moduleSettingsRoute opens it from the module row), like NCI and the desk pet.
    "settings.page": [{ id: "status-capsule.page", page: CAPSULE_SETTINGS_PAGE, group: "app", order: 910, navParent: "modules", icon: PanelTopDashed, titleKey: "status-capsule.moduleTitle", source: "local", hintKey: "status-capsule.pageHint",
      sections: [{ anchor: "status-capsule-items", titleKey: "status-capsule.contents", keywords: ["status-capsule.itemsLabel"] }, { anchor: "status-capsule-look", titleKey: "status-capsule.look", keywords: ["status-capsule.corner", "status-capsule.edge", "status-capsule.always", "status-capsule.scale"] }],
      Page: CapsuleSettingsPage }],
  },
});
