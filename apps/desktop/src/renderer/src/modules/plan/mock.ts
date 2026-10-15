// Browser-preview data for the plan checklist (turn/plan/updated; dev/mockTypes.ts).
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

/** Eva's model works through an `update_plan` todo list (turn/plan/updated) in its running turn, one
 *  step every few seconds, so the status capsule's 进程 count and the timeline's "更新了进程" line can
 *  be seen. It starts before Eva is opened: thread/read has no plan, the host-feed cache seeds it.
 *  Once done, an empty update shows the kept list as 已清空. */
function startPlanUpdates(core: MockCore) {
  const steps = ["读 slashCommands 现有实现", "补 /goal 的 edit / replace 分支", "接通 /review", "接通 /plan", "补单元测试", "跑 vitest 与 tsc", "更新 PROGRESS.md"];
  let done = 2;
  const send = () =>
    core.nativeEvent("eva", "turn/plan/updated", {
      threadId: "thread-eva",
      turnId: "turn-4",
      explanation: done === 2 ? "先把 slash 面板剩下的命令接通，再补测试。" : null,
      plan: steps.map((step, i) => ({ step, status: i < done ? "completed" : i === done ? "inProgress" : "pending" })),
    });
  setTimeout(() => {
    send();
    const timer = setInterval(() => {
      done++;
      send();
      if (done >= steps.length) {
        clearInterval(timer);
        // Then the model clears its list: the capsule keeps the finished one, greyed as 已清空.
        setTimeout(() => core.nativeEvent("eva", "turn/plan/updated", { threadId: "thread-eva", turnId: "turn-4", explanation: null, plan: [] }), 12_000);
      }
    }, 12_000);
  }, 1500);
}

export const mock: ModuleMock = { start: startPlanUpdates };
