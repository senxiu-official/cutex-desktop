// 服务 (cutex services registry): the web services agents started — page + sidebar entry (step 3).
// The title-bar chip of an agent's services is still in TitleBar (titlebar.agent, a B slot).
// With cutex `services-persistent-approval` a section in Settings → 协作: whether an agent's request
// for a persistent service needs the owner's approval (PersistApprovalSection).
// 项目 page: a 服务 tab (`project.tab`, §21) with the project's services and a count for the overview.
// An agent's reveal request (`service_register` reveal: true) → a card 「… 想给你看：… · 打开」 in its
// conversation that opens the service in an owner browser tab (live.ts).
import { Globe } from "lucide-react";
import { SERVICES_PERSIST_APPROVAL_FEATURE } from "../../../../shared/servicesSettings";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { PersistApprovalSection } from "./PersistApprovalSection";
import { ProjectServicesTab, ServicesPage } from "./ServicesPage";
import { useProjectServicesSummary } from "./summary";
import { startServiceReveals } from "./live";
import { ServiceToasts } from "./Toasts";

export default defineModule({
  id: "services",
  titleKey: "services.title",
  descriptionKey: "services.description",
  requires: { capabilities: ["services"] },
  contributes: {
    "nav.primary": [{ id: "services.nav", order: 400, icon: Globe, titleKey: "services.nav", target: { page: "services.page" } }],
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
  },
  activate: (ctx) => startServiceReveals(ctx),
});
