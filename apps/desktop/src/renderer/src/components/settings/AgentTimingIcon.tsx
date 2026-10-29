import { Bot, BotOff, KeyRound, Layers, RotateCcw, Zap } from "lucide-react";
import type { SettingsAgents } from "../../lib/settingsNav";

/** One 16 px marker; its 8 px corner badge has its own background to stay readable. */
export function AgentTimingIcon({ timing }: { timing: SettingsAgents | "mixed" }) {
  if (timing === "none") return <BotOff size={14} aria-hidden />;
  if (timing === "mixed") return <Layers size={14} aria-hidden />;
  const Badge = timing === "now" ? Zap : timing === "access" ? KeyRound : RotateCcw;
  return <span aria-hidden className="relative inline-flex h-4 w-4 shrink-0" data-agent-timing-icon={timing}>
    <Bot size={14} className="absolute top-0 left-0" />
    <Badge size={8} strokeWidth={2.5} className="absolute right-0 bottom-0 rounded-full bg-surface ring-1 ring-surface" data-timing-badge />
  </span>;
}
