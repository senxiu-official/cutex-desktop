// Settings → 模块, developer mode (docs/desktop-modules.md §30.5): the switch and "load from folder" open main's own dialogs;
// this only asks. A module's build error shows here; the last build that ran stays loaded.
import { useMemo, useState } from "react";
import { bridge } from "../../bridge";
import { Markdown } from "../../components/Markdown";
import { Button, ListRow, SettingsGroup, Toggle } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { CodeBlockScope } from "../../lib/codeBlockScope";
import { activeHost } from "../../lib/hosts";
import { useApp } from "../../store";
import { appModules } from "../app";
import { applyModuleDevView, useModuleDevView } from "../devModules";
import { readsAppInternals } from "../../../../shared/modulePacks";
import { usesExperimentalApi } from "../packHost";
import { useModuleStatuses } from "../react";
import type { ModuleDevView } from "../../../../shared/moduleDev";

async function run(call: () => Promise<ModuleDevView> | undefined): Promise<void> {
  try {
    const view = await call();
    if (view) applyModuleDevView(view);
  } catch (error) {
    console.warn("[module-dev]", error);
  }
}

const SAMPLE_REPLY = "```ts\nconst greeting: string = \"hello\";\nconsole.log(greeting);\n```\n\n```sh\necho hello\n```\n";

/** A made-up agent reply, so `timeline.codeBlockAction` items can be tried with no daemon, agent or model: the real code block and toolbar. */
function SampleReply() {
  const hostId = useApp((s) => activeHost(s.hosts)?.id ?? "local");
  const scope = useMemo(() => ({ sessionId: "sample-session", hostId }), [hostId]);
  return (
    <CodeBlockScope.Provider value={scope}>
      <div data-module-dev-sample="" className="pt-1 select-text">
        <Markdown text={SAMPLE_REPLY} relativeFiles={false} />
      </div>
    </CodeBlockScope.Provider>
  );
}

export function DevModulesGroup() {
  const { t } = useI18n();
  const view = useModuleDevView();
  const api = bridge.moduleDev;
  const host = appModules();
  useModuleStatuses();
  const [sample, setSample] = useState(false);
  if (!api || !view) return null;
  return (
    <>
      <SettingsGroup agents="none" source="local">
        <ListRow
          title={t("modules.dev.title")}
          detail={view.skipped ? t("modules.dev.skipped") : t(view.enabled ? "modules.dev.onDetail" : "modules.dev.offDetail")}
          actions={
            view.enabled ? (
              <>
                <Button onClick={() => setSample(!sample)}>{t(sample ? "modules.dev.sampleHide" : "modules.dev.sampleShow")}</Button>
                {!view.skipped && <Button onClick={() => void run(() => api.addFolder())}>{t("modules.dev.addFolder")}</Button>}
                <Button onClick={() => void run(() => api.setEnabled(false))}>{t("modules.dev.turnOff")}</Button>
              </>
            ) : (
              <Button onClick={() => void run(() => api.setEnabled(true))}>{t("modules.dev.turnOn")}</Button>
            )
          }
          below={view.enabled && sample ? <SampleReply /> : undefined}
        />
      </SettingsGroup>
      {view.enabled && !view.skipped && view.modules.map((m) => (
        <SettingsGroup agents="none" source="local" key={m.folder}>
          <ListRow
            title={m.id ? `${m.id} ${m.version}` : t("modules.dev.notBuilt")}
            detail={<span title={m.folder}>{m.folder}</span>}
            below={
              <div data-module-dev={m.id ?? ""} className="space-y-1 pb-1 text-xs">
                {m.error && <p className="break-words text-danger select-text">{t("modules.dev.error", { message: m.errorKey ? t(m.errorKey as MessageKey, m.errorVars) : m.error })}</p>}
                {usesExperimentalApi(m.host) && <p className="text-warn-text">{t("modules.pack.experimentalHint")}</p>}
                {readsAppInternals(m.host) && <p className="text-warn-text">{t("modules.pack.internal")}</p>}
              </div>
            }
            actions={
              <>
                {m.id && host.modules.some((d) => d.id === m.id) && <Toggle label={m.id} checked={host.isEnabled(m.id)} onChange={(on) => void host.setEnabled(m.id!, on)} />}
                <Button onClick={() => void run(() => api.removeFolder(m.folder))}>{t("modules.dev.remove")}</Button>
              </>
            }
          />
        </SettingsGroup>
      ))}
    </>
  );
}
