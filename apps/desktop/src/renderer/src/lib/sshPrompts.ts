// SSH questions main forwards from ssh (shared/sshPrompt.ts, main/sshAskpass.ts): the open list
// (`sshPrompts()` + the `sshPrompts` event) and the answer call. The answer goes straight to main;
// nothing here keeps it.
import { useEffect } from "react";
import { create } from "zustand";
import type { SshPromptAnswer, SshPromptView } from "../../../shared/sshPrompt";
import { api, bridge } from "../bridge";

const useStore = create<{ prompts: SshPromptView[] }>(() => ({ prompts: [] }));

let started = false;
function start(): void {
  if (started) return;
  started = true;
  if (typeof bridge.on === "function") bridge.on("sshPrompts", ({ prompts }) => useStore.setState({ prompts }));
  if (typeof api.sshPrompts !== "function") return;
  api.sshPrompts().then(
    (prompts) => useStore.setState({ prompts }),
    () => {},
  );
}

/** The open questions, oldest first. */
export function useSshPrompts(): SshPromptView[] {
  useEffect(start, []);
  return useStore((s) => s.prompts);
}

/** Answer (null = cancel); the question leaves the list at once (main confirms with the event). */
export function answerSshPrompt(id: string, answer: SshPromptAnswer): void {
  useStore.setState((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) }));
  void api.answerSshPrompt?.(id, answer).catch(() => {});
}
