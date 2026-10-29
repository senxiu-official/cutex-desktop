import { SIDE_MESSAGE_LIMIT } from "./sideChat";

type Field = "message" | "message_id" | "model" | "error_message";
function invalid(field: Field, reason: string): never {
  throw new Error(`side_chat_invalid_${field}: ${reason}`);
}
function sideText(value: unknown, max: number, field: Field, allowEmpty = false): string {
  if (typeof value !== "string") invalid(field, "type");
  if (value.length > max) invalid(field, "too_long");
  if (value.includes("\0")) invalid(field, "nul");
  if (!allowEmpty && !value.trim()) invalid(field, "empty");
  return value;
}

/** Blank optional model means the parent/server default; malformed values remain rejected. */
export function sideModel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const model = sideText(value, 200, "model", true);
  if (new TextEncoder().encode(model).length > 200 || /[\u0000-\u001f\u007f]/.test(model)) invalid("model", "characters_or_length");
  return model.trim() ? model : undefined;
}

export function sideMessage(value: unknown): string {
  const message = sideText(value, SIDE_MESSAGE_LIMIT, "message");
  if (new TextEncoder().encode(message).length > 65_536) invalid("message", "too_long");
  return message;
}
export function sideMessageId(value: unknown): string {
  return sideText(value, 128, "message_id");
}
/** Preserve runtime error context within the bridge's string limit instead of masking it. */
export function sideReplyErrorMessage(value: unknown): string {
  if (typeof value !== "string") invalid("error_message", "type");
  const clean = value.replace(/\0/g, "");
  // Slice by code point so truncation never creates an unpaired surrogate.
  let message = "";
  for (const character of clean) {
    if (message.length + character.length > 1000) break;
    message += character;
  }
  return message.trim() ? message : "Request failed";
}
