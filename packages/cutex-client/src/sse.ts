export interface SseMessage {
  id: string | undefined;
  event: string;
  data: string;
}

const LIVE_EVENT = "live_delta";
const LIVE_EVENT_MAX_BYTES = 64 * 1024;
const encoder = new TextEncoder();

/**
 * Incremental parser for text/event-stream (WHATWG semantics, minus `retry`).
 * Feed it decoded text chunks; it returns complete messages. Comment lines (`: keepalive`)
 * are reported via `onComment` so callers can track liveness.
 */
export class SseParser {
  private buffer = "";
  private id: string | undefined;
  private event = "";
  private data: string[] = [];
  private liveBytes = 0;
  private droppingLive = false;
  private droppedLineHasContent = false;
  private skipLf = false;

  constructor(private readonly onComment?: (text: string) => void) {}

  push(chunk: string): SseMessage[] {
    const out: SseMessage[] = [];
    let start = 0;
    // Scan incoming text before retaining it: a single huge network chunk must
    // not be copied into an unbounded live-event line buffer.
    for (let index = 0; index < chunk.length; index++) {
      const ch = chunk[index];
      if (ch !== "\r" && ch !== "\n") continue;
      if (ch === "\n" && this.skipLf && index === start) {
        this.skipLf = false;
        start = index + 1;
        continue;
      }
      this.append(chunk.slice(start, index));
      this.skipLf = ch === "\r";
      start = index + 1;
      if (this.droppingLive) {
        if (!this.droppedLineHasContent) {
          this.droppingLive = false;
          this.event = "";
          this.liveBytes = 0;
        }
        this.droppedLineHasContent = false;
        continue;
      }
      const line = this.buffer;
      this.buffer = "";
      const message = this.line(line);
      if (message) out.push(message);
      if (this.event === LIVE_EVENT) {
        this.liveBytes++;
        if (this.liveBytes > LIVE_EVENT_MAX_BYTES) this.dropLive(false);
      }
    }
    this.append(chunk.slice(start));
    return out;
  }

  private append(text: string): void {
    if (!text) return;
    this.skipLf = false;
    if (this.droppingLive) {
      this.droppedLineHasContent = true;
      return;
    }
    if (this.event === LIVE_EVENT) {
      // UTF-16 length is a cheap lower bound before allocating an encoded copy.
      if (text.length > LIVE_EVENT_MAX_BYTES - this.liveBytes ||
          encoder.encode(text).byteLength > LIVE_EVENT_MAX_BYTES - this.liveBytes) {
        this.dropLive(true);
        return;
      }
      this.liveBytes += encoder.encode(text).byteLength;
    }
    this.buffer += text;
  }

  private dropLive(inLine: boolean): void {
    this.droppingLive = true;
    this.droppedLineHasContent = inLine;
    this.buffer = "";
    this.data = [];
  }

  private line(line: string): SseMessage | null {
    if (line === "") {
      this.liveBytes = 0;
      if (this.data.length === 0) {
        this.event = "";
        return null;
      }
      const message = { id: this.id, event: this.event || "message", data: this.data.join("\n") };
      this.event = "";
      this.data = [];
      return message;
    }
    if (line.startsWith(":")) {
      this.onComment?.(line.slice(1).trim());
      return null;
    }
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "id":
        if (!value.includes("\0")) this.id = value;
        break;
      case "event":
        this.event = value;
        if (value === LIVE_EVENT && this.liveBytes === 0) {
          // SSE permits data before event. Once identified, bound that retained
          // data too; unidentified/durable messages retain legacy size semantics.
          this.liveBytes = this.data.reduce((bytes, data) => bytes + encoder.encode(data).byteLength + 1, 0);
          if (this.liveBytes > LIVE_EVENT_MAX_BYTES) this.dropLive(false);
        }
        break;
      case "data":
        this.data.push(value);
        break;
    }
    return null;
  }
}
