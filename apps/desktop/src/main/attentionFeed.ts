// Cross-device read state (design 061): one host's `cutex/summary/attentionChanged` events. The desktop does not
// follow the summary stream otherwise; this opens `GET /v2/summary/events` from the cursor of the attention snapshot
// the renderer read last and forwards only that event. A gap (expired cursor, another stream, a lost connection that
// cannot resume) is `{resync: true}`: the renderer reads the snapshot again, which restarts this feed at its cursor.
// `status` says whether the feed is live; while it is not (refused, host away, reconnecting) the renderer re-reads
// the snapshot now and then instead.
import { CutexApiError, readSse, type CutexClient } from "@cutex-desktop/cutex-client";
import { ATTENTION_EVENT, readAttentionChange, type AttentionChange, type AttentionFeedState } from "../shared/attention";

const RETRY_MS = [1_000, 3_000, 10_000, 30_000];

export class AttentionFeed {
  private run: AbortController | null = null;
  private streamId = "";
  private after = "";
  private live: boolean | null = null;

  constructor(private readonly client: CutexClient, private readonly emit: (change: AttentionChange) => void, private readonly status: (state: AttentionFeedState) => void = () => {}) {}

  private setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    this.status({ live });
  }

  /** Follow the stream after `cursor` (a snapshot's); a running feed of the same stream keeps its later position. */
  follow(cursor: { streamId: string; after: string }): void {
    if (this.run && cursor.streamId === this.streamId && BigInt(cursor.after) <= BigInt(this.after || "0")) return;
    this.stop();
    this.streamId = cursor.streamId;
    this.after = cursor.after;
    const run = new AbortController();
    this.run = run;
    void this.loop(run);
  }

  stop(): void {
    this.run?.abort();
    this.run = null;
    this.live = null;
  }

  private async loop(run: AbortController): Promise<void> {
    let failures = 0;
    while (!run.signal.aborted) {
      try {
        const response = await this.client.summaryEvents({ after: this.after, streamId: this.streamId, signal: run.signal });
        failures = 0;
        if (!run.signal.aborted) this.setLive(true);
        for await (const message of readSse(response)) {
          if (run.signal.aborted) return;
          if (message.id && /^[0-9]+$/.test(message.id)) this.after = message.id;
          if (message.event === ATTENTION_EVENT) {
            let data: unknown = null;
            try { data = JSON.parse(message.data); } catch { /* malformed: read everything again */ }
            this.emit(readAttentionChange(data) ?? { resync: true });
          } else if (message.event === "cutex/summary/resync" || message.event === "cutex/access/changed") {
            this.emit({ resync: true });
          }
        }
      } catch (error) {
        if (run.signal.aborted) return;
        this.setLive(false);
        // The cursor is gone (expired, another stream) or this device may no longer read it: one resync, and the
        // renderer's next snapshot read decides (a refusal there turns the overlay off).
        if (error instanceof CutexApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
          this.run = null;
          this.emit({ resync: true });
          return;
        }
      }
      if (run.signal.aborted) return;
      this.setLive(false);
      // The stream ended or the host is away: resume after the last event once it answers again.
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]));
    }
  }
}
