// The title of an owner approval in the app's language, built from its kind and details (cutex writes `summary`
// in English or mixed text for the requesting agent; the card keeps it as the detail line under the title).
// An unknown kind, or a known one whose details lack what its title names, falls back to the daemon's summary.
import type { ApprovalRecord } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import { approvalFacts } from "./approvals";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;
type Titled = Pick<ApprovalRecord, "kind" | "summary"> & { details?: ApprovalRecord["details"] };

/** A detail as one line of display text (control characters → spaces, long values cut), or null. */
function text(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const line = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** `register` / `update` → their own wording; any other op the generic one. */
function op(value: unknown): "register" | "update" | null {
  return value === "register" || value === "update" ? value : null;
}

/** The localized title, or null when this record has none (unknown kind, details missing). */
export function localizedApprovalTitle(record: Titled, t: Translate): string | null {
  const d = record.details && typeof record.details === "object" ? record.details : {};
  const slug = text(d.slug, 80);
  switch (record.kind) {
    case "managed_service": {
      if (!slug) return null;
      const which = op(d.op);
      return t(which === "register" ? "approvals.title.managedService.register" : which === "update" ? "approvals.title.managedService.update" : "approvals.title.managedService", { slug });
    }
    case "service_lifetime": {
      if (!slug) return null;
      const root = text(d.staticRoot, 200);
      const run = d.managedExecution === true;
      if (root) return t(run ? "approvals.title.serviceLifetime.runRoot" : "approvals.title.serviceLifetime.root", { slug, root });
      return t(run ? "approvals.title.serviceLifetime.run" : "approvals.title.serviceLifetime", { slug });
    }
    case "static_root": {
      const root = text(d.staticRoot, 200);
      if (!slug || !root) return null;
      return t("approvals.title.staticRoot", { slug, root });
    }
    case "agent_profile": {
      const name = text(d.name, 80);
      const profile = text(d.profile, 80);
      if (!name || !profile) return null;
      return t(d.operation === "replace" ? "approvals.title.agentProfile.replace" : d.operation === "create" ? "approvals.title.agentProfile.create" : "approvals.title.agentProfile", { name, profile });
    }
    case "ask_delivery": {
      const target = text(d.targetName, 80) ?? text(d.target, 80);
      const title = text(d.title, 120);
      if (!target) return null;
      return title ? t("approvals.title.askDelivery", { target, title }) : t("approvals.title.askDelivery.untitled", { target });
    }
    case "browser_claim":
      return t("approvals.title.browserClaim");
    case "browser_open": {
      // The same cleaned page facts the card lists (no query / fragment / credentials in a URL).
      const facts = approvalFacts(d, "browser_open");
      const page = text(facts.find((f) => f.key === "title")?.value, 80) ?? hostOf(facts.find((f) => f.key === "url")?.value);
      return page ? t("approvals.title.browserOpen", { page }) : t("approvals.title.browserOpen.blank");
    }
    case "workflow_run": {
      const name = text(d.name, 80);
      return name ? t("approvals.title.workflowRun", { name }) : null;
    }
    default:
      return null;
  }
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.host : url;
  } catch {
    return url;
  }
}

/**
 * Title + detail line for a card / row: the localized title with cutex's summary under it (null when it says the
 * same thing), or the summary alone.
 */
export function approvalHeading(record: Titled, t: Translate): { title: string; detail: string | null } {
  const title = localizedApprovalTitle(record, t);
  const summary = record.summary?.trim() ?? "";
  if (!title) return { title: summary, detail: null };
  return { title, detail: summary && summary.toLowerCase() !== title.toLowerCase() ? summary : null };
}

/**
 * The agent a title names, as it is written there (a delegation's target): the card shows it as an agent reference
 * (components/Parties Who) in place of that text. Null when the title names none.
 */
export function titleAgent(record: Titled): { id: string; name: string | null; text: string } | null {
  if (record.kind !== "ask_delivery") return null;
  const d = record.details && typeof record.details === "object" ? record.details : {};
  const id = typeof d.target === "string" && d.target ? d.target : null;
  const shown = text(d.targetName, 80) ?? text(d.target, 80);
  return id && shown ? { id, name: typeof d.targetName === "string" ? d.targetName : null, text: shown } : null;
}
