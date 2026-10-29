// Whether a conversation is folded on screen — to its strip (docs/design/002, lib/convStrips) or 只看 Shelf
// (lib/shelfOnly). Owner 2026-10-22 (002): a folded conversation is NOT being looked at — its turn ends leave
// unread marks and its notifications are not held back, even when it is the focused workspace's. store
// `looksAt` and lib/attentionView ask this; lib/convStrips `startConvStrips` registers the real test (this file
// imports nothing, so the store can use it without a cycle).

let test: (hostId: string, sessionId: string) => boolean = () => false;

/** Registers the test (null: none — nothing is folded). */
export function setFoldedTest(fn: ((hostId: string, sessionId: string) => boolean) | null): void {
  test = fn ?? (() => false);
}

/** This agent's conversation is on screen folded (a strip / 只看 Shelf). */
export const isFoldedConversation = (hostId: string, sessionId: string): boolean => test(hostId, sessionId);
