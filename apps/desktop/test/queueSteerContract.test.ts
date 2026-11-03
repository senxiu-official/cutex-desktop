import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { queueSteerErrorKind, queueSteerErrorMessage, parseQueueSteerError } from "../src/shared/queueSteer";
import { queueSteerNotice } from "../src/renderer/src/lib/queueSteer";
import fixture from "./fixtures/r270-user-input-errors.json";

// Backend producer inventory, independent of the desktop table. CI needs no upstream clone.
const reasons = fixture.cases.filter((entry) => entry.code === "steer_unavailable");
const codes = fixture.cases.filter((entry) => entry.code !== "steer_unavailable");

describe("050 r271 owner-input refusal reasons", () => {
  it("recognizes a definite hostBusy admission refusal without claiming uncertain delivery", () => {
    expect(queueSteerErrorKind("admission_busy", { reason: "hostBusy", retryAfterMs: 1000 })).toBe("hostBusy");
    expect(queueSteerErrorKind("admission_busy", { reason: "other" })).toBe("unrecognized");
    expect(queueSteerErrorKind("admission_busy", { reason: "hostBusy", resyncRequired: true })).toBe("outcomeUnknown");
  });
  it("keeps turnFinishing distinct through IPC and the row's readable reason", () => {
    const kind = queueSteerErrorKind("steer_unavailable", { reason: "turnFinishing" });
    expect(kind).toBe("turnFinishing");
    const wire = queueSteerErrorMessage(kind!);
    expect(parseQueueSteerError(wire)?.kind).toBe("turnFinishing");
    expect(queueSteerNotice(wire, key => key)).toBe("queue.steer.turnFinishing");
    expect(queueSteerErrorKind("steer_unavailable", { reason: "turnFinishing", resyncRequired: true })).toBe("outcomeUnknown");
  });
});

describe("cutex r270 user-input error contract (4af79b6e)", () => {
  it("pins unique product producers and dedicated expected kinds", () => {
    expect(fixture.sourceSHA).toBe("4af79b6ef2a88277ca9dcbff496d198bb5e89dbf");
    expect(reasons.map((entry) => entry.details.reason).sort()).toEqual([
      "admissionBusy", "agentPaused", "delegationTurn", "imagePathRequired", "imageUnavailable",
      "joinChanged", "noActiveTurn", "runtimeNoSteer", "runtimeRefused",
    ]);
    expect(new Set(codes.map((entry) => entry.code)).size).toBe(codes.length);
    expect(codes).toHaveLength(25);
    for (const entry of fixture.cases) {
      expect(entry.expectedKind).not.toBe("unrecognized");
      expect(entry.locations.length).toBeGreaterThan(0);
      for (const location of entry.locations) {
        expect(location.path).toMatch(/^src\/.+\.rs$/);
        expect(location.path).not.toMatch(/tests/);
        expect(location.line).toBeGreaterThan(0);
        expect(location.sourceLine).toContain(entry.code === "steer_unavailable" ? entry.details.reason! : entry.code);
      }
    }
  });
  for (const entry of fixture.cases) {
    it(`${entry.code}${entry.details.reason ? `/${entry.details.reason}` : ""} -> ${entry.expectedKind}`, () => {
      const actual = queueSteerErrorKind(entry.code, entry.details);
      expect(actual).toBe(entry.expectedKind);
      expect(actual).not.toBeNull();
      expect(actual).not.toBe("unrecognized");
    });
  }
  it.each([undefined, null, {}, { reason: "futureSteerReason" }, { reason: 123 }])(
    "flags unknown/missing steer reason (%j) as unrecognized", (details) => {
      expect(queueSteerErrorKind("steer_unavailable", details)).toBe("unrecognized");
    },
  );
  it.each([undefined, null, {}, { reason: "runtimeRefused" }, { resyncRequired: false }])(
    "flags unknown error code (%j) as unrecognized", (details) => {
      expect(queueSteerErrorKind("future_user_input_error", details)).toBe("unrecognized");
    },
  );
  it.each(["steer_unavailable", "future_user_input_error", "event_persistence_unavailable", "turn_conflict"])(
    "%s with explicit resyncRequired remains outcomeUnknown", (code) => {
      expect(queueSteerErrorKind(code, { reason: "futureSteerReason", resyncRequired: true })).toBe("outcomeUnknown");
    },
  );
  it("recognizes the server's wrapped uncertain native outcome", () => {
    expect(queueSteerErrorKind("request_outcome_unknown", {
      resyncRequired: true, originalCode: "event_persistence_unavailable", originalDetails: { stage: "post_submit" },
    })).toBe("outcomeUnknown");
  });
});

const sourceRepository = process.env.CUTEX_CONTRACT_SOURCE_DIR;
it.skipIf(!sourceRepository)("optionally verifies pinned producer anchors and extracts product reasons/codes", () => {
  const sources = new Map<string, string>();
  const source = (path: string) => {
    if (!sources.has(path)) sources.set(path, execFileSync("git", [
      "-C", sourceRepository!, "show", `${fixture.sourceSHA}:${path}`,
    ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }));
    return sources.get(path)!;
  };
  for (const entry of fixture.cases) for (const location of entry.locations) {
    expect(source(location.path).split(/\r?\n/)[location.line - 1]!.trim()).toBe(location.sourceLine);
  }
  // Exclude the test module: its injected refusal strings are not product contracts.
  const product = source("src/cli_app/app_server_user_input.rs").split(/#\[cfg\(test\)\]\s*mod tests\s*\{/)[0]!;
  const image = source("src/management/v2/user_input/image_steering.rs").split("#[cfg(test)]")[0]!;
  const emittedReasons = new Set<string>();
  for (const call of product.matchAll(/steer_unavailable\(\s*([\s\S]*?)\)/g)) {
    for (const literal of call[1]!.matchAll(/"([A-Za-z]+)"/g)) emittedReasons.add(literal[1]!);
  }
  for (const refusal of image.matchAll(/Err\("([A-Za-z]+)"\)/g)) emittedReasons.add(refusal[1]!);
  expect([...emittedReasons].sort()).toEqual(reasons.map((entry) => entry.details.reason).sort());
  // Literal error producers only; status-table entries and assertions are not emitters.
  const emittedCodes = new Set<string>();
  for (const call of product.matchAll(/execution_error(?:_message)?\(\s*"[^"]+"\s*,\s*"([a-z_]+)"/g)) emittedCodes.add(call[1]!);
  for (const field of product.matchAll(/code:\s*"([a-z_]+)"\.(?:into|to_string)\(/g)) emittedCodes.add(field[1]!);
  expect(emittedCodes.size).toBeGreaterThan(8);
  for (const code of emittedCodes) expect(codes.map((entry) => entry.code)).toContain(code);
});

