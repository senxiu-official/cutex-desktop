// 服务 (cutex services registry): the web services agents started — page + sidebar entry (step 3).
// The title-bar chip of an agent's services is still in TitleBar (titlebar.agent, a B slot).
// With cutex `services-persistent-approval` a section in Settings → 协作: whether an agent's request
// for a persistent service needs the owner's approval (PersistApprovalSection).
// 项目 page: a 服务 tab (`project.tab`, §21) with the project's services and a count for the overview.
// An agent's reveal request (`service_register` reveal: true) → a card 「… 想给你看：… · 打开」 in its
// conversation that opens the service in an owner browser tab (live.ts). `cutex:service/…` links in
// chat open the same tab (ref.target kind `service`, refTarget.ts).
// 「和它的智能体一起打开」 (lib/serviceLink, owner 2026-10-21): this module keeps the per-service choice in its
// prefs on this device and opens those services in the owner's Shelf when its workspace opens.
import { Server } from "lucide-react";
import { SERVICES_PERSIST_APPROVAL_FEATURE } from "../../../../shared/servicesSettings";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { ProjectServicesTab, ServicesPage } from "./ServicesPage";
import { useProjectServicesSummary } from "./summary";
import { startServiceReveals } from "./live";
import { ServiceToasts } from "./Toasts";
import { openServiceRef, SERVICE_REF_KIND, useServiceLink } from "./refTarget";
import { initServiceWithAgent, startServiceWithAgent } from "../../lib/serviceLink";
import type { Json } from "../types";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const PersistApprovalSection = lazyPage(() => import("./PersistApprovalSection").then((m) => m.PersistApprovalSection));

export default defineModule({
  id: "services",
  titleKey: "services.title",
  descriptionKey: "services.description",
  requires: { capabilities: ["services"] },
  contributes: {
    "nav.primary": [{ id: "services.nav", order: 400, icon: Server, titleKey: "services.nav", target: { page: "services.page" } }],
    "main.page": [{ id: "services.page", Page: ServicesPage, useTitle: pageTitle("services.nav") }],
    "conversation.overlay": [{ id: "services.revealCards", order: 310, Overlay: ServiceToasts }],
    "project.tab": [{ id: "services.projectTab", tab: "services", order: 320, titleKey: "services.tab", Body: ProjectServicesTab, useSummary: useProjectServicesSummary }],
    "settings.section": [
      {
        id: "services.persistApproval.settings",
        page: "collab",
        order: 300,
        requires: { capabilities: [SERVICES_PERSIST_APPROVAL_FEATURE] },
        titleKey: "services.settings",
        keywords: ["services.persistApproval", "services.persistApproval.hint"],
        Section: PersistApprovalSection,
      },
    ],
    // `cutex:service/<slug>[/path]` links in conversations → the in-app browser tab (refTarget.ts).
    "ref.target": [{ id: "services.ref", kind: SERVICE_REF_KIND, role: "content", open: openServiceRef, useLink: useServiceLink }],
  },
  activate: (ctx) => {
    startServiceReveals(ctx);
    // 和它的智能体一起打开 (per service, this device; lib/serviceLink): the choice, and opening with the agent.
    initServiceWithAgent(
      () => (ctx.signal.aborted ? null : ctx.prefs.get("withAgent", null)),
      (on) => !ctx.signal.aborted && ctx.prefs.set("withAgent", JSON.parse(JSON.stringify(on)) as Json),
    );
    startServiceWithAgent(ctx.signal);
  },
});
