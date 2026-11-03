import { expect, it } from "vitest";
import { artifactRenderIdentity, fileRenderIdentity, largeRenderChoices, reconsiderFileRender, LargeRenderChoices, LARGE_RENDER_MAX_CHOICES, LARGE_RENDER_TTL_MS } from "../src/renderer/src/lib/largeRenderChoices";

it("keys decisions by host, scoped path, size/mtime or artifact revision/hash", () => {
  const file = (host = "local", size = 8, time = "t1", scope = { kind: "project" as const, id: "p1" }) => fileRenderIdentity(host, scope, "page.html", size, time)!;
  const memory = new LargeRenderChoices();
  memory.set(file(), "page");
  expect(memory.get(file())).toBe("page");
  for (const key of [file("remote"), file("local", 9), file("local", 8, "t2"), file("local", 8, "t1", { kind: "project", id: "p2" })]) expect(memory.get(key)).toBeUndefined();
  expect(fileRenderIdentity("local", null, "a.html", 8)).toBeNull();
  const artifact = artifactRenderIdentity("local", "a", 1, 8, "sha1");
  memory.set(artifact, "page");
  expect(memory.get(artifactRenderIdentity("local", "a", 2, 8, "sha1"))).toBeUndefined();
  expect(memory.get(artifactRenderIdentity("local", "a", 1, 8, "sha2"))).toBeUndefined();
});

it("expires both choices 24 hours after the decision, even when read often", () => {
  let time = 0;
  const memory = new LargeRenderChoices(() => time);
  memory.set("page", "page"); memory.set("source", "source");
  time = LARGE_RENDER_TTL_MS - 1;
  expect(memory.get("page")).toBe("page");
  expect(memory.get("source")).toBe("source");
  time++;
  expect(memory.get("page")).toBeUndefined();
  expect(memory.get("source")).toBeUndefined();
});

it("bounds the desktop LRU to 500 entries, retaining recently used decisions", () => {
  const memory = new LargeRenderChoices();
  for (let i = 0; i < LARGE_RENDER_MAX_CHOICES; i++) memory.set(String(i), "page");
  memory.get("0"); memory.set("new", "source");
  expect(memory.get("1")).toBeUndefined();
  expect(memory.get("0")).toBe("page");
  expect(memory.get("new")).toBe("source");
});

it("lets Preview reconsider a source choice for this file without discarding other files or accepted pages", () => {
  const file = fileRenderIdentity("local", null, "/a.html", 8, "t1")!;
  const other = fileRenderIdentity("remote", null, "/a.html", 8, "t1")!;
  const accepted = fileRenderIdentity("local", null, "/a.html", 9, "t2")!;
  largeRenderChoices.set(file, "source"); largeRenderChoices.set(other, "source"); largeRenderChoices.set(accepted, "page");
  reconsiderFileRender("local", null, "/a.html");
  expect(largeRenderChoices.get(file)).toBeUndefined();
  expect(largeRenderChoices.get(other)).toBe("source");
  expect(largeRenderChoices.get(accepted)).toBe("page");
  largeRenderChoices.clear();
});
