import { describe, expect, it } from "vitest";
import { maskAddress } from "../src/renderer/src/lib/maskAddress";

describe("maskAddress", () => {
  it("keeps only the first IPv4 octet", () => {
    expect(maskAddress("100.64.0.97")).toBe("100.•.•.•");
    expect(maskAddress("172.16.0.1:5123")).toBe("172.•.•.•");
  });
  it("keeps only the first IPv6 group", () => {
    expect(maskAddress("fd7a:115c:a1e0::1")).toBe("fd7a:…");
    expect(maskAddress("[fd7a:115c::1]:22")).toBe("fd7a:…");
  });
  it("masks host names after the first letter", () => {
    expect(maskAddress("workstation")).toBe("w•••");
  });
});
