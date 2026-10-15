// The goal's target icon, coloured by status (lib/goalStatus); while the goal runs a soft ring breathes
// out of it (styles.css `goal-ping`, off under reduced motion).
import { Target } from "lucide-react";
import type { ThreadGoalStatus } from "@cutex-desktop/protocol/codex/v2";
import { goalTone } from "../lib/goalStatus";

export function GoalMark({ status, size = 14 }: { status: ThreadGoalStatus; size?: number }) {
  return (
    <span className={`relative flex shrink-0 items-center justify-center ${goalTone(status)}`} style={{ width: size, height: size }}>
      {status === "active" && <span className="absolute inset-0 rounded-full bg-current motion-safe:animate-[goal-ping_2.4s_ease-out_infinite] motion-reduce:hidden" />}
      <Target size={size} className="relative" />
    </span>
  );
}
