// Artifact preview: a JSON object / array reads as a record (modules/artifacts JsonRecord).
import { describe, expect, it } from "vitest";
import { isJsonScalar, jsonKeyLabel, jsonRecordOf } from "../src/renderer/src/modules/artifacts/model";

describe("jsonRecordOf", () => {
  it("takes a whole JSON object or array, whatever the extension", () => {
    expect(jsonRecordOf(' \n{"tests": "23/23 passed", "pass": true}\n', false)).toEqual({ tests: "23/23 passed", pass: true });
    expect(jsonRecordOf("[1, 2]", false)).toEqual([1, 2]);
  });
  it("leaves other text, scalars, broken and truncated JSON alone", () => {
    expect(jsonRecordOf("PASS", false)).toBeNull();
    expect(jsonRecordOf("42", false)).toBeNull();
    expect(jsonRecordOf('{"a": 1', false)).toBeNull();
    expect(jsonRecordOf('{"a": 1}', true)).toBeNull();
    expect(jsonRecordOf('{"a": 1}\n{"b": 2}', false)).toBeNull();
  });
});

describe("jsonKeyLabel / isJsonScalar", () => {
  it("turns keys into labels", () => {
    expect(jsonKeyLabel("director_verification")).toBe("director verification");
    expect(jsonKeyLabel("inputManifest")).toBe("input manifest");
    expect(jsonKeyLabel("raw-arm-order")).toBe("raw arm order");
  });
  it("knows scalars", () => {
    expect([null, 1, "x", false].every(isJsonScalar)).toBe(true);
    expect(isJsonScalar([1])).toBe(false);
    expect(isJsonScalar({})).toBe(false);
  });
});
