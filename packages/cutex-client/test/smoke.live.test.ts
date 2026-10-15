// Live smoke test against a REAL (dev) cutex daemon. Skipped unless CUTEX_SMOKE_SESSION is set.
//   $env:CUTEX_DESKTOP_HOME="$env:USERPROFILE\.cutex-desktop-dev"; $env:CUTEX_MANAGEMENT_URL="http://127.0.0.1:24370"
//   $env:CUTEX_SMOKE_SESSION="cutex.<id>"; pnpm --filter @cutex-desktop/cutex-client exec vitest run test/smoke.live.test.ts
// Sends one short prompt (costs a few tokens on the agent's model).
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { CutexClient } from "../src/client";
import { discoverLocalDaemon } from "../src/discovery";
import { EventFeed } from "../src/feed";

const sessionId = process.env.CUTEX_SMOKE_SESSION;

describe.skipIf(!sessionId)("live smoke", () => {
  it("bootstrap → stream → submit → turn completes with streamed text", async () => {
    const endpoint = await discoverLocalDaemon({ home: process.env.CUTEX_DESKTOP_HOME });
    const client = new CutexClient(endpoint);
    const boot = await client.bootstrap(sessionId!);
    expect(boot.native?.method).toBe("thread/read");

    const events: EventEnvelope[] = [];
    let live = false;
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("turn did not complete in 120s")), 120_000);
      const feed = new EventFeed(
        client,
        {
          event: (e) => {
            events.push(e);
            if (e.native?.message.method === "turn/completed") {
              clearTimeout(timer);
              feed.stop();
              resolve();
            }
          },
          resync: (reason) => reject(new Error(`resync ${reason}`)),
          status: (s) => (live ||= s === "live"),
        },
        { cutexSessionId: sessionId, streamId: boot.checkpoint.streamId, after: boot.checkpoint.cursor ?? undefined },
      );
      feed.start();
    });

    while (!live) await new Promise((r) => setTimeout(r, 50));
    const result = await client.submitInput(
      sessionId!,
      [{ type: "text", text: "Reply with exactly: pong", text_elements: [] }],
      // "auto" starts (idle) or steers (busy); "queue" starts an idle agent only on cutex with queue-idle-start.
      "auto",
    );
    expect(result.disposition).toBe("started");
    await done;

    const methods = events.map((e) => e.native?.message.method ?? e.cutex?.method);
    console.log("event methods:", [...new Set(methods)].join(", "));
    expect(methods).toContain("turn/started");
    expect(methods).toContain("item/agentMessage/delta");
    const text = events
      .filter((e) => e.native?.message.method === "item/agentMessage/delta")
      .map((e) => (e.native!.message.params as { delta: string }).delta)
      .join("");
    console.log("assistant:", text);
    expect(text.toLowerCase()).toContain("pong");
  }, 150_000);
});
