import { useContext } from "react";
import { TimelineFallbackContext } from "./timelineFallback";

/** A recognized schema/tool with malformed details declines without losing original content. */
export function TimelineRowFallback() {
  return <>{useContext(TimelineFallbackContext)}</>;
}
