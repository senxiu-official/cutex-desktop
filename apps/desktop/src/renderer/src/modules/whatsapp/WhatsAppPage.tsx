// Settings → 通知 → WhatsApp (module `whatsapp`): main's watcher on this desktop. Always this computer (main
// watches a tab here), whatever host the Settings window targets.
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { WhatsAppCard } from "./WhatsAppCard";

export function WhatsAppPage() {
  useScrollToSettingsAnchor();
  return <WhatsAppCard hostId={LOCAL_HOST_ID} />;
}
