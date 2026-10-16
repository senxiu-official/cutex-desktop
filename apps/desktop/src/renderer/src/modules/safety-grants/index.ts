// Safety check grants (cutex claude-safety-grants; docs/SAFETY-GRANTS.md in cutex): under full
// access a Claude Code safety check declines a command at once and cutex keeps it as a 需要你
// notice (core: components/SafetyBlockCard via the owner-notify card). This module marks the
// declined tool row in the timeline with the owner's decision.
import { SAFETY_GRANTS_FEATURE } from "@cutex-desktop/protocol";
import { defineModule } from "../slots";
import { isDeclinedTool } from "./declined";
import { SafetyToolRow } from "./SafetyToolRow";

export default defineModule({
  id: "safety-grants",
  titleKey: "safety-grants.title",
  descriptionKey: "safety-grants.description",
  requires: { capabilities: [SAFETY_GRANTS_FEATURE] },
  contributes: {
    "timeline.tool": [{ id: "safety-grants.tool", order: 400, match: isDeclinedTool, Row: SafetyToolRow }],
  },
});
