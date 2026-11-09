// The identity menu's 桌宠 ›: reachable whatever state the pet is in.
import { Check, PawPrint } from "lucide-react";
import { DESK_PET_TRANSLUCENT, type DeskPetSettings } from "../../../../shared/deskPet";
import { translate } from "../../i18n";
import type { MenuEntry } from "../../lib/contextMenu";
import { currentView, openPetSettings, petBridge } from "./controller";

export function identityRows(): MenuEntry[] {
  const view = currentView();
  if (!view) return [];
  const set = (patch: Partial<DeskPetSettings>) => void petBridge()?.set(patch);
  const toggle = (key: "clickThrough" | "onlyInFront" | "showCount", label: string): MenuEntry => ({
    label,
    icon: view.settings[key] ? <Check size={13} /> : null,
    onSelect: () => set({ [key]: !view.settings[key] }),
  });
  return [
    {
      label: translate("desk-pet.nav"),
      icon: <PawPrint size={14} />,
      submenu: [
        { label: translate(view.settings.hidden ? "desk-pet.show" : "desk-pet.hide"), onSelect: () => set({ hidden: !view.settings.hidden }) },
        toggle("clickThrough", translate("desk-pet.clickThrough")),
        { label: translate("desk-pet.translucent"), icon: view.settings.opacity < 1 ? <Check size={13} /> : null, onSelect: () => set({ opacity: view.settings.opacity < 1 ? 1 : DESK_PET_TRANSLUCENT }) },
        toggle("onlyInFront", translate("desk-pet.onlyInFront")),
        "separator",
        { label: translate("desk-pet.openSettings"), onSelect: openPetSettings },
      ],
      onSelect() {},
    },
  ];
}
