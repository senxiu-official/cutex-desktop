// Hooks of the cleanup page's 结束跟进 on messages (kept out of the .tsx files for Fast Refresh).
import { featuresOf, useApp } from "../../store";
import { endFollowUpKey, MESSAGE_END_FOLLOW_UP_FEATURE, useEndFollowUps } from "./endFollowUp";

/** The host offers 结束跟进 on messages (and remembers withdrawn live-only ones, N9). */
export function useMessageEndFollowUp(hostId: string): boolean {
  return useApp((s) => featuresOf(s, hostId).has(MESSAGE_END_FOLLOW_UP_FEATURE));
}

/** 已结束跟进 · 送达未确认 once this desktop ended the message's follow-up. */
export function useFollowUpEnded(hostId: string, messageId: string): boolean {
  return useEndFollowUps((s) => s.entries[endFollowUpKey(hostId, messageId)]?.phase === "ended");
}
