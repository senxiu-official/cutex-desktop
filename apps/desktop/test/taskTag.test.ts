import { describe, expect, it } from "vitest";
import { taskTag } from "../src/renderer/src/lib/tasks";

describe("taskTag", () => {
  const ask = "ask-5e89dd8c9fa048e4b420adf3630eda79";

  it("spells a delegation as cutex shortens it, in either spelling of its id", () => {
    expect(taskTag(ask).label).toBe("#5e89dd");
    expect(taskTag("delegation-5e89dd8c9fa048e4b420adf3630eda79").label).toBe("#5e89dd");
  });

  it("depends on the id alone: not on which ids came first", () => {
    const first = taskTag(ask);
    taskTag("ask-000000aa");
    taskTag("ask-111111bb");
    expect(taskTag(ask)).toEqual(first);
    expect(taskTag("ask-000000aa").label).toBe("#000000");
  });

  it("keeps a short or prefix-only id readable", () => {
    expect(taskTag("ask-1").label).toBe("#1");
    expect(taskTag("job-").label).toBe("#job-");
    expect(taskTag("0a1b2c3d4e").label).toBe("#0a1b2c");
  });
});
