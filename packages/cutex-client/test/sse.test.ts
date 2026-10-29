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

  it("drops oversized live data in one chunk and resumes at the next blank line", () => {
    const parser = new SseParser();
    expect(parser.push(`id: c1\nevent: live_delta\ndata: ${"x".repeat(200_000)}\n\nevent: durable\ndata: final\n\n`)).toEqual([
      { id: "c1", event: "durable", data: "final" },
    ]);
  });

  it("bounds an unterminated live line across arbitrarily many chunks, including ignored fields", () => {
    const parser = new SseParser();
    parser.push("event: live_delta\ndata: ");
    for (let i = 0; i < 100; i++) expect(parser.push("中😀".repeat(4096))).toEqual([]);
    // Inspect retained parser state, not just emitted messages: the attacker
    // never finishes this line, so post-dispatch bounds would not protect it.
    expect(JSON.stringify(parser).length).toBeLessThan(1024);
    expect(parser.push("\r")).toEqual([]);
    expect(parser.push("\nignored: more\r\n\r")).toEqual([]);
    expect(parser.push("\nevent: durable\r\ndata: repaired\r\n\r\n")).toEqual([
      { id: undefined, event: "durable", data: "repaired" },
    ]);
  });

  it("bounds accumulated live data lines and empty-data metadata overhead", () => {
    const parser = new SseParser();
    expect(parser.push(`event: live_delta\n${"data: x\n".repeat(20_000)}\nevent: durable\ndata: next\n\n`)).toEqual([
      { id: undefined, event: "durable", data: "next" },
    ]);
    expect(parser.push(`event: live_delta\n${"data:\n".repeat(20_000)}\nevent: durable\ndata: next2\n\n`)).toEqual([
      { id: undefined, event: "durable", data: "next2" },
    ]);
  });

  it("preserves legacy large durable events and ordinary live frames across CR/LF chunks", () => {
    const parser = new SseParser();
    const large = "中😀".repeat(100_000);
    expect(parser.push(`event: durable\ndata: ${large}\n\nevent: live_delta\r`)).toEqual([
      { id: undefined, event: "durable", data: large },
    ]);
    expect(parser.push("\ndata: 中😀\r")).toEqual([]);
    expect(parser.push("\n\r\n")).toEqual([{ id: undefined, event: "live_delta", data: "中😀" }]);
  });

  it("rejects oversized data preceding a late live event declaration once its type is known", () => {
    const parser = new SseParser();
    expect(parser.push(`data: ${"x".repeat(70_000)}\nevent: live_delta\n\ndata: following\n\n`)).toEqual([
      { id: undefined, event: "message", data: "following" },
    ]);
  });
});
