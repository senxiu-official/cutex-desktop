// 桌宠 (docs/desktop-modules.md §29, README.md here): a little character whose hands move when the owner sends a message
// or an agent runs a command or a tool, and which counts them. A signed pack only (pack.json `packOnly`): not in
// registry.ts, default off. Its window is the app's narrow service (main/deskPet.ts): this module holds the rhythm, the
// counters, the strings and the settings; main only decides about the window. Local decoration: no daemon state.
import { PawPrint } from "lucide-react";
import { defineModule } from "../slots";
import { activateDeskPet } from "./controller";
import { AllPets } from "./AllPets";
import { DeskPetPage } from "./DeskPetPage";
import { identityRows } from "./identityRows";
import { DeskPetTrayButton } from "./TrayButton";

export default defineModule({
  id: "desk-pet",
  titleKey: "desk-pet.title",
  descriptionKey: "desk-pet.description",
  defaultEnabled: false,
  contributes: {
    "settings.page": [{ id: "desk-pet.page", page: "desk-pet", group: "app", order: 900, icon: PawPrint, titleKey: "desk-pet.nav", source: "local", hintKey: "desk-pet.pageHint", Page: DeskPetPage, subPages: { all: { titleKey: "desk-pet.allPets", hintKey: "desk-pet.allPetsHint", Page: AllPets } } }],
    "tray.entry": [{ id: "desk-pet.tray", order: 100, Button: DeskPetTrayButton }],
    "identity.menu": [{ id: "desk-pet.identity", order: 100, entries: identityRows }],
  },
  activate: activateDeskPet,
});
