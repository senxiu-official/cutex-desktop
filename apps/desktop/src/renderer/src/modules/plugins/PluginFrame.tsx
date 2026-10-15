import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { mountSandbox } from "@cutex-desktop/plugin-sandbox";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { captureHostAction } from "../../lib/hostSwitch";
import { useApp } from "../../store";
import { pluginOperations } from "./permissions";
import type { PluginRuntime } from "./runtime";

/** Trusted adapter only; all plugin HTML/scripts are loaded by the opaque frame document factory. */
export function PluginFrame({ runtime }: { runtime: PluginRuntime }) {
  const { t } = useI18n();
  const scope = useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    const plugins = bridge.plugins;
    if (!container.current || !scope || !plugins || !runtime.current(scope)) return;
    const hostCurrent = captureHostAction();
    let closed = false;
    const current = () => !closed && runtime.current(scope) && hostCurrent() && (useApp.getState().hosts?.active ?? "local") === scope.context.host.id;
    const frame = mountSandbox(container.current, {
      resource: { kind: "external-plugin", pluginId: runtime.plugin.manifest.id, html: "", script: "", requestedPermissions: runtime.plugin.manifest.capabilities },
      title: runtime.plugin.manifest.name,
      scope: { hostId: scope.context.host.id },
      grantedPermissions: runtime.plugin.permissions,
      operations: pluginOperations({
        signal: scope.signal, current,
        agents: () => {
          const sidebar = useApp.getState().sidebar;
          return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].map((agent) => ({ id: agent.cutexSessionId, name: agent.displayName, state: agent.runtime.status, threadId: agent.native.threadId }));
        },
        openAgent: (id) => useApp.getState().select(id),
        prefs: scope.context.prefs,
      }),
      documentFactory: async ({ instanceId, channel }) => {
        if (!current()) throw new Error("stale_plugin_scope");
        const prepared = await plugins.prepare({ pluginId: runtime.plugin.manifest.id, fingerprint: runtime.plugin.fingerprint, instanceId, channel });
        // mountSandbox owns late prepare completion: even after unmount it invokes this disposer.
        return { url: prepared.url, dispose: () => { void plugins.release(prepared.id).catch(() => {}); } };
      },
    });
    frame.iframe.className = "h-full min-h-96 w-full flex-1 border-0";
    const untrack = runtime.track(scope, frame.dispose);
    void frame.ready.catch((error: unknown) => { if (current()) setError(error instanceof Error ? error.message : String(error)); });
    return () => { closed = true; untrack(); frame.dispose(); };
  }, [runtime, scope]);
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      {(!scope || !bridge.plugins) && <p className="p-6 text-sm text-muted">{t("plugins.unavailable")}</p>}
      {error && <p role="alert" className="p-4 text-sm text-danger">{t("plugins.failed", { message: error })}</p>}
      <div ref={container} className="flex min-h-0 flex-1 flex-col" />
    </main>
  );
}
