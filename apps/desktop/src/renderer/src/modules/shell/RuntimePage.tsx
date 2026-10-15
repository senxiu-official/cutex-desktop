// Settings → 运行时 (connected host): the page's sections 升级{{agent}} (module runtime-packages) and
// 已安装的运行时 (module runtimes, cutex runtimes-view). The cutex build and the runtimes new agents
// get show once, on 后端更新 (settings audit 2026-10-15, lead decision 1); the page header links
// there (`headerLink` of the page item).
import { useEffect } from "react";
import { refreshRuntimePackages } from "../../lib/runtimePackageStore";
import { useHostRuntimePackages } from "../../lib/runtimePackagesView";
import { refreshRuntimes, useHostRuntimes } from "../../lib/runtimesStore";
import { useTargetHostId } from "../../lib/targetHost";
import { SettingsSections } from "../Outlet";

export function RuntimePage() {
  const packages = useHostRuntimePackages();
  const runtimes = useHostRuntimes();
  const packagesOn = !!packages;
  const runtimesOn = !!runtimes;
  // Opening the page loads both lists (no-op without the capability); a finished upgrade / revert
  // run changes the pins, so the installed list follows it.
  const lastRunDone = packages?.view?.lastRun?.finishedAt ?? null;
  const hostId = useTargetHostId();
  useEffect(() => void refreshRuntimePackages(hostId), [packagesOn, hostId]);
  useEffect(() => void refreshRuntimes(hostId), [runtimesOn, lastRunDone, hostId]);
  return <SettingsSections page="runtime" />;
}
