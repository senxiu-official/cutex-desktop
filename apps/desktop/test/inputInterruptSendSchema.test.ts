import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import type { InputInterruptSendParams, InputInterruptSendResult } from "@cutex-desktop/protocol";
import { record } from "../src/renderer/src/lib/inputLedger/testkit";

const bytes = readFileSync(new URL("../src/renderer/src/dev/inputLedgerFixtures/schema/cutex-methods-v2.20757152.json", import.meta.url));
const schema = JSON.parse(bytes.toString());
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat("date-time", { type: "string", validate: (value: string) => Number.isFinite(Date.parse(value)) });
const params = ajv.compile({ $defs: schema.$defs, $ref: "#/$defs/inputInterruptSend" });
const result = ajv.compile({ $defs: schema.$defs, $ref: "#/$defs/inputInterruptSendResult" });

describe("interruptSend byte-exact backend20757152 schema", () => {
  it("pins the actual schema blob and accepts only the flat frozen request fields", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("60605ec1303e472ff4c16a8f15235c6926596f28f71a4065a3c3604255e2a302");
    const request: InputInterruptSendParams = { inputId: "existing", expectedRev: 8, expectedTurnId: "t1", expectedRuntimeGeneration: 7 };
    expect(params(request)).toBe(true);
    expect(params({ inputId: "existing", expect: { rev: 8 }, turnId: "t1", runtimeGeneration: 7 })).toBe(false);
    expect(params({ ...request, input: [{ type: "text", text: "copied input" }] })).toBe(false);
    expect(params({ ...request, expectedRev: undefined })).toBe(false);
  });
  it.each(["interrupted", "alreadyInContext", "held", "agentOffline"] as const)("accepts typed outcome %s without using it as a delivery state", outcome => {
    const response: InputInterruptSendResult = { ledgerEpoch: "e", stateRevision: 2, outcome, interruptedTurnId: outcome === "alreadyInContext" ? null : "t1", record: record("existing", { state: "sending", reason: "interruptSend", rev: 9, stateRevision: 2, details: { interruptedTurnId: "t1" } }) };
    expect(result(response), JSON.stringify(result.errors)).toBe(true);
  });
  it.each([["failed", "runtimeRefused"], ["failed", "interrupt_timeout"], ["uncertain", "turnInterrupted"], ["inContext", null]] as const)("outcome interrupted can carry %s/%s instead of success", (state, reason) => {
    const response: InputInterruptSendResult = { ledgerEpoch: "e", stateRevision: 2, outcome: "interrupted", interruptedTurnId: "t1", record: record("existing", { state, reason, surface: "timeline", rev: 9, stateRevision: 2 }) };
    expect(result(response), JSON.stringify(result.errors)).toBe(true);
  });
});
