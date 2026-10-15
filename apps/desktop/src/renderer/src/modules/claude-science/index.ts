// Claude Science (default off, owner 2026-10-14): several Claude Science accounts side by side on a
// host. Each account = one cutex managed, persistent service (docs/research/claude-science-accounts-20261014.md):
// `claude-science serve` with HOME = the account's own directory, supervised by cutex, opened in an
// owner browser tab through the service proxy (`<slug>.svc.localhost`, so each account keeps its own
// cookies). Every account logs in once in its own directory — never with a cutex Profile's Claude
// login (refresh-token rotation would fight cutex's Claude agents).
// Needs cutex `services-login-link` (the view ticket mints Claude Science's one-time sign-in link on
// the host; `proxyHostHeader: upstream` also moves the browser's Origin so its CSRF / WebSocket gate
// accepts the proxied UI). Owner only (both capabilities are owner-only). Opening needs the browser
// module. Nothing runs on this machine: cutex runs the commands on the host.
import { FlaskConical } from "lucide-react";
import { SERVICES_LOGIN_LINK_FEATURE } from "../../../../shared/servicesSettings";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { activateClaudeScience } from "./actions";
import { ClaudeSciencePage } from "./ClaudeSciencePage";

export default defineModule({
  id: "claude-science",
  titleKey: "claude-science.title",
  descriptionKey: "claude-science.description",
  defaultEnabled: false,
  requires: { capabilities: ["services", SERVICES_LOGIN_LINK_FEATURE] },
  contributes: {
    "nav.primary": [{ id: "claude-science.nav", order: 420, icon: FlaskConical, titleKey: "claude-science.nav", unavailable: "hide", target: { page: "claude-science.page" } }],
    "main.page": [{ id: "claude-science.page", Page: ClaudeSciencePage, useTitle: pageTitle("claude-science.nav") }],
  },
  activate: activateClaudeScience,
});
