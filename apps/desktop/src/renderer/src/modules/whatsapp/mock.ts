// Browser-preview stand-in for main's WhatsApp watcher (module `whatsapp`; all synthetic — no real QR or messages).
// `?wa` / `?waState=link|relink|ready|offline|unknown|waiting|credential|disabled`: 打开 WhatsApp reserves a key, the
// tab "mounts" and the binding moves 待关联 → 正常 after 4 s. The module itself is off by default: turn it on in
// Settings → 模块 (the WhatsApp service row and its history come from modules/service-notify/mock.ts and services).
import type { ModuleMock } from "../../dev/mockTypes";
import type { WhatsAppWatchView as WhatsAppWatch } from "../../../../shared/browser";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

function whatsAppMock(): void {
  const wanted = params.get("waState") as WhatsAppWatch["status"] | "relink" | null;
  let watch: WhatsAppWatch =
    !wanted || wanted === "disabled"
      ? { tabKey: null, enabled: false, preview: false, status: "disabled", linked: false }
      : { tabKey: "00000000-0000-4000-8000-00000000aaaa", enabled: true, preview: false, status: wanted === "relink" ? "link" : wanted, linked: wanted === "relink" || wanted === "ready" || wanted === "offline" };
  const mounted = new Set<string>();
  window.__cutexMockWhatsApp = {
    whatsAppWatch: async () => structuredClone(watch),
    setWhatsAppWatch: async (tabKey, enabled, preview) => {
      if (watch.tabKey && watch.tabKey !== tabKey) throw new Error("409 whatsapp_tab_bound: another tab is bound");
      watch = { ...watch, tabKey, enabled, preview, status: enabled ? (watch.status === "disabled" ? "link" : watch.status) : "disabled" };
      // The owner scans the code on the phone: linked a few seconds later.
      if (enabled && watch.status === "link") setTimeout(() => (watch = { ...watch, status: "ready", linked: true }), 4_000);
      return structuredClone(watch);
    },
    unbindWhatsAppWatch: async (tabKey) => {
      if (watch.tabKey !== tabKey) throw new Error("409 whatsapp_tab_changed");
      watch = { ...watch, tabKey: null, enabled: false, linked: false, status: "disabled" };
      return structuredClone(watch);
    },
    reserveOwnerTab: async () => {
      const tabKey = crypto.randomUUID();
      setTimeout(() => mounted.add(tabKey), 1_200);
      return { tabKey };
    },
    list: async () => [...mounted].map((tabKey) => ({ tabKey, url: "https://web.whatsapp.com/" })),
  };
}

export const mock: ModuleMock = {
  start: () => {
    if (params.has("wa") || params.has("waState")) whatsAppMock();
  },
};
