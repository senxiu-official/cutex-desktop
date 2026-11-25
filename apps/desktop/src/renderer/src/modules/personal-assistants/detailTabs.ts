// The tabs of one assistant (AssistantDetail); kept out of the component file so it keeps Fast Refresh.
export type DetailTab = "today" | "requests" | "templates" | "notes" | "settings" | "grants" | "history";
export const DETAIL_TABS: readonly DetailTab[] = ["today", "requests", "templates", "notes", "settings", "grants", "history"];

/** A 定期任务 to show first (an owner notice): its id, the refused template revision and why (cutex's code). */
export interface TemplateFocus {
  scheduleId: string;
  templateRevision: number | null;
  reason: string;
}
/** The page params of a notice's 打开定期任务 (`template`, `review`, `reviewRevision`), or null. */
export function templateFocus(params: Readonly<Record<string, string | undefined>>): TemplateFocus | null {
  if (!params.template) return null;
  const rev = Number(params.reviewRevision);
  return { scheduleId: params.template, templateRevision: params.reviewRevision && Number.isSafeInteger(rev) ? rev : null, reason: params.review ?? "" };
}
