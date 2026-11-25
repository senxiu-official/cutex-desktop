// WhatsApp (built-in, default off; owner 2026-11-26: many people never use WhatsApp, so it is not part of 服务通知).
// main watches one owner browser tab on the official https://web.whatsapp.com/ page on THIS desktop and posts generic
// service notifications to the local host (service-notifications-v1); 服务通知 shows and routes them like any
// other service's. This module owns:
// - Settings → 通知 → WhatsApp: status, 打开 WhatsApp, reading / preview switches, 解除绑定 (WhatsAppCard).
// - A clicked WhatsApp notification opens the owner tab (lib/serviceOpeners), while the module is on.
// - main's own copy of this switch (whatsappSync.ts, from modules/app.ts): off = main injects nothing and stops
//   polling at once, and the tab is no longer held as owner-only; the binding and credential stay.
// - Phase 2 (read, reply, English rewrite) has its place in ./assist.ts, behind its own switch.
import { MessageCircle } from "lucide-react";
import { registerServiceOpener } from "../../lib/serviceOpeners";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";
import { WHATSAPP_SLUG } from "./model";
import { openWhatsApp } from "./whatsapp";

const WhatsAppPage = lazyPage(() => import("./WhatsAppPage").then((m) => m.WhatsAppPage));

export const WHATSAPP_MODULE = "whatsapp";
export const WHATSAPP_PAGE = "whatsapp";

export default defineModule({
  id: WHATSAPP_MODULE,
  titleKey: "whatsapp.title",
  descriptionKey: "whatsapp.description",
  defaultEnabled: false,
  contributes: {
    "settings.page": [
      {
        id: "whatsapp.page",
        page: WHATSAPP_PAGE,
        group: "app",
        order: 615,
        navParent: "notifications",
        icon: MessageCircle,
        titleKey: "whatsapp.title",
        hintKey: "whatsapp.pageHint",
        source: "local",
        Page: WhatsAppPage,
        keywords: ["whatsapp.open", "whatsapp.preview"],
        sections: [{ anchor: "whatsapp", titleKey: "whatsapp.title", keywords: ["whatsapp.open", "whatsapp.preview", "whatsapp.reading"] }],
      },
    ],
  },
  activate: (ctx) => {
    const off = registerServiceOpener(WHATSAPP_SLUG, (side) => openWhatsApp(side));
    ctx.signal.addEventListener("abort", off);
  },
});
