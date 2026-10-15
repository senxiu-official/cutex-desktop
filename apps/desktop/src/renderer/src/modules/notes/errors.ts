// Errors of the notes routes as shown: an older cutex without `/v2/notes` (route_not_found / 404)
// reads as the calm "needs a newer cutex" text, never the raw code. The gutter / launchers / actions
// already hide on such a host (lib/hostGatingView.ts); this is the safety net.
import { isRouteMissing } from "../../lib/hostGating";

export function noteErrorText(error: string | null | undefined, t: (key: "notes.unsupportedHost") => string): string | null {
  if (!error) return null;
  return isRouteMissing(error) ? t("notes.unsupportedHost") : error;
}
