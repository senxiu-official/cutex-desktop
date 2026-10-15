/** Optional module-provided welcome copy. Templates use {name} (or {称呼}). */
export interface LaunchGreeting {
  messages: string | readonly string[];
  address?: string;
}

/** The caller keeps one random sample per visit, so editing the draft never rerolls the text. */
export function resolveLaunchGreeting(greeting: LaunchGreeting | undefined, fallback: string, owner: string, sample: number): string {
  const messages = (typeof greeting?.messages === "string" ? [greeting.messages] : greeting?.messages ?? []).filter((text) => text.trim());
  const index = Math.min(messages.length - 1, Math.max(0, Math.floor(sample * messages.length)));
  const template = messages[index] ?? fallback;
  const address = greeting?.address?.trim() || owner;
  return template.replace(/\{(?:name|称呼)\}/g, () => address);
}
