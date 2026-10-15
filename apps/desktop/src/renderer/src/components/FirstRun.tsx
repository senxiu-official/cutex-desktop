// The empty main area on this machine when there is nothing to pick yet (lib/firstRun): cutex not
// installed — the steps, pointing at the install guide (docs/install/AGENT-INSTALL.md) — or installed
// but not running, or running without agents. Replaces 「从左侧选择一个智能体」, which says nothing
// useful on a first run.
import { BookOpen, Download, Power, Server, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { DaemonState } from "../../../shared/ipc";
import { api, bridge } from "../bridge";
import { useI18n } from "../i18n";
import { INSTALL_GUIDE_URL, type FirstRunView } from "../lib/firstRun";
import { cachedProfileList, loadProfileList } from "../lib/profileSnapshot";
import { useApp } from "../store";
import { Button } from "./settings/Form";

export function FirstRunPanel({ view, daemon }: { view: Exclude<FirstRunView, null>; daemon: DaemonState }) {
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  const Icon = view === "notInstalled" ? Download : view === "notRunning" ? Power : view === "noHost" ? Server : Sparkles;
  const url = daemon.baseUrl;
  // Connected, no agents: without any Profile the first agent cannot run, so lead with adding one.
  const [noProfiles, setNoProfiles] = useState(() => cachedProfileList()?.profiles.length === 0);
  useEffect(() => {
    if (view !== "empty") return;
    let live = true;
    loadProfileList().then(
      (list) => live && setNoProfiles(!!list && list.profiles.length === 0),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [view]);
  const guide = (
    <Button onClick={() => void api.openExternal(INSTALL_GUIDE_URL)} title={INSTALL_GUIDE_URL}>
      <BookOpen size={14} className="mr-1 inline-block align-[-2px]" />
      {t("firstRun.installGuide")}
    </Button>
  );
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-6" data-testid={`first-run-${view}`}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface-2/60 px-6 py-5 text-sm">
        <div className="mb-2 flex items-center gap-2 text-base font-medium">
          <Icon size={18} className="shrink-0 text-accent" />
          {t(`firstRun.${view}.title`)}
        </div>
        {view === "notInstalled" && (
          <>
            <p className="mb-3 text-muted">{t("firstRun.notInstalled.body")}</p>
            <ol className="mb-4 list-decimal space-y-1 pl-5 text-muted">
              <li>{t("firstRun.notInstalled.step1")}</li>
              <li>{t("firstRun.notInstalled.step2")}</li>
              <li>{t("firstRun.notInstalled.step3")}</li>
            </ol>
          </>
        )}
        {view === "notRunning" && <p className="mb-4 text-muted">{t("firstRun.notRunning.body", { url })}</p>}
        {view === "empty" && !noProfiles && <p className="text-muted">{t("firstRun.empty.body")}</p>}
        {view === "empty" && noProfiles && (
          <>
            <p className="mb-4 text-muted">{t("firstRun.empty.noProfile")}</p>
            <Button primary onClick={() => openSettings("profiles", { create: true })}>{t("firstRun.empty.addProfile")}</Button>
          </>
        )}
        {view === "noHost" && (
          <>
            <p className="mb-4 text-muted">{t("firstRun.noHost.body")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button primary onClick={() => openSettings("hosts", { anchor: "addHost" })}>{t("firstRun.noHost.add")}</Button>
              {guide}
            </div>
          </>
        )}
        {view !== "empty" && view !== "noHost" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button primary onClick={() => void api.reconnectHost()}>{t("firstRun.retry")}</Button>
              {guide}
              <Button onClick={() => openSettings("hosts")}>{t("firstRun.hostSettings")}</Button>
              {bridge.shell && <Button onClick={() => void bridge.shell?.openLogs()}>{t("firstRun.openLogs")}</Button>}
            </div>
            {daemon.kind === "unreachable" && (
              <details className="mt-3 text-xs text-subtle">
                <summary className="cursor-pointer select-none">{t("firstRun.detail")}</summary>
                <div className="mt-1 font-mono break-all">{url} — {daemon.message}</div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
