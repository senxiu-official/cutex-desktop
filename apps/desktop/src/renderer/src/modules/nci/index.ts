// NCI 远程作业 (default off): everything NCI Gadi (PBS Pro) about remote jobs. People who don't use
// NCI never see it; the owner turns it on in 设置 → 模块.
// - Settings → NCI 远程作业 (host page, cutex inbound-mail): a step-by-step setup guide — the key
//   cutex generates on the host, what to put on Gadi, Gadi's host keys and username, the PBS mailbox,
//   test + turn on the scheduler check (NciSettings.tsx; step states in lib/nciSetup.ts).
// - The 作业 page's NCI bits (source tag, PBS job id, 可能过时, 手动标记结果…, 复制 PBS 作业号) stay
//   in module `jobs` (modules don't import each other) and show only while this module is enabled
//   (`useModuleEnabled(NCI_MODULE)` there).
// - The Job Service, inbound mail and the qstat check live in cutex; this module is only their UI.
import { Mailbox } from "lucide-react";
import { INBOUND_MAIL_FEATURE } from "../../../../shared/remoteJobs";
import { defineModule } from "../slots";
import { NciSettings } from "./NciSettings";

export default defineModule({
  id: "nci",
  titleKey: "nci.title",
  descriptionKey: "nci.description",
  defaultEnabled: false,
  contributes: {
    "settings.page": [
      {
        id: "nci.settings",
        page: "nci",
        group: "tools",
        order: 500,
        icon: Mailbox,
        titleKey: "nci.page",
        source: "host",
        hintKey: "nci.pageHint",
        requires: { capabilities: [INBOUND_MAIL_FEATURE] },
        Page: NciSettings,
        keywords: ["nci.key.title", "nci.gadi.title", "nci.hostKeys.title", "nci.username.title", "nci.mail.title", "nci.enable.title"],
        sections: [
          { anchor: "nci-key", titleKey: "nci.key.title", keywords: ["nci.key.publicKey", "nci.key.fingerprint"] },
          { anchor: "nci-gadi", titleKey: "nci.gadi.title", keywords: ["nci.gadi.helper", "nci.gadi.line"] },
          { anchor: "nci-host-keys", titleKey: "nci.hostKeys.title" },
          { anchor: "nci-username", titleKey: "nci.username.title", keywords: ["nci.advanced.title"] },
          { anchor: "nci-mailbox", titleKey: "nci.mail.title", keywords: ["nci.mail.server", "nci.mail.password", "nci.mail.address"] },
          { anchor: "nci-enable", titleKey: "nci.enable.title", keywords: ["nci.enable.testMail", "nci.enable.verify"] },
        ],
      },
    ],
  },
});
