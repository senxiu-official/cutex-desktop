/** When the composer says "this goes to the next turn" (components/NoSteerSendHint). A delegation turn has
 *  its own hint (DelegationTurnHint); a paused agent its own (AgentPausedSendHint). */
export function noSteerHintShown(o: { busy: boolean; noSteer: boolean; hasContent: boolean; delegation: boolean; paused: boolean }): boolean {
  return o.busy && o.noSteer && o.hasContent && !o.delegation && !o.paused;
}

/** The busy placeholder: a no-steer runtime names the next turn instead of "keep typing to queue". */
export function busyPlaceholderKey(noSteer: boolean): "composer.placeholderBusy" | "composer.placeholderBusyNoSteer" {
  return noSteer ? "composer.placeholderBusyNoSteer" : "composer.placeholderBusy";
}
