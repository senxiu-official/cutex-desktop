import { describe, expect, it } from "vitest";
import { emptyTimeline, type TurnView } from "../src/renderer/src/lib/timeline";
import { turnActivity } from "../src/renderer/src/lib/turnActivity";
import { turnProgressMark } from "../src/renderer/src/lib/silentGap";

describe("live tail history-independent work", () => {
  it.each([327, 3270])("reads only the active tail among %i loaded turns", count => {
    const timeline = emptyTimeline();
    const turns = Array.from({ length: count }, (_, i) => ({ id: `t${i}`, entryIds: [] } as unknown as TurnView));
    const last = turns.at(-1)!;
    last.entryIds.push("reply");
    timeline.activeTurnId = last.id;
    timeline.entries.set("reply", { kind: "agent", id: "reply", turnId: last.id, text: "live reply", streaming: true });
    let reads = 0;
    timeline.turns = new Proxy(turns, { get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    } });
    expect(turnActivity(timeline)).toBe("replying");
    expect(turnProgressMark(timeline)).toContain("reply");
    expect(reads).toBe(2);
    reads = 0;
    timeline.activeTurnId = null;
    expect(turnActivity(timeline)).toBeNull();
    expect(turnProgressMark(timeline)).toBeNull();
    expect(reads).toBe(0);
  });
});
