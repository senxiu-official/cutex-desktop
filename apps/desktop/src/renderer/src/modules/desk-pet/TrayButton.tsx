// The tray's way back: shown only while the pet cannot be reached by itself (hidden, or every click passes through it).
// One click brings it back as usable. It also keeps the pet's native menu in the UI language.
import { useEffect } from "react";
import { PawPrint } from "lucide-react";
import { useI18n } from "../../i18n";
import { menuLabels, petBridge, useDeskPetView } from "./controller";

export function DeskPetTrayButton() {
  const { t, locale } = useI18n();
  const view = useDeskPetView();
  const running = !!view?.running;
  useEffect(() => {
    if (running) void petBridge()?.start(menuLabels()).catch(() => {});
  }, [locale, running]);
  if (!view || !(view.settings.hidden || view.settings.clickThrough)) return null;
  const label = view.settings.hidden ? t("desk-pet.tray.show") : t("desk-pet.tray.clickable");
  return (
    <button
      type="button"
      data-tray-item=""
      data-desk-pet-return=""
      className="tray-item"
      data-tip={label}
      aria-label={label}
      onClick={() => void petBridge()?.set({ hidden: false, clickThrough: false })}
    >
      <PawPrint size={16} aria-hidden />
    </button>
  );
}
