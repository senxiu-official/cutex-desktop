// Attention, notices, approvals, alarms, upgrade cards, agent lifecycle, sub-agents, terminals (state surfaces WP-D3 / WP-D6). Owner-approved wording 2026-11-17: .claude/agent-artifacts/state-surfaces-wording-proposal.md.
// W14 ownerNotify.state.awaitingReply; S11 runtime.* (start deadline, lib/runtimeStart); W13 agentLifecycle.* (lib/archiveWords).
export const zhCN = {
  "ownerNotify.state.awaitingReply": "已读，等你回复",
  "ownerNotify.state.awaitingReplyHint": "你已经看过这条通知，它还在等你回复。",
  "runtime.startingHint": "已请求启动，等运行时上线。{time} 前还没确认，会变成「启动未确认」。",
  "runtime.startUnconfirmed": "启动未确认",
  "runtime.startUnconfirmedHint": "{time} 开始启动，到现在还没确认运行时已上线。可以重新读取，或停止它。",
  "runtime.reread": "重新读取",
  "runtime.rereadHint": "重新读取这台主机上{{agent}}的状态。",
  "runtime.stopUnconfirmedHint": "发一个下线请求，只作用于现在这一代运行时；{time} 开始的那次启动不会被撤回。",
  "agentLifecycle.archivedRestorable": "已归档（可恢复）",
  "agentLifecycle.archivedRestorableHint": "这个{{agent}}已归档，可以恢复。",
  "agentLifecycle.permanentlyRetired": "已永久退休",
  "agentLifecycle.permanentlyRetiredHint": "这个{{agent}}已永久退休，不能恢复。",
};

export const en: Record<keyof typeof zhCN, string> = {
  "ownerNotify.state.awaitingReply": "Read; awaiting your reply",
  "ownerNotify.state.awaitingReplyHint": "You've seen this notice; it is still waiting for your reply.",
  "runtime.startingHint": "Start requested; waiting for the runtime to come online. If not confirmed by {time}, it becomes Start unconfirmed.",
  "runtime.startUnconfirmed": "Start unconfirmed",
  "runtime.startUnconfirmedHint": "The start began at {time} and the runtime hasn't been confirmed online since. Re-read, or stop it.",
  "runtime.reread": "Re-read",
  "runtime.rereadHint": "Read this host's {{agent}} states again.",
  "runtime.stopUnconfirmedHint": "Sends an offline request for the current runtime generation only; the start from {time} isn't withdrawn.",
  "agentLifecycle.archivedRestorable": "Archived (restorable)",
  "agentLifecycle.archivedRestorableHint": "This {{agent}} is archived and can be restored.",
  "agentLifecycle.permanentlyRetired": "Permanently retired",
  "agentLifecycle.permanentlyRetiredHint": "This {{agent}} is permanently retired and can't be restored.",
};

// zh-Hant-CN: OpenCC s2t of zhCN (mainland terms kept).
export const zhHant: Record<keyof typeof zhCN, string> = {
  "ownerNotify.state.awaitingReply": "已讀，等你回覆",
  "ownerNotify.state.awaitingReplyHint": "你已經看過這條通知，它還在等你回覆。",
  "runtime.startingHint": "已請求啓動，等運行時上線。{time} 前還沒確認，會變成「啓動未確認」。",
  "runtime.startUnconfirmed": "啓動未確認",
  "runtime.startUnconfirmedHint": "{time} 開始啓動，到現在還沒確認運行時已上線。可以重新讀取，或停止它。",
  "runtime.reread": "重新讀取",
  "runtime.rereadHint": "重新讀取這臺主機上{{agent}}的狀態。",
  "runtime.stopUnconfirmedHint": "發一個下線請求，只作用於現在這一代運行時；{time} 開始的那次啓動不會被撤回。",
  "agentLifecycle.archivedRestorable": "已歸檔（可恢復）",
  "agentLifecycle.archivedRestorableHint": "這個{{agent}}已歸檔，可以恢復。",
  "agentLifecycle.permanentlyRetired": "已永久退休",
  "agentLifecycle.permanentlyRetiredHint": "這個{{agent}}已永久退休，不能恢復。",
};
