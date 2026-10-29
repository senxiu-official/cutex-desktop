import { AcpRuntimeSettings } from "../../components/DshRuntimeCard";
// Settings → 运行时: the matching runtime groups, then the existing agent-upgrade controls.
// Installed native/Claude versions come from runtimes-view; DSH / Kimi come from component metadata.
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
  return <><SettingsSections page="runtime" only={["runtimes.installed"]} /><AcpRuntimeSettings /><SettingsSections page="runtime" except={["runtimes.installed"]} /></>;
}
