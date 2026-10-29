import type { LaunchForm, LaunchOverrides } from "../../../shared/launch";

/** DSH owns workspace-write + ask. Never forward saved Codex/Claude permissions. */
export function dshOnlyLaunch(launch: LaunchOverrides | LaunchForm | undefined): LaunchOverrides | undefined {
  const out: LaunchOverrides = {};
  if (launch?.model?.trim()) out.model = launch.model.trim();
  if (launch?.reasoningEffort) out.reasoningEffort = launch.reasoningEffort;
  return Object.keys(out).length ? out : undefined;
}

export function dshLaunchFromForm(form: LaunchForm, touched: boolean): LaunchOverrides | undefined {
  return touched ? dshOnlyLaunch(form) : undefined;
}
