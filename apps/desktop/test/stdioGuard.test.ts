// main/stdioGuard (dual-screen run 2026-10-28): with stdout piped to a process that has exited, a console write at quit
// threw EPIPE as an uncaught exception — Electron's "A JavaScript error occurred in the main process" dialog, again on
// every later write, and quit never finished. Guarded streams swallow the error and drop later writes. (Plain Node on
// Windows does not surface a stdout EPIPE; Electron's main process does — checked there by hand, see PROGRESS.md.)
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { guardStdio } from "../src/main/stdioGuard";

const epipe = () => Object.assign(new Error("write EPIPE"), { code: "EPIPE", errno: -32, syscall: "write" });

/** A stream whose reader is gone: every write fails with EPIPE, reported as an 'error' event (as Node does). */
function brokenPipe(): Writable & { attempts: number } {
  const s = new Writable({
    write(_chunk, _enc, cb) {
      s.attempts++;
      cb(epipe());
    },
  }) as Writable & { attempts: number };
  s.attempts = 0;
  return s;
}

const uncaught: unknown[] = [];
const onUncaught = (e: unknown) => uncaught.push(e);

afterEach(() => {
  process.off("uncaughtException", onUncaught);
  uncaught.length = 0;
});

describe("guardStdio", () => {
  it("without the guard the EPIPE has no listener (the error dialog's cause)", () => {
    const s = brokenPipe();
    // EventEmitter: an 'error' with no listener throws — in the main process that is the uncaught exception.
    expect(() => s.emit("error", epipe())).toThrow(/EPIPE/);
  });

  it("an EPIPE on write is swallowed; later writes are dropped without throwing and their callbacks still run", async () => {
    process.on("uncaughtException", onUncaught);
    const s = brokenPipe();
    guardStdio([s]);
    expect(() => s.write("first\n")).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.attempts).toBe(1);
    const done: string[] = [];
    for (let i = 0; i < 5; i++) expect(() => s.write(`line ${i}\n`, () => done.push(String(i)))).not.toThrow();
    expect(s.write("x", "utf8", () => done.push("enc"))).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(s.attempts).toBe(1);
    expect(done).toEqual(["0", "1", "2", "3", "4", "enc"]);
    expect(uncaught).toEqual([]);
  });

  it("a synchronous throw from write (a destroyed stream) does not reach the caller either", () => {
    let calls = 0;
    const s = {
      on: () => s,
      write: (() => {
        calls++;
        throw epipe();
      }) as (...args: never[]) => boolean,
    };
    guardStdio([s]);
    expect(() => (s.write as (c: string) => boolean)("a")).not.toThrow();
    expect(() => (s.write as (c: string) => boolean)("b")).not.toThrow();
    expect(calls).toBe(1);
  });

  it("guards a stream once (a second call adds no second wrapper / listener)", () => {
    const s = brokenPipe();
    guardStdio([s]);
    const write = s.write;
    guardStdio([s, s]);
    expect(s.write).toBe(write);
    expect(s.listenerCount("error")).toBe(1);
  });
});
