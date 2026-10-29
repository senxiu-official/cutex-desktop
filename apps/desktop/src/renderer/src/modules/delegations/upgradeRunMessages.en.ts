import type { zhCN } from "./upgradeRunMessages";

export const en = {
  "delegations.upgrade.run.title": "Project run controls",
  "delegations.upgrade.run.phase.running": "Running",
  "delegations.upgrade.run.phase.pausing": "Pausing; waiting for member turns to finish",
  "delegations.upgrade.run.phase.paused": "Paused",
  "delegations.upgrade.run.phase.partial": "Some member states await confirmation",
  "delegations.upgrade.run.pause": "Pause after current turns",
  "delegations.upgrade.run.confirmPause": "Confirm pause after current turns",
  "delegations.upgrade.run.includeDirector": "Include {{director}} and designated operator",
  "delegations.upgrade.run.membersHint": "By default, pause members after their current turns, excluding the current {{director}} and designated operator.",
  "delegations.upgrade.run.interrupt": "Interrupt and pause now",
  "delegations.upgrade.run.interruptMembers": "Interrupt members’ current turns and pause the project now? The {{director}} and designated operator will keep running. Interrupted delegations will not continue automatically.",
  "delegations.upgrade.run.interruptAll": "Interrupt members’, the {{director}}’s and designated operator’s current turns and pause the project now? Interrupted delegations will not continue automatically.",
  "delegations.upgrade.run.confirmInterrupt": "Confirm immediate interruption",
  "delegations.upgrade.run.cancel": "Cancel",
  "delegations.upgrade.run.resume": "Resume project",
  "delegations.upgrade.run.resumeHint": "Resuming only lifts this pause. Interrupted delegations require an explicit continuation action.",
  "delegations.upgrade.run.interrupted": "Interrupted delegations",
  "delegations.upgrade.run.delegationRef": "{host}/{id}",
  "delegations.upgrade.run.failed": "The action could not be completed. Refresh the project state and try again.",
} satisfies Record<keyof typeof zhCN, string>;
