// The ▾ beside 新工作: start the quick chat on another profile. The listed profiles are the focus
// host's (a picked profile binds the draft to it), so the menu is hidden when the focus host cannot
// create sessions (the entry itself shows when any host of the scope can).
import { ChevronDown } from "lucide-react";
import { api } from "../../bridge";
import { useI18n } from "../../i18n";
import { openMenuFrom } from "../../lib/contextMenu";
import { modelName } from "../../lib/modelDisplay";
import { applyProfileOrder, profileOrderOf } from "../../lib/profileOrder";
import { useApp } from "../../store";

export function QuickChatMenu() {
  const { t } = useI18n();
  const newQuickChat = useApp((s) => s.newQuickChat);
  const focusCanCreate = useApp((s) => s.features.has("human-create-session"));
  if (!focusCanCreate) return null;
  return (
    <button
      title={t("quick-chats.navWith")}
      onClick={(e) => {
        const el = e.currentTarget;
        void api.listProfiles().then((list) =>
          openMenuFrom(
            el,
            // In the owner's manual profile order (lib/profileOrder; the focus host's list).
            applyProfileOrder(list?.profiles ?? [], profileOrderOf()).map((p) => ({
              label: p.name,
              hint: p.name === list?.defaultProfile || p.id === list?.defaultProfile ? t("quick-chats.defaultProfile") : p.model ? modelName(p.model, null, p.id) : undefined,
              onSelect: () => void newQuickChat(p.id),
            })),
          ),
        );
      }}
      className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1 text-subtle opacity-0 group-hover/navitem:opacity-100 hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100"
    >
      <ChevronDown size={13} />
    </button>
  );
}
