// Status capsule (contract 1.2, docs/desktop-modules.md §16): the floating capsule over the
// conversation, as a module the owner can turn off. Provides the "capsule" status surface, mounts
// through the `conversation.overlay` slot and owns its geometry settings (a section on the shell's
// 状态显示 page). Turning it off never stops the status modules (plan, jobs, …): items placed only
// in the capsule just have no resident place until it is back; the saved choices stay.
import { defineModule } from "../slots";
import { revealInCapsule } from "./capsuleState";
import { CapsuleSettingsSection } from "./CapsuleSettings";
import { StatusCapsule } from "./StatusCapsule";

export default defineModule({
  id: "status-capsule",
  titleKey: "status-capsule.moduleTitle",
  descriptionKey: "status-capsule.description",
  defaultEnabled: true,
  contributes: {
    "conversation.statusSurface": [{ id: "status-capsule.surface", surface: "capsule", intents: ["view"], reveal: revealInCapsule }],
    "conversation.overlay": [{ id: "status-capsule.overlay", order: 100, Overlay: StatusCapsule }],
    "settings.section": [{ id: "status-capsule.settings", page: "status", titleKey: "status-capsule.section", keywords: ["status-capsule.corner", "status-capsule.edge", "status-capsule.always", "status-capsule.scale"], Section: CapsuleSettingsSection }],
  },
});
