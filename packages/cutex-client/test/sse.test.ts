import { describe, expect, it } from "vitest";
import { SseParser } from "../src/sse";

describe("SseParser", () => {
  it("parses id/event/data across arbitrary chunk boundaries", () => {
    const comments: string[] = [];
    const parser = new SseParser((c) => comments.push(c));
    const input = ": keepalive\n\nid: c1\nevent: cutex_management_event_v2\ndata: {\"a\":1}\n\nid: c2\r\ndata: x\r\ndata: y\r\n\r\n";
    const out = [];
    for (const ch of input) out.push(...parser.push(ch));
    expect(comments).toEqual(["keepalive"]);
    expect(out).toEqual([
      { id: "c1", event: "cutex_management_event_v2", data: '{"a":1}' },
      { id: "c2", event: "message", data: "x\ny" },
    ]);
  });

  it("does not split a CRLF that straddles chunks", () => {
    const parser = new SseParser();
    expect(parser.push("data: a\r")).toEqual([]);
    expect(parser.push("\n\r\n")).toEqual([{ id: undefined, event: "message", data: "a" }]);
  });
});
