import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { fetch as fixedFetch } from "undici";
import { daemonFetch } from "../src/main/daemonFetch";

describe("main daemon fetch parser", () => {
  it("uses the fixed parser at every main-process CutexClient construction", () => {
    expect(daemonFetch).toBe(fixedFetch);
    for (const name of ["daemon", "hosts"]) {
      const source = readFileSync(new URL(`../src/main/${name}.ts`, import.meta.url), "utf8");
      const constructions = source.match(/new CutexClient\([^;\n]+/g) ?? [];
      expect(constructions.length).toBeGreaterThan(0);
      for (const construction of constructions) expect(construction).toContain("fetch: daemonFetch");
    }
  });

  // The child's startup on a busy machine took 7.9 s when measured (48 at once), past this test's old 5 s and
  // close to its old 8 s kill. The test waits for the child's exit; the limits only catch a hang.
  it("survives a close-delimited TCP response ending while its body is backpressured", async () => {
    // Run outside Vitest's process: this exact scenario throws from the socket
    // event, outside the fetch promise, on Electron's embedded undici 7.29.1.
    const undici = createRequire(import.meta.url).resolve("undici");
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=commonjs", "-e", `
      const {createServer} = require('node:net');
      const {fetch} = require(${JSON.stringify(undici)});
      const body = Buffer.alloc(65536, 0x61);
      let peer;
      const server = createServer(socket => socket.once('data', () => {
        peer = socket;
        socket.setNoDelay(true);
        socket.write('HTTP/1.1 200 OK\\r\\nConnection: close\\r\\n\\r\\n');
      }));
      server.listen(0, '127.0.0.1', async () => {
        try {
          const url = 'http://127.0.0.1:' + server.address().port;
          for (const cancel of [false, true]) {
            const response = await fetch(url);
            // Headers parsed and nothing reading the body: only now the body and the FIN.
            await new Promise(resolve => peer.end(body, resolve));
            await new Promise(resolve => setTimeout(resolve, 250));
            if (cancel) await response.body.cancel();
            else if ((await response.arrayBuffer()).byteLength !== body.length) throw Error('lost bytes');
          }
          console.log('consumed and cancelled');
        } catch (error) { console.error(error); process.exitCode = 1; }
        finally { server.close(); }
      });
    `], { encoding: "utf8", timeout: 60_000, windowsHide: true });
    expect(stdout).toContain("consumed and cancelled");
  }, 70_000);
});
