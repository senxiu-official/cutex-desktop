// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "profile-import.summary.loading": "Reading…",
  "profile-import.summary.error": "Read failed; expand to retry",
  "profile-import.summary.count": "{total} providers · {available} importable",
  "profile-import.title": "Import from CC Switch",
  "profile-import.description": "Settings → Profiles → Import from CC Switch: turn the Claude Code / Codex providers set up in CC Switch on the host into profiles; CC Switch is only read",
  "profile-import.section": "Import from CC Switch",
  "profile-import.sectionHint": "Turn the Claude Code and Codex providers set up in CC Switch on this host into profiles.",
  "profile-import.notFound": "CC Switch was not found on this host",
  "profile-import.error": "Could not read CC Switch: {message}",
  "profile-import.empty": "CC Switch has no provider to import yet",
  "profile-import.reload": "Read again",
  "profile-import.app.claude": "Claude Code",
  "profile-import.app.codex": "Codex",
  "profile-import.current": "Current",
  "profile-import.existing": "Existing profile: {name}",
  "profile-import.noKey": "No API key, cannot be imported",
  "profile-import.unsupported": "Not supported yet",
  "profile-import.note": "Importing copies the API keys into cutex profiles; CC Switch is only read, never changed.",
  "profile-import.import": "Import {n}",
  "profile-import.importing": "Importing…",
  "profile-import.created": "Imported {n} profiles: {names}",
  "profile-import.created.one": "Imported {n} profile: {names}",
  "profile-import.failed": "{n} not imported:",
  "profile-import.failedRow": "{name}: {message}",
  "profile-import.err.unsupportedVersion": "Your CC Switch is newer than this host's cutex: update cutex, then import again",
  "profile-import.err.unsupportedFormat": "This CC Switch data could not be read (unexpected format)",
};
