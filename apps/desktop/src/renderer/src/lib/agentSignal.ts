// The per-agent display state (lib/agentAttention agentSignal), in a file with no imports so leaf modules
// (lib/rosterTiers) and other clients (apps/ipad) can use the type without the attention / store graph.

/**
 * One display state per agent, most urgent first: needs-you (amber), running (ring + elapsed), error
 * (runtime error, or the last turn failed and wasn't seen), done (a finished turn not seen yet),
 * offline (grey), idle (nothing shown), unknown (not confirmed yet: dimmed, 「连接中」).
 */
export type AgentSignal = "needsYou" | "running" | "error" | "done" | "offline" | "idle" | "unknown";
