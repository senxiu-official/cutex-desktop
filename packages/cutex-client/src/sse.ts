export interface SseMessage {
  id: string | undefined;
  event: string;
  data: string;
}

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

  constructor(private readonly onComment?: (text: string) => void) {}

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    let index: number;
    while ((index = this.nextLineBreak()) >= 0) {
      const line = this.buffer.slice(0, index);
      const skip = this.buffer[index] === "\r" && this.buffer[index + 1] === "\n" ? 2 : 1;
      this.buffer = this.buffer.slice(index + skip);
      const message = this.line(line);
      if (message) out.push(message);
    }
    return out;
  }

  private nextLineBreak(): number {
    const cr = this.buffer.indexOf("\r");
    const lf = this.buffer.indexOf("\n");
    if (cr < 0) return lf;
    if (lf < 0) return cr === this.buffer.length - 1 ? -1 : cr; // wait for a possible \n
    return Math.min(cr, lf);
  }

  private line(line: string): SseMessage | null {
    if (line === "") {
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
        break;
      case "data":
        this.data.push(value);
        break;
    }
    return null;
  }
}
