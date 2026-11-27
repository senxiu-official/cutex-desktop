// Module overrides for en-AU. English module defaults are applied by the app catalog.
import { enAU as onboarding } from "./onboarding/locales.en-AU";
import { en as projectViewEn } from "./project-view/i18n.en";

const browser = {
    "browser.error.serviceManuallyStopped": "This service was manually stopped. Choose Start on the Services page; reloading will not start it.",
    "browser.error.serviceWakeFailed": "The service could not finish waking. Check its logs on the Services page, then choose Wake to retry. Startup will not retry automatically.",
  };

const projectView = { ...projectViewEn };

const projects = {
    "projects.operators": "{{operators}}",
    "projects.operatorsEmpty": "No {{operators}}",
    "projects.setOperator": "Make {{operator}}",
    "projects.revokeOperator": "Remove {{operator}}",
    "projects.operatorRestartRequired": "{{Operator}} permissions updated; the current turn continues. Restart to apply.",
    "projects.operatorOffline": "{{Operator}} permissions updated; they apply on the next start.",
    "projects.operatorRestartNow": "Restart now",
    "projects.operatorSuccessor": "Revoke {name}’s {{operator}} grant before making them {{director}}.",
    "projects.operatorMenuArmed": "Click again: make {name} this project's {{operator}}, able to act for the {{director}}",
    "projects.operatorMenuDirector": "The {{director}} can't also be {{operator}}",
    "projects.operatorMenuUnavailable": "{{Operator}} grants can't be changed in this project right now (no {{director}}, or not active)",
    "projects.operatorMenuFailed": "{action} failed: {error}",
    "projects.operatorRuntimeUnknown": "{{Operator}} permissions updated. Runtime status is unavailable; restart to apply.",
    "projects.operatorRestartArmed": "Click again to restart; any active turn will be interrupted"
  };

const runtimes = {
  "runtimes.prune.action": "Clean up ({n})",
  "runtimes.prune.refresh": "Refresh",
  "runtimes.prune.loading": "Checking cleanup plan…",
  "runtimes.prune.checking": "Checking…",
  "runtimes.prune.timeout": "Cleanup plan can’t be read right now",
  "runtimes.prune.retry": "Retry",
  "runtimes.verificationPending": "not checked yet",
  "runtimes.verificationPendingHint": "cutex is still checking this version’s files in the background; until it finishes, its SHA isn’t shown and it isn’t judged registered or not.",
  "runtimes.prune.sizeUnknown": "not computed",
  "runtimes.prune.totalUnknown": "size not computed",
  "runtimes.prune.atLeast": "at least {size}",
  "runtimes.unregistered": "Unregistered build",
  "runtimes.unregisteredIn": "Unregistered build (folder {dir})",
  "runtimes.unregisteredHint": "cutex’s version registry has no entry for this file’s SHA-256, so it can’t tell the version; the name is the file’s folder.",
  "runtimes.prune.pending": "Cleaning up…",
  "runtimes.prune.confirm": "Delete {n} versions ({size}) on this host? The host will recheck each version.",
  "runtimes.prune.delete": "Delete",
  "runtimes.prune.cancel": "Cancel",
  "runtimes.prune.error": "Cleanup could not be confirmed. Check the refreshed plan.",
  "runtimes.prune.freed": "Freed {size}",
  "runtimes.prune.deleted": "Deleted",
  "runtimes.prune.refused": "Refused",
  "runtimes.prune.failed": "Failed",
  "runtimes.prune.plan": "Cleanup plan and protected versions",
  "runtimes.prune.selected": "Selected for new {{agents}}",
  "runtimes.prune.pinned": "Pinned by {{agents}}",
  "runtimes.prune.rollback": "Retained for rollback",
  "runtimes.prune.running": "Running",
  "runtimes.prune.unmanaged": "Not managed by cutex",
  "runtimes.prune.inspection_failed": "Safety inspection failed",
  "runtimes.prune.not_found": "Version not found",
  "runtimes.prune.io_error": "File operation failed",
  "runtimes.prune.unknown": "Protected or unknown reason",
  "runtimes.current": "New {{agents}} use",
  "runtimes.noCurrent": "Not installed or no default selected",
  "runtimes.unused": "{n} unused old versions can be cleaned up",
  "runtimes.unreferenced": "{n} old versions not referenced by sessions",
  "runtimes.nativeDependency": "Standalone executable; no Python or Node required",
  "runtimes.bundledPython": "Bundled Python (included since claude-r28)",
  "runtimes.pythonUnknown": "Host-managed Python; this version reports no bundled dependency",
  "runtimes.cli": "Claude CLI: {source} · {version}",
  "runtimes.cliUnknown": "Host has not reported the Claude CLI source or version",
  "runtimes.cliBundledUnregistered": "Claude CLI bundled with the runtime (version not registered)",
  "runtimes.bundled": "Bundled",
  "runtimes.system": "System",
  "runtimes.dshUsage": "For {{agents}} using a DSH Profile (DeepSeek)",
  "runtimes.dshProfile": "Settings → Profile → New → choose DSH as the type",
  "runtimes.node": "Node ≥ {minimum} · current {version}",
  "runtimes.nodeUnknown": "Node requirements and detection are reported by the host component",
  };

export const services = {
  "services.idleStop": "Sleep when idle",
  "services.idleStop.1h": "1 hour",
  "services.idleStop.24h": "24 hours",
  "services.idleStop.7d": "7 days",
  "services.idleStop.forever": "Forever",
  "services.idleStop.hint": "Proxy traffic, active connections and viewing leases count as use. Health checks, tile fetches and direct-port traffic do not count or wake a service. Choose Forever for direct-port-only services or backends needed at any time. Sleep keeps the registration and port; the next proxy visit wakes it.",
  "services.health.stoppedIdle": "Sleeping",
  "services.wake": "Wake",
  "services.idleWakeFailed": "Last startup failed; wake to retry",
  "services.temporary.confirm": "Make this service temporary and move it? The host may reclaim it under its idle or expiry rules.",
  "services.temporary.confirmAction": "Make temporary and move",
  "services.organize.upgrade": "{host} needs a newer cutex to save service sections, groups and order",
  "services.organize.offline": "{host} is not connected; its services can be moved once it reconnects",
};

export const shell = {
    "shell.perf.mode": "Performance mode",
    "shell.perf.save": "Save resources",
    "shell.perf.smooth": "Prefer smoothness",
    "shell.perf.saveHint": "When the window isn't in front, looping animations such as spinners pause; rarely used pages like Settings load the first time you open them.",
    "shell.perf.smoothHint": "Looping animations keep running; rarely used pages load in the background after start, so they open without waiting. Uses a little more CPU and memory."
  };

export const moduleLocale = { ...browser, ...onboarding, ...projectView, ...projects, ...runtimes, ...services, ...shell };
