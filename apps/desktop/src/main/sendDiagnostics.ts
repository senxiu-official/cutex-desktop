import type { SubmitHttpTraceEvent } from "@cutex-desktop/cutex-client";

/** Fixed ten one-second buckets: no timers, payload copies or per-event log writes. */
export class RecentFeedTraffic {
  private buckets = Array.from({ length: 10 }, () => ({ second: -1, bytes: 0, events: 0 }));
  constructor(private readonly now = () => performance.now()) {}
  add(sample: { bytes: number; events: number }): void {
    const second = Math.floor(this.now() / 1000);
    const bucket = this.buckets[second % this.buckets.length]!;
    if (bucket.second !== second) Object.assign(bucket, { second, bytes: 0, events: 0 });
    if (Number.isFinite(sample.bytes) && sample.bytes > 0) bucket.bytes += Math.floor(sample.bytes);
    if (Number.isFinite(sample.events) && sample.events > 0) bucket.events += Math.floor(sample.events);
  }
  snapshot(): { windowMs: number; bytes: number; events: number } {
    const second = Math.floor(this.now() / 1000);
    let bytes = 0, events = 0;
    for (const bucket of this.buckets) {
      if (bucket.second <= second && bucket.second > second - 10) { bytes += bucket.bytes; events += bucket.events; }
    }
    return { windowMs: 10_000, bytes, events };
  }
}

/** Default submit has at most four attempts. Allowlist metadata even if a caller adds fields. */
export function submitHttpTraceBuffer() {
  const records: SubmitHttpTraceEvent[] = [];
  return {
    observe(event: SubmitHttpTraceEvent): void {
      if (records.length >= 12 || !/^[a-zA-Z0-9._:-]{1,128}$/.test(event.requestId)) return;
      if (!["fetch-headers", "fetch-body", "response-parse"].includes(event.stage)) return;
      records.push({
        requestId: event.requestId, attempt: event.attempt, stage: event.stage,
        elapsedMs: Math.max(0, Math.round(event.elapsedMs)), outcome: event.outcome,
        ...(event.status === undefined ? {} : { status: event.status }),
        ...(event.parsed === undefined ? {} : { parsed: event.parsed }),
      });
    },
    snapshot: () => records.map((record) => ({ ...record })),
  };
}
