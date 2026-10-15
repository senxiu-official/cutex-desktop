// Browser-preview data for the Claude Science page (module claude-science, default off: turn it on in
// 设置 → 模块). The accounts are ordinary managed services, so they are registered through the bridge
// into the services mock (the module serves no api methods itself): "Work" running and sharing ~/.ssh,
// "Lab" stopped on an existing directory. Under `?legacy` (no services-login-link) the page is hidden.
import { SERVICES_LOGIN_LINK_FEATURE } from "../../../../shared/servicesSettings";
import type { ModuleMock } from "../../dev/mockTypes";

export const mock: ModuleMock = {
  features: { new: [SERVICES_LOGIN_LINK_FEATURE] },
  start: (core) => {
    if (core.legacy) return;
    // After install: window.cutex is the mock bridge by then.
    setTimeout(() => {
      const api = window.cutex?.api;
      if (!api) return;
      void (async () => {
        // Shapes of model.ts registerRequest (mocks may not import module code): the page reads home,
        // binary and the ~/.ssh share back from the command line.
        const serve = `export HOME="$h"; cd "$h" || exit 1; "$cs" serve --port {port} --sandbox-port 0 --no-browser --no-auto-update`;
        const bin = `"$r"/'.local/bin/claude-science'`;
        const account = (id: string, name: string, home: string, ssh: boolean, port?: number) =>
          api.registerService({
            slug: `claude-science-${id}`,
            displayName: name,
            runtime: "managed",
            lifetime: "persistent",
            proxyHostHeader: "upstream",
            command: `r=$HOME; cs=${bin}; h=${home}; mkdir -p "$h" || exit 1; ${ssh ? `[ -e "$h/.ssh" ] || ln -s "$r/.ssh" "$h/.ssh"; ` : ""}${serve}`,
            loginLinkCommand: `r=$HOME; HOME=${home} exec ${bin} url`,
            env: { CLAUDE_SCIENCE_ACCOUNT: id },
            ...(port ? { port } : {}),
          });
        await account("work", "Work", `"$r"/'.cs-accounts/work'`, true);
        await account("lab", "Lab (shared group)", `'/home/alex/.cs-lab'`, false, 8010);
        await api.serviceAction("claude-science-lab", "stop");
      })().catch(() => undefined);
    }, 0);
  },
};
