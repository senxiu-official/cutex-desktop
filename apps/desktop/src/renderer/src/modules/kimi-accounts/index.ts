// Kimi 账户 (cutex kimi-accounts, r266; docs/design/049): a section of Settings → Profile after Claude 账户 — the host's
// Kimi accounts (one private Kimi Code login each) with their sign-in state, bound Profiles and agents; add / rename /
// remove, and the device-code login (cutex runs `kimi login` on the host; the section shows the URL and code and polls).
// The Profile → account select is core (components/settings/KimiAccountSelect.tsx, lib/kimiAccounts.ts). Hidden
// without the capability.
import { KIMI_ACCOUNTS_FEATURE } from "../../../../shared/kimiAccounts";
import { KIMI_ACCOUNTS_SECTION } from "../../lib/kimiAccounts";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";

const KimiAccountsSection = lazyPage(() => import("./KimiAccountsSection").then((m) => m.KimiAccountsSection));

export default defineModule({
  id: "kimi-accounts",
  titleKey: "kimi-accounts.title",
  descriptionKey: "kimi-accounts.description",
  requires: { capabilities: [KIMI_ACCOUNTS_FEATURE] },
  contributes: {
    "settings.section": [
      {
        id: KIMI_ACCOUNTS_SECTION,
        page: "profiles",
        order: 110,
        titleKey: "kimi-accounts.section",
        keywords: ["kimi-accounts.add", "kimi-accounts.login", "kimi-accounts.logout", "kimi-accounts.state.loggedIn"],
        Section: KimiAccountsSection,
      },
    ],
  },
});
